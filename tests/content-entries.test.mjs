import assert from "node:assert/strict";
import test from "node:test";
import { getCases, casePath, shotPath, draftPath } from "../src/lib/content.js";
import { applyVideoUpload, isMediaUrl, normalizeContentEntry, normalizeDraft, presentCase } from "../src/lib/contentEntries.js";
import { createDefaultTagGroups } from "../src/tagSettings.js";
import { createCreationReferences, filterCreationReferences } from "../src/lib/creationReferences.js";
import { getShotAnnotation } from "../src/lib/shotPresentation.js";
import { filterStudyShots, formatShotDuration, shotSegments } from "../src/lib/shotOverview.js";
import { caseLearningFocus } from "../src/lib/learningPresentation.js";
import { createStudyReport } from "../src/lib/studyReport.js";

const entry = () => ({ ...structuredClone(getCases()[2]), id: "local-test", title: "  新录入案例  " });

test("replacing a video clears previous measurements and reviews while preserving authored material", () => {
  const draft = {
    kind: "视频", title: "", prompt: "保留提示词", description: "未保存介绍",
    video: {
      src: "https://example.com/old.mp4", durationSeconds: 99, isMock: true,
      metadata: { width: 1920, height: 1080, fps: 24, hasAudio: true },
      cast: [{ id: "person", name: "主角" }],
      shots: [{ id: "shot", narrative: "未保存分析", review: { boundary: { confirmed: true } } }],
    },
  };
  const before = structuredClone(draft);
  const changed = applyVideoUpload(draft, "https://example.com/new.mp4", { phase: "uploaded", name: "新片.mp4", duration: 0, metadata: {} });
  assert.equal(changed.title, "新片");
  assert.equal(changed.video.src, "https://example.com/new.mp4");
  assert.equal(changed.video.durationSeconds, 0);
  assert.deepEqual(changed.video.metadata, {});
  assert.equal(changed.video.isMock, false);
  assert.deepEqual(changed.video.shots, [{ id: "shot", narrative: "未保存分析", review: {} }]);
  assert.deepEqual(changed.video.cast, draft.video.cast);
  assert.equal(changed.prompt, draft.prompt);
  assert.equal(changed.description, draft.description);
  assert.deepEqual(draft, before);
});

test("late OSS measurements preserve current manual timing, video parameters and other unsaved edits", () => {
  const draft = {
    kind: "视频", title: "新填写的标题", prompt: "新的提示词", description: "新的介绍",
    video: {
      src: "https://example.com/new.mp4", durationSeconds: 12.5, isMock: false,
      metadata: { width: 640, height: 360, fps: 25, hasAudio: false },
      cast: [{ id: "person", name: "刚填写的人物" }],
      shots: [{ id: "shot", narrative: "刚填写的分析", review: { boundary: { confirmed: true } } }],
    },
  };
  const before = structuredClone(draft);
  const changed = applyVideoUpload(draft, draft.video.src, { phase: "metadata", name: "文件名.mp4", duration: 30, metadata: { width: 1920, height: 1080 } });
  assert.deepEqual(changed, draft);
  assert.deepEqual(draft, before);
});

test("OSS measurements fill only unknown video fields and ignore a source that was replaced or removed", () => {
  const draft = {
    kind: "视频", title: "当前标题", prompt: "未保存提示词",
    video: { src: "https://example.com/new.mp4", durationSeconds: 0, metadata: { fps: 24, hasAudio: false }, shots: [] },
  };
  const info = { phase: "metadata", duration: 30, metadata: { width: 1920, height: 1080 } };
  const changed = applyVideoUpload(draft, draft.video.src, info);
  assert.equal(changed.video.durationSeconds, 30);
  assert.deepEqual(changed.video.metadata, { width: 1920, height: 1080, fps: 24, hasAudio: false });
  assert.equal(changed.title, draft.title);
  assert.equal(changed.prompt, draft.prompt);
  for (const src of ["", "https://example.com/other.mp4"]) {
    const current = { ...draft, video: { ...draft.video, src } };
    assert.equal(applyVideoUpload(current, draft.video.src, info), current);
  }
  const image = { ...draft, kind: "分镜" };
  assert.equal(applyVideoUpload(image, draft.video.src, info), image);
});

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
  for (const source of ["https://example.com/video.mp4", "/images/avatar-curator.png"]) assert.equal(isMediaUrl(source), true, source);
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
  const references = createCreationReferences([normalizeContentEntry(entry())]);
  assert.equal(filterCreationReferences(references, { groups, filters: { type: option.id } }).length, 1);
  const custom = { id: "custom", label: "风格", options: [{ id: "film", label: "电影质感", value: "胶片" }] };
  const customReferences = createCreationReferences([normalizeContentEntry({ ...entry(), tags: ["胶片"] })]);
  assert.equal(filterCreationReferences(customReferences, { groups: [...groups, custom], filters: { custom: "film" } }).length, 1);
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

