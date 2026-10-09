const filename = /^[a-f0-9-]+\.(png|jpg|gif|webp|mp4|webm)$/;

export function isOssMediaUrl(value) {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.port &&
      /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]\.oss-[a-z0-9]+(?:-[a-z0-9]+)+\.aliyuncs\.com$/.test(url.hostname);
  } catch { return false; }
}

export function unsignedOssUrl(value) {
  if (!isOssMediaUrl(value)) return value;
  const url = new URL(value);
  url.search = "";
  url.hash = "";
  return url.href;
}

export function mediaNameFromUrl(value) {
  if (typeof value !== "string") return null;
  let pathname = value;
  if (isOssMediaUrl(value)) pathname = new URL(value).pathname;
  const match = /^\/media\/([^/?#]+)$/.exec(pathname) ?? (isOssMediaUrl(value) ? /\/media\/([^/]+)$/.exec(pathname) : null);
  return match && filename.test(match[1]) ? match[1] : null;
}

export function matchesMediaReference(value, media) {
  if (value === `/media/${media.name}`) return true;
  if (!media.storage || !isOssMediaUrl(value)) return false;
  const url = new URL(value);
  return url.hostname.startsWith(`${media.storage.bucket}.`) &&
    url.pathname === `/${media.storage.key.split("/").map(encodeURIComponent).join("/")}`;
}

// Transform only media fields; prompts, notes and imported source data retain their text.
export function mapMediaUrls(value, transform) {
  if (Array.isArray(value)) return value.map((item) => mapMediaUrls(item, transform));
  if (!value || typeof value !== "object") return value;
  const result = { ...value };
  if (typeof value.image === "string") result.image = transform(value.image);
  if (value.draft) result.draft = mapMediaUrls(value.draft, transform);
  if (value.published) result.published = mapMediaUrls(value.published, transform);
  if (value.video) {
    result.video = { ...value.video };
    if (typeof value.video.src === "string") result.video.src = transform(value.video.src);
    if (Array.isArray(value.video.shots)) result.video.shots = value.video.shots.map((shot) => ({
      ...shot,
      ...(typeof shot.image === "string" && { image: transform(shot.image) }),
      ...(typeof shot.endImage === "string" && { endImage: transform(shot.endImage) }),
    }));
    if (Array.isArray(value.video.cast)) result.video.cast = value.video.cast.map((person) => ({
      ...person, ...(typeof person.image === "string" && { image: transform(person.image) }),
    }));
  }
  return result;
}
