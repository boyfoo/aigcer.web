import { withRepository } from "../../../server/repository.js";
import { json, failure, readJson } from "../../../server/http.js";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request) {
  try { const body = await readJson(request); return json(withRepository((repository) => repository.saveTags(body.groups, body.revision))); }
  catch (error) { return failure(error); }
}
