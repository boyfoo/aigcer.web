import "server-only";
import { connection } from "next/server";
import { withRepository } from "./repository.js";

export const isStaticExport = process.env.JINGJIE_BUILD_TARGET === "sites";
const displayedContent = (repository, value) => isStaticExport ? repository.resolveStaticMedia(value) : value;
export async function publicContent() {
  if (!isStaticExport) await connection();
  return withRepository(async (repository) => ({
    items: await displayedContent(repository, await repository.listPublished()),
    tags: await repository.readTags(),
  }));
}
export async function publishedCase(id) {
  if (!isStaticExport) await connection();
  return withRepository(async (repository) => displayedContent(repository, await repository.getPublished(id)));
}
