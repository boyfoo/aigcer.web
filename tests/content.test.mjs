import assert from "node:assert/strict";
import test from "node:test";
import { access } from "node:fs/promises";
import { casePath, collections, collectionPath, getCase, getCases, getCollectionCases } from "../src/lib/content.js";
import { getSiteUrl, pageMetadata } from "../src/lib/seo.js";
import sitemap from "../src/app/sitemap.js";
import robots from "../src/app/robots.js";

test("every case has a unique stable route and an existing image", async () => {
  const cases = getCases();
  assert.ok(cases.length);
  assert.equal(new Set(cases.map(({ id }) => id)).size, cases.length);
  for (const item of cases) {
    assert.match(item.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert.equal(getCase(item.id), item);
    assert.equal(casePath(item.id), `/cases/${item.id}`);
    await access(new URL(`../public${item.image}`, import.meta.url));
  }
  assert.equal(getCase("missing-case"), null);
});

test("collections contain only their intended case types", () => {
  for (const collection of collections) {
    const cases = getCollectionCases(collection.slug);
    assert.ok(cases.length);
    assert.ok(cases.every((item) => !collection.kind || item.kind === collection.kind));
  }
  assert.deepEqual(getCollectionCases("missing-collection"), []);
});

test("production sitemap, canonical URLs and indexing use the configured origin", () => {
  const previous = process.env.SITE_URL;
  process.env.SITE_URL = "https://jingjie.example/";
  try {
    const expectedPaths = ["/", ...collections.map(({ slug }) => collectionPath(slug)), ...getCases().map(({ id }) => casePath(id))];
    assert.deepEqual(sitemap().map(({ url }) => url), expectedPaths.map((path) => `https://jingjie.example${path}`));
    assert.equal(robots().sitemap, "https://jingjie.example/sitemap.xml");
    const item = getCases()[0];
    const metadata = pageMetadata({ title: item.title, description: item.description, path: casePath(item.id), image: item.image });
    assert.equal(metadata.alternates.canonical, `https://jingjie.example/cases/${item.id}`);
    assert.equal(metadata.openGraph.images[0].url, `https://jingjie.example${item.image}`);
    assert.equal(metadata.robots.index, true);
    assert.equal(pageMetadata({ title: "设置", path: "/settings", index: false }).robots.index, false);
  } finally {
    if (previous === undefined) delete process.env.SITE_URL;
    else process.env.SITE_URL = previous;
  }
});

test("unconfigured previews do not advertise a fabricated public domain", () => {
  const previous = process.env.SITE_URL;
  delete process.env.SITE_URL;
  try {
    assert.equal(getSiteUrl(), null);
    assert.deepEqual(sitemap(), []);
    assert.equal(robots().rules.disallow, "/");
    assert.equal(pageMetadata({ title: "首页", path: "/" }).robots.index, false);
    assert.equal(pageMetadata({ title: "首页", path: "/" }).alternates, undefined);
    process.env.SITE_URL = "javascript:alert(1)";
    assert.throws(getSiteUrl, /SITE_URL/);
  } finally {
    if (previous === undefined) delete process.env.SITE_URL;
    else process.env.SITE_URL = previous;
  }
});
