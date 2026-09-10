import { withRepository } from "./repository.js";
import { buildSitemap } from "../lib/sitemap.js";
import { getSiteUrl } from "../lib/seo.js";

const escape = (value) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
export function sitemapResponse() {
  const origin = getSiteUrl();
  const entries = origin ? withRepository((repository) => buildSitemap(repository.listPublished(), origin)) : [];
  const urls = entries.map((item) => `<url><loc>${escape(item.url)}</loc></url>`).join("");
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`, { headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "no-store" } });
}
