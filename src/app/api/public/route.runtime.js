import { withRepository } from "../../../server/repository.js";
import { json, failure } from "../../../server/http.js";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function GET() {
  try { return json(withRepository((repository) => ({ items: repository.listPublished(), tags: repository.readTags() }))); }
  catch (error) { return failure(error); }
}
