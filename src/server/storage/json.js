import { mkdir, readFile, open, rename, unlink, rmdir, stat, copyFile, readdir } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import path from "node:path";
import { ContentError } from "../errors.js";
import { validateDocument, validMediaName, sameStoredMedia } from "./document.js";
import { validCaseId } from "../../lib/contentEntries.js";
import { OssMediaStorage } from "./oss.js";
import { isOssMediaUrl, mapMediaUrls, mediaNameFromUrl, matchesMediaReference, unsignedOssUrl } from "../../lib/mediaUrls.js";

const serialize = (value) => JSON.stringify(value, null, 2) + "\n";
const storageError = (message) => new ContentError(`${message}；请检查数据文件，原数据不会重新初始化。`, 503);
const dataFilename = (name) => ["content.json", "tags.json", "media.json", "submissions.json"].includes(name) ||
  (typeof name === "string" && name.startsWith("content/") && name.endsWith(".json") && validCaseId(name.slice(8, -5)));

function filesFor(document) {
  validateDocument(document);
  const files = new Map([
    ["content.json", { version: 3, items: document.content.map(({ draft, published, ...record }) => ({ ...record, kind: draft.kind, title: draft.title })) }],
    ["tags.json", { version: 1, ...document.tags }],
    ["media.json", { version: 1, items: document.media }],
    ["submissions.json", { version: 1, items: document.submissions }],
  ]);
  for (const { id, draft, published } of document.content) files.set(`content/${id}.json`, { version: 1, id, draft, published });
  return new Map([...files].map(([name, value]) => [name, serialize(value)]));
}

/** @implements {import('./provider.js').DataProvider} */
export class JsonDataProvider {
  constructor({ directory, initialize, oss }) {
    this.directory = path.resolve(directory);
    this.lock = path.join(this.directory, ".content.lock");
    this.journal = ".content-transaction.json";
    this.initialize = initialize;
    this.oss = oss ?? new OssMediaStorage();
  }

  async readText(name) {
    try { return await readFile(path.join(this.directory, name), "utf8"); }
    catch (error) { if (error.code === "ENOENT") return null; throw error; }
  }

  async readJson(name, optional = false) {
    const text = await this.readText(name);
    if (text === null) {
      if (optional) return null;
      throw storageError(`数据文件缺失：${name}`);
    }
    try { const value = JSON.parse(text); if (value === null) throw new Error("null document"); return value; }
    catch { throw storageError(`数据文件不是有效的 JSON：${name}`); }
  }

  async hasSplitFiles() {
    const details = await readdir(path.join(this.directory, "content")).catch((error) => { if (error.code !== "ENOENT") throw error; return []; });
    return await this.readText("tags.json") !== null || await this.readText("media.json") !== null ||
      await this.readText("submissions.json") !== null || details.length > 0;
  }

  async readExisting() {
    const index = await this.readJson("content.json", true);
    if (index === null) {
      if (await this.hasSplitFiles()) throw storageError("案例索引 content.json 缺失，但目录中仍有其他数据文件");
      return null;
    }
    // One-time migration at the storage boundary; subsequent access uses split files only.
    if (index?.version === 1 && Array.isArray(index.content)) {
      const document = validateDocument({ ...index, version: 2, submissions: [] });
      if (await this.hasSplitFiles()) throw storageError("旧合并文件与拆分文件同时存在，无法安全自动迁移");
      await this.write(document);
      return document;
    }
    if (![2, 3].includes(index?.version) || !Array.isArray(index.items)) throw storageError("案例索引结构或版本无效");
    const ids = new Set();
    for (const entry of index.items) {
      if (!validCaseId(entry?.id) || ids.has(entry.id)) throw storageError("案例索引包含无效或重复的标识");
      ids.add(entry.id);
    }
    const [tags, media, submissions, content] = await Promise.all([
      this.readJson("tags.json"),
      this.readJson("media.json"),
      this.readJson("submissions.json", index.version === 2),
      Promise.all(index.items.map(async ({ kind, title, ...record }) => {
        const detail = await this.readJson(`content/${record.id}.json`);
        if (detail?.version !== 1 || detail.id !== record.id) throw storageError(`案例详情结构或版本无效：${record.id}`);
        return { ...record, draft: detail.draft, published: detail.published };
      })),
    ]);
    if (tags?.version !== 1 || media?.version !== 1 || (submissions !== null && submissions?.version !== 1)) throw storageError("标签、素材或提交索引版本无效");
    if (index.version === 2 && submissions !== null) throw storageError("旧案例索引与提交索引同时存在，无法安全自动迁移");
    const document = validateDocument({ version: 2, content, tags: { groups: tags.groups, revision: tags.revision },
      media: media.items, submissions: submissions?.items ?? [] });
    if (index.version === 2) await this.write(document);
    return document;
  }

