import { App } from "../App.jsx";
import { pageMetadata } from "../lib/seo.js";

export const metadata = pageMetadata({ title: "AI 视频灵感库", path: "/" });

export default function HomePage() {
  return <App />;
}
