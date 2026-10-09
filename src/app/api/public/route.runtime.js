import { withRepository } from "../../../server/repository.js";
import { json, failure } from "../../../server/http.js";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  try { return json(await withRepository(async (repository) => ({ items: await repository.listPublished(), tags: await repository.readTags() }))); }
  catch (error) { return failure(error); }
}
