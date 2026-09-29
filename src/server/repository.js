import { randomUUID } from "node:crypto";
import { storyboardItems } from "../data.js";
import { createDefaultTagGroups, normalizeTagGroups } from "../tagSettings.js";
import { normalizeDraft, normalizeContentEntry, presentCase } from "../lib/contentEntries.js";
import { ContentError } from "./errors.js";
import { createDataProvider } from "./storage/provider.js";

export { ContentError } from "./errors.js";

export function createInitialDocument(seeds = storyboardItems) {
  return {
    version: 1,
    content: seeds.map((seed, position) => ({
      id: seed.id, draft: normalizeDraft(seed), published: normalizeDraft(seed), status: "published", revision: 1,
      updatedAt: "2026-09-07T00:00:00.000Z", publishedAt: "2026-09-07T00:00:00.000Z", position,
    })),
    tags: { groups: createDefaultTagGroups(), revision: 1 },
    media: [],
  };
}

/** Business rules depend only on DataProvider, never on JSON or filesystem details. */
export function createRepository({ directory, seeds = storyboardItems, provider } = {}) {
  const storage = provider ?? createDataProvider({ directory, initialize: () => createInitialDocument(seeds) });
  const record = (row) => row ? {
    id: row.id, draft: row.draft, status: row.status, revision: row.revision,
    updatedAt: row.updatedAt, publishedAt: row.publishedAt,
    hasChanges: JSON.stringify(row.published) !== JSON.stringify(row.draft),
  } : null;
  const checkRevision = (row, revision) => {
    if (row && row.revision !== revision) throw new ContentError("内容已在其他页面更新，请重新载入后再编辑；当前输入仍保留。", 409);
    if (!row && revision != null) throw new ContentError("案例不存在或已被删除", 404);
  };
  const sorted = (rows, field) => rows.sort((a, b) => b[field].localeCompare(a[field]) || a.position - b.position);
  return {
    close: () => storage.close(),
    listRecords: async () => sorted((await storage.read()).content, "updatedAt").map(record),
    getRecord: async (id) => record((await storage.read()).content.find((row) => row.id === id)),
    listPublished: async () => sorted((await storage.read()).content.filter((row) => row.status === "published"), "publishedAt").map((row) => presentCase(row.published)),
    getPublished: async (id) => {
      const row = (await storage.read()).content.find((row) => row.id === id);
      return row?.status === "published" ? presentCase(row.published) : null;
    },
    change: ({ action, draft, id, revision }) => storage.update((document) => {
      if (!["save", "publish", "unlist", "relist", "delete"].includes(action)) throw new ContentError("不支持的内容操作");
      const targetId = id || `case-${randomUUID()}`;
      let row = document.content.find((entry) => entry.id === targetId);
      checkRevision(row, revision);
      const now = new Date().toISOString();
      if (action === "save" || action === "publish") {
        const value = normalizeContentEntry({ ...draft, id: targetId }, { publish: action === "publish" });
        if (!row) {
          row = {
            id: targetId, draft: value, published: null, status: "draft", revision: 0, publishedAt: null,
            position: document.content.reduce((max, entry) => Math.max(max, entry.position), 0) + 1,
          };
          document.content.push(row);
        }
        row.draft = value;
        if (action === "publish") {
          row.published = structuredClone(value);
          row.status = "published";
          row.publishedAt = now;
        }
      } else {
        if (!row) throw new ContentError("案例不存在", 404);
        if (action === "delete") {
          if (row.status !== "draft" || row.published) throw new ContentError("已发布过的内容请使用下架，原资料会保留");
          document.content = document.content.filter((entry) => entry.id !== targetId);
          return null;
        }
        if (action === "unlist" && row.status !== "published") throw new ContentError("只有已发布内容可以下架");
        if (action === "relist" && (row.status !== "offline" || !row.published)) throw new ContentError("只有已下架内容可以重新上架");
        row.status = action === "unlist" ? "offline" : "published";
      }
      row.revision++;
      row.updatedAt = now;
      return record(row);
    }),
    readTags: async () => (await storage.read()).tags,
    saveTags: (groups, revision) => storage.update((document) => {
      if (document.tags.revision !== revision) throw new ContentError("标签已在其他页面更新，请刷新后再修改", 409);
      document.tags = { groups: normalizeTagGroups(groups), revision: revision + 1 };
      return document.tags;
    }),
    addMedia: (media) => storage.update((document) => {
      if (document.media.some((item) => item.name === media.name)) throw new ContentError("素材已存在", 409);
      document.media.push(media);
    }),
    getMedia: async (name) => (await storage.read()).media.find((item) => item.name === name) ?? null,
    writeMedia: (name, chunks) => storage.writeMedia(name, chunks),
    statMedia: (name) => storage.statMedia(name),
    openMedia: (name, range) => storage.openMedia(name, range),
    removeMedia: (name) => storage.removeMedia(name),
    exportMedia: (name, destination) => storage.exportMedia(name, destination),
  };
}

export async function withRepository(work, options) {
  const repository = createRepository(options);
  try { return await work(repository); }
  finally { await repository.close(); }
}
