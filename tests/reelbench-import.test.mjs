import assert from "node:assert/strict";
import test from "node:test";
import { normalizeContentEntry, normalizeDraft } from "../src/lib/contentEntries.js";
import { convertReelbenchImport } from "../src/lib/reelbenchImport.js";
import { shotStatistics, studyQuality } from "../src/lib/studyReport.js";

const videoData = () => ({
  source: "C:\\work\\original.mp4",
  title: "真实拉片",
  meta: { durationSeconds: 10, width: 1920, height: 1080, fps: 29.97, hasAudio: true },
  cast: [{ id: "P1", name: "甲", note: "真实录入的人物", image: "cast/P1.jpg" }],
  shots: [{ id: "S01", start: 0, end: 4, seconds: 4, size: "medium-close", camera: "tracking", category: "dialogue", transitionIn: "cut", rhythm: "setup", frame: "人物站在门边，抬手推开门。", rhythmNote: "交代人物进入房间的目的。", audio: "甲：进来吧。", onscreenText: "第一天", note: "机器切点，需对照原片", subjects: ["P1"] }],
});
const media = () => [
  { localName: "original.mp4", kind: "video", url: "/media/original.mp4" },
  { localName: "frames/S01a.jpg", kind: "image", url: "/media/frame-a.jpg" },
  { localName: "frames/S01b.jpg", kind: "image", url: "/media/frame-b.jpg" },
  { localName: "cast/P1.jpg", kind: "image", url: "/media/person.jpg" },
];
const convert = (data = videoData(), files = media()) => convertReelbenchImport(data, files, { caseId: "mcp-case" });

test("reelbench material maps to an editable draft without mutating the source", () => {
  const source = videoData();
  const before = structuredClone(source);
  const result = convert(source);
  const shot = result.draft.video.shots[0];
  assert.deepEqual(source, before);
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(normalizeDraft(result.draft), result.draft);
  assert.equal(result.draft.kind, "视频");
  assert.equal(result.draft.video.src, "/media/original.mp4");
  assert.equal(result.draft.video.durationSeconds, 10);
  assert.deepEqual(result.draft.video.metadata, { width: 1920, height: 1080, fps: 29.97, hasAudio: true });
  assert.equal(shot.summary, before.shots[0].frame);
  assert.equal(shot.narrative, before.shots[0].rhythmNote);
  assert.equal(shot.dialogue, before.shots[0].audio);
  assert.equal("sound" in shot, false);
  assert.equal(shot.onscreenText, "第一天");
  assert.deepEqual(shot.facts, { 景别: "中近景", 运镜: "跟拍" });
  assert.deepEqual([shot.category, shot.transition, shot.rhythm], ["对话", "硬切", "铺垫"]);
  assert.deepEqual(shot.analysis, [{ label: "来源备注", text: before.shots[0].note }]);
  assert.deepEqual(shot.subjects, ["p1"]);
  assert.deepEqual(result.sourceIds, { cast: { P1: "p1" }, shots: { S01: "s01" } });
  assert.equal(result.draft.video.cast[0].image, "/media/person.jpg");
  assert.equal(shot.imagePrompt, "");
  assert.equal(shot.videoPrompt, "");
});

test("enumerations retain their actual taxonomy meaning and missing transitions stay unknown", () => {
  const source = videoData();
  Object.assign(source.shots[0], { size: "wide", camera: "rack-focus", category: "insert", rhythm: "close", transitionIn: "match-cut" });
  const shot = convert(source).draft.video.shots[0];
  assert.deepEqual(shot.facts, { 景别: "全景", 运镜: "变焦点" });
  assert.deepEqual([shot.category, shot.rhythm, shot.transition], ["插入特写", "收口", "匹配剪辑"]);
  source.shots[0].size = "close";
  source.shots[0].transitionIn = undefined;
  assert.equal(convert(source).draft.video.shots[0].facts.景别, "特写");
  assert.equal("transition" in convert(source).draft.video.shots[0], false);
});

