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
 * @property {(name: string, chunks: AsyncIterable<Uint8Array>) => Promise<void>} writeMedia Local data migration only; uploads use OSS presigned URLs.
 * @property {(files: Array<{name: string, kind: string, mime: string, size: number}>) => Promise<Array<import('./document.js').StoredMedia>>} planMediaUploads
 * @property {(input: {uploads: Array<{name: string, kind: string, mime: string, size: number, mediaUrl?: string}>}) => Promise<{uploads: Object[]}>} presignMedia
 * @property {(name: string, uploadedStorage?: import('./document.js').StoredMedia['storage']) => Promise<string>} getMediaReference
 * @property {(name: string) => Promise<string>} getPlannedMediaReference
 * @property {(url: string) => Promise<import('./document.js').StoredMedia | null>} resolveMediaReference
 * @property {<T>(value: T, media?: import('./document.js').StoredMedia[]) => Promise<T>} canonicalizeMediaUrls
 * @property {<T>(value: T) => Promise<T>} resolveStaticMedia
 * @property {(name: string) => Promise<{size: number} | null>} statMedia
 * @property {(name: string, range?: {start: number, end: number}) => Promise<ReadableStream>} openMedia
 * @property {(name: string, uploadedStorage?: import('./document.js').StoredMedia['storage']) => Promise<void>} removeMedia
 * @property {(name: string, destination: string) => Promise<void>} exportMedia
 * @property {() => Promise<{enabled: boolean, expiresSeconds: number}>} getDirectUploadConfig
 * @property {(input: {key: string, kind: string, size: number, mime: string}) => Promise<{size: number, mime: string, etag: string}>} inspectMediaObject Checks OSS HEAD metadata only.
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
