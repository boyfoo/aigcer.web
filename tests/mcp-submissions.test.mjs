import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRepository, createInitialDocument } from "../src/server/repository.js";
import { JsonDataProvider } from "../src/server/storage/json.js";
import { OssMediaStorage } from "../src/server/storage/oss.js";
import { createSubmissionService } from "../src/server/mcpSubmissions.js";
import { identifyMedia, MEDIA_LIMITS } from "../src/lib/mediaFormats.js";

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
  const objects = new Map(), promotions = [];
  const repositories = [];
  let signatures = 0;
  function open() {
    const provider = new JsonDataProvider({ directory, initialize: () => createInitialDocument([]) });
    provider.getDirectUploadConfig = async () => ({ enabled: true, expiresSeconds: 900 });
    provider.getPlannedMediaReference = async (name) => `https://unit-bucket.oss-cn-hangzhou.aliyuncs.com/jingjie/media/${name}`;
    provider.getMediaReference = async (name, storage) => `https://${storage.bucket}.oss-cn-hangzhou.aliyuncs.com/${storage.key}`;
    provider.makeUploadKey = async (submissionId, name) => `jingjie/uploads/${submissionId}/${name}`;
    provider.createUploadUrl = async ({ key, mime, size }) => ({
      uploadUrl: `https://unit-bucket.oss-cn-hangzhou.aliyuncs.com/${key}?Signature=signature-${++signatures}`,
      headers: { "Content-Type": mime, "Content-Length": String(size), "x-oss-forbid-overwrite": "true" },
      expiresAt: new Date(Date.now() + 900000).toISOString(),
    });
    provider.inspectUploadedObject = async ({ key, kind, mime, size }) => {
      const bytes = objects.get(key);
      if (!bytes) throw Object.assign(new Error("素材尚未上传"), { status: 404 });
      if (bytes.length !== size) throw Object.assign(new Error("素材大小与申请不一致"), { status: 409 });
      const detected = identifyMedia(bytes, kind);
      if (detected.mime !== mime) throw Object.assign(new Error("素材实际格式与申请不一致"), { status: 415 });
      return { size, mime, etag: createHash("md5").update(bytes).digest("hex") };
    };
    provider.promoteUploadedObject = async ({ sourceKey, name, etag }) => {
      promotions.push({ sourceKey, name, etag });
      return { provider: "oss", bucket: "unit-bucket", key: `jingjie/media/${name}` };
    };
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
  return { ...open(), directory, objects, promotions, open };
}

const asset = (upload) => ({ assetId: upload.assetId, url: upload.url, objectKey: upload.objectKey });

test("upload preparation returns scoped presigned URLs and stable asset identifiers, and request retries are idempotent", async (t) => {
  const { service, repository } = await fixture(t);
  const files = [imageFile, videoFile];
  const prepared = await service.prepareUpload({ requestId: "local-analysis-1", files });
  assert.equal(prepared.status, "prepared");
  assert.equal(prepared.uploads.length, 2);
  for (const upload of prepared.uploads) {
    assert.ok(upload.assetId);
    assert.match(upload.objectKey, new RegExp(`/uploads/${prepared.submissionId}/`));
    assert.match(upload.uploadUrl, /^https:\/\/unit-bucket\.oss-cn-hangzhou\.aliyuncs\.com\//);
    assert.equal(upload.headers["Content-Type"], upload.mime);
    assert.equal(upload.headers["Content-Length"], String(upload.size));
    assert.ok(Date.parse(upload.expiresAt) > Date.now());
    assert.match(upload.url, /^https:\/\/unit-bucket\.oss-cn-hangzhou\.aliyuncs\.com\/jingjie\/media\/[a-f0-9-]+\.(png|mp4)$/);
    assert.equal(new URL(upload.url).search, "");
    assert.notEqual(upload.url, upload.uploadUrl);
  }
  assert.doesNotMatch(JSON.stringify(prepared), /accessKeySecret|securityToken|server-only-secret/i);
  const retried = await service.prepareUpload({ requestId: "local-analysis-1", files: [...files].reverse() });
  assert.equal(retried.submissionId, prepared.submissionId);
  assert.deepEqual(retried.uploads.map(({ assetId }) => assetId).sort(), prepared.uploads.map(({ assetId }) => assetId).sort());
  await assert.rejects(service.prepareUpload({ requestId: "local-analysis-1", files: [{ ...imageFile, size: imageFile.size + 1 }, videoFile] }), (error) => error.status === 409);
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
    await assert.rejects(service.prepareUpload({ requestId: "invalid-manifest", files: [file] }));
  }
  await assert.rejects(service.prepareUpload({ requestId: "duplicate-files", files: [imageFile, imageFile] }));
  assert.deepEqual((await provider.read()).submissions, []);
});

