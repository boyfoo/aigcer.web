import { randomUUID } from "node:crypto";
import { storyboardItems } from "../data.js";
import { createDefaultTagGroups, normalizeTagGroups } from "../tagSettings.js";
import { normalizeDraft, normalizeContentEntry, presentCase } from "../lib/contentEntries.js";
import { ContentError } from "./errors.js";
import { createDataProvider } from "./storage/provider.js";
import { initialMedia } from "./seedMedia.js";

export { ContentError } from "./errors.js";

export function createInitialDocument(seeds = storyboardItems) {
  return {
    version: 2,
    content: seeds.map((seed, position) => ({
      id: seed.id, draft: normalizeDraft(seed), published: normalizeDraft(seed), status: "published", revision: 1,
      updatedAt: "2026-09-07T00:00:00.000Z", publishedAt: "2026-09-07T00:00:00.000Z", position,
    })),
    tags: { groups: createDefaultTagGroups(), revision: 1 },
    media: seeds === storyboardItems ? structuredClone(initialMedia) : [],
    submissions: [],
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
    getSubmission: async (id) => (await storage.read()).submissions.find((entry) => entry.id === id) ?? null,
    prepareSubmission: (submission) => storage.update((document) => {
      const existing = document.submissions.find((entry) => entry.requestId === submission.requestId);
      if (existing) {
        if (existing.manifestHash !== submission.manifestHash) throw new ContentError("同一提交标识的文件清单发生变化，请为新的提交使用新的 requestId。", 409);
        return existing;
      }
      document.submissions.push(submission);
      return submission;
    }),
    commitSubmission: ({ submissionId, payloadHash, draft, media, source, result }) => storage.update(async (document) => {
      const submission = document.submissions.find((entry) => entry.id === submissionId);
      if (!submission) throw new ContentError("提交不存在，请先申请上传地址。", 404);
      if (submission.status === "submitted") {
        if (submission.payloadHash !== payloadHash) throw new ContentError("这次提交已保存，不能用同一提交标识覆盖不同资料。", 409);
        return submission.result;
      }
      const value = normalizeDraft(await storage.canonicalizeMediaUrls(draft, [...document.media, ...media]));
      if (document.content.some((entry) => entry.id === value.id)) throw new ContentError("案例标识已存在，提交未覆盖原资料。", 409);
      for (const item of media) {
        if (document.media.some((entry) => entry.name === item.name)) throw new ContentError("素材标识已存在，提交未覆盖原素材。", 409);
      }
      const now = new Date().toISOString();
      document.media.push(...media);
      document.content.push({
        id: value.id, draft: value, published: null, status: "draft", revision: 1,
        updatedAt: now, publishedAt: null,
        position: document.content.reduce((max, entry) => Math.max(max, entry.position), 0) + 1,
      });
      Object.assign(submission, { status: "submitted", updatedAt: now, caseId: value.id, payloadHash, source, result });
      return result;
    }),
    change: ({ action, draft, id, revision }) => storage.update(async (document) => {
      if (!["save", "publish", "unlist", "relist", "delete"].includes(action)) throw new ContentError("不支持的内容操作");
      const targetId = id || `case-${randomUUID()}`;
      let row = document.content.find((entry) => entry.id === targetId);
      checkRevision(row, revision);
      const now = new Date().toISOString();
      if (action === "save" || action === "publish") {
        const canonical = await storage.canonicalizeMediaUrls(draft, document.media);
        const value = normalizeContentEntry({ ...canonical, id: targetId }, { publish: action === "publish" });
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
    confirmMedia: (media) => storage.update((document) => {
      const existing = document.media.find((item) => item.name === media.name);
      if (existing) {
        if (["mime", "size", "originalName"].some((field) => existing[field] !== media[field]) ||
            ["provider", "bucket", "key"].some((field) => existing.storage?.[field] !== media.storage[field])) {
          throw new ContentError("素材已登记且与上传确认信息不一致", 409);
        }
        return existing;
      }
      document.media.push(media);
      return media;
    }),
    getMedia: async (name) => (await storage.read()).media.find((item) => item.name === name) ?? null,
    createMediaUrl: (name, method, uploadedStorage) => storage.createMediaUrl(name, method, uploadedStorage),
    getMediaReference: (name, uploadedStorage) => storage.getMediaReference(name, uploadedStorage),
    getPlannedMediaReference: (name) => storage.getPlannedMediaReference(name),
    resolveMediaReference: (url) => storage.resolveMediaReference(url),
    resolveMediaAccess: (value) => storage.resolveMediaAccess(value),
    resolveStaticMedia: (value) => storage.resolveStaticMedia(value),
    removeMedia: (name, uploadedStorage) => storage.removeMedia(name, uploadedStorage),
    exportMedia: (name, destination) => storage.exportMedia(name, destination),
    getDirectUploadConfig: () => storage.getDirectUploadConfig(),
    makeUploadKey: (submissionId, name) => storage.makeUploadKey(submissionId, name),
    createUploadUrl: (file) => storage.createUploadUrl(file),
    createBrowserUpload: (input) => storage.createBrowserUpload(input),
    verifyBrowserUpload: (uploadToken) => storage.verifyBrowserUpload(uploadToken),
    removeUploadedObject: (key) => storage.removeUploadedObject(key),
    inspectUploadedObject: (file) => storage.inspectUploadedObject(file),
    promoteUploadedObject: (file) => storage.promoteUploadedObject(file),
  };
}

export async function withRepository(work, options) {
  const repository = createRepository(options);
  try { return await work(repository); }
  finally { await repository.close(); }
}
