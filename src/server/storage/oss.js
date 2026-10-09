import OSS from "ali-oss";
import { createWriteStream } from "node:fs";
import { mkdir, rename, unlink } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import path from "node:path";
import { ContentError } from "../errors.js";
import { validMediaName, validSubmissionId } from "./document.js";
import { identifyMedia, MEDIA_LIMITS, MEDIA_TYPES } from "../../lib/mediaFormats.js";

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
  const accessExpiresSeconds = Number(env.JINGJIE_OSS_ACCESS_TTL_SECONDS || "3600");
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket) || !/^(oss-)?[a-z0-9]+(?:-[a-z0-9]+)+$/.test(region) ||
      !prefix.split("/").every((part) => /^[a-zA-Z0-9_-]+$/.test(part)) ||
      !Number.isSafeInteger(expiresSeconds) || expiresSeconds < 60 || expiresSeconds > 3600) {
    throw new ContentError("OSS Bucket、Region、目录前缀或上传有效期配置无效；有效期应为 60 至 3600 秒。", 503);
  }
  if (!Number.isSafeInteger(accessExpiresSeconds) || accessExpiresSeconds < 60 || accessExpiresSeconds > 86400) {
    throw new ContentError("OSS 访问有效期配置无效，应为 60 至 86400 秒。", 503);
  }
  return { bucket, region: region.startsWith("oss-") ? region : `oss-${region}`, accessKeyId, accessKeySecret,
    stsToken: env.JINGJIE_OSS_SECURITY_TOKEN || undefined, prefix, expiresSeconds, accessExpiresSeconds };
}

/** OSS handles private object bytes; JSON remains the authority for registered media. */
export class OssMediaStorage {
  constructor({ env = process.env, clientFactory = (options) => new OSS(options) } = {}) {
    this.config = configuration(env);
    this.clientFactory = clientFactory;
  }

  getDirectUploadConfig() {
    return { enabled: Boolean(this.config), expiresSeconds: this.config?.expiresSeconds ?? 1800 };
  }

  client() {
    if (!this.config) throw new ContentError("远程直传尚未配置 OSS，请先配置服务端存储。", 503);
    if (!this.ossClient) {
      const { prefix, expiresSeconds, accessExpiresSeconds, ...options } = this.config;
      this.ossClient = this.clientFactory({ ...options, secure: true, authorizationV4: true, timeout: 30000 });
    }
    return this.ossClient;
  }

  makeUploadKey(submissionId, name) {
    this.client();
    if (!validSubmissionId(submissionId) || !validMediaName(name)) throw new ContentError("上传任务或素材标识无效");
    return `${this.config.prefix}/uploads/${submissionId}/${name}`;
  }

  checkUploadKey(key) {
    this.client();
    const prefix = `${this.config.prefix}/uploads/`;
    if (typeof key !== "string" || !key.startsWith(prefix)) throw new ContentError("上传对象不属于当前上传目录");
    const [submissionId, name, ...extra] = key.slice(prefix.length).split("/");
    if (extra.length || !validSubmissionId(submissionId) || !validMediaName(name)) throw new ContentError("上传对象路径无效");
    return name;
  }

  async createUploadUrl({ key, mime, size, browser = false }) {
    const name = this.checkUploadKey(key), type = MEDIA_TYPES[mime];
    if (!type || !name.endsWith(`.${type.extension}`)) throw new ContentError("上传类型与素材文件名不匹配", 415);
    if (!Number.isSafeInteger(size) || size <= 0 || size > MEDIA_LIMITS[type.kind]) throw new ContentError("上传文件大小无效或超过限制", 413);
    const headers = { "Content-Type": mime, ...(!browser && { "Content-Length": String(size) }), "x-oss-forbid-overwrite": "true", "x-oss-object-acl": "private" };
    // Browsers control Content-Length themselves. Completion verifies the expected size.
    let uploadUrl;
    try { uploadUrl = await this.client().signatureUrlV4("PUT", this.config.expiresSeconds, { headers }, key, browser ? [] : ["content-length"]); }
    catch { throw new ContentError("无法签发 OSS 上传地址，请检查服务端 OSS 配置。", 503); }
    return { uploadUrl, headers, expiresAt: new Date(Date.now() + this.config.expiresSeconds * 1000).toISOString() };
  }

  uploadTokenSignature(payload) {
    return createHmac("sha256", this.config.accessKeySecret).update("browser-upload-v1.").update(payload).digest();
  }

  async createBrowserUpload(input) {
    const type = MEDIA_TYPES[input?.mime];
    if (!type || type.kind !== input.kind) throw new ContentError("上传素材类型无效", 415);
    if (!Number.isSafeInteger(input.size) || input.size <= 0 || input.size > MEDIA_LIMITS[type.kind]) {
      throw new ContentError("上传文件大小无效或超过限制", 413);
    }
    if (typeof input.name !== "string" || !input.name.trim() || input.name.length > 200) throw new ContentError("上传文件名称无效");
    const name = `${randomUUID()}.${type.extension}`;
    const key = this.makeUploadKey(randomUUID(), name);
    const upload = await this.createUploadUrl({ key, mime: input.mime, size: input.size, browser: true });
    const plan = {
      version: 1, bucket: this.config.bucket, prefix: this.config.prefix, region: this.config.region,
      key, name, originalName: input.name, kind: type.kind, mime: input.mime, size: input.size,
      // Give an upload finishing just before PUT expiry time to complete registration.
      expiresAt: Date.parse(upload.expiresAt) + 10 * 60 * 1000,
    };
    const payload = Buffer.from(JSON.stringify(plan)).toString("base64url");
    const uploadToken = `${payload}.${this.uploadTokenSignature(payload).toString("base64url")}`;
    return { ...upload, uploadToken, mediaUrl: this.getPlannedMediaReference(name) };
  }