test("a successful submission registers verified OSS assets and saves one unpublished draft", async (t) => {
  const { service, repository, provider, objects, promotions } = await fixture(t);
  const prepared = await service.prepareUpload({ requestId: "image-import", files: [imageFile] });
  const upload = prepared.uploads[0];
  objects.set(upload.objectKey, png);
  const result = await service.submitCase({ submissionId: prepared.submissionId, data: { kind: "image", title: "图片分析", image: imageFile.localName, analysis: "AI 根据图片填写的分析" }, assets: [asset(upload)] });
  assert.equal(result.status, "draft");
  assert.equal(result.mediaCount, 1);
  assert.equal(result.revision, 1);
  assert.match(result.previewUrl, /\/case-preview\?id=/);
  assert.match(result.editUrl, /\/content/);
  const record = await repository.getRecord(result.caseId);
  assert.equal(record.status, "draft");
  assert.equal(record.draft.title, "图片分析");
  assert.equal(record.draft.image, upload.url);
  assert.deepEqual(await repository.listPublished(), []);
  const document = await provider.read();
  assert.equal(document.content[0].published, null);
  assert.equal(document.media[0].storage.provider, "oss");
  assert.equal(document.media[0].originalName, imageFile.localName);
  assert.equal(promotions.length, 1);
  assert.equal(document.submissions[0].source.data.title, "图片分析");
  assert.doesNotMatch(JSON.stringify(document.content), /Signature=|uploadUrl|"\/media\//i);
  const published = await repository.change({ action: "publish", id: record.id, revision: record.revision, draft: record.draft });
  assert.equal(published.status, "published");
  assert.equal((await repository.getPublished(record.id)).image, upload.url);
});

test("registered private media receives a one-hour GET signature without reading object bytes", async (t) => {
  const { service, provider, objects } = await fixture(t);
  const prepared = await service.prepareUpload({ requestId: "private-media-access", files: [imageFile] });
  const upload = prepared.uploads[0];
  objects.set(upload.objectKey, png);
  await service.submitCase({
    submissionId: prepared.submissionId,
    data: { kind: "image", title: "私有素材", image: imageFile.localName },
    assets: [asset(upload)],
  });
  provider.oss = new OssMediaStorage({ env: {
    JINGJIE_OSS_BUCKET: "unit-bucket", JINGJIE_OSS_REGION: "cn-hangzhou",
    JINGJIE_OSS_ACCESS_KEY_ID: "unit-id", JINGJIE_OSS_ACCESS_KEY_SECRET: "unit-secret",
  } });
  for (const method of ["statMedia", "openMedia", "exportMedia", "inspectUploadedObject", "promoteUploadedObject"]) {
    provider[method] = async () => assert.fail(`getMediaAccess must not call ${method}`);
  }
  const client = provider.oss.client();
  for (const method of ["head", "get", "getStream", "put", "putStream", "copy", "delete", "request"]) {
    client[method] = async () => assert.fail(`getMediaAccess must not request OSS ${method}`);
  }
  const sign = provider.createMediaUrl.bind(provider);
  const calls = [];
  provider.createMediaUrl = async (...args) => { calls.push(args); return sign(...args); };
  const before = Date.now();
  const access = await service.getMediaAccess({ url: upload.url });
  const after = Date.now();
  assert.deepEqual(Object.keys(access).sort(), ["expiresAt", "mediaUrl", "url"]);
  assert.equal(access.mediaUrl, upload.url);
  const signed = new URL(access.url);
  assert.equal(`${signed.origin}${signed.pathname}`, upload.url);
  assert.equal(signed.searchParams.get("x-oss-expires"), "3600");
  assert.equal(signed.searchParams.get("x-oss-signature-version"), "OSS4-HMAC-SHA256");
  assert.ok(signed.searchParams.get("x-oss-signature"));
  assert.ok(Date.parse(access.expiresAt) >= before + 3600000);
  assert.ok(Date.parse(access.expiresAt) <= after + 3600000);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1], "GET");
  assert.equal(calls[0][2].provider, "oss");
  assert.equal((await provider.read()).media[0].name, calls[0][0]);
  assert.doesNotMatch(JSON.stringify((await provider.read()).content), /x-oss-signature|Signature=/i);
});

