import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { storyboardItems } from "../data.js";
import { createDefaultTagGroups, normalizeTagGroups } from "../tagSettings.js";
import { normalizeDraft, normalizeContentEntry, presentCase } from "../lib/contentEntries.js";

// Live data belongs on a persistent volume, not in the compiled server bundle.
export const storageRoot = () => path.resolve(/* turbopackIgnore: true */ process.env.JINGJIE_DATA_DIR || path.join(process.cwd(), "storage"));
export class ContentError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
export function createRepository(directory = storageRoot(), seeds = storyboardItems) {
  mkdirSync(directory, { recursive: true });
  const db = new DatabaseSync(path.join(directory, "content.sqlite"));
  db.exec("PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;");
  db.exec(`CREATE TABLE IF NOT EXISTS content (
    id TEXT PRIMARY KEY, draft TEXT NOT NULL, published TEXT, status TEXT NOT NULL CHECK(status IN ('draft','published','offline')),
    revision INTEGER NOT NULL, updated_at TEXT NOT NULL, published_at TEXT, position INTEGER NOT NULL
  ); CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, revision INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS media (name TEXT PRIMARY KEY, mime TEXT NOT NULL, size INTEGER NOT NULL, original_name TEXT NOT NULL);`);
  const transaction = (work) => {
    db.exec("BEGIN IMMEDIATE");
    try { const result = work(); db.exec("COMMIT"); return result; }
    catch (error) { db.exec("ROLLBACK"); throw error; }
  };
  transaction(() => {
    if (!db.prepare("SELECT key FROM settings WHERE key='initialized'").get()) {
      seeds.forEach((seed, index) => {
        const content = JSON.stringify(normalizeDraft(seed));
        db.prepare("INSERT INTO content VALUES (?, ?, ?, 'published', 1, ?, ?, ?)").run(seed.id, content, content, "2026-09-07T00:00:00.000Z", "2026-09-07T00:00:00.000Z", index);
      });
      db.prepare("INSERT INTO settings VALUES ('initialized','true',1)").run();
      db.prepare("INSERT INTO settings VALUES ('tags',?,1)").run(JSON.stringify(createDefaultTagGroups()));
    }
  });
  const record = (row) => row ? { id: row.id, draft: JSON.parse(row.draft), status: row.status, revision: row.revision, updatedAt: row.updated_at, publishedAt: row.published_at, hasChanges: row.published !== row.draft } : null;
  const getRow = (id) => db.prepare("SELECT * FROM content WHERE id=?").get(id);
  const checkRevision = (row, revision) => {
    if (row && row.revision !== revision) throw new ContentError("内容已在其他页面更新，请重新载入后再编辑；当前输入仍保留。", 409);
    if (!row && revision != null) throw new ContentError("案例不存在或已被删除", 404);
  };
  return {
    close: () => db.close(),
    listRecords: () => db.prepare("SELECT * FROM content ORDER BY updated_at DESC, position ASC").all().map(record),
    getRecord: (id) => record(getRow(id)),
    listPublished: () => db.prepare("SELECT published FROM content WHERE status='published' ORDER BY published_at DESC, position ASC").all().map((row) => presentCase(JSON.parse(row.published))),
    getPublished: (id) => { const row = getRow(id); return row?.status === "published" ? presentCase(JSON.parse(row.published)) : null; },
    change: ({ action, draft, id, revision }) => transaction(() => {
      if (!["save", "publish", "unlist", "relist", "delete"].includes(action)) throw new ContentError("不支持的内容操作");
      const targetId = id || `case-${randomUUID()}`;
      const row = getRow(targetId);
      checkRevision(row, revision);
      const now = new Date().toISOString();
      if (action === "save" || action === "publish") {
        const value = JSON.stringify(normalizeContentEntry({ ...draft, id: targetId }, { publish: action === "publish" }));
        if (!row) {
          const position = db.prepare("SELECT COALESCE(MAX(position),0)+1 AS value FROM content").get().value;
          db.prepare("INSERT INTO content VALUES (?, ?, ?, ?, 1, ?, ?, ?)").run(targetId, value, action === "publish" ? value : null, action === "publish" ? "published" : "draft", now, action === "publish" ? now : null, position);
        } else {
          db.prepare("UPDATE content SET draft=?, published=?, status=?, revision=revision+1, updated_at=?, published_at=? WHERE id=?").run(value, action === "publish" ? value : row.published, action === "publish" ? "published" : row.status, now, action === "publish" ? now : row.published_at, targetId);
        }
      } else {
        if (!row) throw new ContentError("案例不存在", 404);
        if (action === "delete") {
          if (row.status !== "draft" || row.published) throw new ContentError("已发布过的内容请使用下架，原资料会保留");
          db.prepare("DELETE FROM content WHERE id=?").run(targetId);
          return null;
        }
        if (action === "unlist" && row.status !== "published") throw new ContentError("只有已发布内容可以下架");
        if (action === "relist" && (row.status !== "offline" || !row.published)) throw new ContentError("只有已下架内容可以重新上架");
        // Relisting restores the last publication, never a pending edit.
        db.prepare("UPDATE content SET status=?, revision=revision+1, updated_at=? WHERE id=?").run(action === "unlist" ? "offline" : "published", now, targetId);
      }
      return record(getRow(targetId));
    }),
    readTags: () => { const row = db.prepare("SELECT * FROM settings WHERE key='tags'").get(); return { groups: JSON.parse(row.value), revision: row.revision }; },
    saveTags: (groups, revision) => transaction(() => {
      const current = db.prepare("SELECT revision FROM settings WHERE key='tags'").get();
      if (current.revision !== revision) throw new ContentError("标签已在其他页面更新，请刷新后再修改", 409);
      const normalized = normalizeTagGroups(groups);
      db.prepare("UPDATE settings SET value=?, revision=revision+1 WHERE key='tags'").run(JSON.stringify(normalized));
      return { groups: normalized, revision: revision + 1 };
    }),
    addMedia: (media) => db.prepare("INSERT INTO media VALUES (?, ?, ?, ?)").run(media.name, media.mime, media.size, media.originalName),
    getMedia: (name) => db.prepare("SELECT * FROM media WHERE name=?").get(name),
  };
}
export function withRepository(work) {
  const repository = createRepository();
  try { return work(repository); } finally { repository.close(); }
}
