import { randomUUID } from "node:crypto";
import { withRepository, ContentError } from "./repository.js";
import { validMediaName } from "./storage/document.js";
import { sameOrigin } from "./http.js";
import { identifyMedia, MEDIA_LIMITS } from "../lib/mediaFormats.js";

export { identifyMedia, MEDIA_LIMITS };

export async function uploadMedia(request) {
  sameOrigin(request);
  const url = new URL(request.url), kind = url.searchParams.get("kind");
  if (!Object.hasOwn(MEDIA_LIMITS, kind)) throw new ContentError("上传类型无效");
  const limit = MEDIA_LIMITS[kind];
  if (Number(request.headers.get("content-length")) > limit) throw new ContentError("文件超过上传大小限制", 413);
  if (!request.body) throw new ContentError("上传中断或文件为空，请重新上传");
  const iterator = request.body[Symbol.asyncIterator]();
  const prefix = [];
  let size = 0, header = Buffer.alloc(0);
  try {
    // Detect the actual format before choosing a filename; retain only the stream prefix.
    while (header.length < 1024) {
      const { done, value } = await iterator.next();
      if (done) break;
      prefix.push(value);
      header = Buffer.concat([header, Buffer.from(value).subarray(0, 1024 - header.length)]);
    }
    if (request.signal.aborted || !header.length) throw new ContentError("上传中断或文件为空，请重新上传");
    const type = identifyMedia(header, kind), name = `${randomUUID()}.${type.extension}`;
    const originalName = (url.searchParams.get("name") || name).slice(0, 200);
    async function* checkedChunks() {
      async function* chunks() { yield* prefix; yield* { [Symbol.asyncIterator]: () => iterator }; }
      for await (const chunk of chunks()) {
        if (request.signal.aborted) throw new ContentError("上传中断，请重新上传");
        size += chunk.byteLength;
        if (size > limit) throw new ContentError("文件超过上传大小限制", 413);
        yield chunk;
      }
      if (request.signal.aborted) throw new ContentError("上传中断，请重新上传");
    }
    return await withRepository(async (repository) => {
      await repository.writeMedia(name, checkedChunks());
      try { await repository.addMedia({ name, mime: type.mime, size, originalName }); }
      catch (error) { await repository.removeMedia(name); throw error; }
      return { url: `/media/${name}`, name: originalName, size, kind };
    });
  } finally { await iterator.return?.(); }
}

export function byteRange(value, size) {
  if (!value) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2])) throw new ContentError("无效的视频范围", 416);
  let start, end;
  if (!match[1]) { const suffix = Number(match[2]); if (!suffix) throw new ContentError("无效的视频范围", 416); start = Math.max(0, size - suffix); end = size - 1; }
  else { start = Number(match[1]); end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1; }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || start > end) throw new ContentError("无效的视频范围", 416);
  return { start, end };
}

export async function serveMedia(request, name) {
  if (!validMediaName(name)) return new Response(null, { status: 404 });
  return withRepository(async (repository) => {
    const media = await repository.getMedia(name);
    if (!media) return new Response(null, { status: 404 });
    const info = await repository.statMedia(name);
    if (!info) return new Response(null, { status: 404 });
    const headers = { "Content-Type": media.mime, "Accept-Ranges": "bytes", "Cache-Control": "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" };
    let range;
    try { range = byteRange(request.headers.get("range"), info.size); }
    catch { return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${info.size}` } }); }
    headers["Content-Length"] = String(range ? range.end - range.start + 1 : info.size);
    if (range) headers["Content-Range"] = `bytes ${range.start}-${range.end}/${info.size}`;
    if (request.method === "HEAD") return new Response(null, { status: range ? 206 : 200, headers });
    return new Response(await repository.openMedia(name, range ?? undefined), { status: range ? 206 : 200, headers });
  });
}
