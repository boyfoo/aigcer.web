"use client";

import { createContext, useContext, useCallback, useEffect, useRef, useState } from "react";
import { App as AntApp, ConfigProvider, theme } from "antd";
import { requestContent } from "./lib/contentClient.js";
import { FAVORITES_KEY, decodeFavorites, encodeFavorites } from "./lib/favorites.js";
import { ReferenceProjectsProvider } from "./ReferenceProjects.jsx";
import { ContentProvider } from "./ContentProvider.jsx";

const PreferencesContext = createContext(null);
export const usePreferences = () => useContext(PreferencesContext);

export function Providers({ children, initialContent }) {
  const [tagState, setTagState] = useState(initialContent.tags);
  const updateTags = useCallback((tags) => setTagState(tags), []);
  const tagGroups = tagState.groups;
  const tagsLoaded = true;
  const [savedIds, setSavedIds] = useState(new Set());
  const favoriteReady = useRef(false);
  const [favoritesError, setFavoritesError] = useState("");
  useEffect(() => {
    const load = () => {
      try { setSavedIds(decodeFavorites(localStorage.getItem(FAVORITES_KEY))); favoriteReady.current = true; setFavoritesError(""); }
      catch { favoriteReady.current = false; setFavoritesError("收藏暂时无法读取，原数据未被覆盖"); }
    };
    load();
    const sync = (event) => { if (event.key === FAVORITES_KEY || event.key === null) load(); };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);
  const toggleFavorite = (id) => {
    if (!favoriteReady.current) throw new Error(favoritesError || "收藏尚未读取完成");
    const next = decodeFavorites(localStorage.getItem(FAVORITES_KEY));
    const wasSaved = next.has(id);
    if (wasSaved) next.delete(id); else next.add(id);
    localStorage.setItem(FAVORITES_KEY, encodeFavorites(next));
    setSavedIds(next);
    return !wasSaved;
  };
  const saveTags = async (groups, revision) => {
    const next = await requestContent("/api/tags", { groups, revision });
    setTagState(next);
    return next;
  };

  return <ConfigProvider theme={{
    algorithm: theme.darkAlgorithm,
    token: {
      colorPrimary: "#fcd535", colorPrimaryHover: "#ffe36b", colorPrimaryActive: "#e0b920",
      colorLink: "#ede7dc", colorLinkHover: "#f6f1e8", colorLinkActive: "#ede7dc",
      colorBgBase: "#0b0d0c", colorBgContainer: "#111411", colorTextBase: "#ede7dc", colorBorder: "#494439",
      borderRadius: 8, controlHeight: 40,
      fontFamily: "var(--font-sans)", fontWeightStrong: 500, lineHeight: 1.65,
    },
    components: { Button: { fontWeight: 500, primaryColor: "#0b0d0c", lineWidth: 2 }, Input: { activeShadow: "none" }, Tag: { borderRadiusSM: 999 } },
  }}><AntApp><PreferencesContext.Provider value={{ tagGroups, tagRevision: tagState.revision, saveTags, tagsLoaded, savedIds, toggleFavorite, favoritesError }}>
    <ContentProvider initialItems={initialContent.items} onTagsChange={updateTags}><ReferenceProjectsProvider>{children}</ReferenceProjectsProvider></ContentProvider>
  </PreferencesContext.Provider></AntApp></ConfigProvider>;
}