test("missing tail and character images remain absent and are reported separately", () => {
  const result = convert(videoData(), media().slice(0, 2));
  const shot = result.draft.video.shots[0];
  assert.equal(shot.image, "/media/frame-a.jpg");
  assert.equal("endImage" in shot, false);
  assert.equal(result.draft.video.cast[0].image, "");
  assert.ok(result.warnings.some((warning) => warning.includes("shots[0].endImage") && warning.includes("S01b.jpg")));
  assert.ok(result.warnings.some((warning) => warning.includes("cast[0].image")));
  assert.equal(studyQuality(result.draft.video).find(({ id }) => id === "frames").status, "pending");
});

test("AI review fields and a passed quality gate do not become an author review", () => {
  const source = videoData();
  source.quality = { status: "passed" };
  source.shots[0].review = { frame: { confirmed: true, note: "AI校验通过" }, rhythm: { confirmed: true, note: "通过" } };
  const result = convert(source);
  assert.equal("review" in result.draft.video.shots[0], false);
  assert.equal(studyQuality(result.draft.video).find(({ id }) => id === "frame").status, "pending");
  assert.ok(result.warnings.some((warning) => warning.includes("shots[0].review")));
});

test("unknown enum values are left blank with paths and original values in warnings", () => {
  const source = videoData();
  Object.assign(source.shots[0], { size: "unknown-size", camera: "floating", category: "unknown-category", rhythm: "unknown-rhythm", transitionIn: "unknown-transition" });
  const result = convert(source);
  const shot = result.draft.video.shots[0];
  assert.deepEqual(shot.facts, {});
  for (const key of ["category", "rhythm", "transition"]) assert.equal(key in shot, false);
  for (const key of ["size", "camera", "category", "rhythm", "transitionIn"]) assert.ok(result.warnings.some((warning) => warning.includes(`shots[0].${key}`) && warning.includes(source.shots[0][key])));
});

test("cast and shot identifiers stay distinct after lowercase normalization and keep references", () => {
  const source = videoData();
  source.cast.push({ id: "p1", name: "乙" });
  source.shots[0].subjects = ["P1", "p1", "P1"];
  source.shots.push({ id: "s01", start: 6, end: 8, subjects: ["p1"] });
  const result = convert(source);
  const castIds = result.draft.video.cast.map(({ id }) => id);
  assert.equal(new Set(castIds).size, 2);
  assert.deepEqual(result.draft.video.shots[0].subjects, castIds);
  assert.deepEqual(result.draft.video.shots[1].subjects, [castIds[1]]);
  assert.equal(new Set(result.draft.video.shots.map(({ id }) => id)).size, 2);
  const reordered = structuredClone(source);
  reordered.cast.reverse();
  assert.deepEqual(convert(reordered).sourceIds.cast, result.sourceIds.cast);
  source.shots[0].subjects = ["P404"];
  assert.throws(() => convert(source), /shots\[0\]\.subjects\[0\].*不存在/);
  source.shots[0].subjects = [];
  source.cast.push({ id: "P1", name: "重复" });
  assert.throws(() => convert(source), /cast\[2\]\.id.*重复/);
});

test("measured timing keeps unanalysed gaps, rejects overlaps, invalid numbers and out of bounds", () => {
  const source = videoData();
  source.shots.push({ id: "S02", start: 6, end: 8 });
  assert.deepEqual(convert(source).draft.video.shots.map(({ start, end }) => [start, end]), [[0, 4], [6, 8]]);
  for (const [field, value, error] of [["start", "6", /shots\[1\]\.start/], ["start", 3, /shots\[1\]\.start.*重叠/], ["end", 6, /shots\[1\]\.end/], ["end", 11, /shots\[1\]\.end.*超出/], ["start", NaN, /shots\[1\]\.start/]]) {
    const broken = structuredClone(source);
    broken.shots[1][field] = value;
    assert.throws(() => convert(broken), error);
  }
  source.shots[0].seconds = 3;
  assert.throws(() => convert(source), /shots\[0\]\.seconds.*不一致/);
});

test("incomplete drafts do not infer duration, audio, people or first and last frames", () => {
  const result = convert({ shots: [{ frame: "只记录了画面描述" }] }, []);
  assert.equal(result.draft.video.durationSeconds, 0);
  assert.equal(result.draft.video.src, "");
  const shot = result.draft.video.shots[0];
  assert.deepEqual([shot.start, shot.end, shot.image], [0, 0, ""]);
  for (const key of ["subjects", "dialogue", "sound", "review", "endImage"]) assert.equal(key in shot, false);
  assert.equal("metadata" in result.draft.video, false);
  assert.equal("cast" in result.draft.video, false);
  assert.ok(result.warnings.some((warning) => warning.includes("真实视频时长")));
  assert.ok(result.warnings.some((warning) => warning.includes("缺少起止时间")));
});

