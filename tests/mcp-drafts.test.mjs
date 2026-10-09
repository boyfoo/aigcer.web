import assert from "node:assert/strict";
import test from "node:test";
import { createInitialDocument, createRepository } from "../src/server/repository.js";
import { ContentError } from "../src/server/errors.js";
import { createDraftService } from "../src/server/mcpDrafts.js";

class MemoryDataProvider {
  constructor() {
    this.document = createInitialDocument([]);
    this.pending = Promise.resolve();
    this.canonicalized = [];
    this.mediaUrls = new Map();
    this.objects = new Map();
    this.inspections = [];
  }

  async read() {
    await this.pending;
    return structuredClone(this.document);
  }

  update(work) {
    const result = this.pending.then(async () => {
      const document = structuredClone(this.document);
      const value = await work(document);
      this.document = document;
      return structuredClone(value);
    });
    this.pending = result.catch(() => {});
    return result;
  }

  async canonicalizeMediaUrls(value) {
    this.canonicalized.push(structuredClone(value));
    const replace = (input) => {
      if (typeof input === "string") return this.mediaUrls.get(input) ?? input;
      if (Array.isArray(input)) return input.map(replace);
      if (input && typeof input === "object") return Object.fromEntries(Object.entries(input).map(([key, item]) => [key, replace(item)]));
      return input;
    };
    return replace(value);
  }

  registerMedia(name, { kind = "image", uploaded = true } = {}) {
    const media = {
      name, mime: kind === "video" ? "video/mp4" : "image/png", size: 32,
      storage: { provider: "oss", bucket: "unit-bucket", key: `jingjie/media/${name}` },
    };
    this.document.media.push(media);
    if (uploaded) this.objects.set(media.storage.key, { size: media.size, mime: media.mime, etag: "unit-etag" });
    return `https://cdn.example/jingjie/media/${name}`;
  }

  async getMediaReference(name) {
    return `https://cdn.example/jingjie/media/${name}`;
  }

  async resolveMediaReference(url) {
    const media = this.document.media.find((item) => url === `https://cdn.example/jingjie/media/${item.name}`);
    return media ? structuredClone(media) : null;
  }

  async inspectMediaObject(input) {
    this.inspections.push(structuredClone(input));
    const object = this.objects.get(input.key);
    if (!object) throw new ContentError("素材尚未上传", 404);
    return structuredClone(object);
  }

  async close() {
    await this.pending;
  }
}

const review = () => ({ frame: { confirmed: true, note: "作者已对照原片核实" } });
const videoDraft = () => ({
  id: "imported-video", kind: "视频", title: "导入案例", analysis: "整片分析", prompt: "整体提示词",
  image: "https://media.example/cover.png", tags: ["原有标签"],
  tagValues: { emotion: ["平静"], style: ["写实"] },
  video: {
    src: "https://media.example/video.mp4", durationSeconds: 12, isMock: false,
    metadata: { width: 1920, height: 1080, fps: 24, hasAudio: true },
    cast: [{ id: "person-1", name: "人物甲", image: "https://media.example/person.png" }],
    shots: [
      { id: "shot-1", start: 0, end: 5, title: "开场", summary: "人物走进房间", subjects: ["person-1"], image: "https://media.example/first.png", review: review() },
      { id: "shot-2", start: 5, end: 12, title: "收尾", summary: "人物望向窗外", subjects: ["person-1"], image: "https://media.example/second.png", review: review() },
    ],
  },
});

async function fixture(t, { draft = videoDraft(), publish = false, origin = "https://jingjie.example" } = {}) {
  const provider = new MemoryDataProvider();
  const repository = createRepository({ provider });
  t.after(() => repository.close());
  let record = await repository.change({ action: "save", id: draft.id, draft });
  if (publish) record = await repository.change({ action: "publish", id: record.id, revision: record.revision, draft: record.draft });
  return { provider, repository, record, service: createDraftService(repository, { origin }) };
}

const statusError = (status) => (error) => error instanceof ContentError && error.status === status;