  async locked(work) {
    await mkdir(this.directory, { recursive: true });
    const deadline = Date.now() + 5000;
    while (true) {
      try { await mkdir(this.lock); break; }
      catch (error) {
        if (error.code !== "EEXIST") throw error;
        if (Date.now() >= deadline) throw new ContentError("数据正在写入，请稍后重试；若服务曾异常退出，请停服后检查数据目录中的 .content.lock。", 503);
        await delay(25);
      }
    }
    try { await this.recover(); return await work(); }
    finally { await rmdir(this.lock); }
  }

  async atomicWrite(name, text) {
    const target = path.join(this.directory, name);
    await mkdir(path.dirname(target), { recursive: true });
    const temporary = `${target}.${randomUUID()}.tmp`;
    let file;
    try {
      file = await open(temporary, "wx");
      await file.writeFile(text, "utf8");
      await file.sync();
      await file.close();
      file = null;
      await rename(temporary, target);
    } finally {
      await file?.close();
      await unlink(temporary).catch((error) => { if (error.code !== "ENOENT") throw error; });
    }
  }

  async removeDataFile(name) {
    await unlink(path.join(this.directory, name)).catch((error) => { if (error.code !== "ENOENT") throw error; });
  }

  async recover() {
    const journal = await this.readJson(this.journal, true);
    if (journal === null) return;
    if (journal?.version !== 1 || !Array.isArray(journal.files) || journal.files.some((entry) =>
      !entry || !dataFilename(entry.name) || (entry.before !== null && typeof entry.before !== "string"))) {
      throw storageError("数据事务记录无效");
    }
    // A retained journal denotes an uncommitted transaction. Roll back idempotently.
    for (const { name, before } of journal.files) {
      if (before === null) await this.removeDataFile(name);
      else await this.atomicWrite(name, before);
    }
    await this.removeDataFile(this.journal);
  }

  async write(document, previous) {
    const next = filesFor(document);
    const prior = previous ? filesFor(previous) : new Map();
    const changed = [...new Set([...prior.keys(), ...next.keys()])].filter((name) => prior.get(name) !== next.get(name));
    if (!changed.length) return;
    const files = await Promise.all(changed.map(async (name) => ({ name, before: await this.readText(name) })));
    // Reads share the lock so no caller can observe a partially applied multi-file update.
    await this.atomicWrite(this.journal, serialize({ version: 1, files }));
    try {
      for (const name of changed) {
        if (next.has(name)) await this.atomicWrite(name, next.get(name));
        else await this.removeDataFile(name);
      }
      await this.removeDataFile(this.journal);
    } catch (error) {
      await this.recover();
      throw error;
    }
  }

  async initialDocument() {
    if (await stat(path.join(this.directory, "content.sqlite")).catch((error) => { if (error.code !== "ENOENT") throw error; })) {
      throw new ContentError("该目录仍有 SQLite 数据，请先执行 data:migrate 将其迁移为 JSON。", 503);
    }
    return validateDocument(await this.initialize());
  }

  async read() {
    return this.locked(async () => {
      const current = await this.readExisting();
      if (current) {
        const document = { ...current, content: await this.canonicalizeMediaUrls(current.content, current.media) };
        await this.write(document, current);
        return document;
      }
      const document = await this.initialDocument();
      document.content = await this.canonicalizeMediaUrls(document.content, document.media);
      await this.write(document);
      return structuredClone(document);
    });
  }

  async update(work) {
    return this.locked(async () => {
      const previous = await this.readExisting();
      const document = previous ? structuredClone(previous) : await this.initialDocument();
      document.content = await this.canonicalizeMediaUrls(document.content, document.media);
      const result = await work(document);
      document.content = await this.canonicalizeMediaUrls(document.content, document.media);
      await this.write(document, previous);
      return structuredClone(result);
    });
  }

  mediaPath(name) {
    if (!validMediaName(name)) throw new ContentError("素材文件名无效");
    return path.join(this.directory, "uploads", name);
  }

  async writeMedia(name, chunks) {
    const target = this.mediaPath(name);
    await mkdir(path.dirname(target), { recursive: true });
    const temporary = `${target}.${randomUUID()}.part`;
    let file;
    try {
      file = await open(temporary, "wx");
      for await (const chunk of chunks) {
        let offset = 0;
        while (offset < chunk.byteLength) offset += (await file.write(chunk, offset, chunk.byteLength - offset)).bytesWritten;
      }
      await file.sync();
      await file.close();
      file = null;
      await rename(temporary, target);
    } finally {
      await file?.close();
      await unlink(temporary).catch((error) => { if (error.code !== "ENOENT") throw error; });
    }
  }

  async planMediaUploads(files) {
    if (!Array.isArray(files) || files.length > 252) throw new ContentError("每批最多申请 252 个素材");
    return files.map((file) => this.oss.planMediaUpload(file));
  }

