import assert from "node:assert/strict";
import test from "node:test";
import { createCreationReferences, filterCreationReferences, getReferenceTagValues } from "../src/lib/creationReferences.js";
import { presentCase } from "../src/lib/contentEntries.js";
import { mockVideo } from "../src/mockVideo.js";

const group = (id, values) => ({ id, label: id, options: values.map((value, index) => ({ id: `${id}-${index}`, label: value, value })) });
const groups = [group("viewpoint", ["第一人称", "第三人称"]), group("props", ["剑", "刀"]), group("action", ["重击", "闪避"]), group("shot-size", ["特写"]), group("movement", ["推镜头", "固定镜头"])];
const shot = (id, tags, extra = {}) => ({ id, title: id, start: 0, end: 3, image: "", summary: "", facts: {}, analysis: [], tagValues: tags, ...extra });
const item = (shots, extra = {}) => ({ id: "sword-fight", kind: "视频", title: "山林交锋", image: "/cover.png", tags: ["剑"], tagValues: { viewpoint: ["第一人称"], props: ["剑"] }, video: { src: "/movie.mp4", durationSeconds: 10, shots }, ...extra });

test("references keep authored shot identity, timing and links; missing frames use a labelled case cover", () => {
  const source = item([shot("opening", { props: ["刀"] }), shot("strike", { props: ["剑"] }, { start: 3, end: 5.25, image: "/strike.png" })]);
  const references = createCreationReferences([source]);
  assert.equal(references.length, 2);
  assert.equal(references[0].caseId, source.id);
  assert.equal(references[0].shot, source.video.shots[0]);
  assert.equal(references[0].image, "/cover.png");
  assert.equal(references[0].imageFallback, true);
  assert.equal(references[1].index, 1);
  assert.equal(references[1].duration, 2.25);
  assert.equal(references[1].imageFallback, false);
  assert.equal(references[1].href, "/cases/sword-fight?shot=strike");
  assert.equal(references[0].shot.endImage, undefined);
  assert.equal(source.video.shots[0].image, "");
  assert.equal(createCreationReferences([presentCase(source)])[0].imageFallback, true);
});

test("multiple groups must match one shot and a selected group's options match with OR", () => {
  const references = createCreationReferences([item([
    shot("pov-dodge", { viewpoint: ["第一人称"], action: ["闪避"], props: ["刀"] }),
    shot("sword-strike", { viewpoint: ["第三人称"], action: ["重击"], props: ["剑"] }),
  ])]);
  assert.equal(filterCreationReferences(references, { groups, filters: { viewpoint: ["viewpoint-0"], props: ["props-0"] } }).length, 0);
  assert.deepEqual(filterCreationReferences(references, { groups, filters: { viewpoint: ["viewpoint-0", "viewpoint-1"], action: ["action-0"] } }).map(({ shotId }) => shotId), ["sword-strike"]);
  assert.equal(filterCreationReferences(references, { groups, filters: { props: ["props-0", "props-1"] } }).length, 2);
});

test("shot filters only use explicit shot tags and exact authored facts, without case inheritance or guessed synonyms", () => {
  const references = createCreationReferences([item([shot("detail", { props: ["刀"] }, { facts: { 景别: "特写", 运镜: "缓慢推进", 光影: "逆光", 构图: "框中框" }, category: "主观" })])]);
  assert.deepEqual(getReferenceTagValues(references[0], "props"), ["刀"]);
  assert.deepEqual(getReferenceTagValues(references[0], "viewpoint"), []);
  assert.deepEqual(getReferenceTagValues(references[0], "shot-purpose"), []);
  assert.deepEqual(getReferenceTagValues(references[0], "shot-size"), ["特写"]);
  assert.deepEqual(getReferenceTagValues(references[0], "composition"), ["框中框"]);
  assert.deepEqual(getReferenceTagValues(references[0], "lighting"), ["逆光"]);
  assert.equal(filterCreationReferences(references, { groups, filters: { "shot-size": ["shot-size-0"] } }).length, 1);
  assert.equal(filterCreationReferences(references, { groups, filters: { movement: ["movement-0"] } }).length, 0);
});

test("shot facts are the sole source for their four filter groups, including after a fact is changed or cleared", () => {
  const references = createCreationReferences([item([shot("detail", { "shot-size": ["特写"], movement: ["推镜头"] }, { facts: { 景别: "中景", 运镜: "" } })])]);
  assert.deepEqual(getReferenceTagValues(references[0], "shot-size"), ["中景"]);
  assert.deepEqual(getReferenceTagValues(references[0], "movement"), []);
  assert.equal(filterCreationReferences(references, { groups, filters: { "shot-size": ["shot-size-0"] } }).length, 0);
});

test("word searches combine with AND on the same shot, including its authored material and the source title", () => {
  const references = createCreationReferences([item([
    shot("strike", { props: ["剑"] }, { title: "挡开攻势", summary: "人物转身", facts: { 构图: "对角线" }, analysis: [{ label: "表演", text: "蓄力后重击" }], imagePrompt: "银色铠甲", videoPrompt: "碎石飞散", narrative: "改变局势", sound: "金属碰撞", dialogue: "让开", onscreenText: "决战" }),
    shot("dodge", { props: ["刀"] }, { summary: "急速闪避" }),
  ], { description: "海底变身", prompt: "瞬间巨大化" })]);
  for (const query of ["山林 剑 重击", "对角线 银色 碎石", "局势 金属 让开 决战"]) assert.deepEqual(filterCreationReferences(references, { query }).map(({ shotId }) => shotId), ["strike"]);
  assert.equal(filterCreationReferences(references, { query: "重击 闪避" }).length, 0);
  assert.equal(filterCreationReferences(references, { query: "海底" }).length, 0);
  assert.equal(filterCreationReferences(references, { query: "巨大化" }).length, 0);
  assert.equal(filterCreationReferences(references, { groups, filters: { props: ["props-1"] }, query: "重击" }).length, 0);
});

test("static frames and undissected videos stay available without inventing shots or endpoints", () => {
  const source = { id: "single-frame", kind: "分镜", title: "剑客剪影", description: "山顶", image: "/frame.png", duration: "00:08", movement: "固定镜头", tagValues: { props: ["剑"] }, analysis: "逆光", prompt: "黄昏" };
  const references = createCreationReferences([source, item([])]);
  assert.equal(references[0].kind, "frame");
  assert.equal(references[0].duration, 8);
  assert.equal(references[0].href, "/cases/single-frame");
  assert.equal(references[0].imageFallback, false);
  assert.deepEqual(getReferenceTagValues(references[0], "movement"), ["固定镜头"]);
  assert.equal(filterCreationReferences(references, { query: "逆光 黄昏" }).length, 1);
  assert.equal(references[1].kind, "video");
  assert.equal(references[1].shotId, null);
  assert.equal(references[1].shot, null);
  assert.equal(references[1].duration, 10);
  assert.match(references[1].description, /尚未录入镜头拆解/);
  assert.equal(references[1].href, "/cases/sword-fight");
});

test("sample footage references are marked as authored examples", () => {
  const references = createCreationReferences([item([], { video: mockVideo })]);
  assert.equal(references.length, mockVideo.shots.length);
  assert.ok(references.every((reference) => reference.isMock && reference.kind === "shot"));
});
