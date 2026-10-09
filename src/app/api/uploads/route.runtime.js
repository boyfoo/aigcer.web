import { completeBrowserUpload, prepareBrowserUpload } from "../../../server/media.js";
import { ContentError } from "../../../server/errors.js";
import { json, failure, readJson } from "../../../server/http.js";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request) {
  try {
    const body = await readJson(request);
    if (body?.action === "prepare") return json(await prepareBrowserUpload(body));
    if (body?.action === "complete") return json(await completeBrowserUpload(body));
    throw new ContentError("上传操作无效");
  } catch (error) { return failure(error); }
}
