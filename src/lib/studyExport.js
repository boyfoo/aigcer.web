import { createStudyReport } from "./studyReport.js";
import { createOfflineReportHtml } from "./offlineStudy.js";

export function downloadFile(contents, name, type) {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const link = document.createElement("a");
  link.href = url; link.download = name; document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const fileName = (item) => (item.title || item.id || "拉片报告").replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-").slice(0, 80);
export function downloadStudyJson(item) { downloadFile(JSON.stringify(createStudyReport(item), null, 2), `${fileName(item)}-镜头资料.json`, "application/json;charset=utf-8"); }

export async function downloadOfflineStudy(item) {
  const images = {}, video = item.video || {};
  const urls = [...new Set([item.image, ...(video.shots || []).flatMap((s) => [s.image, s.endImage]), ...(video.cast || []).map((c) => c.image)].filter(Boolean))];
  let missing = 0, embeddedBytes = 0;
  // Bound memory, concurrency and network waits for large reports.
  for (let i = 0; i < urls.length; i += 4) {
    await Promise.all(urls.slice(i, i + 4).map(async (url) => {
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
        if (!response.ok) throw new Error("图片读取失败");
        const blob = await response.blob();
        if (!/^image\/(png|jpeg|webp|gif)$/.test(blob.type) || blob.size > 20 * 1024 * 1024 || embeddedBytes + blob.size > 128 * 1024 * 1024) throw new Error("图片过大或格式不支持");
        embeddedBytes += blob.size;
        images[url] = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(reader.error); reader.readAsDataURL(blob); });
      } catch { images[url] = ""; missing++; }
    }));
  }
  downloadFile(createOfflineReportHtml(item, images), `${fileName(item)}-离线拉片报告.html`, "text/html;charset=utf-8");
  return missing;
}
