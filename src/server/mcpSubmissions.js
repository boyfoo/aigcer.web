import { createHash, randomUUID } from "node:crypto";
import { ContentError } from "./errors.js";
import { MEDIA_LIMITS, MEDIA_TYPES } from "../lib/mediaFormats.js";
import { convertReelbenchImport } from "../lib/reelbenchImport.js";
import { normalizeDraft } from "../lib/contentEntries.js";
import { isOssMediaUrl, unsignedOssUrl } from "../lib/mediaUrls.js";

export const MAX_SUBMISSION_FILES = 252;

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}

const digest = (value) => createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
const identifier = (value, label) => {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{1,120}$/.test(value)) throw new ContentError(`${label}需要是 1–120 位字母、数字、下划线或短横线。`);
  return value;
};

function manifest(files) {
  if (!Array.isArray(files) || files.length > MAX_SUBMISSION_FILES) throw new ContentError(`每次提交最多 ${MAX_SUBMISSION_FILES} 个素材。`);
  const names = new Set();
  let videos = 0;
  return files.map((file, index) => {
    const label = `files[${index}]`;
    const localName = typeof file?.localName === "string" ? file.localName.replaceAll("\\", "/").trim() : "";
    if (!localName || localName.length > 300 || /[\u0000-\u001f]/.test(localName) || /^(?:\/|[a-zA-Z]:)/.test(localName) || localName.split("/").includes("..")) throw new ContentError(`${label}.localName 需要是文件名或输出目录内的相对路径。`);
    if (names.has(localName)) throw new ContentError(`${label}.localName 与其他素材重复。`);
    names.add(localName);
    const type = MEDIA_TYPES[file?.mime];
    if (!type || type.kind !== file.kind) throw new ContentError(`${label}的 kind 和 mime 不匹配或格式不支持。`);
    if (!Number.isSafeInteger(file.size) || file.size <= 0 || file.size > MEDIA_LIMITS[file.kind]) throw new ContentError(`${label}.size 超过上传限制或不是有效文件大小。`);
    if (file.kind === "video" && ++videos > 1) throw new ContentError("一个视频案例只能提交一条原视频。");
    return { localName, kind: file.kind, mime: file.mime, size: file.size };
  }).sort((a, b) => a.localName.localeCompare(b.localName));
}

async function parallelMap(values, work) {
  const results = new Array(values.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(4, values.length) }, async () => {
    while (next < values.length) {
      const index = next++;
      try { results[index] = { value: await work(values[index], index) }; }
      catch (error) { results[index] = { error }; }
    }
  }));
  const failure = results.find((entry) => entry.error);
  if (failure) throw failure.error;
  return results.map((entry) => entry.value);
}

