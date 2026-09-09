import { AntdRegistry } from "@ant-design/nextjs-registry";
import { Providers } from "../Providers.jsx";
import "@fontsource-variable/noto-sans-sc/wght.css";
import "@fontsource-variable/noto-serif-sc/wght.css";
import "../styles.css";
import { siteDescription, siteName } from "../lib/seo.js";

export const metadata = {
  title: { default: `${siteName} · AI 视频灵感库`, template: `%s · ${siteName}` },
  description: siteDescription,
};

export default function RootLayout({ children }) {
  return <html lang="zh-CN"><body><AntdRegistry><Providers>{children}</Providers></AntdRegistry></body></html>;
}
