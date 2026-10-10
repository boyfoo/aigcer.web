import assert from "node:assert/strict";
import test from "node:test";
import { storyboardItems } from "../src/data.js";
import { createCreationReferences, filterCreationReferences } from "../src/lib/creationReferences.js";
import {
  createDefaultTagGroups,
  createInitialTagFilters,
  moveTagEntry,
  normalizeTagGroups,
  reconcileTagFilters,
  validateTagGroups,
} from "../src/tagSettings.js";

test("default creation tags support a combined reference query", () => {
  const groups = createDefaultTagGroups();
  assert.equal(validateTagGroups(groups), "");
  const item = {
    id: "sword-reference",
    title: "重击参考",
    kind: "视频",
    video: { durationSeconds: 3, shots: [{ id: "strike", start: 0, end: 3, tagValues: { viewpoint: ["第一视角"], props: ["剑"], action: ["重击"], intent: ["力量感"] } }] },
  };
  const filters = Object.fromEntries(Object.entries(item.video.shots[0].tagValues).map(([id, [value]]) => [
    id,
    [groups.find((group) => group.id === id).options.find((option) => option.value === value).id],
  ]));
  assert.equal(filterCreationReferences(createCreationReferences([item]), { groups, filters }).length, 1);
  item.video.shots[0].tagValues.action = ["格挡"];
  assert.equal(filterCreationReferences(createCreationReferences([item]), { groups, filters }).length, 0);
  item.video.shots[0].tagValues = {};
  assert.equal(filterCreationReferences(createCreationReferences([item]), { groups, filters }).length, 0);
});

test("default tags retain existing option identifiers and provide independent editable copies", () => {
  const groups = createDefaultTagGroups();
  for (const [id, values] of [
    ["type", ["故事片", "广告", "纪录片", "短片", "动画", "实验影像"]],
    ["emotion", ["温暖", "宁静", "怀旧", "孤独", "希望", "紧张", "治愈"]],
    ["lighting", ["自然光", "黄金时刻", "蓝调时刻", "室内暖光", "逆光", "柔光", "硬光"]],
    ["movement", ["固定镜头", "推镜头", "拉镜头", "摇镜头", "跟镜头", "升降镜头", "航拍"]],
  ]) {
    assert.deepEqual(groups.find((group) => group.id === id).options.slice(0, values.length), values.map((value, index) => ({
      id: `${id}-${index}`,
      label: value,
      value,
    })));
  }
  groups[0].label = "已修改";
  groups[0].options[0].label = "已修改";
  assert.equal(createDefaultTagGroups()[0].label, "主体");
  assert.equal(createDefaultTagGroups()[0].options[0].label, "人物");
});

test("renaming and sorting preserve reference associations and active filters", () => {
  const groups = createDefaultTagGroups();
  const type = groups.find((group) => group.id === "type");
  const tag = type.options.find((option) => option.value === "短片");
  const filters = { type: tag.id };
  const references = createCreationReferences(storyboardItems);
  const before = filterCreationReferences(references, { groups, filters });
  assert.equal(before.length, 1);
  type.label = "影片类型";
  tag.label = "叙事短片";
  type.options = moveTagEntry(type.options, tag.id, -1);
  const renamed = normalizeTagGroups(moveTagEntry(groups, "type", 1));
  assert.deepEqual(filterCreationReferences(references, { groups: renamed, filters }), before);
  assert.deepEqual(reconcileTagFilters(renamed, filters).type, [tag.id]);
});

test("deleting active children and groups releases their filters", () => {
  const groups = createDefaultTagGroups();
  const filters = createInitialTagFilters(groups);
  filters.emotion = [groups.find((group) => group.id === "emotion").options[0].id];
  const emotion = groups.find((group) => group.id === "emotion");
  emotion.options = emotion.options.filter((option) => !filters.emotion.includes(option.id));
  const reduced = groups.filter((group) => group.id !== "lighting");
  const next = reconcileTagFilters(reduced, filters);
  assert.deepEqual(next.emotion, []);
  assert.equal("lighting" in next, false);
  const references = createCreationReferences(storyboardItems);
  assert.deepEqual(filterCreationReferences(references, { groups: reduced, filters: next }), references);
  assert.deepEqual(reconcileTagFilters([], filters), {});
  assert.deepEqual(filterCreationReferences(references, { groups: [], filters }), references);
});

test("custom groups filter assigned and existing freeform static-frame tags", () => {
  const groups = normalizeTagGroups([{ id: "custom", label: " 场景 ", options: [
    { id: "outdoor", label: " 室外 ", value: null },
  ] }]);
  assert.equal(groups[0].label, "场景");
  assert.equal(groups[0].options[0].value, "室外");
  const references = createCreationReferences([
    { ...storyboardItems[2], tagValues: { custom: ["室外"] } },
    { ...storyboardItems[3], tagValues: { custom: ["室内"] } },
    { ...storyboardItems[2], id: "freeform-frame", tags: ["室外"], tagValues: {} },
  ]);
  assert.deepEqual(filterCreationReferences(references, { groups, filters: { custom: "outdoor" } }).map(({ caseId }) => caseId), [storyboardItems[2].id, "freeform-frame"]);
});

test("unassigned creation conditions do not adopt a case's freeform tags", () => {
  const groups = createDefaultTagGroups();
  const sword = groups.find((group) => group.id === "props").options.find((option) => option.value === "剑");
  const item = { ...storyboardItems[2], tags: ["剑", "重击"], tagValues: {} };
  assert.equal(filterCreationReferences(createCreationReferences([item]), { groups, filters: { props: [sword.id] } }).length, 0);
  item.tagValues.props = ["剑"];
  assert.equal(filterCreationReferences(createCreationReferences([item]), { groups, filters: { props: [sword.id] } }).length, 1);
});

test("validation prevents empty, duplicate, reserved and malformed labels", () => {
  for (const mutate of [
    (groups) => { groups[0].label = " "; },
    (groups) => { groups[0].label = groups[1].label; },
    (groups) => { groups[0].options[0].label = " "; },
    (groups) => { groups[0].options[0].label = "全部"; },
    (groups) => { groups[0].options[0].label = groups[0].options[1].label; },
    (groups) => { groups[0].options[0].id = groups[0].id; },
    (groups) => { groups[0].options = null; },
  ]) {
    const groups = createDefaultTagGroups();
    mutate(groups);
    assert.ok(validateTagGroups(groups));
    assert.throws(() => normalizeTagGroups(groups));
  }
  assert.equal(validateTagGroups([]), "");
});
