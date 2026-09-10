import { Suspense } from "react";
import { LocalCasePreview } from "../../LocalCasePreview.jsx";
import { pageMetadata } from "../../lib/seo.js";

export const metadata = pageMetadata({ title: "草稿预览", path: "/case-preview", index: false });

export default function CasePreviewPage() {
  return <Suspense fallback={<main className="tag-settings-page">正在读取案例…</main>}><LocalCasePreview /></Suspense>;
}
