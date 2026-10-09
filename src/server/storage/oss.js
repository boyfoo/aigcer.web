import OSS from "ali-oss";
import { createWriteStream } from "node:fs";
import { mkdir, rename, unlink } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { ContentError } from "../errors.js";
import { validMediaName } from "./document.js";
import { MEDIA_LIMITS, MEDIA_TYPES } from "../../lib/mediaFormats.js";

const missingObject = (error) => error?.status === 404 || ["NoSuchKey", "NoSuchObject"].includes(error?.code);
const etagValue = (value) => typeof value === "string" && /^(?:"[a-fA-F0-9-]+"|[a-fA-F0-9-]+)$/.test(value) ? value : null;

function configuration(env) {
  const names = ["BUCKET", "REGION", "ACCESS_KEY_ID", "ACCESS_KEY_SECRET"];
  const values = names.map((name) => env[`JINGJIE_OSS_${name}`]);
  if (values.every((value) => !value)) return null;
  if (values.some((value) => typeof value !== "string" || !value.trim())) {
    throw new ContentError("OSS 配置不完整，请设置 Bucket、Region 与服务端访问密钥。", 503);
  }
  const [bucket, region, accessKeyId, accessKeySecret] = values;
  const prefix = (env.JINGJIE_OSS_PREFIX || "jingjie").replace(/^\/+|\/+$/g, "");
  const expiresSeconds = Number(env.JINGJIE_OSS_UPLOAD_TTL_SECONDS || "1800");
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket) || !/^(oss-)?[a-z0-9]+(?:-[a-z0-9]+)+$/.test(region) ||
      !prefix.split("/").every((part) => /^[a-zA-Z0-9_-]+$/.test(part)) ||
      !Number.isSafeInteger(expiresSeconds) || expiresSeconds < 60 || expiresSeconds > 3600) {
    throw new ContentError("OSS Bucket、Region、目录前缀或上传有效期配置无效；有效期应为 60 至 3600 秒。", 503);
  }
  return { bucket, region: region.startsWith("oss-") ? region : `oss-${region}`, accessKeyId, accessKeySecret,
    stsToken: env.JINGJIE_OSS_SECURITY_TOKEN || undefined, prefix, expiresSeconds };
}

/** Uploads use signed PUT URLs; public media references are read directly. */
export class OssMediaStorage {
  constructor({ env = process.env, clientFactory = (options) => new OSS(options) } = {}) {
    this.config = configuration(env);
    this.clientFactory = clientFactory;
  }

  getDirectUploadConfig() {
    return { enabled: Boolean(this.config), expiresSeconds: this.config?.expiresSeconds ?? 1800 };
  }

  client() {
    if (!this.config) throw new ContentError("尚未配置 OSS，请先配置服务端存储。", 503);
    if (!this.ossClient) {
      const { prefix, expiresSeconds, ...options } = this.config;
      this.ossClient = this.clientFactory({ ...options, secure: true, authorizationV4: true, timeout: 30000 });
    }
    return this.ossClient;
  }

  planMediaUpload(input) {
    const type = Object.hasOwn(MEDIA_TYPES, input?.mime) ? MEDIA_TYPES[input.mime] : null;
    if (!type || type.kind !== input.kind) throw new ContentError("上传素材类型无效", 415);
    if (!Number.isSafeInteger(input.size) || input.size <= 0 || input.size > MEDIA_LIMITS[type.kind]) {
      throw new ContentError("上传文件大小无效或超过限制", 413);
    }
    if (typeof input.name !== "string" || !input.name.trim() || input.name.length > 300 || /[\u0000-\u001f]/.test(input.name)) {
      throw new ContentError("上传文件名称无效");
    }
    this.client();
    const name = `${randomUUID()}.${type.extension}`;
    return { name, mime: input.mime, size: input.size, originalName: input.name,
      storage: { provider: "oss", bucket: this.config.bucket, key: `${this.config.prefix}/media/${name}` } };
  }

  checkStoredObject(storage) {
    this.client();
    if (storage?.provider !== "oss" || storage.bucket !== this.config.bucket || typeof storage.key !== "string" ||
        !validMediaName(storage.key.split("/").at(-1)) || !/\/media\/[^/]+$/.test(storage.key) ||
        storage.key.split("/").some((part) => !part || part === "." || part === "..")) {
      throw new ContentError("素材所属 OSS Bucket 或对象路径与当前配置不一致", 503);
    }
    return storage.key;
  }

