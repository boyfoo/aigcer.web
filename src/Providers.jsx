"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { App as AntApp, ConfigProvider, theme } from "antd";
import { createDefaultTagGroups, loadTagGroups } from "./tagSettings.js";

const PreferencesContext = createContext(null);
export const usePreferences = () => useContext(PreferencesContext);

export function Providers({ children }) {
  const [tagGroups, setTagGroups] = useState(createDefaultTagGroups);
  const [tagsLoaded, setTagsLoaded] = useState(false);
  const [savedIds, setSavedIds] = useState(new Set());
  useEffect(() => {
    setTagGroups(loadTagGroups());
    setTagsLoaded(true);
  }, []);

  return <ConfigProvider theme={{
    algorithm: theme.darkAlgorithm,
    token: {
      colorPrimary: "#fcd535", colorPrimaryHover: "#ffe36b", colorPrimaryActive: "#e0b920",
      colorBgBase: "#0b0d0c", colorBgContainer: "#111411", colorTextBase: "#ede7dc", colorBorder: "#494439",
      borderRadius: 8, controlHeight: 40,
      fontFamily: '"Noto Sans SC Variable", "PingFang SC", "Microsoft YaHei", sans-serif',
    },
    components: { Button: { fontWeight: 500, primaryColor: "#0b0d0c" }, Input: { activeShadow: "none" }, Tag: { borderRadiusSM: 999 } },
  }}><AntApp><PreferencesContext.Provider value={{ tagGroups, setTagGroups, tagsLoaded, savedIds, setSavedIds }}>
    {children}
  </PreferencesContext.Provider></AntApp></ConfigProvider>;
}
