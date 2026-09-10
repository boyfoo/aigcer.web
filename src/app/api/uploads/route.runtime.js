import { uploadMedia } from "../../../server/media.js";
import { json, failure } from "../../../server/http.js";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request) {
  try { return json(await uploadMedia(request), 201); } catch (error) { return failure(error); }
}
