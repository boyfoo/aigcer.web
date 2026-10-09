import { createHash, randomUUID } from "node:crypto";
import { ContentError } from "./errors.js";
import { MEDIA_LIMITS, MEDIA_TYPES } from "../lib/mediaFormats.js";
import { convertReelbenchImport } from "../lib/reelbenchImport.js";
import { normalizeDraft } from "../lib/contentEntries.js";

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
    if (!submission) throw new ContentError("提交不存在，请先调用 jingjie_presign。", 404);
    return submission;
  };

  return {
    async presign({ requestId, files }) {
      identifier(requestId, "requestId");
      const normalized = manifest(files);
      const media = await repository.planMediaUploads(normalized.map(({ localName, ...file }) => ({ ...file, name: localName })));
      const now = new Date().toISOString();
      const submission = await repository.prepareSubmission({
        id: randomUUID(), requestId, manifestHash: digest(normalized), status: "prepared", createdAt: now, updatedAt: now,
        files: normalized.map((file, index) => ({ ...file, assetId: randomUUID(), name: media[index].name, uploadKey: media[index].storage.key })),
      }, media);
      if (submission.status === "submitted") {
        return { uploads: [], submissionId: submission.id, status: "submitted", result: submission.result };
      }
      const uploads = await Promise.all(submission.files.map(async (file) => ({
        name: file.localName, kind: file.kind, mime: file.mime, size: file.size,
        mediaUrl: await repository.getPlannedMediaReference(file.name),
      })));
      const signed = uploads.length ? await repository.presignMedia({ uploads }) : { uploads: [] };
      return {
        ...signed, submissionId: submission.id, status: "prepared",
        uploads: signed.uploads.map((upload, index) => ({
          ...upload, localName: submission.files[index].localName, mime: submission.files[index].mime,
          assetId: submission.files[index].assetId, objectKey: submission.files[index].uploadKey,
        })),
        instructions: "使用 uploadUrl 和 headers 以 PUT 将本地文件原始字节直接上传正式 OSS 对象，使用返回的 public-read 权限。PUT 成功即可直接用公开 mediaUrl 预览，无需确认或复制；mediaUrl 也用于长期保存。上传完成后调用 jingjie_submit_case 保存资料，assets 只列真正上传成功的 assetId。PUT 过期时沿用原 requestId 和 files。重试先查询状态：uploaded 跳过，awaiting_upload 继续上传，unavailable 保留标识稍后查询，invalid 修正文件后用新 requestId 重新申请，原对象禁止覆盖。",
      };
    },

    async getSubmissionStatus({ submissionId }) {
      const submission = await getSubmission(submissionId);
      if (submission.status === "submitted") return { submissionId, status: "submitted", result: submission.result };
      const files = await parallelMap(submission.files, async (file) => {
        try {
          await repository.inspectMediaObject({ key: file.uploadKey, kind: file.kind, size: file.size, mime: file.mime });
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
      return { submissionId, status: "prepared", files };
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
        if (asset.mediaUrl != null && asset.mediaUrl !== url) throw new ContentError(`assets[${index}].mediaUrl 与后端返回的 OSS 素材地址不一致。`);
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
        await repository.inspectMediaObject({ key: file.uploadKey, kind: file.kind, size: file.size, mime: file.mime });
        const media = await repository.getMedia(file.name);
        if (media?.storage?.provider !== "oss" || media.storage.key !== file.uploadKey || media.mime !== file.mime || media.size !== file.size) {
          throw new ContentError("素材登记信息与本次提交不一致", 409);
        }
        const url = await repository.getMediaReference(file.name, media.storage);
        if (url !== file.url) throw new ContentError("正式素材地址与本次上传计划不一致，请重新检查后提交。", 409);
        return media;
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
