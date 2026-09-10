import { withRepository } from "../../../server/repository.js";
import { json, failure, readJson } from "../../../server/http.js";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function GET() {
  try { return json({ records: withRepository((repository) => repository.listRecords()) }); }
  catch (error) { return failure(error); }
}
export async function POST(request) {
  try { const body = await readJson(request); return json({ record: withRepository((repository) => repository.change(body)) }); }
  catch (error) { return failure(error); }
}
