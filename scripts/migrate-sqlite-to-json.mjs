import { DatabaseSync } from "node:sqlite";
import { access, cp, mkdir, mkdtemp, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateDocument, validMediaName } from "../src/server/storage/document.js";
import { JsonDataProvider } from "../src/server/storage/json.js";

const root = fileURLToPath(new URL("../", import.meta.url));

/** Run with the old service stopped. The SQLite source is opened read-only and retained. */
export async function migrateSqlite(source, destination) {
  source = path.resolve(source);
  destination = path.resolve(destination);
  if (source === destination) throw new Error("迁移目标必须是独立的新目录；原 SQLite 与素材将保留。 ");
  try { await access(destination); throw new Error("目标目录已存在，拒绝覆盖已有数据。请选择新的空路径。"); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  const db = new DatabaseSync(path.join(source, "content.sqlite"), { readOnly: true });
  let document;
  try {
    db.exec("BEGIN");
    const tags = db.prepare("SELECT value, revision FROM settings WHERE key='tags'").get();
    document = validateDocument({
      version: 2,
      submissions: [],
      content: db.prepare("SELECT * FROM content ORDER BY position").all().map((row) => ({
        id: row.id, draft: JSON.parse(row.draft), published: row.published === null ? null : JSON.parse(row.published),
        status: row.status, revision: row.revision, updatedAt: row.updated_at, publishedAt: row.published_at, position: row.position,
      })),
      tags: { groups: JSON.parse(tags.value), revision: tags.revision },
      media: db.prepare("SELECT * FROM media").all().map((row) => ({ name: row.name, mime: row.mime, size: row.size, originalName: row.original_name })),
    });
  } finally { db.close(); }

  await mkdir(path.dirname(destination), { recursive: true });
  const staging = await mkdtemp(path.join(path.dirname(destination), `.${path.basename(destination)}-migration-`));
  try {
    const uploads = path.join(source, "uploads");
    const info = await stat(uploads).catch((error) => { if (error.code !== "ENOENT") throw error; });
    if (info) await cp(uploads, path.join(staging, "uploads"), { recursive: true, errorOnExist: true, force: false });
    for (const media of document.media) {
      if (!validMediaName(media.name)) throw new Error("迁移素材文件名无效");
      const file = await stat(path.join(staging, "uploads", media.name));
      if (!file.isFile() || file.size !== media.size) throw new Error(`素材缺失或大小不匹配：${media.name}`);
    }
    const provider = new JsonDataProvider({ directory: staging, initialize: () => document });
    validateDocument(await provider.read());
    // Recheck after copying; migration must never replace a newly initialized destination.
    try { await access(destination); throw new Error("目标目录已存在，迁移未覆盖它。"); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    await rename(staging, destination);
    return { content: document.content.length, media: document.media.length, destination };
  } finally {
    const resolved = path.resolve(staging);
    if (path.dirname(resolved) !== path.dirname(destination) || !path.basename(resolved).startsWith(`.${path.basename(destination)}-migration-`)) throw new Error("Unsafe migration cleanup path");
    await rm(resolved, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await migrateSqlite(process.argv[2] || path.join(root, "storage"), process.argv[3] || path.join(root, "data"));
  console.log(`已迁移 ${result.content} 条案例、${result.media} 条媒体记录到 ${result.destination}；原 SQLite 和素材完整保留。`);
}
