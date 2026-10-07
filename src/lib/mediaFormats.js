export const MEDIA_LIMITS = { image: 20 * 1024 * 1024, video: 512 * 1024 * 1024 };
export const MEDIA_TYPES = {
  "image/png": { kind: "image", extension: "png" },
  "image/jpeg": { kind: "image", extension: "jpg" },
  "image/gif": { kind: "image", extension: "gif" },
  "image/webp": { kind: "image", extension: "webp" },
  "video/mp4": { kind: "video", extension: "mp4" },
  "video/webm": { kind: "video", extension: "webm" },
};

export function identifyMedia(bytes, kind) {
  const hex = bytes.subarray(0, 12).toString("hex");
  const ascii = bytes.subarray(0, 16).toString("ascii");
  if (kind === "image") {
    if (hex.startsWith("89504e470d0a1a0a")) return { extension: "png", mime: "image/png" };
    if (hex.startsWith("ffd8ff")) return { extension: "jpg", mime: "image/jpeg" };
    if (ascii.startsWith("GIF87a") || ascii.startsWith("GIF89a")) return { extension: "gif", mime: "image/gif" };
    if (ascii.startsWith("RIFF") && ascii.slice(8, 12) === "WEBP") return { extension: "webp", mime: "image/webp" };
  } else {
    if (ascii.slice(4, 8) === "ftyp" && ["isom", "iso2", "mp41", "mp42", "avc1", "M4V ", "MSNV"].includes(ascii.slice(8, 12))) return { extension: "mp4", mime: "video/mp4" };
    if (hex.startsWith("1a45dfa3") && bytes.toString("ascii").includes("webm")) return { extension: "webm", mime: "video/webm" };
  }
  throw Object.assign(new Error(kind === "image" ? "请选择 PNG、JPG、WebP 或 GIF 图片" : "请选择 MP4 或 WebM 视频，暂不支持此文件格式"), { status: 415 });
}
