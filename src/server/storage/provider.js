import path from "node:path";
import { ContentError } from "../errors.js";
import { JsonDataProvider } from "./json.js";

/**
 * Storage contract. Every method is asynchronous, including remote implementations.
 * read() returns an isolated document; callers may not mutate persisted state.
 * update(work) reads the latest document and commits it atomically after work resolves.
 * Updates must serialize across instances/processes; failed callbacks must roll back.
 * Media streams returned by openMedia() must remain usable after close().
 *
 * @typedef {Object} DataProvider
 * @property {() => Promise<import('./document.js').DataDocument>} read
 * @property {<T>(work: (document: import('./document.js').DataDocument) => T | Promise<T>) => Promise<T>} update
 * @property {(name: string, chunks: AsyncIterable<Uint8Array>) => Promise<void>} writeMedia
 * @property {(name: string) => Promise<{size: number} | null>} statMedia
 * @property {(name: string, range?: {start: number, end: number}) => Promise<ReadableStream>} openMedia
 * @property {(name: string) => Promise<void>} removeMedia
 * @property {(name: string, destination: string) => Promise<void>} exportMedia
 * @property {() => Promise<{enabled: boolean, expiresSeconds: number}>} getDirectUploadConfig
 * @property {(submissionId: string, name: string) => Promise<string>} makeUploadKey
 * @property {(input: {key: string, mime: string, size: number}) => Promise<{uploadUrl: string, headers: Object, expiresAt: string}>} createUploadUrl
 * @property {(input: {key: string, kind: string, size: number, mime: string}) => Promise<{size: number, mime: string, etag: string}>} inspectUploadedObject
 * @property {(input: {sourceKey: string, name: string, etag: string}) => Promise<{provider: 'oss', bucket: string, key: string}>} promoteUploadedObject
 * @property {() => Promise<void>} close
 */

// Runtime data stays outside Next.js bundles and public static files.
export const storageRoot = () => path.resolve(/* turbopackIgnore: true */ process.env.JINGJIE_DATA_DIR || path.join(process.cwd(), "data"));

// Register a new implementation here; API routes and business rules stay unchanged.
const providers = {
  json: (options) => new JsonDataProvider(options),
};

/** @returns {DataProvider} */
export function createDataProvider({ name = process.env.JINGJIE_DATA_PROVIDER || "json", directory = storageRoot(), initialize, oss } = {}) {
  if (!Object.hasOwn(providers, name)) throw new ContentError(`未知的数据提供者：${name}，请检查 JINGJIE_DATA_PROVIDER 配置。`, 503);
  return providers[name]({ directory, initialize, oss });
}
