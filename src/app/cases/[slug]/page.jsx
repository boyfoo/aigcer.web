import { notFound } from "next/navigation";
import { App } from "../../../App.jsx";
import { casePath, getCase, getCases } from "../../../lib/content.js";
import { pageMetadata } from "../../../lib/seo.js";

export function generateStaticParams() {
  return getCases().map((item) => ({ slug: item.id }));
}

export async function generateMetadata({ params }) {
  const item = getCase((await params).slug);
  if (!item) notFound();
  return pageMetadata({ title: item.title, description: item.description, path: casePath(item.id), image: item.image });
}

export default async function CasePage({ params }) {
  const item = getCase((await params).slug);
  if (!item) notFound();
  return <App key={item.id} page="case" items={getCases()} initialCaseId={item.id} />;
}
