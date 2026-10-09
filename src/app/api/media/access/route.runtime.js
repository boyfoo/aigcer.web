import { mediaAccess } from "../../../../server/media.js";
import { failure, readJson } from "../../../../server/http.js";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request) {
  try { return await mediaAccess(request, await readJson(request)); }
  catch (error) { return failure(error); }
}
