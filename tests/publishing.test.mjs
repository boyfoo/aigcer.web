import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRepository } from "../src/server/repository.js";
import { identifyMedia, byteRange } from "../src/server/media.js";
import { sameOrigin } from "../src/server/http.js";
import { decodeFavorites, encodeFavorites } from "../src/lib/favorites.js";
import { createDefaultTagGroups, matchesTagFilters, reconcileTagFilters } from "../src/tagSettings.js";

function database(t) {
  const prefix = path.join(tmpdir(), "jingjie-publishing-");
  const directory = mkdtempSync(prefix);
  const repository = createRepository(directory, []);
  t.after(() => { repository.close(); assert.ok(path.resolve(directory).startsWith(path.resolve(prefix))); rmSync(directory, { recursive: true, force: true }); });
  return { repository, directory };
}
const input = { kind: "分镜", title: "本地上传案例", image: "/images/night-lounge.png", duration: "00:08", prompt: "", analysis: "", tags: [] };
const act = (repository, action, record, draft = record.draft) => repository.change({ action, id: record.id, revision: record.revision, draft });

test("draft persistence, manual publication, pending edits, unlisting and relisting form an isolated lifecycle", (t) => {
  const { repository, directory } = database(t);
  let record = repository.change({ action: "save", draft: input });
  assert.equal(record.status, "draft");
  assert.deepEqual(repository.listPublished(), []);
  assert.throws(() => act(repository, "publish", record), /至少填写/);
  assert.equal(repository.getRecord(record.id).revision, record.revision);
  const secondProcess = createRepository(directory, []);
  assert.equal(secondProcess.getRecord(record.id).draft.title, input.title);
  secondProcess.close();
  record = act(repository, "publish", record, { ...record.draft, analysis: "正式分析" });
  assert.equal(repository.getPublished(record.id).analysis, "正式分析");
  record = act(repository, "save", record, { ...record.draft, title: "未发布的新标题", analysis: "未公开的分析" });
  assert.equal(record.hasChanges, true);
  assert.equal(repository.getPublished(record.id).title, input.title);
  record = act(repository, "unlist", record);
  assert.equal(record.status, "offline");
  assert.equal(repository.getPublished(record.id), null);
  record = act(repository, "relist", record);
  assert.equal(repository.getPublished(record.id).analysis, "正式分析");
  record = act(repository, "publish", record);
  assert.equal(repository.getPublished(record.id).analysis, "未公开的分析");
  assert.equal(record.hasChanges, false);
  assert.throws(() => act(repository, "delete", record), /下架/);
});

test("concurrent edits cannot overwrite a newer saved draft or publication", (t) => {
  const { repository } = database(t);
  const original = repository.change({ action: "save", draft: input });
  const newer = act(repository, "save", original, { ...original.draft, title: "最新修改" });
  assert.throws(() => act(repository, "publish", original, { ...original.draft, prompt: "旧编辑器的提示词" }), (error) => error.status === 409);
  assert.equal(repository.getRecord(newer.id).draft.title, "最新修改");
  assert.deepEqual(repository.listPublished(), []);
  act(repository, "delete", newer);
  assert.equal(repository.getRecord(newer.id), null);
});

test("publication accepts reference material on a shot, and incomplete timing can be saved but not published", (t) => {
  const { repository } = database(t);
  let record = repository.change({ action: "save", draft: { ...input, kind: "视频", video: { src: "/media/video.mp4", durationSeconds: 6, shots: [{ id: "first-shot", start: 0, end: 0, imagePrompt: "首帧提示词" }] } } });
  assert.throws(() => act(repository, "publish", record), /时间/);
  record.draft.video.shots[0].end = 6;
  record = act(repository, "publish", record);
  assert.equal(repository.getPublished(record.id).video.shots[0].imagePrompt, "首帧提示词");
});

test("multi-select tags are OR within a group and AND between groups; empty selections impose no restriction", () => {
  const groups = createDefaultTagGroups();
  const id = (group, label) => groups.find(({ id }) => id === group).options.find(({ value }) => value === label).id;
  const filters = { lighting: [id("lighting", "逆光"), id("lighting", "柔光")], emotion: [id("emotion", "温暖")] };
  assert.equal(matchesTagFilters({ lighting: ["柔光"], emotion: ["温暖"], tags: [] }, groups, filters), true);
  assert.equal(matchesTagFilters({ lighting: ["逆光", "硬光"], emotion: ["孤独"], tags: [] }, groups, filters), false);
  assert.equal(matchesTagFilters({ lighting: ["硬光"], emotion: ["温暖"], tags: [] }, groups, filters), false);
  assert.equal(matchesTagFilters({ lighting: [], emotion: [], tags: [] }, groups, {}), true);
  const trimmed = structuredClone(groups);
  trimmed.find(({ id }) => id === "lighting").options = [];
  assert.deepEqual(reconcileTagFilters(trimmed, filters).lighting, []);
});

test("site-wide tags persist and reject conflicting saves", (t) => {
  const { repository, directory } = database(t);
  const current = repository.readTags();
  current.groups[0].label = "影片类型";
  repository.saveTags(current.groups, current.revision);
  const another = createRepository(directory, []);
  assert.equal(another.readTags().groups[0].label, "影片类型");
  another.close();
  assert.throws(() => repository.saveTags([], current.revision), (error) => error.status === 409);
});

test("media content detection, byte ranges and cross-site write rejection", () => {
  assert.equal(identifyMedia(Buffer.from("89504e470d0a1a0a", "hex"), "image").mime, "image/png");
  assert.throws(() => identifyMedia(Buffer.from("<svg><script>alert(1)</script></svg>"), "image"), (error) => error.status === 415);
  assert.throws(() => identifyMedia(Buffer.from("this is not video.mp4"), "video"));
  assert.deepEqual(byteRange("bytes=2-6", 10), { start: 2, end: 6 });
  assert.deepEqual(byteRange("bytes=-3", 10), { start: 7, end: 9 });
  assert.deepEqual(byteRange("bytes=6-", 10), { start: 6, end: 9 });
  for (const range of ["bytes=9-3", "bytes=20-", "bytes=0-1,3-4", "bytes=-0"]) assert.throws(() => byteRange(range, 10));
  assert.throws(() => sameOrigin(new Request("http://localhost/api/content", { headers: { Origin: "https://elsewhere.example" } })), (error) => error.status === 403);
  assert.doesNotThrow(() => sameOrigin(new Request("http://internal/api/content", { headers: { Host: "127.0.0.1:5174", Origin: "http://127.0.0.1:5174" } })));
});

test("anonymous favorites survive serialization without resetting corrupt saved data", () => {
  assert.deepEqual(decodeFavorites(encodeFavorites(new Set(["a", "b"]))), new Set(["a", "b"]));
  assert.deepEqual(decodeFavorites(null), new Set());
  assert.throws(() => decodeFavorites("corrupt"));
  assert.throws(() => decodeFavorites('{"version":1,"ids":[4]}'));
});
