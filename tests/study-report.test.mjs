import test from "node:test";
import assert from "node:assert/strict";
import { Script } from "node:vm";
import { normalizeContentEntry, normalizeDraft } from "../src/lib/contentEntries.js";
import { castIndex, createStudyReport, shotDistributions, shotStatistics, studyQuality, videoMetadataText } from "../src/lib/studyReport.js";
import { filterStudyShots } from "../src/lib/shotOverview.js";
import { createOfflineReportHtml } from "../src/lib/offlineStudy.js";

const shot = (id, start, end, changes = {}) => ({ id, start, end, title: `镜头 ${id}`, image: `/media/${id}.png`, endImage: `/media/${id}-b.png`, summary: `画面 ${id}`, facts: { 景别: "近景", 运镜: "固定" }, category: "主体", rhythm: "铺垫", transition: "硬切", subjects: [], narrative: `叙事 ${id}`, analysis: [], ...changes });
const video = () => ({ src: "/media/video.mp4", durationSeconds: 20, metadata: { width: 1920, height: 1080, fps: 29.97, hasAudio: false }, cast: [{ id: "person-a", name: "林", note: "主角", image: "/media/person.png" }], shots: [shot("a", 0, 2, { subjects: ["person-a"] }), shot("b", 2, 8, { category: "反应" }), shot("c", 10, 20, { subjects: ["person-a"], rhythm: "收口" })] });
const item = () => ({ id: "report-case", kind: "视频", title: "报告案例", image: "/media/cover.png", analysis: "案例分析", video: video() });

test("statistics retain gaps, use adjacent boundaries for cut rate, and calculate unequal shot lengths", () => {
  const stats = shotStatistics(video());
  assert.equal(stats.average, 6); assert.equal(stats.median, 6);
  assert.equal(stats.coverage, 90); assert.equal(stats.covered, 18);
  assert.equal(stats.cuts, 1); assert.equal(stats.cutsPerMinute, 3);
  assert.equal(stats.longest.index, 2); assert.equal(stats.shortest.index, 0);
  assert.equal(shotStatistics({ ...video(), shots: video().shots.slice(0, 2) }).median, 4);
  assert.equal(shotStatistics({}).average, null);
  assert.equal(shotStatistics({ durationSeconds: 0, shots: [shot("x", 0, 0)] }).measured, 0);
});

test("distribution is weighted by elapsed time, including unlabelled and uncovered footage", () => {
  const source = video(); source.shots[1].category = "";
  const group = shotDistributions(source).find((g) => g.title === "镜头类别");
  assert.deepEqual(group.rows.map((r) => [r.label, r.count, r.percent]), [["主体", 2, 60], ["未填写", 1, 30], ["未拆解时段", 0, 10]]);
  assert.equal(group.rows.reduce((sum, row) => sum + row.percent, 0), 100);
});

test("cast links preserve original indices and combine with search and category/rhythm filters", () => {
  const v = video();
  assert.deepEqual(castIndex(v)[0].shots, ["a", "c"]); assert.equal(castIndex(v)[0].seconds, 12);
  assert.deepEqual(filterStudyShots(v.shots, { person: "person-a", people: v.cast, query: "林", category: "主体", rhythm: "收口" }).map((r) => r.index), [2]);
  assert.deepEqual(filterStudyShots(v.shots, { category: "反应", person: "person-a" }), []);
});

test("new fields persist through normalization while old entries remain optional", () => {
  const source = item(); source.video.shots[0].review = { boundary: { confirmed: true, note: "逐帧确认 2 秒处切换" } };
  const result = normalizeContentEntry(source);
  assert.deepEqual(result.video.metadata, source.video.metadata);
  assert.deepEqual(result.video.cast, source.video.cast);
  assert.deepEqual(result.video.shots[0].subjects, ["person-a"]);
  assert.deepEqual(result.video.shots[0].review, source.video.shots[0].review);
  const old = item(); delete old.video.metadata; delete old.video.cast; old.video.shots.forEach((s) => { delete s.subjects; delete s.category; delete s.rhythm; delete s.transition; });
  const restored = normalizeContentEntry(old);
  assert.equal("cast" in restored.video, false); assert.equal("metadata" in restored.video, false); assert.equal("subjects" in restored.video.shots[0], false);
});

test("invalid metadata, dangling subjects, duplicate cast and unsafe images cannot be persisted", () => {
  for (const mutate of [(i) => { i.video.metadata.fps = -1; }, (i) => { i.video.metadata.hasAudio = "yes"; }, (i) => { i.video.cast.push(i.video.cast[0]); }, (i) => { i.video.cast[0].image = "javascript:alert(1)"; }, (i) => { i.video.shots[0].subjects = ["missing"]; }, (i) => { i.video.shots[0].category = "unknown"; }, (i) => { i.video.shots[0].review = JSON.parse('{"__proto__":{"confirmed":true,"note":"x"}}'); }]) { const source = item(); mutate(source); assert.throws(() => normalizeDraft(source)); }
  const source = item(); source.video.shots[0].review = { frame: { confirmed: true, note: "" } }; assert.doesNotThrow(() => normalizeDraft(source)); assert.throws(() => normalizeContentEntry(source), /复核/);
});

test("quality reports do not pass visual checks without evidence or empty data", () => {
  const checks = studyQuality(video()); assert.equal(checks.length, 15);
  assert.equal(checks.find((c) => c.id === "timeline").status, "warning");
  assert.equal(checks.find((c) => c.id === "duration").status, "passed");
  for (const id of ["frame", "category-evidence", "motion", "boundary", "rhythm"]) assert.equal(checks.find((c) => c.id === id).status, "pending");
  assert.ok(studyQuality({}).every((c) => c.status === "pending"));
  const v = video(); v.shots.forEach((s) => { s.review = { frame: { confirmed: true, note: "已对照视频" } }; });
  assert.equal(studyQuality(v).find((c) => c.id === "frame").status, "passed");
  assert.equal(studyQuality({ ...v, isMock: true }).find((c) => c.id === "frame").status, "pending");
  v.shots[0].imageIsFallback = true;
  assert.equal(studyQuality(v).find((c) => c.id === "frames").status, "pending");
});

test("offline report is standalone, escapes authored HTML and preserves recoverable data", () => {
  const source = item(); source.title = '</script><img src=x onerror="alert(1)">'; source.video.shots[0].dialogue = "你好";
  const html = createOfflineReportHtml(source, { [source.image]: "data:image/png;base64,aGVsbG8=" });
  assert.ok(html.includes("&lt;/script&gt;")); assert.ok(!html.includes(source.title));
  assert.ok(html.includes("data:image/png;base64,aGVsbG8=")); assert.doesNotMatch(html, /<script[^>]+src=/);
  const scripts = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)];
  assert.equal(scripts.length, 2); const payload = JSON.parse(scripts[0][2]);
  assert.equal(payload.case.title, source.title); assert.equal(payload.case.video.shots[0].dialogue, "你好");
  assert.equal(payload.quality.length, 15); assert.doesNotThrow(() => new Script(scripts[1][2]));
  assert.ok(html.includes('id="local-video"')); assert.ok(html.includes('id="person"'));
  assert.equal(createStudyReport(source).format, "jingjie-study-report");
});

test("video metadata keeps unknown distinct from silent video", () => {
  assert.match(videoMetadataText(video().metadata), /1920 × 1080 · 16:9 · 29.97 fps · 无声/);
  assert.match(videoMetadataText({}), /帧率未记录.*音轨未确认/);
});