test("getDraft returns the stable case ID, current revision, editable data and management URLs", async (t) => {
  const { service, record, provider } = await fixture(t);
  const before = await provider.read();
  const result = await service.getDraft({ caseId: record.id });
  assert.equal(result.caseId, record.id);
  assert.equal(result.draftId, undefined);
  assert.equal(result.status, "draft");
  assert.equal(result.revision, record.revision);
  assert.deepEqual(result.draft, record.draft);
  assert.equal(result.updatedAt, record.updatedAt);
  assert.equal(result.publishedAt, null);
  assert.equal(result.hasChanges, true);
  assert.equal(result.previewUrl, `https://jingjie.example/case-preview?id=${record.id}`);
  assert.equal(new URL(result.editUrl).origin, "https://jingjie.example");
  assert.equal(new URL(result.editUrl).pathname, "/content");
  assert.deepEqual(await provider.read(), before);
});

test("a duration correction preserves the video, shot data and other unpatched fields", async (t) => {
  const { service, record, repository } = await fixture(t);
  const result = await service.updateDraft({ caseId: record.id, revision: record.revision, patch: { video: { durationSeconds: 12.75 } } });
  assert.equal(result.caseId, record.id);
  assert.equal(result.revision, record.revision + 1);
  assert.equal(result.draft.video.durationSeconds, 12.75);
  assert.equal(result.draft.video.src, record.draft.video.src);
  assert.deepEqual(result.draft.video.metadata, record.draft.video.metadata);
  assert.deepEqual(result.draft.video.cast, record.draft.video.cast);
  assert.deepEqual(result.draft.video.shots, record.draft.video.shots.map(({ review: _review, ...shot }) => shot));
  assert.equal(result.draft.title, record.draft.title);
  assert.equal(result.draft.analysis, record.draft.analysis);
  assert.deepEqual((await repository.getRecord(record.id)).draft, result.draft);
});

test("patch merges metadata and tag groups, replaces arrays and honors explicit empty values", async (t) => {
  const { service, record } = await fixture(t);
  const result = await service.updateDraft({
    caseId: record.id, revision: record.revision,
    patch: { title: "修改后的标题", analysis: "", tags: [], tagValues: { emotion: [], subject: ["人物"] }, video: { metadata: { fps: 30 }, shots: [], cast: [] } },
  });
  assert.equal(result.draft.title, "修改后的标题");
  assert.equal(result.draft.analysis, "");
  assert.equal(result.draft.prompt, record.draft.prompt);
  assert.deepEqual(result.draft.tags, []);
  assert.deepEqual(result.draft.tagValues, { emotion: [], style: ["写实"], subject: ["人物"] });
  assert.deepEqual(result.draft.video.metadata, { width: 1920, height: 1080, fps: 30, hasAudio: true });
  assert.deepEqual(result.draft.video.shots, []);
  assert.deepEqual(result.draft.video.cast, []);
  assert.equal(result.draft.video.src, record.draft.video.src);
});

test("nullable metadata fields clear only their own recorded values", async (t) => {
  const { service, record } = await fixture(t);
  const result = await service.updateDraft({
    caseId: record.id, revision: record.revision,
    patch: { video: { metadata: { fps: null, hasAudio: null } } },
  });
  assert.deepEqual(result.draft.video.metadata, { width: 1920, height: 1080 });
  assert.equal(result.draft.video.src, record.draft.video.src);
  assert.equal(result.draft.video.durationSeconds, record.draft.video.durationSeconds);
});

test("unknown IDs return 404 and never create a record", async (t) => {
  const { service, provider } = await fixture(t);
  const before = await provider.read();
  await assert.rejects(service.getDraft({ caseId: "missing-case" }), statusError(404));
  await assert.rejects(service.updateDraft({ caseId: "missing-case", revision: 1, patch: { title: "不可创建" } }), statusError(404));
  assert.deepEqual(await provider.read(), before);
});

test("stale and concurrent revisions cannot overwrite a more recent draft", async (t) => {
  const { service, record, repository } = await fixture(t);
  const writes = await Promise.allSettled([
    service.updateDraft({ caseId: record.id, revision: record.revision, patch: { title: "修改甲" } }),
    service.updateDraft({ caseId: record.id, revision: record.revision, patch: { title: "修改乙" } }),
  ]);
  assert.equal(writes.filter(({ status }) => status === "fulfilled").length, 1);
  const failure = writes.find(({ status }) => status === "rejected");
  assert.ok(statusError(409)(failure.reason));
  const saved = await repository.getRecord(record.id);
  assert.equal(saved.revision, record.revision + 1);
  assert.ok(["修改甲", "修改乙"].includes(saved.draft.title));
  await assert.rejects(service.updateDraft({ caseId: record.id, revision: record.revision, patch: { analysis: "过期输入" } }), statusError(409));
  assert.deepEqual(await repository.getRecord(record.id), saved);
});