test("private media access rejects unregistered objects and noncanonical or foreign references before signing", async (t) => {
  const { service, provider, objects } = await fixture(t);
  const prepared = await service.prepareUpload({ requestId: "access-registration-boundary", files: [imageFile] });
  const upload = prepared.uploads[0];
  provider.createMediaUrl = async () => assert.fail("unregistered media must never receive a signature");
  await assert.rejects(service.getMediaAccess({ url: upload.url }), (error) => error.status === 404);
  objects.set(upload.objectKey, png);
  await service.submitCase({
    submissionId: prepared.submissionId, data: { kind: "image", image: imageFile.localName }, assets: [asset(upload)],
  });
  for (const url of [
    upload.url.replace("unit-bucket.", "foreign-bucket."),
    upload.url.replace("oss-cn-hangzhou", "oss-cn-shanghai"),
    upload.url.replace("/jingjie/media/", "/other/media/"),
    upload.url.replace(/[^/]+$/, "ffffffff-ffff-4fff-8fff-ffffffffffff.png"),
  ]) await assert.rejects(service.getMediaAccess({ url }), (error) => error.status === 404);
  for (const url of [
    upload.uploadUrl, `${upload.url}?Signature=expired`, `${upload.url}#preview`,
    `/media/${upload.url.split("/").at(-1)}`, "https://unrelated.example/image.png", "not-a-url", null,
  ]) await assert.rejects(service.getMediaAccess({ url }), (error) => error.status === 400);
  await provider.update((document) => { delete document.media[0].storage; });
  await assert.rejects(service.getMediaAccess({ url: upload.url }), (error) => error.status === 404);
});

