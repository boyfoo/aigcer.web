import assert from "node:assert/strict";
import test from "node:test";
import { groupCreationFilters } from "../src/lib/creationNavigation.js";
import { creationTagGroups } from "../src/lib/creationTags.js";

test("the six creation entries cover all 21 existing groups exactly once", () => {
  const entries = groupCreationFilters(creationTagGroups);
  assert.deepEqual(entries.map(({ id, label }) => [id, label]), [
    ["content", "内容与环境"],
    ["action", "动作与变化"],
    ["camera", "视角与拍摄"],
    ["image", "构图与光影"],
    ["direction", "导演与剪辑"],
    ["expression", "表达与类型"],
  ]);
  const groupedIds = entries.flatMap(({ groups }) => groups.map(({ id }) => id));
  assert.equal(groupedIds.length, 21);
  assert.equal(new Set(groupedIds).size, 21);
  assert.deepEqual([...groupedIds].sort(), creationTagGroups.map(({ id }) => id).sort());
  assert.deepEqual(entries.map(({ groups }) => groups.map(({ id }) => id)), [
    ["subject", "props", "environment"],
    ["action", "transformation", "effects"],
    ["viewpoint", "shot-size", "angle", "movement"],
    ["composition", "focus", "lighting"],
    ["shot-purpose", "blocking", "editing", "time", "rhythm"],
    ["intent", "type", "emotion"],
  ]);
});

test("unknown custom groups stay in other categories without inferring meaning from their labels", () => {
  const customCamera = { id: "custom-camera", label: "视角与拍摄", options: [] };
  const customAction = { id: "custom-action", label: "重击与变身", options: [{ id: "custom-hit", label: "重击", value: "重击" }] };
  const movement = { ...creationTagGroups.find(({ id }) => id === "movement"), label: "环境" };
  const entries = groupCreationFilters([customCamera, movement, customAction]);
  assert.deepEqual(entries.map(({ id }) => id), ["camera", "other"]);
  assert.deepEqual(entries[0].groups, [movement]);
  assert.equal(entries[1].label, "其他分类");
  assert.deepEqual(entries[1].groups, [customCamera, customAction]);
  assert.equal(entries[1].groups[1], customAction);
});

test("removed groups and empty entries are not recreated from defaults", () => {
  const props = creationTagGroups.find(({ id }) => id === "props");
  const time = creationTagGroups.find(({ id }) => id === "time");
  assert.deepEqual(groupCreationFilters([props, time]), [
    { id: "content", label: "内容与环境", groups: [props] },
    { id: "direction", label: "导演与剪辑", groups: [time] },
  ]);
  assert.deepEqual(groupCreationFilters([]), []);
});

test("each entry preserves the current settings order and original group data", () => {
  const groups = structuredClone(creationTagGroups).reverse();
  const before = structuredClone(groups);
  const entries = groupCreationFilters(groups);
  assert.deepEqual(entries.find(({ id }) => id === "camera").groups.map(({ id }) => id), ["movement", "angle", "shot-size", "viewpoint"]);
  assert.deepEqual(entries.find(({ id }) => id === "expression").groups.map(({ id }) => id), ["emotion", "type", "intent"]);
  for (const entry of entries) {
    for (const group of entry.groups) assert.equal(group, groups.find(({ id }) => id === group.id));
  }
  assert.deepEqual(groups, before);
});