test("saving published and offline records preserves status and their public snapshot", async (t) => {
  const { service, record, repository, provider } = await fixture(t, { publish: true });
  const published = await repository.getPublished(record.id);
  const result = await service.updateDraft({ caseId: record.id, revision: record.revision, patch: { title: "尚未发布的新标题" } });
  assert.equal(result.status, "published");
  assert.equal(result.hasChanges, true);
  assert.equal(result.publishedAt, record.publishedAt);
  assert.deepEqual(await repository.getPublished(record.id), published);
  const offline = await repository.change({ action: "unlist", id: record.id, revision: result.revision });
  const offlineSnapshot = (await provider.read()).content[0].published;
  const updated = await service.updateDraft({ caseId: record.id, revision: offline.revision, patch: { description: "下架期间补充的资料" } });
  assert.equal(updated.status, "offline");
  assert.equal(updated.publishedAt, record.publishedAt);
  assert.equal(await repository.getPublished(record.id), null);
  assert.deepEqual((await provider.read()).content[0].published, offlineSnapshot);
  await repository.change({ action: "relist", id: record.id, revision: updated.revision });
  assert.deepEqual(await repository.getPublished(record.id), published);
});

test("draft updates use repository media canonicalization and return the stored references", async (t) => {
  const { service, record, provider, repository } = await fixture(t);
  const videoUrl = provider.registerMedia("replacement.mp4", { kind: "video" });
  const portraitUrl = provider.registerMedia("portrait.png");
  const coverUrl = provider.registerMedia("cover.png");
  provider.mediaUrls.set(record.draft.image, coverUrl);
  const before = provider.canonicalized.length;
  const result = await service.updateDraft({
    caseId: record.id, revision: record.revision,
    patch: { video: { src: videoUrl, cast: [{ ...record.draft.video.cast[0], image: portraitUrl }] } },
  });
  assert.ok(provider.canonicalized.length > before);
  assert.equal(result.draft.video.src, videoUrl);
  assert.equal(result.draft.video.cast[0].image, portraitUrl);
  assert.equal(result.draft.image, coverUrl);
  assert.deepEqual(provider.inspections.map(({ key }) => key).sort(), ["jingjie/media/portrait.png", "jingjie/media/replacement.mp4"]);
  assert.deepEqual((await repository.getRecord(record.id)).draft, result.draft);
});

test("video, metadata and cast changes clear all manual review confirmations", async (t) => {
  for (const video of [
    { metadata: { fps: 30 } },
    { cast: [{ id: "person-1", name: "修改人物名", image: "https://media.example/person.png" }] },
  ]) {
    const { service, record } = await fixture(t);
    const result = await service.updateDraft({ caseId: record.id, revision: record.revision, patch: { video } });
    assert.ok(result.draft.video.shots.every((shot) => !shot.review || Object.keys(shot.review).length === 0));
  }
});

test("replacing a video resets stale timing and metadata unless replacements are supplied together", async (t) => {
  for (const details of [{}, { durationSeconds: 18, metadata: { width: 1280, height: 720 } }]) {
    const { service, record, provider } = await fixture(t);
    const src = provider.registerMedia("replacement.mp4", { kind: "video" });
    const result = await service.updateDraft({ caseId: record.id, revision: record.revision, patch: { video: { src, ...details } } });
    assert.equal(result.draft.video.src, src);
    assert.equal(result.draft.video.durationSeconds, details.durationSeconds ?? 0);
    assert.deepEqual(result.draft.video.metadata ?? {}, details.metadata ?? {});
    assert.deepEqual(result.draft.video.shots, record.draft.video.shots.map(({ review: _review, ...shot }) => shot));
    assert.ok(result.draft.video.shots.every((shot) => !shot.review || Object.keys(shot.review).length === 0));
  }
});

