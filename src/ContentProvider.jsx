"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { requestContent, contentReadOnly } from "./lib/contentClient.js";

const ContentContext = createContext(null);
export const useContentCases = () => useContext(ContentContext);
export function ContentProvider({ children, initialItems, onTagsChange }) {
  const [items, setItems] = useState(initialItems);
  const pathname = usePathname();
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    if (contentReadOnly) return;
    const requestId = ++generation.current;
    const data = await requestContent("/api/public");
    if (requestId === generation.current) { setItems(data.items); onTagsChange(data.tags); }
  }, [onTagsChange]);
  useEffect(() => { setItems(initialItems); }, [initialItems]);
  useEffect(() => {
    const update = () => { refresh().catch(() => {}); };
    update(); window.addEventListener("focus", update);
    return () => window.removeEventListener("focus", update);
  }, [pathname, refresh]);
  return <ContentContext.Provider value={{ items, refresh }}>{children}</ContentContext.Provider>;
}

export function useManagedContent() {
  const { refresh: refreshPublic } = useContentCases();
  const [records, setRecords] = useState([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const refresh = useCallback(async () => {
    if (contentReadOnly) { setError("当前是静态浏览版本，请在网站服务的内容录入页管理资料。"); return; }
    try { const data = await requestContent("/api/content"); setRecords(data.records); setReady(true); setError(""); }
    catch (failure) { setError(failure.message); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  const change = async (action, draft, current) => {
    const data = await requestContent("/api/content", { action, draft, id: current?.id, revision: current?.revision });
    setRecords((all) => data.record ? [data.record, ...all.filter(({ id }) => id !== data.record.id)] : all.filter(({ id }) => id !== current.id));
    // Saving succeeded even if a subsequent public-list refresh temporarily fails.
    await refreshPublic().catch(() => {});
    return data.record;
  };
  return { records, ready, error, refresh, change };
}
