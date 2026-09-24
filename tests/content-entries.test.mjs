import assert from "node:assert/strict";
import test from "node:test";
import { getCases, casePath, shotPath, draftPath } from "../src/lib/content.js";
import { isMediaUrl, normalizeContentEntry, normalizeDraft, presentCase } from "../src/lib/contentEntries.js";
import { createDefaultTagGroups, matchesTagFilters } from "../src/tagSettings.js";
import { getShotAnnotation } from "../src/lib/shotPresentation.js";
import { filterStudyShots, formatShotDuration, shotSegments } from "../src/lib/shotOverview.js";
import { caseLearningFocus } from "../src/lib/learningPresentation.js";

const entry = () => ({ ...structuredClone(getCases()[2]), id: "local-test", title: "  新录入案例  " });

test("case learning focus uses authored material and never presents mock shot analysis as a real lesson", () => {
  assert.equal(caseLearningFocus({ analysis: "逆光描出轮廓。后续细节。" }), "逆光描出轮廓。");
  const video = { isMock: true, shots: [{ summary: "模拟分析" }] };
  assert.equal(caseLearningFocus({ video, tags: ["雨夜", "逆光"] }), "雨夜 · 逆光");
  assert.equal(caseLearningFocus({ video: { ...video, isMock: false } }), "模拟分析");
  assert.equal(Array.from(caseLearningFocus({ analysis: "画".repeat(2000) })).length, 101);
});

test("normalizing drafts trims text and preserves video references without mutating input", () => {
  const source = entry();
  assert.equal(normalizeDraft(source).title, "新录入案例");
  assert.equal(source.title, "  新录入案例  ");
  const video = structuredClone(getCases()[0]);
  const before = structuredClone(video);
  assert.deepEqual(normalizeDraft(video).video, before.video);
  assert.deepEqual(video, before);
});

test("local case and shot links use the actual preview route and preserve query parameters", () => {
  const route = new URL(shotPath("local-test", "shot-test"), "https://example.com");
  assert.equal(route.pathname, "/cases/local-test");
  assert.equal(draftPath("local-test"), "/case-preview?id=local-test");
  assert.equal(route.searchParams.get("shot"), "shot-test");
  assert.equal(casePath("night-cinema"), "/cases/night-cinema");
  assert.equal(shotPath("night-cinema", "ending"), "/cases/night-cinema?shot=ending");
});

test("media sources reject scripts, temporary blobs and invalid image data", () => {
  for (const source of ["javascript:alert(1)", "blob:https://example.com/x", "file:///C:/video.mp4", "//elsewhere.com/x", "/\\elsewhere.com/x", "https://user:password@example.com/x", "data:image/svg+xml,<svg></svg>"]) assert.equal(isMediaUrl(source), false, source);
  for (const source of ["https://example.com/video.mp4", "/images/night-lounge.png"]) assert.equal(isMediaUrl(source), true, source);
  assert.equal(isMediaUrl("data:image/png;base64,aGVsbG8="), false);
  assert.throws(() => normalizeDraft({ ...entry(), image: "data:image/png;base64,aGVsbG8=" }), /封面/);
  assert.throws(() => normalizeContentEntry({ ...entry(), image: "blob:expired" }), /封面/);
});

test("publishing validates required fields while drafts allow incomplete content", () => {
  for (const changes of [{ title: "" }, { prompt: " " }, { duration: "00:99" }]) assert.throws(() => normalizeContentEntry({ ...entry(), ...changes }));
  assert.equal(normalizeContentEntry({ ...entry(), description: "" }).description, "");
  assert.equal(normalizeContentEntry({ ...entry(), prompt: "", analysis: "观察光线方向" }).analysis, "观察光线方向");
  assert.equal(normalizeDraft({ ...entry(), title: "", prompt: "", image: "" }).title, "");
});

test("video entry supports initial saving without shots, and validates authored shot timing", () => {
  const item = structuredClone(getCases()[0]);
  item.id = "local-video";
  item.video.isMock = false;
  assert.equal(getShotAnnotation({ id: "new-authored-shot" }), null);
  assert.equal(normalizeContentEntry({ ...item, video: { ...item.video, shots: [] } }).video.shots.length, 0);
  item.video.shots[0].image = "";
  assert.equal(presentCase(normalizeContentEntry(item)).video.shots[0].image, item.image);
  for (const changes of [{ start: -1 }, { end: 0 }, { end: 99 }]) {
    const invalid = structuredClone(item);
    Object.assign(invalid.video.shots[0], changes);
    assert.throws(() => normalizeContentEntry(invalid), /时间/);
  }
  item.video.shots[1].start = 5;
  assert.throws(() => normalizeContentEntry(item), /重叠/);
});