test("new media must be registered, uploaded, unsigned and of the matching media kind", async (t) => {
  const { service, record, provider } = await fixture(t);
  const pending = provider.registerMedia("pending.mp4", { kind: "video", uploaded: false });
  const image = provider.registerMedia("image.png");
  const uploaded = provider.registerMedia("uploaded.mp4", { kind: "video" });
  const before = await provider.read();
  await assert.rejects(service.updateDraft({ caseId: record.id, revision: record.revision, patch: { video: { src: pending } } }), statusError(404));
  for (const src of [image, "https://remote.example/unregistered.mp4", `${uploaded}?Signature=temporary`, "/media/uploaded.mp4"]) {
    await assert.rejects(service.updateDraft({ caseId: record.id, revision: record.revision, patch: { video: { src } } }), statusError(400));
  }
  assert.deepEqual(await provider.read(), before);
});

test("changing one shot clears only its review; MCP cannot import or replace human confirmations", async (t) => {
  const { service, record } = await fixture(t);
  const shots = structuredClone(record.draft.video.shots);
  shots[0].summary = "修正后的人物动作";
  shots[0].review = { frame: { confirmed: true, note: "自动生成确认" } };
  shots[1].review = { frame: { confirmed: true, note: "替换人工结论" }, boundary: { confirmed: true, note: "自动确认切点" } };
  shots.push({ id: "shot-3", start: 12, end: 12, summary: "未完善的新镜头", review: { frame: { confirmed: true, note: "自动确认新镜头" } } });
  const result = await service.updateDraft({ caseId: record.id, revision: record.revision, patch: { video: { shots } } });
  assert.ok(!result.draft.video.shots[0].review || Object.keys(result.draft.video.shots[0].review).length === 0);
  assert.deepEqual(result.draft.video.shots[1].review, record.draft.video.shots[1].review);
  assert.ok(!result.draft.video.shots[2].review || Object.keys(result.draft.video.shots[2].review).length === 0);
});

test("round-tripping unchanged shots and changing only case prose preserve existing review", async (t) => {
  const { service, record } = await fixture(t);
  const result = await service.updateDraft({
    caseId: record.id, revision: record.revision,
    patch: { title: "标题更新", video: { shots: structuredClone(record.draft.video.shots), metadata: { fps: 24 } } },
  });
  assert.deepEqual(result.draft.video.shots, record.draft.video.shots);
});

test("updates allow incomplete drafts under the same validation used by the editor", async (t) => {
  const { service, record } = await fixture(t);
  const result = await service.updateDraft({
    caseId: record.id, revision: record.revision,
    patch: { title: "", image: "", prompt: "", analysis: "", video: { src: "", durationSeconds: 0, cast: [{ id: "person-1", name: "" }], shots: [{ id: "unfinished-shot", start: 5, end: 0 }] } },
  });
  assert.equal(result.status, "draft");
  assert.equal(result.draft.title, "");
  assert.equal(result.draft.video.src, "");
  assert.equal(result.draft.video.durationSeconds, 0);
  assert.equal(result.draft.video.cast[0].name, "");
  assert.equal(result.draft.video.shots[0].end, 0);
});

test("invalid inputs, immutable fields and unknown patch fields fail with ContentError 400 without mutation", async (t) => {
  const { service, record, provider } = await fixture(t);
  const before = await provider.read();
  for (const input of [{}, { caseId: "../case" }, { caseId: 1 }]) {
    await assert.rejects(service.getDraft(input), statusError(400));
  }
  for (const input of [
    {},
    { caseId: record.id, patch: { title: "缺版本" } },
    { caseId: record.id, revision: 0, patch: {} },
    { caseId: record.id, revision: 1.5, patch: {} },
    { caseId: record.id, revision: record.revision, patch: null },
    { caseId: record.id, revision: record.revision, patch: [] },
    ...[
      { id: "replacement-id" }, { kind: "分镜" }, { isMock: true }, { unknownField: "无效" },
      { duration: "00:30" }, { video: { isMock: true } }, { video: { duration: 20 } }, { video: { metadata: { unknown: true } } },
      { video: { shots: [{ ...record.draft.video.shots[0], unknown: true }] } },
      { video: { cast: [{ ...record.draft.video.cast[0], unknown: true }] } },
      { video: { durationSeconds: -1 } }, { video: { metadata: { fps: "30" } } },
      { title: "x".repeat(81) }, { video: { src: "javascript:alert(1)" } },
      { video: { shots: [{ id: "shot-1", subjects: ["missing-person"] }] } },
    ].map((patch) => ({ caseId: record.id, revision: record.revision, patch })),
  ]) {
    await assert.rejects(service.updateDraft(input), statusError(400));
  }
  assert.deepEqual(await provider.read(), before);
});