export function createSubmissionService(repository, { origin = "" } = {}) {
  const address = (pathname) => origin ? new URL(pathname, origin).href : pathname;
  const getSubmission = async (submissionId) => {
    identifier(submissionId, "submissionId");
    const submission = await repository.getSubmission(submissionId);
    if (!submission) throw new ContentError("提交不存在，请先调用 jingjie_prepare_upload。", 404);
    return submission;
  };
  const uploads = (submission) => parallelMap(submission.files, async (file) => ({
    assetId: file.assetId, localName: file.localName, kind: file.kind, mime: file.mime,
    size: file.size, objectKey: file.uploadKey, url: await repository.getPlannedMediaReference(file.name),
    ...await repository.createUploadUrl({ key: file.uploadKey, mime: file.mime, size: file.size }),
  }));
  const prepared = async (submission) => submission.status === "submitted"
    ? { submissionId: submission.id, status: "submitted", result: submission.result }
    : {
      submissionId: submission.id, status: "prepared", uploads: await uploads(submission),
      instructions: "使用 uploadUrl 和 headers 以 PUT 上传本地文件原始字节，成功后调用 jingjie_submit_case，传原始拉片 JSON 和成功上传的 assetId；url 是稳定素材地址。完成提交登记后，用 url 调用 jingjie_get_media_access 获取私有 GET 签名并直接读取 OSS；uploadUrl 仅用于 PUT，未登记的临时素材不可预览。重试先查询状态：uploaded 跳过，awaiting_upload 沿用提交继续上传，unavailable 保留标识稍后查询，invalid 修正文件后用新 requestId 重新申请，原对象禁止覆盖。",
    };

  return {
    async getMediaAccess({ url }) {
      if (typeof url !== "string" || url.length > 2048 || !isOssMediaUrl(url) || unsignedOssUrl(url) !== url) {
        throw new ContentError("请提供已登记的无签名 OSS 素材地址");
      }
      const media = await repository.resolveMediaReference(url);
      if (media?.storage?.provider !== "oss") {
        throw new ContentError("素材不存在或尚未登记，请先完成 jingjie_submit_case", 404);
      }
      const mediaUrl = await repository.getMediaReference(media.name, media.storage);
      if (mediaUrl !== url) throw new ContentError("素材地址与已登记对象不一致", 404);
      const access = await repository.createMediaUrl(media.name, "GET", media.storage);
      return { ...access, mediaUrl };
    },

    async prepareUpload({ requestId, files }) {
      identifier(requestId, "requestId");
      const normalized = manifest(files);
      const config = await repository.getDirectUploadConfig();
      if (!config.enabled) throw new ContentError("尚未配置 OSS 直传，请在服务器配置 JINGJIE_OSS_* 环境变量。", 503);
      const id = randomUUID();
      const now = new Date().toISOString();
      const planned = await Promise.all(normalized.map(async (file) => {
        const name = `${randomUUID()}.${MEDIA_TYPES[file.mime].extension}`;
        return { ...file, assetId: randomUUID(), name, uploadKey: await repository.makeUploadKey(id, name) };
      }));
      const submission = await repository.prepareSubmission({
        id, requestId, manifestHash: digest(normalized), status: "prepared", createdAt: now, updatedAt: now, files: planned,
      });
      return prepared(submission);
    },

    async getSubmissionStatus({ submissionId }) {
      const submission = await getSubmission(submissionId);
      if (submission.status === "submitted") return { submissionId, status: "submitted", result: submission.result };
      const files = await parallelMap(submission.files, async (file) => {
        try {
          await repository.inspectUploadedObject({ key: file.uploadKey, kind: file.kind, size: file.size, mime: file.mime });
          return { assetId: file.assetId, localName: file.localName, status: "uploaded" };
        } catch (error) {
          if (error.status === 404) return { assetId: file.assetId, localName: file.localName, status: "awaiting_upload" };
          return {
            assetId: file.assetId, localName: file.localName,
            status: !error.status || error.status >= 500 ? "unavailable" : "invalid",
            message: error instanceof ContentError ? error.message : "OSS 暂时无法核验素材，请保留提交标识后重试。",
          };
        }
      });
      return { ...await prepared(submission), files };
    },

    async submitCase({ submissionId, data, assets }) {
      const submission = await getSubmission(submissionId);
      if (!data || typeof data !== "object" || Array.isArray(data)) throw new ContentError("data 需要是原始拉片 JSON 或单张图片资料对象。");
      if (!Array.isArray(assets) || assets.length > submission.files.length) throw new ContentError("assets 需要列出本次成功上传的素材。");
      const seen = new Set();
      const selected = (await parallelMap(assets, async (asset, index) => {
        const file = submission.files.find((entry) => entry.assetId === asset?.assetId);
        if (!file || seen.has(asset.assetId)) throw new ContentError(`assets[${index}].assetId 不属于本次提交或重复。`);
        seen.add(asset.assetId);
        if (asset.objectKey != null && asset.objectKey !== file.uploadKey) throw new ContentError(`assets[${index}].objectKey 与签发路径不一致。`);
        const url = await repository.getPlannedMediaReference(file.name);
        if (asset.url != null && asset.url !== url) throw new ContentError(`assets[${index}].url 与后端返回的 OSS 素材地址不一致。`);
        return { ...file, url };
      })).sort((a, b) => a.assetId.localeCompare(b.assetId));
      const payloadHash = digest({ data, assets: selected.map((file) => file.assetId) });
      if (submission.status === "submitted") {
        if (submission.payloadHash !== payloadHash) throw new ContentError("这次提交已保存，不能用同一提交标识覆盖不同资料。", 409);
        return submission.result;
      }
      let converted, draft;
      try {
        converted = convertReelbenchImport(data, selected, { caseId: `case-${submission.id}` });
        draft = normalizeDraft(converted.draft);
      } catch (error) {
        throw new ContentError(error.message);
      }
      const confirmed = await parallelMap(selected, async (file) => {
        const actual = await repository.inspectUploadedObject({ key: file.uploadKey, kind: file.kind, size: file.size, mime: file.mime });
        const storage = await repository.promoteUploadedObject({ sourceKey: file.uploadKey, name: file.name, etag: actual.etag });
        const url = await repository.getMediaReference(file.name, storage);
        if (url !== file.url) throw new ContentError("正式素材地址与本次上传计划不一致，请重新检查后提交。", 409);
        return { name: file.name, mime: actual.mime, size: actual.size, originalName: file.localName, storage };
      });
      const missing = submission.files.filter((file) => !seen.has(file.assetId)).map((file) => `未提交素材：${file.localName}`);
      const result = {
        submissionId, status: "draft", caseId: draft.id, revision: 1, title: draft.title,
        previewUrl: address(`/case-preview?id=${encodeURIComponent(draft.id)}`), editUrl: address("/content"),
        warnings: [...new Set([...converted.warnings, ...missing])], mediaCount: confirmed.length, shotCount: draft.video?.shots.length ?? 0,
      };
      return repository.commitSubmission({
        submissionId, payloadHash, draft, media: confirmed, result,
        source: { format: data.kind === "image" ? "image" : "reelbench-shots", data, ...(converted.sourceIds && { sourceIds: converted.sourceIds }) },
      });
    },
  };
}
