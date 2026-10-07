import assert from "node:assert/strict";
import test from "node:test";
import { createFilterExamples } from "../src/filterExamples.js";
import { normalizeContentEntry, tagValues } from "../src/lib/contentEntries.js";
import { creationTagGroups, CREATION_SHOT_FACT_GROUPS } from "../src/lib/creationTags.js";
import { createCreationReferences, filterCreationReferences, getReferenceTagValues } from "../src/lib/creationReferences.js";

const images = Array.from({ length: 20 }, (_, index) => `/media/filter-test-${index + 1}.png`);
const videoSrc = "/media/filter-test.mp4";
const videoDuration = 32.323;
const examples = createFilterExamples(images, videoSrc, videoDuration);
const groupsById = new Map(creationTagGroups.map((group) => [group.id, group]));
const factGroupIds = Object.keys(CREATION_SHOT_FACT_GROUPS);
const ids = (references) => references.map((reference) => reference.id).sort();
const publishedExamples = () => examples.map((item) => normalizeContentEntry(item, { publish: true }));
const filter = (references, filters) => filterCreationReferences(references, { groups: creationTagGroups, filters });
const option = (groupId, value) => groupsById.get(groupId).options.find((entry) => (entry.value ?? entry.label) === value);

function assertKnownValues(groupId, values, context) {
  const group = groupsById.get(groupId);
  assert.ok(group, `${context}: unknown group ${groupId}`);
  const known = new Set(group.options.map((entry) => entry.value ?? entry.label));
  for (const value of tagValues(values)) {
    assert.ok(known.has(value), `${context}: ${groupId} has unfilterable value ${value}`);
  }
}

test("filter examples publish with the correct media type and valid sample video segments", () => {
  assert.equal(examples.length, 30);
  assert.equal(new Set(examples.map((item) => item.id)).size, examples.length);
  const published = publishedExamples();
  assert.equal(published.filter((item) => item.kind === "分镜").length, 20);
  assert.equal(published.filter((item) => item.kind === "视频").length, 10);

  for (const item of published) {
    assert.match(`${item.title} ${item.description} ${item.analysis}`, /筛选测试|测试样例|测试资料|虚构/, item.id);
    assert.ok(images.includes(item.image), `${item.id}: a supplied image is required`);
    if (item.kind === "分镜") {
      assert.equal(item.video, undefined, `${item.id}: a frame must not have video data`);
      continue;
    }
    assert.equal(item.video.src, videoSrc);
    assert.equal(item.video.durationSeconds, videoDuration);
    assert.equal(item.video.isMock, true, `${item.id}: test classifications must not claim to describe real footage`);
    assert.ok(item.video.shots.length >= 2, `${item.id}: distinct shots are needed to test combined filters`);
    let previousEnd = 0;
    for (const shot of item.video.shots) {
      assert.ok(shot.start >= previousEnd && shot.end > shot.start && shot.end <= videoDuration, `${item.id}/${shot.id}: segment timing`);
      assert.ok(images.includes(shot.image), `${item.id}/${shot.id}: a supplied frame is required`);
      assert.ok(Object.values(shot.review ?? {}).every((review) => !review.confirmed), `${item.id}/${shot.id}: no invented review confirmation`);
      previousEnd = shot.end;
    }
  }
});

test("all saved example classifications use filterable values and shot facts have one source", () => {
  for (const item of examples) {
    for (const [groupId, values] of Object.entries(item.tagValues ?? {})) assertKnownValues(groupId, values, item.id);
    for (const groupId of ["type", "emotion", "lighting", "movement"]) assertKnownValues(groupId, item[groupId], item.id);
    for (const shot of item.video?.shots ?? []) {
      const context = `${item.id}/${shot.id}`;
      for (const [groupId, values] of Object.entries(shot.tagValues ?? {})) {
        assert.ok(!factGroupIds.includes(groupId), `${context}: ${groupId} must only be saved in facts`);
        assertKnownValues(groupId, values, context);
      }
      const factNames = Object.values(CREATION_SHOT_FACT_GROUPS);
      assert.deepEqual(Object.keys(shot.facts).sort(), [...factNames].sort(), `${context}: four authored frame facts`);
      for (const [groupId, factName] of Object.entries(CREATION_SHOT_FACT_GROUPS)) assertKnownValues(groupId, shot.facts[factName], context);
    }
  }
});

