import { mkdir, open, rename, unlink, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { storageRoot, withRepository, ContentError } from "./repository.js";
import { sameOrigin } from "./http.js";

export const MEDIA_LIMITS = { image: 20 * 1024 * 1024, video: 512 * 1024 * 1024 };
export function identifyMedia(bytes, kind) {
  const hex = bytes.subarray(0, 12).toString("hex");
  const ascii = bytes.subarray(0, 16).toString("ascii");
  if (kind === "image") {
    if (hex.startsWith("89504e470d0a1a0a")) return { extension: "png", mime: "image/png" };
    if (hex.startsWith("ffd8ff")) return { extension: "jpg", mime: "image/jpeg" };
    if (ascii.startsWith("GIF87a") || ascii.startsWith("GIF89a")) return { extension: "gif", mime: "image/gif" };
    if (ascii.startsWith("RIFF") && ascii.slice(8, 12) === "WEBP") return { extension: "webp", mime: "image/webp" };
  } else {
    if (ascii.slice(4, 8) === "ftyp" && ["isom", "iso2", "mp41", "mp42", "avc1", "M4V ", "MSNV"].includes(ascii.slice(8, 12))) return { extension: "mp4", mime: "video/mp4" };
    if (hex.startsWith("1a45dfa3") && bytes.toString("ascii").includes("webm")) return { extension: "webm", mime: "video/webm" };
  }
  throw new ContentError(kind === "image" ? "请选择 PNG、JPG、WebP 或 GIF 图片" : "请选择 MP4 或 WebM 视频，暂不支持此文件格式", 415);
}

export async function uploadMedia(request) {
  sameOrigin(request);
  const url = new URL(request.url), kind = url.searchParams.get("kind");
  if (!Object.hasOwn(MEDIA_LIMITS, kind)) throw new ContentError("上传类型无效");
  const limit = MEDIA_LIMITS[kind];
  if (Number(request.headers.get("content-length")) > limit) throw new ContentError("文件超过上传大小限制", 413);
  const directory = path.join(storageRoot(), "uploads");
  await mkdir(directory, { recursive: true });
  const id = randomUUID(), temporary = path.join(directory, `${id}.part`);
  let target, file, size = 0, header = Buffer.alloc(0);
  try {
    file = await open(temporary, "wx");
    for await (const chunk of request.body ?? []) {
      size += chunk.byteLength;
      if (size > limit) throw new ContentError("文件超过上传大小限制", 413);
      if (header.length < 1024) header = Buffer.concat([header, Buffer.from(chunk).subarray(0, 1024 - header.length)]);
      let offset = 0;
      while (offset < chunk.byteLength) offset += (await file.write(chunk, offset, chunk.byteLength - offset)).bytesWritten;
    }
    if (request.signal.aborted || !size) throw new ContentError("上传中断或文件为空，请重新上传");
    const type = identifyMedia(header, kind), name = `${id}.${type.extension}`;
    await file.close(); file = null;
    target = path.join(directory, name);
    await rename(temporary, target);
    const originalName = (url.searchParams.get("name") || name).slice(0, 200);
    withRepository((repository) => repository.addMedia({ name, mime: type.mime, size, originalName }));
    return { url: `/media/${name}`, name: originalName, size, kind };
  } catch (error) {
    await file?.close();
    await unlink(temporary).catch(() => {});
    if (target) await unlink(target).catch(() => {});
    throw error;
  }
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
  if (!/^[a-f0-9-]+\.(png|jpg|gif|webp|mp4|webm)$/.test(name)) return new Response(null, { status: 404 });
  const media = withRepository((repository) => repository.getMedia(name));
  if (!media) return new Response(null, { status: 404 });
  const file = path.join(storageRoot(), "uploads", name);
  const info = await stat(file).catch(() => null);
  if (!info?.isFile()) return new Response(null, { status: 404 });
  const headers = { "Content-Type": media.mime, "Accept-Ranges": "bytes", "Cache-Control": "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" };
  let range;
  try { range = byteRange(request.headers.get("range"), info.size); }
  catch { return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${info.size}` } }); }
  headers["Content-Length"] = String(range ? range.end - range.start + 1 : info.size);
  if (range) headers["Content-Range"] = `bytes ${range.start}-${range.end}/${info.size}`;
  if (request.method === "HEAD") return new Response(null, { status: range ? 206 : 200, headers });
  const stream = createReadStream(file, range ?? {});
  return new Response(Readable.toWeb(stream), { status: range ? 206 : 200, headers });
}