  async presignMedia(input) {
    if (!input || typeof input !== "object" || Array.isArray(input) ||
        Object.keys(input).some((key) => key !== "uploads")) throw new ContentError("批量预签名参数无效");
    const { uploads } = input;
    if (!Array.isArray(uploads) || uploads.length < 1 || uploads.length > 252) {
      throw new ContentError("每批需要 1 至 252 个上传文件");
    }
    const plans = await this.planMediaUploads(uploads);
    const registered = new Map((await this.read()).media.map((item) => [item.name, item]));
    const resolve = (url) => {
      if (!isOssMediaUrl(url) || url.length > 2048) throw new ContentError("请提供已申请的 OSS 素材地址", 404);
      const media = this.registeredMedia(url, registered);
      if (!media?.storage || this.oss.getMediaReference(media.storage) !== unsignedOssUrl(url)) {
        throw new ContentError("OSS 素材不存在或未申请", 404);
      }
      return media;
    };
    const uploadMedia = plans.map((plan, index) => {
      if (uploads[index].mediaUrl === undefined) return plan;
      const media = resolve(uploads[index].mediaUrl);
      if (!sameStoredMedia({ ...plan, name: media.name, storage: media.storage }, media)) {
        throw new ContentError("重新申请上传的文件信息与原申请不一致", 409);
      }
      return media;
    });
    const signedUploads = await Promise.all(uploadMedia.map((media) => this.oss.presignMedia(media)));
    const newMedia = uploadMedia.filter((_, index) => uploads[index].mediaUrl === undefined);
    if (newMedia.length) {
      // Persist only declared metadata. The client uploads bytes and starts playback itself.
      await this.update((document) => {
        for (const media of newMedia) {
          const existing = document.media.find((item) => item.name === media.name);
          if (existing && !sameStoredMedia(existing, media)) throw new ContentError("素材标识已存在", 409);
          if (!existing) document.media.push(media);
        }
      });
    }
    return { uploads: signedUploads };
  }

  async getMediaReference(name, uploadedStorage) {
    if (!validMediaName(name)) throw new ContentError("素材文件名无效");
    const storage = uploadedStorage ?? await this.mediaStorage(name);
    return storage ? this.oss.getMediaReference(storage) : `/media/${name}`;
  }

  async getPlannedMediaReference(name) { return this.oss.getPlannedMediaReference(name); }

  registeredMedia(url, media) {
    const item = media.get(mediaNameFromUrl(url));
    return item && matchesMediaReference(url, item) ? item : null;
  }

  async canonicalizeMediaUrls(value, media) {
    const registered = new Map((media ?? (await this.read()).media).map((item) => [item.name, item]));
    return mapMediaUrls(value, (url) => {
      const item = this.registeredMedia(url, registered);
      if (!item?.storage) return url;
      return this.oss.getDirectUploadConfig().enabled ? this.oss.getMediaReference(item.storage) : unsignedOssUrl(url);
    });
  }

  async resolveMediaReference(url) {
    if (typeof url !== "string" || url.length > 2048) throw new ContentError("素材地址无效");
    const media = new Map((await this.read()).media.map((item) => [item.name, item]));
    return this.registeredMedia(url, media);
  }

  async resolveStaticMedia(value) {
    const media = new Map((await this.read()).media.map((item) => [item.name, item]));
    return mapMediaUrls(value, (url) => {
      const item = this.registeredMedia(url, media);
      return item?.storage ? `/media/${item.name}` : url;
    });
  }

  async statMedia(name) {
    const storage = await this.mediaStorage(name);
    if (storage) return this.oss.statMedia(storage);
    try { const info = await stat(this.mediaPath(name)); return info.isFile() ? { size: info.size } : null; }
    catch (error) { if (error.code === "ENOENT") return null; throw error; }
  }

  async openMedia(name, range) {
    const storage = await this.mediaStorage(name);
    if (storage) throw new ContentError("OSS 素材请使用预签名地址直接访问", 404);
    return Readable.toWeb(createReadStream(this.mediaPath(name), range));
  }

  async removeMedia(name, uploadedStorage) {
    const storage = uploadedStorage ?? await this.mediaStorage(name);
    if (storage) return this.oss.removeMedia(storage);
    await unlink(this.mediaPath(name)).catch((error) => { if (error.code !== "ENOENT") throw error; });
  }

  async exportMedia(name, destination) {
    const storage = await this.mediaStorage(name);
    if (storage) return this.oss.exportMedia(storage, destination);
    await copyFile(this.mediaPath(name), destination);
  }

  async close() {}

  async mediaStorage(name) {
    if (!validMediaName(name)) throw new ContentError("素材文件名无效");
    return (await this.read()).media.find((item) => item.name === name)?.storage;
  }

  async getDirectUploadConfig() { return this.oss.getDirectUploadConfig(); }
  async inspectMediaObject(input) { return this.oss.inspectMediaObject(input); }
}
