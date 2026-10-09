import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRepository, createInitialDocument } from "../src/server/repository.js";
import { JsonDataProvider } from "../src/server/storage/json.js";
import { OssMediaStorage } from "../src/server/storage/oss.js";
import { createSubmissionService } from "../src/server/mcpSubmissions.js";
import { createDraftService } from "../src/server/mcpDrafts.js";
import { MEDIA_LIMITS } from "../src/lib/mediaFormats.js";

const png = Buffer.from("89504e470d0a1a0a00000000", "hex");
const mp4 = Buffer.from("000000186674797069736f6d00000000", "hex");
const imageFile = { localName: "cover.png", kind: "image", mime: "image/png", size: png.length };
const videoFile = { localName: "video.mp4", kind: "video", mime: "video/mp4", size: mp4.length };
const source = {
  title: "本地拉片", source: "video.mp4", meta: { durationSeconds: 10, width: 1920, height: 1080, fps: 24 },
  cast: [{ id: "P1", name: "人物甲" }],
  shots: [{ id: "S01", start: 0, end: 10, frame: "人物甲走进房间", size: "wide", camera: "static", review: { frame: { confirmed: true, note: "AI 自动质量检查" } } }],
};

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), "jingjie-mcp-"));
  const objects = new Map(), requests = [];
  const repositories = [];
  function open() {
    const oss = new OssMediaStorage({ env: {
      JINGJIE_OSS_BUCKET: "unit-bucket", JINGJIE_OSS_REGION: "cn-hangzhou",
      JINGJIE_OSS_ACCESS_KEY_ID: "unit-id", JINGJIE_OSS_ACCESS_KEY_SECRET: "unit-secret",
      JINGJIE_OSS_UPLOAD_TTL_SECONDS: "900",
    } });
    const client = oss.client();
    const sign = client.signatureUrlV4.bind(client);
    client.signatureUrlV4 = async (method, ...args) => {
      assert.equal(method, "PUT");
      return sign(method, ...args);
    };
    client.head = async (key) => {
      requests.push({ method: "HEAD", key });
      const bytes = objects.get(key);
      if (!bytes) throw Object.assign(new Error("素材尚未上传"), { status: 404 });
      const mime = bytes.equals(png) ? "image/png" : bytes.equals(mp4) ? "video/mp4" : "image/jpeg";
      return { res: { headers: { "content-length": String(bytes.length), "content-type": mime, etag: '"1234567890abcdef"' } } };
    };
    for (const method of ["get", "getStream", "put", "putStream", "copy", "delete", "request"]) {
      client[method] = async () => assert.fail(`MCP must not transfer object bytes or copy via ${method}`);
    }
    const provider = new JsonDataProvider({ directory, initialize: () => createInitialDocument([]), oss });
    const repository = createRepository({ provider });
    repositories.push(repository);
    return { repository, provider, service: createSubmissionService(repository) };
  }
  t.after(async () => {
    await Promise.all(repositories.map((repository) => repository.close()));
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(tmpdir()));
    assert.ok(path.basename(directory).startsWith("jingjie-mcp-"));
    await rm(directory, { recursive: true, force: true });
  });
  return { ...open(), directory, objects, requests, open };
}

const asset = (upload) => ({ assetId: upload.assetId, mediaUrl: upload.mediaUrl, objectKey: upload.objectKey });

