import { ContentError } from "../errors.js";
import { validCaseId } from "../../lib/contentEntries.js";
import { MEDIA_TYPES } from "../../lib/mediaFormats.js";

/**
 * @typedef {Object} StoredContent
 * @property {string} id
 * @property {ReturnType<typeof import('../../lib/contentEntries.js').normalizeDraft>} draft
 * @property {StoredContent['draft'] | null} published
 * @property {'draft' | 'published' | 'offline'} status
 * @property {number} revision
 * @property {string} updatedAt
 * @property {string | null} publishedAt
 * @property {number} position
 *
 * @typedef {{name: string, mime: string, size: number, originalName: string, storage?: {provider: 'oss', bucket: string, key: string}}} StoredMedia
 * @typedef {Object} DataDocument
 * @property {2} version
 * @property {StoredContent[]} content
 * @property {{groups: ReturnType<typeof import('../../tagSettings.js').createDefaultTagGroups>, revision: number}} tags
 * @property {StoredMedia[]} media
 * @property {Object[]} submissions
 */

export const validMediaName = (name) => typeof name === "string" && /^[a-f0-9-]+\.(png|jpg|gif|webp|mp4|webm)$/.test(name);
export const validSubmissionId = (id) => typeof id === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id);
const object = (item) => item !== null && typeof item === "object" && !Array.isArray(item);
const hash = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const date = (value) => typeof value === "string" && Number.isFinite(Date.parse(value));

function validSubmission(row) {
  if (!object(row) || !validSubmissionId(row.id) || typeof row.requestId !== "string" || !row.requestId ||
      !hash(row.manifestHash) || !["prepared", "submitted"].includes(row.status) ||
      !date(row.createdAt) || !date(row.updatedAt) || !Array.isArray(row.files)) return false;
  const assets = new Set(), names = new Set(), keys = new Set();
  for (const file of row.files) {
    if (!object(file) || !validSubmissionId(file.assetId) || assets.has(file.assetId) ||
        typeof file.localName !== "string" || !file.localName || !["image", "video"].includes(file.kind) ||
        !Object.hasOwn(MEDIA_TYPES, file.mime) || MEDIA_TYPES[file.mime].kind !== file.kind ||
        !Number.isSafeInteger(file.size) || file.size <= 0 ||
        !validMediaName(file.name) || names.has(file.name) || typeof file.uploadKey !== "string" ||
        !file.name.endsWith(`.${MEDIA_TYPES[file.mime].extension}`) ||
        !file.uploadKey.endsWith(`/uploads/${row.id}/${file.name}`) || keys.has(file.uploadKey)) return false;
    assets.add(file.assetId); names.add(file.name); keys.add(file.uploadKey);
  }
  if (row.caseId !== undefined && !validCaseId(row.caseId)) return false;
  if (row.payloadHash !== undefined && !hash(row.payloadHash)) return false;
  if (row.source !== undefined && (!object(row.source) || !["reelbench-shots", "image"].includes(row.source.format) || !object(row.source.data))) return false;
  return row.status !== "submitted" || (validCaseId(row.caseId) && hash(row.payloadHash) && object(row.result) &&
    row.result.caseId === row.caseId && row.result.status === "draft" && Array.isArray(row.result.warnings) &&
    row.result.warnings.every((warning) => typeof warning === "string"));
}

/** The provider-neutral, versioned data exchanged with the repository. */
export function validateDocument(value) {
  const revision = (item) => Number.isSafeInteger(item) && item > 0;
  const ids = new Set();
  const names = new Set();
  const submissions = new Set(), requests = new Set();
  if (!object(value) || value.version !== 2 || !Array.isArray(value.content) ||
      !object(value.tags) || !Array.isArray(value.tags.groups) || !revision(value.tags.revision) ||
      !Array.isArray(value.media) || !Array.isArray(value.submissions) || value.content.some((row) => {
        if (!object(row) || !validCaseId(row.id) || ids.has(row.id) || !object(row.draft) || row.draft.id !== row.id ||
            !["draft", "published", "offline"].includes(row.status) || !revision(row.revision) ||
            typeof row.updatedAt !== "string" || !Number.isSafeInteger(row.position) || row.position < 0 ||
            (row.status === "draft" ? row.published !== null || row.publishedAt !== null :
              !object(row.published) || row.published.id !== row.id || typeof row.publishedAt !== "string")) return true;
        ids.add(row.id);
        return false;
      }) || value.media.some((item) => {
        if (!object(item) || !validMediaName(item.name) || names.has(item.name) || typeof item.mime !== "string" ||
            !Number.isSafeInteger(item.size) || item.size < 0 || typeof item.originalName !== "string" ||
            (item.storage !== undefined && (!object(item.storage) || item.storage.provider !== "oss" ||
              typeof item.storage.bucket !== "string" || !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(item.storage.bucket) ||
              typeof item.storage.key !== "string" || !item.storage.key.endsWith(`/media/${item.name}`) ||
              item.storage.key.split("/").some((segment) => !segment || segment === "." || segment === "..")))) return true;
        names.add(item.name);
        return false;
      }) || value.submissions.some((row) => {
        if (!validSubmission(row) || submissions.has(row.id) || requests.has(row.requestId)) return true;
        submissions.add(row.id); requests.add(row.requestId);
        return false;
      })) {
    throw new ContentError("数据文件结构或版本无效，请检查数据文件；原文件未被覆盖。", 503);
  }
  return value;
}
