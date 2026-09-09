import { getSiteUrl } from "../lib/seo.js";

export const dynamic = "force-static";

export default function robots() {
  const origin = getSiteUrl();
  if (!origin) return { rules: { userAgent: "*", disallow: "/" } };
  return { rules: { userAgent: "*", allow: "/", disallow: "/api/" }, sitemap: `${origin}/sitemap.xml` };
}
