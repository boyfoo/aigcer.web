import assert from "node:assert/strict";
import test from "node:test";
import { getCases, casePath, shotPath, draftPath } from "../src/lib/content.js";
import { decodeContentEntries, encodeContentEntries, isMediaUrl, mergeContentEntries, normalizeContentEntry, normalizeDraft, presentCase } from "../src/lib/contentEntries.js";
import { createDefaultTagGroups, matchesTagFilters } from "../src/tagSettings.js";
import { getShotAnnotation } from "../src/lib/shotPresentation.js";

const entry = () => ({ ...structuredClone(getCases()[2]), id: "local-test", title: "  新录入案例  " });

test("saved entries round trip and replace originals without losing video reference content", () => {
  const originals = getCases();
  const edited = structuredClone(originals[0]);
  edited.title = "新的标题";
  const entries = decodeContentEntries(encodeContentEntries([entry(), edited]));
  const merged = mergeContentEntries(originals, entries);
  assert.equal(merged.length, originals.length + 1);
  assert.equal(merged[0].title, "新录入案例");
  assert.deepEqual(merged.find(({ id }) => id === edited.id).video, originals[0].video);
  assert.equal(originals[0].title, "雨夜老电影院");
  assert.equal(mergeContentEntries(originals, entries.filter(({ id }) => id !== edited.id))[1], originals[0]);
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
  for (const source of ["javascript:alert(1)", "blob:https://example.com/x", "file:///C:/video.mp4", "//elsewhere.com/x", "/\\elsewhere.com/x", "https://user:password@example.com/x", "data:image/svg+xml,<svg></svg>"]) assert.equal(isMediaUrl(source, true), false, source);
  for (const source of ["https://example.com/video.mp4", "/images/night-lounge.png"]) assert.equal(isMediaUrl(source, true), true, source);
  assert.equal(isMediaUrl("data:image/png;base64,aGVsbG8=", true), false);
  assert.equal(isMediaUrl("data:image/png;base64,aGVsbG8=", true, true), true);
  assert.throws(() => normalizeContentEntry({ ...entry(), image: "blob:expired" }), /封面/);
});

test("invalid storage cannot silently replace existing entries with an empty list", () => {
  assert.deepEqual(decodeContentEntries(null), []);
  for (const raw of ["broken", '{"version":2,"entries":[]}', JSON.stringify({ version: 1, entries: [entry(), entry()] })]) assert.throws(() => decodeContentEntries(raw));
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
