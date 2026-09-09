import assert from "node:assert/strict";
import test from "node:test";
import { access } from "node:fs/promises";
import { casePath, collections, collectionPath, getCase, getCases, getCollectionCases } from "../src/lib/content.js";
import { getSiteUrl, pageMetadata } from "../src/lib/seo.js";
import sitemap from "../src/app/sitemap.js";
import robots from "../src/app/robots.js";
import { clampSeekTime, formatVideoTime, getShotAtTime } from "../src/lib/videoTimeline.js";

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

test("video cases have ordered, contiguous, playable shot ranges and complete reference content", async () => {
  const videos = getCases().filter((item) => item.kind === "视频");
  assert.ok(videos.length);
  for (const { video } of videos) {
    assert.equal(new URL(video.src).protocol, "https:");
    assert.ok(video.durationSeconds > 0);
    assert.equal(new Set(video.shots.map(({ id }) => id)).size, video.shots.length);
    let previousEnd = 0;
    for (const shot of video.shots) {
      assert.equal(shot.start, previousEnd);
      assert.ok(shot.end > shot.start && shot.end <= video.durationSeconds);
      assert.ok(shot.title && shot.summary && shot.analysis.length && shot.imagePrompt && shot.videoPrompt);
      await access(new URL(`../public${shot.image}`, import.meta.url));
      previousEnd = shot.end;
    }
    assert.equal(previousEnd, video.durationSeconds);
  }
});

test("timeline follows forward playback, exact cuts, reverse seeks and the final frame", () => {
  const shots = getCases().find((item) => item.video).video.shots;
  assert.equal(getShotAtTime(shots, 0), shots[0]);
  assert.equal(getShotAtTime(shots, 5.999), shots[0]);
  assert.equal(getShotAtTime(shots, 6), shots[1]);
  assert.equal(getShotAtTime(shots, 24), shots[3]);
  assert.equal(getShotAtTime(shots, 2), shots[0]);
  assert.equal(getShotAtTime(shots, 32.323), shots.at(-1));
  for (const time of [-1, NaN, Infinity, 40]) assert.equal(getShotAtTime(shots, time), null);
  assert.equal(getShotAtTime([], 0), null);
  assert.equal(getShotAtTime([{ start: 0, end: 2 }, { start: 4, end: 6 }], 3), null);
});

test("seek targets stay playable before metadata and with shorter replacement videos", () => {
  assert.equal(clampSeekTime(19, NaN), 19);
  assert.equal(clampSeekTime(19, 0), 19);
  assert.equal(clampSeekTime(-3, 32), 0);
  assert.equal(clampSeekTime(NaN, 32), 0);
  assert.equal(clampSeekTime(26, 10), 9.99);
  assert.equal(clampSeekTime(6, 32), 6);
  assert.equal(formatVideoTime(32.323), "00:32");
  assert.equal(formatVideoTime(65), "01:05");
  assert.equal(formatVideoTime(NaN), "00:00");
});