test("shot creation tags round trip through draft and published content without inheriting case tags", () => {
  const item = structuredClone(getCases()[0]);
  item.tagValues = { viewpoint: ["第一视角"], action: ["重击"] };
  item.tags = ["剑", "力量感"];
  item.video.shots[0].tagValues = {
    props: [" 剑 ", "剑", ""],
    action: ["重击"],
    intent: ["力量感"],
    viewpoint: "第一视角",
    editing: ["动作衔接"],
  };
  item.video.shots[0].facts = { 景别: "特写", 运镜: "固定镜头", 构图: "居中构图", 光影: "逆光" };
  Object.assign(item.video.shots[0], { category: "主观", rhythm: "重音", transition: "硬切" });
  const before = structuredClone(item);
  const expected = { props: ["剑"], action: ["重击"], intent: ["力量感"], viewpoint: ["第一视角"], editing: ["动作衔接"] };
  const saved = normalizeDraft(item);
  const published = normalizeContentEntry(JSON.parse(JSON.stringify(saved)));
  assert.deepEqual(saved.video.shots[0].tagValues, expected);
  assert.deepEqual(published.video.shots[0].tagValues, expected);
  assert.deepEqual(presentCase(published).video.shots[0].tagValues, expected);
  assert.deepEqual(JSON.parse(JSON.stringify(createStudyReport(published))).case.video.shots[0].tagValues, expected);
  assert.equal("tagValues" in published.video.shots[1], false);
  assert.deepEqual(item, before);
  assert.deepEqual(published.video.shots[0].facts, before.video.shots[0].facts);
  for (const key of ["category", "rhythm", "transition"]) assert.equal(published.video.shots[0][key], before.video.shots[0][key]);
  item.video.shots[0].tagValues = {};
  assert.deepEqual(normalizeDraft(item).video.shots[0].tagValues, {});
});

test("case and shot creation tags share group, value and identifier limits", () => {
  const invalid = [
    [],
    "重击",
    { "Invalid Group": ["剑"] },
    Object.fromEntries(Array.from({ length: 51 }, (_, index) => [`group-${index}`, []])),
    { props: Array.from({ length: 31 }, (_, index) => `道具${index}`) },
    { props: ["剑".repeat(61)] },
    { props: {} },
  ];
  for (const tagValues of invalid) {
    const item = structuredClone(getCases()[0]);
    assert.throws(() => normalizeDraft({ ...item, tagValues }), /标签/);
    item.video.shots[0].tagValues = tagValues;
    assert.throws(() => normalizeDraft(item), /标签/);
  }
  const item = structuredClone(getCases()[0]);
  item.video.shots[0].tagValues = Object.fromEntries(Array.from({ length: 50 }, (_, index) => [`group-${index}`, []]));
  item.video.shots[0].tagValues.props = Array.from({ length: 30 }, (_, index) => `道具${index}`);
  delete item.video.shots[0].tagValues["group-49"];
  const saved = normalizeDraft(item);
  assert.equal(Object.keys(saved.video.shots[0].tagValues).length, 50);
  assert.equal(saved.video.shots[0].tagValues.props.length, 30);
});

test("shot facts cannot be duplicated as independently editable creation tags", () => {
  for (const groupId of ["shot-size", "movement", "composition", "lighting"]) {
    const item = structuredClone(getCases()[0]);
    item.video.shots[0].tagValues = { [groupId]: ["重复值"] };
    assert.throws(() => normalizeDraft(item), /画面信息.*重复/);
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
