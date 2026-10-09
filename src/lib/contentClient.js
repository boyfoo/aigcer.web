import { isOssMediaUrl, mediaNameFromUrl, ossAccessExpiresAt, unsignedOssUrl } from "./mediaUrls.js";
import { MEDIA_TYPES } from "./mediaFormats.js";

export const contentReadOnly = process.env.NEXT_PUBLIC_CONTENT_READ_ONLY === "1";

export async function requestOfflineImage(url, signal) {
  const access = await requestMediaAccess(url, signal);
  return fetch(access.url, { signal });
}

export async function requestMediaAccess(url, signal) {
  if (!contentReadOnly && isOssMediaUrl(url)) {
    const expiresAt = ossAccessExpiresAt(url);
    if (expiresAt && Date.parse(expiresAt) > Date.now()) {
      return { url, mediaUrl: unsignedOssUrl(url), expiresAt };
    }
    if (mediaNameFromUrl(url)) return requestContent("/api/media/access", { url }, signal);
  }
  return { url, mediaUrl: url, expiresAt: null };
}

function putUpload(file, prepared, onProgress, signal) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let settled = false;
    const cancelled = () => Object.assign(new Error("上传已取消"), { name: "AbortError" });
    const finish = (error) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", abort);
      xhr.upload.onprogress = null;
      xhr.onload = null;
      xhr.onerror = null;
      xhr.ontimeout = null;
      xhr.onabort = null;
      if (error) reject(error);
      else resolve();
    };
    const abort = () => {
      xhr.abort();
      finish(cancelled());
    };

    try {
      xhr.open("PUT", prepared.uploadUrl);
      xhr.timeout = 10 * 60 * 1000;
      for (const [name, value] of Object.entries(prepared.headers)) {
        // Browsers set the File body's exact length and forbid assigning this header.
        if (name.toLowerCase() !== "content-length") xhr.setRequestHeader(name, value);
      }
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) onProgress(Math.min(100, Math.round(event.loaded / event.total * 100)));
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          onProgress(100);
          finish();
        } else {
          finish(new Error(`素材直传失败（HTTP ${xhr.status}），请重试。`));
        }
      };
      xhr.onerror = () => finish(new Error("素材直传中断，请检查网络或存储配置后重试。"));
      xhr.ontimeout = () => finish(new Error("上传超时，请重试或选择较小的文件。"));
      xhr.onabort = () => finish(cancelled());
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
      else xhr.send(file);
    } catch (error) {
      finish(error);
    }
  });
}

export async function uploadFile(file, kind, onProgress = () => {}, onRequest = () => {}, onPhase = () => {}) {
  const controller = new AbortController();
  onRequest(controller);
  const extension = (file.name || "").split(".").at(-1).toLowerCase();
  const type = Object.entries(MEDIA_TYPES).find(([, format]) =>
    format.kind === kind && format.extension === (extension === "jpeg" ? "jpg" : extension),
  );

  try {
    onPhase("preparing");
    const prepared = await requestContent("/api/uploads", {
      action: "prepare",
      kind,
      name: file.name || (kind === "video" ? "video.mp4" : "image.png"),
      mime: file.type || type?.[0] || "",
      size: file.size,
    }, controller.signal);
    controller.signal.throwIfAborted();

    onPhase("uploading");
    await putUpload(file, prepared, onProgress, controller.signal);
    controller.signal.throwIfAborted();

    onPhase("confirming");
    const uploaded = await requestContent("/api/uploads", {
      action: "complete",
      uploadToken: prepared.uploadToken,
    }, controller.signal);
    controller.signal.throwIfAborted();
    return uploaded;
  } catch (error) {
    if (controller.signal.aborted) throw Object.assign(new Error("上传已取消"), { name: "AbortError" });
    if (error.name === "TimeoutError") throw new Error("上传准备或确认超时，请检查网络后重试。");
    if (error instanceof TypeError) throw new Error("无法连接网站，请检查网络后重试。");
    throw error;
  }
}

export async function requestContent(path, body, signal) {
  const timeout = AbortSignal.timeout(30000);
  const response = await fetch(path, { cache: "no-store", signal: signal ? AbortSignal.any([signal, timeout]) : timeout, ...(body !== undefined && { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "暂时无法连接网站，请稍后重试；当前输入仍然保留。");
  return data;
}
