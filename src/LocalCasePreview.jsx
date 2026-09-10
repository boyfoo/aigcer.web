"use client";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { App } from "./App.jsx";
import { useManagedContent } from "./ContentProvider.jsx";
import { presentCase } from "./lib/contentEntries.js";

export function LocalCasePreview() {
  const params = useSearchParams();
  const { records, ready, error } = useManagedContent();
  const item = records.find((entry) => entry.id === params.get("id"));
  if (error || (ready && !item)) return <main className="tag-settings-page"><h1>暂时无法打开这个草稿</h1><p>{error || "内容不存在或已被删除。"}</p><Link href="/content">返回内容录入</Link></main>;
  if (!ready) return <main className="tag-settings-page" role="status">正在读取草稿…</main>;
  return <><div className="draft-preview-notice">草稿预览 · 保存后需发布才对访客生效 <Link href="/content">返回内容录入</Link></div><App key={item.id} page="case" initialCaseId={item.id} previewItem={presentCase(item.draft)} /></>;
}