  async verifyBrowserUpload(uploadToken) {
    this.client();
    if (typeof uploadToken !== "string" || uploadToken.length > 4096) throw new ContentError("上传确认凭据无效", 403);
    const [payload, signature, ...extra] = uploadToken.split(".");
    if (extra.length || !/^[A-Za-z0-9_-]+$/.test(payload ?? "") || !/^[A-Za-z0-9_-]+$/.test(signature ?? "")) {
      throw new ContentError("上传确认凭据无效", 403);
    }
    const received = Buffer.from(signature, "base64url"), expected = this.uploadTokenSignature(payload);
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) throw new ContentError("上传确认凭据无效", 403);
    let plan;
    try { plan = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")); }
    catch { throw new ContentError("上传确认凭据无效", 403); }
    const type = MEDIA_TYPES[plan?.mime];
    if (plan?.version !== 1 || plan.bucket !== this.config.bucket || plan.prefix !== this.config.prefix || plan.region !== this.config.region ||
        !type || type.kind !== plan.kind || !Number.isSafeInteger(plan.size) || plan.size <= 0 || plan.size > MEDIA_LIMITS[type.kind] ||
        !Number.isSafeInteger(plan.expiresAt) || typeof plan.originalName !== "string" || !plan.originalName.trim() || plan.originalName.length > 200 ||
        !validMediaName(plan.name) || !plan.name.endsWith(`.${type.extension}`) || this.checkUploadKey(plan.key) !== plan.name) {
      throw new ContentError("上传确认凭据无效", 403);
    }
    if (Date.now() >= plan.expiresAt) throw new ContentError("上传确认已过期，请重新上传", 410);
    return { ...plan, storage: { provider: "oss", bucket: this.config.bucket, key: `${this.config.prefix}/media/${plan.name}` } };
  }

  async removeUploadedObject(key) {
    this.checkUploadKey(key);
    await this.removeMedia({ provider: "oss", bucket: this.config.bucket, key });
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

  async inspectUploadedObject({ key, kind, size, mime }) {
    const name = this.checkUploadKey(key);
    const type = MEDIA_TYPES[mime];
    if (!type || type.kind !== kind || !name.endsWith(`.${type.extension}`)) throw new ContentError("上传素材类型无效", 415);
    if (!Number.isSafeInteger(size) || size <= 0 || size > MEDIA_LIMITS[kind]) throw new ContentError("上传文件大小无效或超过限制", 413);
    const info = await this.head(key);
    if (!info) throw new ContentError("素材尚未上传或已经失效，请完成上传后重试", 404);
    if (info.size !== size) throw new ContentError("OSS 素材大小与申请上传时不一致", 409);
    let response;
    try {
      response = await this.client().get(key, {
        headers: { Range: `bytes=0-${Math.min(size, 1024) - 1}`, "If-Match": info.etag },
      });
    } catch (error) {
      if (missingObject(error) || error?.status === 412) throw new ContentError("上传素材在校验时发生变化，请重新上传后提交", 409);
      throw new ContentError("OSS 素材内容校验失败，请稍后重试。", 503);
    }
    let detected;
    try { detected = identifyMedia(Buffer.from(response.content), kind); }
    catch (error) { throw new ContentError(error.message, error.status || 415); }
    if (detected.mime !== mime || info.mime !== mime) throw new ContentError("素材实际格式或 Content-Type 与申请上传时不一致", 415);
    return { size: info.size, mime: detected.mime, etag: info.etag };
  }

  async promoteUploadedObject({ sourceKey, name, etag }) {
    const sourceName = this.checkUploadKey(sourceKey);
    if (!validMediaName(name) || sourceName !== name || !etagValue(etag)) throw new ContentError("正式素材标识或校验信息无效");
    const key = `${this.config.prefix}/media/${name}`;
    const previous = await this.head(key);
    if (previous) {
      if (previous.etag !== etag) throw new ContentError("正式素材已存在且内容不一致，无法覆盖", 409);
      return { provider: "oss", bucket: this.config.bucket, key };
    }
    try {
      // Source conditional copy prevents a replaced upload from entering the verified draft.
      await this.client().copy(key, sourceKey, {
        headers: { "If-Match": etag, "x-oss-forbid-overwrite": "true", "x-oss-object-acl": "private" },
      });
    } catch (error) {
      if ([409, 412].includes(error?.status)) {
        const existing = await this.head(key);
        if (!existing || existing.etag !== etag) throw new ContentError("上传素材已变化或正式对象已存在，请重新检查后提交", 409);
      } else throw new ContentError("OSS 素材确认失败，请稍后重试。", 503);
    }
    const confirmed = await this.head(key);
    if (!confirmed || confirmed.etag !== etag) throw new ContentError("正式素材校验失败，请重新提交", 409);
    return { provider: "oss", bucket: this.config.bucket, key };
  }

  checkStoredObject(storage) {
    this.client();
    if (storage.provider !== "oss" || storage.bucket !== this.config.bucket) throw new ContentError("素材所属 OSS Bucket 与当前配置不一致", 503);
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

  async createMediaUrl(storage, method = "GET") {
    const key = this.checkStoredObject(storage);
    if (!["GET", "HEAD"].includes(method)) throw new ContentError("素材访问仅支持 GET 或 HEAD", 405);
    let url;
    try { url = await this.client().signatureUrlV4(method, this.config.accessExpiresSeconds, {}, key); }
    catch { throw new ContentError("无法签发 OSS 访问地址，请检查服务端存储配置或稍后重试。", 503); }
    return { url, expiresAt: new Date(Date.now() + this.config.accessExpiresSeconds * 1000).toISOString() };
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
