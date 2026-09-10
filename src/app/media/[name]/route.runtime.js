import { serveMedia } from "../../../server/media.js";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request, { params }) { return serveMedia(request, (await params).name); }
export const HEAD = GET;
