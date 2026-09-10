import { collections, casePath, collectionPath } from "./content.js";
export function buildSitemap(items, origin) {
  if (!origin) return [];
  return ["/", ...collections.map(({ slug }) => collectionPath(slug)), ...items.map(({ id }) => casePath(id))].map((path) => ({ url: new URL(path, origin).href }));
}
