import { ContentError } from "./repository.js";

export const json = (value, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
export const failure = (error) => json({ error: error.code ? "服务器暂时无法保存或读取内容，请重试" : error.message || "请求失败" }, error.status || (error.code ? 503 : 400));
export function sameOrigin(request) {
  const origin = request.headers.get("origin");
  // Next.js may reconstruct request.url with its internal hostname. Browsers send
  // the public authority in Host, including the port, and cannot override it.
  if (origin) {
    let source;
    try { source = new URL(origin); } catch { throw new ContentError("来源地址无效", 403); }
    const authority = request.headers.get("host") || new URL(request.url).host;
    if (!["http:", "https:"].includes(source.protocol) || source.host !== authority || source.origin !== origin) throw new ContentError("不接受其他网站发起的修改请求", 403);
  }
  if (request.headers.get("sec-fetch-site") === "cross-site") throw new ContentError("不接受跨站修改请求", 403);
}
export async function readJson(request) {
  sameOrigin(request);
  if (!request.headers.get("content-type")?.startsWith("application/json")) throw new ContentError("请求需要使用 JSON 格式", 415);
  const chunks = []; let size = 0;
  for await (const chunk of request.body ?? []) {
    size += chunk.byteLength;
    if (size > 2 * 1024 * 1024) throw new ContentError("内容过长，请缩短分析或分镜资料", 413);
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new ContentError("请求内容格式不正确"); }
}