test("video, cover, shot frames and cast portraits persist the final unsigned OSS references", async (t) => {
  const { service, repository, objects } = await fixture(t);
  const files = [videoFile, imageFile, ...["frames/S01a.png", "frames/S01b.png", "cast/P1.png"].map((localName) => ({ ...imageFile, localName }))];
  const prepared = await service.prepareUpload({ requestId: "all-video-media", files });
  for (const upload of prepared.uploads) objects.set(upload.objectKey, upload.kind === "video" ? mp4 : png);
  const data = structuredClone(source);
  data.image = imageFile.localName;
  data.cast[0].image = "cast/P1.png";
  data.shots[0].image = "frames/S01a.png";
  data.shots[0].endImage = "frames/S01b.png";
  const result = await service.submitCase({ submissionId: prepared.submissionId, data, assets: prepared.uploads.map(asset) });
  const { draft } = await repository.getRecord(result.caseId);
  const byName = new Map(prepared.uploads.map((upload) => [upload.localName, upload.url]));
  assert.equal(draft.image, byName.get(imageFile.localName));
  assert.equal(draft.video.src, byName.get(videoFile.localName));
  assert.equal(draft.video.shots[0].image, byName.get("frames/S01a.png"));
  assert.equal(draft.video.shots[0].endImage, byName.get("frames/S01b.png"));
  assert.equal(draft.video.cast[0].image, byName.get("cast/P1.png"));
  assert.doesNotMatch(JSON.stringify(draft), /Signature=|uploadUrl|"\/media\//i);
});

test("omitted files remain explicit missing material and can be saved in an incomplete video draft", async (t) => {
  const { service, repository, objects, provider } = await fixture(t);
  const prepared = await service.prepareUpload({ requestId: "missing-frame", files: [videoFile, { ...imageFile, localName: "frames/S01a.png" }] });
  const video = prepared.uploads.find((upload) => upload.kind === "video");
  objects.set(video.objectKey, mp4);
  const result = await service.submitCase({ submissionId: prepared.submissionId, data: source, assets: [asset(video)] });
  assert.equal(result.status, "draft");
  assert.ok(result.warnings.some((warning) => /frames\/S01a\.png|缺|未上传/.test(warning)));
  assert.equal(result.mediaCount, 1);
  assert.equal(result.shotCount, 1);
  const record = await repository.getRecord(result.caseId);
  assert.equal(record.draft.video.src, video.url);
  assert.equal(record.draft.video.shots[0].image, "");
  assert.equal(record.draft.video.shots[0].endImage, undefined);
  assert.equal(record.draft.video.shots[0].review, undefined);
  assert.equal((await provider.read()).media.length, 1);
  assert.equal((await provider.read()).submissions[0].source.data.shots[0].review.frame.confirmed, true);
});

test("referenced assets with a mismatched actual size or actual format cannot commit any draft or media", async (t) => {
  const { service, repository, provider, objects } = await fixture(t);
  for (const [requestId, bytes, status] of [
    ["wrong-size", Buffer.concat([png, Buffer.from([0])]), 409],
    ["wrong-format", Buffer.from("ffd8ff000000000000000000", "hex"), 415],
  ]) {
    const prepared = await service.prepareUpload({ requestId, files: [imageFile] });
    const upload = prepared.uploads[0];
    objects.set(upload.objectKey, bytes);
    await assert.rejects(service.submitCase({ submissionId: prepared.submissionId, data: { kind: "image", image: imageFile.localName }, assets: [asset(upload)] }), (error) => error.status === status);
    assert.equal((await repository.getSubmission(prepared.submissionId)).status, "prepared");
  }
  assert.deepEqual(await repository.listRecords(), []);
  assert.deepEqual((await provider.read()).media, []);
});

test("submissions cannot replace an issued asset URL or object key with arbitrary remote material", async (t) => {
  const { service, repository, objects } = await fixture(t);
  const prepared = await service.prepareUpload({ requestId: "bound-assets", files: [imageFile] });
  const upload = prepared.uploads[0];
  objects.set(upload.objectKey, png);
  const data = { kind: "image", image: imageFile.localName };
  for (const supplied of [
    { ...asset(upload), url: "https://unrelated.example/foreign.png" },
    { ...asset(upload), url: upload.uploadUrl },
    { ...asset(upload), url: `${upload.url}?Signature=expired-upload` },
    { ...asset(upload), url: `/media/${upload.url.split("/").at(-1)}` },
    { ...asset(upload), objectKey: "other/uploads/foreign.png" },
    { ...asset(upload), assetId: "unknown-asset" },
  ]) await assert.rejects(service.submitCase({ submissionId: prepared.submissionId, data, assets: [supplied] }));
  assert.deepEqual(await repository.listRecords(), []);
});

test("submission and asset status survives repository restart, and a successful retry never creates another case", async (t) => {
  const state = await fixture(t);
  const prepared = await state.service.prepareUpload({ requestId: "recover-import", files: [imageFile, videoFile] });
  const firstRestart = state.open();
  const awaiting = await firstRestart.service.getSubmissionStatus({ submissionId: prepared.submissionId });
  assert.equal(awaiting.status, "prepared");
  assert.ok(awaiting.files.every((file) => file.status === "awaiting_upload"));
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
  assert.equal((await secondRestart.repository.listRecords()).length, 1);
  await assert.rejects(secondRestart.service.submitCase({ submissionId: prepared.submissionId, data: { ...data, title: "尝试覆盖" }, assets: prepared.uploads.map(asset) }), (error) => error.status === 409);
  assert.equal((await secondRestart.repository.getRecord(result.caseId)).draft.title, data.title);
  const stored = await readFile(path.join(state.directory, "submissions.json"), "utf8");
  assert.doesNotMatch(stored, /Signature=|uploadUrl|AccessKeySecret/i);
});

test("unknown submissions fail clearly and invalid uploaded files are visible in status", async (t) => {
  const { service, objects } = await fixture(t);
  await assert.rejects(service.getSubmissionStatus({ submissionId: "unknown-submission" }), (error) => error.status === 404);
  const prepared = await service.prepareUpload({ requestId: "invalid-upload-status", files: [imageFile] });
  objects.set(prepared.uploads[0].objectKey, Buffer.alloc(imageFile.size));
  const status = await service.getSubmissionStatus({ submissionId: prepared.submissionId });
  assert.equal(status.files[0].status, "invalid");
  assert.ok(status.files[0].message);
});

test("temporary OSS failures remain recoverable without telling the client to replace a submission", async (t) => {
  const { service, provider } = await fixture(t);
  const prepared = await service.prepareUpload({ requestId: "temporary-oss-failure", files: [imageFile] });
  provider.inspectUploadedObject = async () => { throw Object.assign(new Error("upstream failure with private configuration"), { status: 503 }); };
  const status = await service.getSubmissionStatus({ submissionId: prepared.submissionId });
  assert.equal(status.files[0].status, "unavailable");
  assert.doesNotMatch(status.files[0].message, /private configuration/);
  assert.match(status.instructions, /unavailable.*保留/);
  assert.equal(status.submissionId, prepared.submissionId);
});

test("a failed persistence transaction leaves the submission prepared and can be retried without a partial draft", async (t) => {
  const { service, repository, provider, objects } = await fixture(t);
  const prepared = await service.prepareUpload({ requestId: "transaction-retry", files: [imageFile] });
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
  assert.deepEqual((await provider.read()).media, []);
  const result = await service.submitCase(input);
  assert.equal(result.status, "draft");
  assert.equal((await repository.listRecords()).length, 1);
  assert.equal((await provider.read()).media.length, 1);
});
