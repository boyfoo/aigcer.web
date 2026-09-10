import { notFound } from "next/navigation";
import { App } from "../../../App.jsx";
import { casePath } from "../../../lib/content.js";
import { publishedCase } from "../../../server/published.js";
import { withRepository } from "../../../server/repository.js";
import { pageMetadata } from "../../../lib/seo.js";

export function generateStaticParams() {
  return withRepository((repository) => repository.listPublished().map((item) => ({ slug: item.id })));
}

export async function generateMetadata({ params }) {
  const item = await publishedCase((await params).slug);
  if (!item) notFound();
  return pageMetadata({ title: item.title, description: item.description, path: casePath(item.id), image: item.image });
}

export default async function CasePage({ params }) {
  const item = await publishedCase((await params).slug);
  if (!item) notFound();
  return <App key={item.id} page="case" initialCaseId={item.id} serverItem={item} />;
}
