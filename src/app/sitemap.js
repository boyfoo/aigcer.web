import { casePath, collectionPath, collections, getCases } from "../lib/content.js";
import { getSiteUrl } from "../lib/seo.js";

export const dynamic = "force-static";

export default function sitemap() {
  const origin = getSiteUrl();
  if (!origin) return [];
  return ["/", ...collections.map(({ slug }) => collectionPath(slug)), ...getCases().map(({ id }) => casePath(id))]
    .map((path) => ({ url: new URL(path, origin).href }));
}
