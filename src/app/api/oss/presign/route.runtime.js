import { presignMedia } from "../../../../server/media.js";
import { json, failure, readJson } from "../../../../server/http.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request) {
  try {
    const response = json(await presignMedia(await readJson(request)));
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
  catch (error) { return failure(error); }
}