for (const kind of ["分镜", "视频"]) {
  test(`${kind} examples independently cover every left-sidebar option and same-group selection uses OR`, () => {
    const references = createCreationReferences(publishedExamples().filter((item) => item.kind === kind));
    assert.ok(references.every((reference) => reference.kind === (kind === "视频" ? "shot" : "frame")));
    for (const group of creationTagGroups) {
      for (const entry of group.options) {
        assert.ok(filter(references, { [group.id]: [entry.id] }).length > 0, `${kind}: ${group.label} / ${entry.label} needs a result`);
      }
      const first = group.options[0].id;
      const last = group.options.at(-1).id;
      const union = new Set([...ids(filter(references, { [group.id]: [first] })), ...ids(filter(references, { [group.id]: [last] }))]);
      assert.deepEqual(ids(filter(references, { [group.id]: [first, last] })), [...union].sort(), `${kind}: ${group.label} OR`);
    }
  });

  test(`${kind} examples support first-person sword strikes and cross-group selection uses AND`, () => {
    const references = createCreationReferences(publishedExamples().filter((item) => item.kind === kind));
    const filters = Object.fromEntries([["viewpoint", "第一视角"], ["props", "剑"], ["action", "重击"]].map(([groupId, value]) => [groupId, [option(groupId, value).id]]));
    assert.ok(filter(references, filters).length > 0, `${kind}: 第一视角 + 剑 + 重击 must match one reference`);

    for (let firstIndex = 0; firstIndex < creationTagGroups.length; firstIndex += 1) {
      const firstGroup = creationTagGroups[firstIndex];
      for (const secondGroup of creationTagGroups.slice(firstIndex + 1)) {
        const firstOption = firstGroup.options[0];
        const secondOption = secondGroup.options[0];
        const firstMatches = new Set(ids(filter(references, { [firstGroup.id]: [firstOption.id] })));
        const intersection = ids(filter(references, { [secondGroup.id]: [secondOption.id] })).filter((id) => firstMatches.has(id));
        assert.deepEqual(ids(filter(references, { [firstGroup.id]: [firstOption.id], [secondGroup.id]: [secondOption.id] })), intersection, `${kind}: ${firstGroup.label} + ${secondGroup.label} AND`);
      }
    }
  });
}

test("video examples include a split-shot negative case and never inherit case classifications", () => {
  const videos = publishedExamples().filter((item) => item.kind === "视频");
  let splitCase;
  for (const item of videos) {
    const references = createCreationReferences([item]);
    for (const firstGroup of creationTagGroups) {
      for (const secondGroup of creationTagGroups.filter((group) => group.id !== firstGroup.id)) {
        const firstOptions = firstGroup.options.filter((entry) => references.some((reference) => getReferenceTagValues(reference, firstGroup.id).includes(entry.value ?? entry.label)));
        const secondOptions = secondGroup.options.filter((entry) => references.some((reference) => getReferenceTagValues(reference, secondGroup.id).includes(entry.value ?? entry.label)));
        for (const firstOption of firstOptions) {
          for (const secondOption of secondOptions) {
            const filters = { [firstGroup.id]: [firstOption.id], [secondGroup.id]: [secondOption.id] };
            if (filter(references, filters).length === 0) {
              splitCase = { references, firstGroup, firstOption, secondGroup, secondOption, filters };
              break;
            }
          }
          if (splitCase) break;
        }
        if (splitCase) break;
      }
      if (splitCase) break;
    }
    if (splitCase) break;
  }
  assert.ok(splitCase, "a video must offer conditions that occur in separate shots but cannot be combined");
  assert.ok(filter(splitCase.references, { [splitCase.firstGroup.id]: [splitCase.firstOption.id] }).length > 0);
  assert.ok(filter(splitCase.references, { [splitCase.secondGroup.id]: [splitCase.secondOption.id] }).length > 0);
  assert.deepEqual(filter(splitCase.references, splitCase.filters), []);

  const baseline = createCreationReferences(videos);
  const withCaseTags = createCreationReferences(videos.map((item) => ({
    ...item,
    tagValues: Object.fromEntries(creationTagGroups.map((group) => [group.id, group.options.map((entry) => entry.value ?? entry.label)])),
  })));
  for (let index = 0; index < baseline.length; index += 1) {
    for (const group of creationTagGroups) {
      assert.deepEqual(getReferenceTagValues(withCaseTags[index], group.id), getReferenceTagValues(baseline[index], group.id), `${baseline[index].id}: ${group.label} must describe the shot`);
    }
  }
});