  getMediaReference(storage) {
    const key = this.checkStoredObject(storage);
    return `https://${storage.bucket}.${this.config.region}.aliyuncs.com/${key.split("/").map(encodeURIComponent).join("/")}`;
  }

  getPlannedMediaReference(name) {
    if (!validMediaName(name)) throw new ContentError("素材文件名无效");
    this.client();
    return this.getMediaReference({ provider: "oss", bucket: this.config.bucket, key: `${this.config.prefix}/media/${name}` });
  }

  async presignMedia(media) {
    const key = this.checkStoredObject(media.storage);
    const mediaUrl = this.getMediaReference(media.storage);
    const type = Object.hasOwn(MEDIA_TYPES, media.mime) ? MEDIA_TYPES[media.mime] : null;
    if (!type || !media.name.endsWith(`.${type.extension}`) || !Number.isSafeInteger(media.size) ||
        media.size <= 0 || media.size > MEDIA_LIMITS[type.kind]) throw new ContentError("上传素材信息无效", 415);
    try {
      const headers = { "Content-Type": media.mime, "x-oss-forbid-overwrite": "true", "x-oss-object-acl": "public-read" };
      // Browsers own Content-Length. Every client uses the same PUT header contract.
      const uploadUrl = await this.client().signatureUrlV4("PUT", this.config.expiresSeconds, { headers }, key);
      return { mediaUrl, uploadUrl, headers, uploadExpiresAt: new Date(Date.now() + this.config.expiresSeconds * 1000).toISOString(),
        name: media.originalName, kind: type.kind, size: media.size };
    } catch {
      throw new ContentError("无法签发 OSS 地址，请检查服务端 OSS 配置后重试。", 503);
    }
  }

  async head(key) {
    try {
      const result = await this.client().head(key);
      const headers = result.res?.headers ?? {};
      const size = Number(headers["content-length"]), etag = etagValue(headers.etag);
      if (!Number.isSafeInteger(size) || size < 0 || !etag) throw new ContentError("OSS 返回的素材信息无效", 503);
      return { size, mime: headers["content-type"]?.split(";")[0].trim(), etag };
    } catch (error) {
      if (missingObject(error)) return null;
      if (error instanceof ContentError) throw error;
      throw new ContentError("无法读取 OSS 素材信息，请检查服务端 OSS 配置后重试。", 503);
    }
  }

  async inspectMediaObject({ key, kind, size, mime }) {
    this.client();
    const name = typeof key === "string" ? key.split("/").at(-1) : "";
    const type = Object.hasOwn(MEDIA_TYPES, mime) ? MEDIA_TYPES[mime] : null;
    if (!validMediaName(name) || key !== `${this.config.prefix}/media/${name}` || !type || type.kind !== kind ||
        !name.endsWith(`.${type.extension}`)) throw new ContentError("素材对象或类型无效", 415);
    if (!Number.isSafeInteger(size) || size <= 0 || size > MEDIA_LIMITS[kind]) throw new ContentError("素材文件大小无效或超过限制", 413);
    const info = await this.head(key);
    if (!info) throw new ContentError("素材尚未上传，请完成 OSS 直传后重试", 404);
    if (info.size !== size) throw new ContentError("OSS 素材大小与申请时不一致", 409);
    if (info.mime !== mime) throw new ContentError("OSS 素材 Content-Type 与申请时不一致", 415);
    return info;
  }

  async statMedia(storage) {
    const info = await this.head(this.checkStoredObject(storage));
    return info ? { size: info.size } : null;
  }

  async exportMedia(storage, destination) {
    const temporary = `${destination}.${randomUUID()}.part`;
    await mkdir(path.dirname(destination), { recursive: true });
    try {
      const result = await this.client().getStream(this.checkStoredObject(storage));
      await pipeline(result.stream, createWriteStream(temporary, { flags: "wx" }));
      await rename(temporary, destination);
    } finally {
      await unlink(temporary).catch((error) => { if (error.code !== "ENOENT") throw error; });
    }
  }

  async removeMedia(storage) {
    try { await this.client().delete(this.checkStoredObject(storage)); }
    catch (error) { if (!missingObject(error)) throw error; }
  }
}
