import { App } from "../../App.jsx";
import { getCases } from "../../lib/content.js";
import { pageMetadata } from "../../lib/seo.js";

export const metadata = pageMetadata({ title: "内容录入", path: "/content", index: false });

export default function ContentPage() {
  return <App page="content" items={getCases()} />;
}
