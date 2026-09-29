import { ContentError } from "../errors.js";
import { validCaseId } from "../../lib/contentEntries.js";

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
 * @typedef {{name: string, mime: string, size: number, originalName: string}} StoredMedia
 * @typedef {Object} DataDocument
 * @property {1} version
 * @property {StoredContent[]} content
 * @property {{groups: ReturnType<typeof import('../../tagSettings.js').createDefaultTagGroups>, revision: number}} tags
 * @property {StoredMedia[]} media
 */

export const validMediaName = (name) => typeof name === "string" && /^[a-f0-9-]+\.(png|jpg|gif|webp|mp4|webm)$/.test(name);

/** The provider-neutral, versioned data exchanged with the repository. */
export function validateDocument(value) {
  const object = (item) => item !== null && typeof item === "object" && !Array.isArray(item);
  const revision = (item) => Number.isSafeInteger(item) && item > 0;
  const ids = new Set();
  const names = new Set();
  if (!object(value) || value.version !== 1 || !Array.isArray(value.content) ||
      !object(value.tags) || !Array.isArray(value.tags.groups) || !revision(value.tags.revision) ||
      !Array.isArray(value.media) || value.content.some((row) => {
        if (!object(row) || !validCaseId(row.id) || ids.has(row.id) || !object(row.draft) || row.draft.id !== row.id ||
            !["draft", "published", "offline"].includes(row.status) || !revision(row.revision) ||
            typeof row.updatedAt !== "string" || !Number.isSafeInteger(row.position) || row.position < 0 ||
            (row.status === "draft" ? row.published !== null || row.publishedAt !== null :
              !object(row.published) || row.published.id !== row.id || typeof row.publishedAt !== "string")) return true;
        ids.add(row.id);
        return false;
      }) || value.media.some((item) => {
        if (!object(item) || !validMediaName(item.name) || names.has(item.name) || typeof item.mime !== "string" ||
            !Number.isSafeInteger(item.size) || item.size < 0 || typeof item.originalName !== "string") return true;
        names.add(item.name);
        return false;
      })) {
    throw new ContentError("数据文件结构或版本无效，请检查数据文件；原文件未被覆盖。", 503);
  }
  return value;
}