test("limits reject excess shots and cast without silent truncation", () => {
  assert.throws(() => convert({ shots: Array.from({ length: 101 }, () => ({})) }, []), /shots.*100/);
  assert.throws(() => convert({ cast: Array.from({ length: 51 }, () => ({})) }, []), /cast.*50/);
  assert.throws(() => convert({ shots: [null] }, []), /shots\[0\]/);
  assert.throws(() => convert({ meta: { durationSeconds: "10" } }, []), /meta\.durationSeconds/);
});

test("a single missing boundary must be completed instead of creating an invented interval", () => {
  for (const [start, end, missing] of [[undefined, 4, "start"], [6, undefined, "end"], [null, 4, "start"], [0, null, "end"]]) {
    const source = videoData();
    Object.assign(source.shots[0], { start, end });
    assert.throws(() => convert(source), new RegExp(`shots\\[0\\]\\.${missing}.*起止时间需要同时提供`));
  }
});

test("shots without either boundary remain unmeasured and cannot pass publication validation", () => {
  const source = videoData();
  source.analysis = "已录入的整体分析";
  delete source.shots[0].start;
  delete source.shots[0].end;
  delete source.shots[0].seconds;
  const result = convert(source);
  assert.deepEqual([result.draft.video.shots[0].start, result.draft.video.shots[0].end], [0, 0]);
  assert.equal(shotStatistics(result.draft.video).measured, 0);
  assert.equal(shotStatistics(result.draft.video).covered, 0);
  assert.ok(result.warnings.some((warning) => warning.includes("shots[0]") && warning.includes("缺少起止时间")));
  assert.throws(() => normalizeContentEntry(result.draft), /镜头 1.*时间/);
});

test("non-Latin source identifiers remain stable when cast order changes", () => {
  const source = { cast: [{ id: "人物甲", name: "甲" }, { id: "人物乙", name: "乙" }], shots: [{ id: "镜头甲", subjects: ["人物甲"] }] };
  const result = convert(source, []);
  const reversed = structuredClone(source);
  reversed.cast.reverse();
  assert.deepEqual(convert(reversed, []).sourceIds, result.sourceIds);
  assert.equal(result.draft.video.shots[0].subjects[0], result.sourceIds.cast.人物甲);
});

test("image submissions use confirmed media and retain explicit author input", () => {
  const data = { kind: "image", image: "C:\\images\\cover.jpg", title: "图片", description: "已录入介绍", analysis: "已录入分析", prompt: "已录入提示词" };
  const result = convert(data, [{ localName: "cover.jpg", kind: "image", url: "/media/cover.jpg" }]);
  assert.equal(result.draft.kind, "分镜");
  assert.equal(result.draft.image, "/media/cover.jpg");
  assert.equal(result.draft.prompt, data.prompt);
  assert.equal(result.draft.analysis, data.analysis);
  assert.equal("video" in result.draft, false);
  assert.equal(convert(data, []).draft.image, "");
  assert.ok(convert(data, []).warnings.some((warning) => warning.includes("cover.jpg")));
});

test("ambiguous basename matching cannot attach the wrong uploaded frame", () => {
  const files = media().filter(({ localName }) => localName !== "frames/S01a.jpg");
  files.push({ localName: "one/S01a.jpg", kind: "image", url: "/media/one.jpg" }, { localName: "two/S01a.jpg", kind: "image", url: "/media/two.jpg" });
  const result = convert(videoData(), files);
  assert.equal(result.draft.video.shots[0].image, "");
  assert.ok(result.warnings.some((warning) => warning.includes("shots[0].image") && warning.includes("多个素材")));
  const source = videoData();
  source.shots[0].image = "two\\S01a.jpg";
  assert.equal(convert(source, files).draft.video.shots[0].image, "/media/two.jpg");
  assert.throws(() => convert(source, [{ localName: "original.mp4", kind: "video", url: "https://outside.test/video.mp4" }]), /media\[0\]\.url/);
});
