import Link from "next/link";

export default function NotFound() {
  return <main className="not-found-page"><p>404</p><h1>没有找到这个页面</h1><p>内容可能已移除，回到首页看看其他镜头参考。</p><Link href="/">返回镜头参考</Link></main>;
}
