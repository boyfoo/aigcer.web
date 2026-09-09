import { App } from "../../App.jsx";
import { getCases } from "../../lib/content.js";
import { pageMetadata } from "../../lib/seo.js";

export const metadata = pageMetadata({ title: "标签设置", path: "/settings", index: false });

export default function SettingsPage() {
  return <App page="settings" items={getCases()} />;
}
