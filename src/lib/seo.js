export const siteName = "镜界";
export const siteDescription = "观看 AI 视频案例，阅读分镜与提示词，学习镜头语言、光影、色彩和视觉风格。";

export function getSiteUrl() {
  if (!process.env.SITE_URL) return null;
  const url = new URL(process.env.SITE_URL);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("SITE_URL must be an HTTP(S) origin without credentials");
  }
  return url.origin;
}

export function pageMetadata({ title, description = siteDescription, path, image, index = true }) {
  const origin = getSiteUrl();
  const url = origin ? new URL(path, origin).href : undefined;
  return {
    title,
    description,
    ...(url && { alternates: { canonical: url } }),
    robots: { index: Boolean(origin) && index, follow: index },
    openGraph: {
      title: `${title} · ${siteName}`,
      description,
      siteName,
      locale: "zh_CN",
      type: "website",
      ...(url && { url }),
      images: image && origin ? [{ url: new URL(image, origin).href, alt: title }] : [],
    },
  };
}
