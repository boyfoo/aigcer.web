import { AntdRegistry } from "@ant-design/nextjs-registry";
import { Providers } from "../Providers.jsx";
import "@fontsource-variable/noto-sans-sc/wght.css";
import "../styles.css";
import { siteDescription, siteName } from "../lib/seo.js";
import { publicContent } from "../server/published.js";

export const metadata = {
  title: { default: `${siteName} · AI 视频灵感库`, template: `%s · ${siteName}` },
  description: siteDescription,
  icons: {
    icon: [
      { url: "/favicon.ico?v=4", sizes: "16x16 32x32 48x48", type: "image/x-icon" },
    ],
    apple: [{ url: "/apple-touch-icon.png?v=3", sizes: "180x180", type: "image/png" }],
  },
};

export default async function RootLayout({ children }) {
  const initialContent = await publicContent();
  return <html lang="zh-CN"><body><AntdRegistry><Providers initialContent={initialContent}>{children}</Providers></AntdRegistry></body></html>;
}
