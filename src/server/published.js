import "server-only";
import { connection } from "next/server";
import { withRepository } from "./repository.js";

export const isStaticExport = process.env.JINGJIE_BUILD_TARGET === "sites";
export async function publicContent() {
  if (!isStaticExport) await connection();
  return withRepository(async (repository) => ({ items: await repository.listPublished(), tags: await repository.readTags() }));
}
export async function publishedCase(id) {
  if (!isStaticExport) await connection();
  return withRepository((repository) => repository.getPublished(id));
}