test("entered cases remain filterable when displayed labels are renamed", () => {
  const groups = createDefaultTagGroups();
  const group = groups.find(({ id }) => id === "type");
  const option = group.options.find(({ value }) => value === "故事片");
  option.label = "剧情片";
  assert.equal(matchesTagFilters(normalizeContentEntry(entry()), groups, { type: option.id }), true);
  const custom = { id: "custom", label: "风格", options: [{ id: "film", label: "电影质感", value: "胶片" }] };
  assert.equal(matchesTagFilters(normalizeContentEntry({ ...entry(), tags: ["胶片"] }), [...groups, custom], { custom: "film" }), true);
});

test("optional shot frames and context round trip without adding invented content to old cases", () => {
  const item = structuredClone(getCases()[0]);
  Object.assign(item.video.shots[0], { endImage: "/media/tail.png", sound: "  雨声与低音  ", dialogue: "快进来。", onscreenText: "电影院", narrative: "交代人物的目的" });
  const restored = normalizeDraft(JSON.parse(JSON.stringify(normalizeDraft(item))));
  assert.equal(restored.video.shots[0].endImage, "/media/tail.png");
  assert.equal(restored.video.shots[0].sound, "雨声与低音");
  assert.equal(restored.video.shots[0].dialogue, "快进来。");
  assert.equal(restored.video.shots[0].onscreenText, "电影院");
  assert.equal(restored.video.shots[0].narrative, "交代人物的目的");
  assert.equal("endImage" in restored.video.shots[1], false);
  assert.equal("sound" in restored.video.shots[1], false);
  item.video.shots[0].image = "";
  const shown = presentCase(normalizeDraft(item));
  assert.equal(shown.video.shots[0].image, item.image);
  assert.equal(shown.video.shots[0].imageIsFallback, true);
  assert.equal(shown.video.shots[0].endImage, "/media/tail.png");
});

test("tail frames follow upload URL validation and optional context keeps text limits", () => {
  for (const changes of [{ endImage: "blob:expired" }, { endImage: "javascript:alert(1)" }, { sound: "声".repeat(2001) }, { dialogue: {} }]) {
    const item = structuredClone(getCases()[0]);
    Object.assign(item.video.shots[0], changes);
    assert.throws(() => normalizeDraft(item), /尾帧|声音|台词/);
  }
});

const overviewShots = [
  { id: "a", start: 1, end: 3, title: "街口", facts: { 景别: "远景", 运镜: "固定" }, sound: "雨声", analysis: [] },
  { id: "b", start: 4, end: 4.25, title: "抬头", facts: { 景别: "特写", 运镜: "固定" }, dialogue: "等一下", analysis: [] },
  { id: "c", start: 4.25, end: 8, title: "走进街道", facts: { 景别: "远景", 运镜: "跟拍" }, narrative: "人物离开", analysis: [] },
];
test("overview searches authored context and combines filters while preserving canonical shot numbers", () => {
  assert.deepEqual(filterStudyShots(overviewShots, { query: "雨声 街口" }).map(({ index }) => index), [0]);
  assert.deepEqual(filterStudyShots(overviewShots, { query: "等一下" }).map(({ index }) => index), [1]);
  assert.deepEqual(filterStudyShots(overviewShots, { query: "离开" }).map(({ index }) => index), [2]);
  assert.deepEqual(filterStudyShots(overviewShots, { size: "远景", movement: "固定" }).map(({ index }) => index), [0]);
  assert.deepEqual(filterStudyShots(overviewShots, { size: "特写", movement: "跟拍" }), []);
  assert.deepEqual(filterStudyShots(overviewShots, { size: "远景", sort: "longest" }).map(({ index }) => index), [2, 0]);
  assert.deepEqual(filterStudyShots(overviewShots, { sort: "shortest" }).map(({ index }) => index), [1, 0, 2]);
  assert.deepEqual(overviewShots.map(({ id }) => id), ["a", "b", "c"]);
  assert.equal(formatShotDuration(overviewShots[1]), "0.25 秒");
});

test("rhythm width represents the full duration including leading, interior and trailing gaps", () => {
  const segments = shotSegments(overviewShots, 10);
  assert.deepEqual(segments.map(({ start, end }) => [start, end]), [[0, 1], [1, 3], [3, 4], [4, 4.25], [4.25, 8], [8, 10]]);
  assert.deepEqual(segments.filter(({ shot }) => shot).map(({ index, fraction }) => [index, fraction]), [[0, .2], [1, .025], [2, .375]]);
  assert.equal(segments.reduce((sum, { fraction }) => sum + fraction, 0), 1);
  assert.deepEqual(shotSegments([], 0), []);
  assert.deepEqual(shotSegments([{ id: "incomplete", start: 0, end: 0 }], 10), []);
  assert.deepEqual(shotSegments([{ id: "a", start: 0, end: 4 }, { id: "b", start: 2, end: 6 }], 10), []);
});
