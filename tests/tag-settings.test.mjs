import assert from "node:assert/strict";
import test from "node:test";
import { storyboardItems } from "../src/data.js";
import {
  createDefaultTagGroups,
  createInitialTagFilters,
  loadTagGroups,
  matchesTagFilters,
  moveTagEntry,
  normalizeTagGroups,
  reconcileTagFilters,
  saveTagGroups,
  TAG_SETTINGS_KEY,
  validateTagGroups,
} from "../src/tagSettings.js";

test("renaming and sorting preserve case associations and active filters", () => {
  const groups = createDefaultTagGroups();
  const type = groups.find((group) => group.id === "type");
  const tag = type.options.find((option) => option.value === "短片");
  const filters = { type: tag.id };
  const before = storyboardItems.filter((item) => matchesTagFilters(item, groups, filters));
  assert.equal(before.length, 1);
  type.label = "影片类型";
  tag.label = "叙事短片";
  type.options = moveTagEntry(type.options, tag.id, -1);
  const renamed = normalizeTagGroups(moveTagEntry(groups, "type", 1));
  assert.deepEqual(storyboardItems.filter((item) => matchesTagFilters(item, renamed, filters)), before);
  assert.equal(reconcileTagFilters(renamed, filters).type, tag.id);
});

test("deleting active children and groups releases their filters", () => {
  const groups = createDefaultTagGroups();
  const filters = createInitialTagFilters(groups);
  const emotion = groups.find((group) => group.id === "emotion");
  emotion.options = emotion.options.filter((option) => option.id !== filters.emotion);
  const reduced = groups.filter((group) => group.id !== "lighting");
  const next = reconcileTagFilters(reduced, filters);
  assert.equal(next.emotion, "");
  assert.equal("lighting" in next, false);
  assert.equal(matchesTagFilters(storyboardItems[0], reduced, next), true);
  assert.deepEqual(reconcileTagFilters([], filters), {});
  assert.equal(matchesTagFilters(storyboardItems[0], [], filters), true);
});

test("new custom groups can filter existing mock case tags", () => {
  const groups = normalizeTagGroups([{ id: "custom", label: " 场景 ", options: [
    { id: "indoor", label: " 室内 ", value: null },
  ] }]);
  assert.equal(groups[0].label, "场景");
  assert.equal(groups[0].options[0].value, "室内");
  assert.equal(matchesTagFilters(storyboardItems[0], groups, { custom: "indoor" }), true);
  assert.equal(matchesTagFilters(storyboardItems[1], groups, { custom: "indoor" }), false);
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

test("local save restores edits, handles empty settings and falls back on corrupt data", () => {
  const originalWindow = globalThis.window;
  const values = new Map();
  globalThis.window = { localStorage: {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  } };
  try {
    assert.deepEqual(loadTagGroups(), createDefaultTagGroups());
    const edited = createDefaultTagGroups();
    edited[0].label = "影片类型";
    assert.deepEqual(loadTagGroups(), createDefaultTagGroups());
    const saved = saveTagGroups(edited);
    assert.deepEqual(loadTagGroups(), saved);
    saveTagGroups([]);
    assert.deepEqual(loadTagGroups(), []);
    values.set(TAG_SETTINGS_KEY, "invalid json");
    assert.deepEqual(loadTagGroups(), createDefaultTagGroups());
    values.set(TAG_SETTINGS_KEY, JSON.stringify({ version: 1, groups: [{}] }));
    assert.deepEqual(loadTagGroups(), createDefaultTagGroups());
    globalThis.window.localStorage.setItem = () => { throw new Error("Storage unavailable"); };
    assert.throws(() => saveTagGroups(edited), /Storage unavailable/);
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});
