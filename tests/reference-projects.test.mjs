import assert from "node:assert/strict";
import test from "node:test";
import { decodeReferenceProjects, encodeReferenceProjects, updateReferenceProjects as update } from "../src/lib/referenceProjects.js";
import { getPromptSegments, groupPromptSegments } from "../src/lib/shotPresentation.js";
import { mockVideo } from "../src/mockVideo.js";

const makeProject = () => update([], { type: "createProject", id: "p1", name: "  雨夜短片  " });
const action = (type, rest = {}) => ({ type, projectId: "p1", ...rest });
const add = (id, groupId = "") => action("addReference", { reference: { id, caseId: "night-cinema", shotId: id, groupId, note: "" } });

test("projects persist names, shot sources, groups and notes without mutating prior snapshots", () => {
  const original = makeProject();
  const projects = [action("addGroup", { id: "g1", name: "开场" }), add("establishing", "g1"), action("editReference", { referenceId: "establishing", note: "参考冷暖光与纵深" })].reduce(update, original);
  assert.equal(original[0].references.length, 0);
  assert.equal(original[0].groups.length, 0);
  assert.equal(projects[0].name, "雨夜短片");
  assert.equal(projects[0].references[0].note, "参考冷暖光与纵深");
  assert.deepEqual(decodeReferenceProjects(encodeReferenceProjects(projects)), projects);
  assert.deepEqual(decodeReferenceProjects(null), []);
});

test("duplicate shots are rejected per project but allowed across projects", () => {
  const projects = update(makeProject(), add("character"));
  assert.throws(() => update(projects, add("character")), /已经/);
  const another = update(projects, { type: "createProject", id: "p2", name: "人物篇" });
  const next = update(another, { ...add("character"), projectId: "p2" });
  assert.equal(next[1].references.length, 1);
  assert.throws(() => update(next, action("renameProject", { name: "人物篇" })), /同名/);
  assert.throws(() => update(next, add("detail", "missing")), /不存在/);
});

test("ordering stays within its group, drag placement can move a shot between groups", () => {
  const projects = [action("addGroup", { id: "g1", name: "光影" }), add("a"), add("b", "g1"), add("c")].reduce(update, makeProject());
  const reordered = update(projects, action("moveReference", { referenceId: "c", direction: -1 }));
  assert.deepEqual(reordered[0].references.map(({ id }) => id), ["c", "b", "a"]);
  assert.equal(update(reordered, action("moveReference", { referenceId: "c", direction: -1 })), reordered);
  const dragged = update(reordered, action("placeReference", { referenceId: "a", beforeId: "b" }));
  assert.deepEqual(dragged[0].references.filter(({ groupId }) => groupId === "g1").map(({ id }) => id), ["a", "b"]);
  assert.deepEqual(projects[0].references.map(({ id }) => id), ["a", "b", "c"]);
});

test("removing a group preserves its shots and notes; deletion affects only the chosen project", () => {
  const projects = [action("addGroup", { id: "g1", name: "开场" }), add("a", "g1"), action("editReference", { referenceId: "a", note: "需要保留" }), { type: "createProject", id: "p2", name: "另一项目" }].reduce(update, makeProject());
  const ungrouped = update(projects, action("removeGroup", { groupId: "g1" }));
  assert.equal(ungrouped[0].references[0].groupId, "");
  assert.equal(ungrouped[0].references[0].note, "需要保留");
  assert.equal(update(ungrouped, action("removeReference", { referenceId: "a" }))[0].references.length, 0);
  assert.deepEqual(update(ungrouped, action("removeProject")), [projects[1]]);
});

test("invalid persisted data and oversized edits are rejected without changing the last valid snapshot", () => {
  const projects = update(makeProject(), add("a"));
  const before = encodeReferenceProjects(projects);
  assert.throws(() => update(projects, action("editReference", { referenceId: "a", note: "x".repeat(2001) })), /2000/);
  assert.equal(encodeReferenceProjects(projects), before);
  for (const raw of ["{", '{"version":2,"projects":[]}', '{"version":1,"projects":[null]}', before.replace('"groupId":""', '"groupId":"missing"')]) assert.throws(() => decodeReferenceProjects(raw));
  assert.throws(() => encodeReferenceProjects([...projects, projects[0]]));
});

test("structured prompt segments preserve every original character and group copies only include their category", () => {
  for (const shot of mockVideo.shots) for (const kind of ["image", "video"]) {
    const segments = getPromptSegments(shot, kind);
    assert.equal(segments.map(({ text }) => text).join(""), kind === "image" ? shot.imagePrompt : shot.videoPrompt);
    assert.ok(segments.every(({ category }) => category !== "描述"));
    for (const group of groupPromptSegments(segments)) assert.equal(group.text, segments.filter(({ category }) => category === group.category).map(({ text }) => text).join(""));
  }
});