test("one batch signs only PUT for public OSS objects and retries reuse stable identifiers", async (t) => {
  const { service, repository, provider, requests } = await fixture(t);
  const files = [imageFile, videoFile];
  const before = Date.now();
  const prepared = await service.presign({ requestId: "local-analysis-1", files });
  const after = Date.now();
  assert.equal(prepared.status, "prepared");
  assert.equal(prepared.uploads.length, 2);
  for (const upload of prepared.uploads) {
    assert.ok(upload.assetId);
    assert.match(upload.objectKey, /^jingjie\/media\/[a-f0-9-]+\.(png|mp4)$/);
    assert.match(upload.uploadUrl, /^https:\/\/unit-bucket\.oss-cn-hangzhou\.aliyuncs\.com\//);
    assert.equal(upload.headers["Content-Type"], upload.mime);
    assert.equal(Object.keys(upload.headers).some((name) => name.toLowerCase() === "content-length"), false);
    assert.equal(upload.headers["x-oss-object-acl"], "public-read");
    assert.equal(upload.headers["x-oss-forbid-overwrite"], "true");
    assert.equal(new URL(upload.uploadUrl).searchParams.get("x-oss-expires"), "900");
    assert.ok(Date.parse(upload.uploadExpiresAt) >= before + 900000);
    assert.ok(Date.parse(upload.uploadExpiresAt) <= after + 900000);
    assert.match(upload.mediaUrl, /^https:\/\/unit-bucket\.oss-cn-hangzhou\.aliyuncs\.com\/jingjie\/media\/[a-f0-9-]+\.(png|mp4)$/);
    assert.equal(new URL(upload.mediaUrl).search, "");
    assert.notEqual(upload.mediaUrl, upload.uploadUrl);
    assert.equal(new URL(upload.mediaUrl).pathname, `/${upload.objectKey}`);
    assert.equal(upload.url, undefined);
    assert.equal(upload.expiresAt, undefined);
  }
  assert.deepEqual(requests, []);
  assert.equal(prepared.accesses, undefined);
  assert.doesNotMatch(JSON.stringify(prepared), /accessKeySecret|securityToken|server-only-secret/i);
  const retried = await service.presign({ requestId: "local-analysis-1", files: [...files].reverse() });
  assert.equal(retried.submissionId, prepared.submissionId);
  assert.deepEqual(retried.uploads.map(({ assetId }) => assetId).sort(), prepared.uploads.map(({ assetId }) => assetId).sort());
  assert.equal((await provider.read()).media.length, 2);
  await assert.rejects(service.presign({ requestId: "local-analysis-1", files: [{ ...imageFile, size: imageFile.size + 1 }, videoFile] }), (error) => error.status === 409);
  assert.equal((await repository.listRecords()).length, 0);
});

test("file manifests reject unsupported types, excessive sizes, duplicate names, and invalid sizes before issuing URLs", async (t) => {
  const { service, provider } = await fixture(t);
  for (const file of [
    null,
    "C:\\videos\\cover.png",
    { ...imageFile, localName: "C:\\videos\\cover.png" },
    { ...imageFile, localName: "/home/user/cover.png" },
    { ...imageFile, localName: "../cover.png" },
    { ...imageFile, mime: "image/svg+xml" },
    { ...imageFile, kind: "video" },
    { ...imageFile, size: MEDIA_LIMITS.image + 1 },
    { ...videoFile, size: MEDIA_LIMITS.video + 1 },
    { ...imageFile, size: 0 },
    { ...imageFile, size: 1.5 },
  ]) {
    await assert.rejects(service.presign({ requestId: "invalid-manifest", files: [file] }));
  }
  await assert.rejects(service.presign({ requestId: "duplicate-files", files: [imageFile, imageFile] }));
  await assert.rejects(service.presign({ files: [imageFile] }));
  await assert.rejects(service.presign({}));
  await assert.rejects(service.presign({ requestId: "missing-manifest" }));
  await assert.rejects(service.presign({ requestId: "too-many", files: Array.from({ length: 253 }, (_, index) => ({ ...imageFile, localName: `frames/${index}.png` })) }));
  assert.deepEqual((await provider.read()).submissions, []);
  assert.deepEqual((await provider.read()).media, []);
});

test("a successful submission registers verified OSS assets and saves one unpublished draft", async (t) => {
  const { service, repository, provider, objects, requests } = await fixture(t);
  const prepared = await service.presign({ requestId: "image-import", files: [imageFile] });
  const upload = prepared.uploads[0];
  objects.set(upload.objectKey, png);
  provider.presignMedia = async () => assert.fail("submit must not sign any media addresses");
  provider.oss.presignMedia = async () => assert.fail("submit must not sign any OSS addresses");
  const result = await service.submitCase({ submissionId: prepared.submissionId, data: { kind: "image", title: "图片分析", image: imageFile.localName, analysis: "AI 根据图片填写的分析" }, assets: [asset(upload)] });
  assert.equal(result.status, "draft");
  assert.equal(result.mediaCount, 1);
  assert.equal(result.revision, 1);
  assert.match(result.previewUrl, /\/case-preview\?id=/);
  assert.match(result.editUrl, /\/content/);
  const record = await repository.getRecord(result.caseId);
  assert.equal(record.status, "draft");
  assert.equal(record.draft.title, "图片分析");
  assert.equal(record.draft.image, upload.mediaUrl);
  assert.deepEqual(await repository.listPublished(), []);
  const document = await provider.read();
  assert.equal(document.content[0].published, null);
  assert.equal(document.media[0].storage.provider, "oss");
  assert.equal(document.media[0].originalName, imageFile.localName);
  assert.equal(document.media.length, 1);
  assert.deepEqual(requests, [{ method: "HEAD", key: upload.objectKey }]);
  assert.equal(document.submissions[0].source.data.title, "图片分析");
  assert.doesNotMatch(JSON.stringify(document.content), /Signature=|uploadUrl|"\/media\//i);
  const published = await repository.change({ action: "publish", id: record.id, revision: record.revision, draft: record.draft });
  assert.equal(published.status, "published");
  assert.equal((await repository.getPublished(record.id)).image, upload.mediaUrl);
});


test("video, cover, shot frames and cast portraits persist the final unsigned OSS references", async (t) => {
  const { service, repository, objects } = await fixture(t);
  const files = [videoFile, imageFile, ...["frames/S01a.png", "frames/S01b.png", "cast/P1.png"].map((localName) => ({ ...imageFile, localName }))];
  const prepared = await service.presign({ requestId: "all-video-media", files });
  for (const upload of prepared.uploads) objects.set(upload.objectKey, upload.kind === "video" ? mp4 : png);
  const data = structuredClone(source);
  data.image = imageFile.localName;
  data.cast[0].image = "cast/P1.png";
  data.shots[0].image = "frames/S01a.png";
  data.shots[0].endImage = "frames/S01b.png";
  const result = await service.submitCase({ submissionId: prepared.submissionId, data, assets: prepared.uploads.map(asset) });
  const { draft } = await repository.getRecord(result.caseId);
  const byName = new Map(prepared.uploads.map((upload) => [upload.localName, upload.mediaUrl]));
  assert.equal(draft.image, byName.get(imageFile.localName));
  assert.equal(draft.video.src, byName.get(videoFile.localName));
  assert.equal(draft.video.shots[0].image, byName.get("frames/S01a.png"));
  assert.equal(draft.video.shots[0].endImage, byName.get("frames/S01b.png"));
  assert.equal(draft.video.cast[0].image, byName.get("cast/P1.png"));
  assert.doesNotMatch(JSON.stringify(draft), /Signature=|uploadUrl|"\/media\//i);
});

test("omitted files remain explicit missing material and can be saved in an incomplete video draft", async (t) => {
  const { service, repository, objects, provider } = await fixture(t);
  const prepared = await service.presign({ requestId: "missing-frame", files: [videoFile, { ...imageFile, localName: "frames/S01a.png" }] });
  const video = prepared.uploads.find((upload) => upload.kind === "video");
  objects.set(video.objectKey, mp4);
  const result = await service.submitCase({ submissionId: prepared.submissionId, data: source, assets: [asset(video)] });
  assert.equal(result.status, "draft");
  assert.ok(result.warnings.some((warning) => /frames\/S01a\.png|缺|未上传/.test(warning)));
  assert.equal(result.mediaCount, 1);
  assert.equal(result.shotCount, 1);
  const record = await repository.getRecord(result.caseId);
  assert.equal(record.draft.video.src, video.mediaUrl);
  assert.equal(record.draft.video.shots[0].image, "");
  assert.equal(record.draft.video.shots[0].endImage, undefined);
  assert.equal(record.draft.video.shots[0].review, undefined);
  assert.equal((await provider.read()).media.length, 2);
  assert.equal((await provider.read()).submissions[0].source.data.shots[0].review.frame.confirmed, true);
});

test("HEAD size or Content-Type mismatches cannot commit a draft and keep the declared media plans", async (t) => {
  const { service, repository, provider, objects } = await fixture(t);
  for (const [requestId, bytes, status] of [
    ["wrong-size", Buffer.concat([png, Buffer.from([0])]), 409],
    ["wrong-format", Buffer.from("ffd8ff000000000000000000", "hex"), 415],
  ]) {
    const prepared = await service.presign({ requestId, files: [imageFile] });
    const upload = prepared.uploads[0];
    objects.set(upload.objectKey, bytes);
    await assert.rejects(service.submitCase({ submissionId: prepared.submissionId, data: { kind: "image", image: imageFile.localName }, assets: [asset(upload)] }), (error) => error.status === status);
    assert.equal((await repository.getSubmission(prepared.submissionId)).status, "prepared");
  }
  assert.deepEqual(await repository.listRecords(), []);
  assert.equal((await provider.read()).media.length, 2);
});

test("submissions cannot replace an issued asset URL or object key with arbitrary remote material", async (t) => {
  const { service, repository, objects } = await fixture(t);
  const prepared = await service.presign({ requestId: "bound-assets", files: [imageFile] });
  const upload = prepared.uploads[0];
  objects.set(upload.objectKey, png);
  const data = { kind: "image", image: imageFile.localName };
  for (const supplied of [
    { ...asset(upload), mediaUrl: "https://unrelated.example/foreign.png" },
    { ...asset(upload), mediaUrl: upload.uploadUrl },
    { ...asset(upload), mediaUrl: `/media/${upload.mediaUrl.split("/").at(-1)}` },
    { ...asset(upload), objectKey: "other/media/foreign.png" },
    { ...asset(upload), assetId: "unknown-asset" },
  ]) await assert.rejects(service.submitCase({ submissionId: prepared.submissionId, data, assets: [supplied] }));
  assert.deepEqual(await repository.listRecords(), []);
});

test("submission and asset status survives repository restart, and a successful retry never creates another case", async (t) => {
  const state = await fixture(t);
  const prepared = await state.service.presign({ requestId: "recover-import", files: [imageFile, videoFile] });
  const firstRestart = state.open();
  const awaiting = await firstRestart.service.getSubmissionStatus({ submissionId: prepared.submissionId });
  assert.equal(awaiting.status, "prepared");
  assert.ok(awaiting.files.every((file) => file.status === "awaiting_upload"));
  assert.equal(awaiting.uploads, undefined);
  assert.equal(awaiting.accesses, undefined);
  const image = prepared.uploads.find((upload) => upload.kind === "image");
  const video = prepared.uploads.find((upload) => upload.kind === "video");
  state.objects.set(image.objectKey, png);
  state.objects.set(video.objectKey, mp4);
  const ready = await firstRestart.service.getSubmissionStatus({ submissionId: prepared.submissionId });
  assert.ok(ready.files.every((file) => file.status === "uploaded"));
  const data = { kind: "image", title: "重复提交仍是一条", image: imageFile.localName, prompt: "真实录入" };
  const result = await firstRestart.service.submitCase({ submissionId: prepared.submissionId, data, assets: prepared.uploads.map(asset) });
  const secondRestart = state.open();
  const status = await secondRestart.service.getSubmissionStatus({ submissionId: prepared.submissionId });
  assert.equal(status.status, "submitted");
  assert.deepEqual(status.result, result);
  const retry = await secondRestart.service.submitCase({ submissionId: prepared.submissionId, data, assets: prepared.uploads.map(asset).reverse() });
  assert.deepEqual(retry, result);
  const completed = await secondRestart.service.presign({ requestId: "recover-import", files: [videoFile, imageFile] });
  assert.equal(completed.status, "submitted");
  assert.deepEqual(completed.result, result);
  assert.deepEqual(completed.uploads, []);
  assert.equal((await secondRestart.provider.read()).media.length, 2);
  assert.equal((await secondRestart.repository.listRecords()).length, 1);
  await assert.rejects(secondRestart.service.submitCase({ submissionId: prepared.submissionId, data: { ...data, title: "尝试覆盖" }, assets: prepared.uploads.map(asset) }), (error) => error.status === 409);
  assert.equal((await secondRestart.repository.getRecord(result.caseId)).draft.title, data.title);
  const stored = await readFile(path.join(state.directory, "submissions.json"), "utf8");
  assert.doesNotMatch(stored, /Signature=|uploadUrl|AccessKeySecret/i);
});

test("unknown submissions fail clearly and status reports invalid objects without signing", async (t) => {
  const { service, provider, objects } = await fixture(t);
  await assert.rejects(service.getSubmissionStatus({ submissionId: "unknown-submission" }), (error) => error.status === 404);
  const prepared = await service.presign({ requestId: "invalid-upload-status", files: [imageFile] });
  objects.set(prepared.uploads[0].objectKey, Buffer.alloc(imageFile.size));
  provider.presignMedia = async () => assert.fail("status must not sign any media addresses");
  provider.oss.presignMedia = async () => assert.fail("status must not sign any OSS addresses");
  const status = await service.getSubmissionStatus({ submissionId: prepared.submissionId });
  assert.equal(status.files[0].status, "invalid");
  assert.ok(status.files[0].message);
});

test("temporary OSS failures remain recoverable without telling the client to replace a submission", async (t) => {
  const { service, provider } = await fixture(t);
  const prepared = await service.presign({ requestId: "temporary-oss-failure", files: [imageFile] });
  provider.inspectMediaObject = async () => { throw Object.assign(new Error("upstream failure with private configuration"), { status: 503 }); };
  const status = await service.getSubmissionStatus({ submissionId: prepared.submissionId });
  assert.equal(status.files[0].status, "unavailable");
  assert.doesNotMatch(status.files[0].message, /private configuration/);
  assert.equal(status.uploads, undefined);
  assert.equal(status.submissionId, prepared.submissionId);
});

test("a failed persistence transaction leaves the submission prepared and can be retried without a partial draft", async (t) => {
  const { service, repository, provider, objects } = await fixture(t);
  const prepared = await service.presign({ requestId: "transaction-retry", files: [imageFile] });
  const upload = prepared.uploads[0];
  objects.set(upload.objectKey, png);
  const write = provider.atomicWrite.bind(provider);
  let failed = false;
  provider.atomicWrite = async (name, text) => {
    if (!failed && name.startsWith("content/")) {
      failed = true;
      throw new Error("simulated submission write failure");
    }
    await write(name, text);
  };
  const input = { submissionId: prepared.submissionId, data: { kind: "image", title: "完整保存", image: imageFile.localName }, assets: [asset(upload)] };
  await assert.rejects(service.submitCase(input), /simulated submission write failure/);
  assert.equal((await repository.getSubmission(prepared.submissionId)).status, "prepared");
  assert.deepEqual(await repository.listRecords(), []);
  assert.equal((await provider.read()).media.length, 1);
  const result = await service.submitCase(input);
  assert.equal(result.status, "draft");
  assert.equal((await repository.listRecords()).length, 1);
  assert.equal((await provider.read()).media.length, 1);
});

test("editing a submitted draft persists across restart and can use a newly uploaded replacement asset", async (t) => {
  const state = await fixture(t);
  const prepared = await state.service.presign({ requestId: "editable-import", files: [imageFile] });
  state.objects.set(prepared.uploads[0].objectKey, png);
  const data = { kind: "image", title: "原始导入", image: imageFile.localName };
  const saved = await state.service.submitCase({ submissionId: prepared.submissionId, data, assets: prepared.uploads.map(asset) });
  const drafts = createDraftService(state.repository);
  const current = await drafts.getDraft({ caseId: saved.caseId });
  const replacement = await state.service.presign({ requestId: "replace-draft-cover", files: [{ ...imageFile, localName: "new-cover.png" }] });
  const upload = replacement.uploads[0];
  await assert.rejects(drafts.updateDraft({ caseId: saved.caseId, revision: current.revision, patch: { image: upload.mediaUrl } }), (error) => error.status === 404);
  state.objects.set(upload.objectKey, png);
  const updated = await drafts.updateDraft({ caseId: saved.caseId, revision: current.revision, patch: { title: "修改后的资料", image: upload.mediaUrl } });
  assert.equal(updated.revision, 2);
  assert.equal(updated.draft.image, upload.mediaUrl);
  const restarted = state.open();
  assert.deepEqual(await createDraftService(restarted.repository).getDraft({ caseId: saved.caseId }), updated);
  assert.equal((await restarted.repository.listRecords()).length, 1);
  assert.deepEqual((await restarted.repository.getSubmission(prepared.submissionId)).source.data, data);
  assert.deepEqual((await restarted.service.getSubmissionStatus({ submissionId: prepared.submissionId })).result, saved);
});

test("empty file manifests can save incomplete drafts without signing an empty batch", async (t) => {
  const { service, provider } = await fixture(t);
  provider.presignMedia = async () => assert.fail("an empty draft must not issue signatures");
  const planned = await service.presign({ requestId: "empty-draft", files: [] });
  assert.deepEqual(planned.uploads, []);
  assert.equal(planned.accesses, undefined);
  const saved = await service.submitCase({ submissionId: planned.submissionId, data: { kind: "image", title: "未上传图片" }, assets: [] });
  assert.equal(saved.status, "draft");
  assert.equal(saved.mediaCount, 0);
});
