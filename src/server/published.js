import "server-only";
import { connection } from "next/server";
import { withRepository } from "./repository.js";

export const isStaticExport = process.env.JINGJIE_BUILD_TARGET === "sites";
export async function publicContent() {
  if (!isStaticExport) await connection();
  return withRepository((repository) => ({ items: repository.listPublished(), tags: repository.readTags() }));
}
export async function publishedCase(id) {
  if (!isStaticExport) await connection();
  return withRepository((repository) => repository.getPublished(id));
}
