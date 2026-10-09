import { useEffect, useRef, useState } from "react";
import { requestMediaAccess } from "../lib/contentClient.js";

const pendingAccess = (source) => ({ source, url: "", expiresAt: null, loading: Boolean(source), error: "" });

export function useMediaAccess(value) {
  const [access, setAccess] = useState(() => pendingAccess(value));
  const [refresh, setRefresh] = useState(0);
  const cached = useRef(null);
  const request = useRef(null);

  useEffect(() => {
    if (!value) {
      cached.current = null;
      setAccess(pendingAccess(""));
      return;
    }

    const existing = cached.current;
    if (existing?.source === value && (!existing.expiresAt || Date.parse(existing.expiresAt) > Date.now())) {
      setAccess(existing);
      return;
    }

    const controller = new AbortController();
    let active = true;
    request.current = controller;
    setAccess(pendingAccess(value));

    requestMediaAccess(value, controller.signal).then((result) => {
      if (!active || controller.signal.aborted) return;
      const resolved = { source: value, url: result.url, expiresAt: result.expiresAt, loading: false, error: "" };
      cached.current = resolved;
      setAccess(resolved);
    }).catch((error) => {
      if (!active || controller.signal.aborted) return;
      setAccess({ ...pendingAccess(value), loading: false, error: error.message || "无法取得素材预览地址，请重试。" });
    });

    return () => {
      active = false;
      controller.abort();
      if (request.current === controller) request.current = null;
    };
  }, [value, refresh]);

  const retry = () => {
    request.current?.abort();
    cached.current = null;
    setAccess(pendingAccess(value));
    setRefresh((current) => current + 1);
  };

  const acceptUpload = ({ mediaUrl, url, expiresAt }) => {
    request.current?.abort();
    // Reuse the upload's access URL; the unsigned object URL remains the saved source.
    const resolved = { source: mediaUrl, url, expiresAt, loading: false, error: "" };
    cached.current = resolved;
    setAccess(resolved);
  };

  return { ...(access.source === value ? access : pendingAccess(value)), retry, acceptUpload };
}
