import { notFound } from "next/navigation";
import { App } from "../../../App.jsx";
import { collections, collectionPath, getCollection } from "../../../lib/content.js";
import { pageMetadata } from "../../../lib/seo.js";

export function generateStaticParams() {
  return collections.map(({ slug }) => ({ slug }));
}

export async function generateMetadata({ params }) {
  const collection = getCollection((await params).slug);
  if (!collection) notFound();
  return pageMetadata({ title: collection.title, description: collection.description, path: collectionPath(collection.slug) });
}

export default async function CollectionPage({ params }) {
  const collection = getCollection((await params).slug);
  if (!collection) notFound();
  return <App key={collection.slug} collection={collection} />;
}
