import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { presignMedia } from "../src/server/media.js";
import { createInitialDocument } from "../src/server/repository.js";
import { JsonDataProvider } from "../src/server/storage/json.js";
import { OssMediaStorage } from "../src/server/storage/oss.js";
import { MEDIA_LIMITS } from "../src/lib/mediaFormats.js";

const env = {
  JINGJIE_OSS_BUCKET: "batch-test", JINGJIE_OSS_REGION: "cn-hangzhou",
  JINGJIE_OSS_ACCESS_KEY_ID: "batch-test-key", JINGJIE_OSS_ACCESS_KEY_SECRET: "batch-secret-stays-on-server",
  JINGJIE_OSS_PREFIX: "jingjie", JINGJIE_OSS_UPLOAD_TTL_SECONDS: "300",
};
const image = { name: "cover.png", kind: "image", mime: "image/png", size: 1108 };
const video = { name: "video.mp4", kind: "video", mime: "video/mp4", size: 4096 };
const reference = (name) => `https://batch-test.oss-cn-hangzhou.aliyuncs.com/jingjie/media/${name}`;
const clientError = (error) => error.status >= 400 && error.status < 500;

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), "jingjie-batch-presign-"));
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(tmpdir()));
    assert.ok(path.basename(directory).startsWith("jingjie-batch-presign-"));
    await rm(directory, { recursive: true, force: true });
  });
  const calls = [];
  let signatures = 0;
  const sdk = {
    async signatureUrlV4(method, expires, options, key, additionalHeaders) {
      calls.push({ operation: "signature", method, expires, options, key, additionalHeaders });
      const date = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
      const query = new URLSearchParams({ "x-oss-signature-version": "OSS4-HMAC-SHA256", "x-oss-date": date, "x-oss-expires": String(expires), "x-oss-signature": `signature-${++signatures}` });
      return `https://batch-test.oss-cn-hangzhou.aliyuncs.com/${key}?${query}`;
    },
  };
  for (const operation of ["head", "get", "copy", "put", "putStream", "getStream", "delete"]) {
    sdk[operation] = async () => {
      calls.push({ operation });
      throw new Error(`Batch signing must not call OSS ${operation}`);
    };
  }
  const storage = new OssMediaStorage({ env, clientFactory: () => sdk });
  const provider = new JsonDataProvider({ directory, initialize: () => createInitialDocument([]), oss: storage });
  const sign = (body) => presignMedia(body, { provider });
  return { directory, calls, sdk, storage, provider, sign };
}

test("planning uploads generates formal metadata without signing or registering it", async (t) => {
  const { provider, calls, directory } = await fixture(t);
  await provider.read();
  const before = await readFile(path.join(directory, "media.json"), "utf8");
  const planned = await provider.planMediaUploads([image, video]);
  assert.equal(planned.length, 2);
  assert.notEqual(planned[0].name, planned[1].name);
  for (const [index, media] of planned.entries()) {
    const file = [image, video][index];
    assert.deepEqual(media, { name: media.name, mime: file.mime, size: file.size, originalName: file.name, storage: { provider: "oss", bucket: env.JINGJIE_OSS_BUCKET, key: `jingjie/media/${media.name}` } });
  }
  assert.deepEqual(calls, []);
  assert.equal(await readFile(path.join(directory, "media.json"), "utf8"), before);
});

test("a single batch signs only PUT for public objects and registers metadata before any byte upload", async (t) => {
  const state = await fixture(t);
  const result = await state.sign({ uploads: [image, video] });
  assert.deepEqual(Object.keys(result), ["uploads"]);
  assert.equal(result.uploads.length, 2);
  const document = await state.provider.read();
  assert.equal(document.media.length, 2);
  for (const [index, upload] of result.uploads.entries()) {
    const file = [image, video][index];
    assert.deepEqual({ name: upload.name, kind: upload.kind, size: upload.size }, { name: file.name, kind: file.kind, size: file.size });
    const put = new URL(upload.uploadUrl), canonical = new URL(upload.mediaUrl);
    assert.equal(put.pathname, canonical.pathname);
    assert.match(canonical.pathname, /^\/jingjie\/media\/[a-f0-9-]+\.(png|mp4)$/);
    assert.equal(canonical.search, "");
    assert.equal(put.searchParams.get("x-oss-expires"), "300");
    assert.equal(upload.url, undefined);
    assert.equal(upload.expiresAt, undefined);
    assert.ok(Date.parse(upload.uploadExpiresAt) > Date.now());
    assert.equal(upload.headers["Content-Type"], file.mime);
    assert.equal(upload.headers["x-oss-object-acl"], "public-read");
    assert.equal(upload.headers["x-oss-forbid-overwrite"], "true");
    assert.ok(!Object.keys(upload.headers).some((key) => key.toLowerCase() === "content-length"));
    const media = document.media.find((item) => item.name === canonical.pathname.split("/").at(-1));
    assert.deepEqual(media, { name: media.name, mime: file.mime, size: file.size, originalName: file.name, storage: { provider: "oss", bucket: env.JINGJIE_OSS_BUCKET, key: canonical.pathname.slice(1) } });
  }
  assert.equal(state.calls.length, 2);
  assert.ok(state.calls.every((call) => call.operation === "signature"));
  assert.deepEqual(state.calls.map((call) => call.method), ["PUT", "PUT"]);
  assert.ok(state.calls.every((call) => !(call.additionalHeaders ?? []).includes("content-length")));
  assert.doesNotMatch(JSON.stringify(result), new RegExp(env.JINGJIE_OSS_ACCESS_KEY_SECRET));
  assert.deepEqual(document.content, []);
  assert.deepEqual(document.submissions, []);
  assert.doesNotMatch(await readFile(path.join(state.directory, "media.json"), "utf8"), /signature|expiresAt|uploadUrl|uploadToken/i);
  assert.ok(!(await readdir(state.directory)).some((name) => /upload|ticket/.test(name)));
});

test("batch shape, count and upload metadata are all validated before signing or registration", async (t) => {
  const state = await fixture(t);
  const invalidBodies = [
    null, [], {}, { uploads: [] }, { urls: [] }, { uploads: {} }, { urls: "invalid" },
    { uploads: Array(253).fill(image) },
    { uploads: Array(252).fill(image), urls: [reference("abc-123.png")] },
    { uploadToken: "obsolete-confirmation-ticket" },
    ...[
      null, { ...image, name: "" }, { ...image, name: "a".repeat(301) }, { ...image, name: "invalid\n.png" },
      { ...image, kind: "unknown" }, { ...image, kind: "video" },
      { ...image, mime: "" }, { ...image, mime: "image/svg+xml" }, { ...image, mime: "constructor" },
      { ...image, size: 0 }, { ...image, size: 1.5 }, { ...image, size: MEDIA_LIMITS.image + 1 },
    ].map((invalid) => ({ uploads: [image, invalid] })),
  ];
  for (const body of invalidBodies) await assert.rejects(state.sign(body), clientError);
  assert.deepEqual(state.calls, []);
  assert.deepEqual((await state.provider.read()).media, []);
});

test("the maximum batch of 252 uploads is accepted and gets distinct registered objects", async (t) => {
  const state = await fixture(t);
  const files = Array.from({ length: 252 }, (_, index) => ({ ...image, name: `frame-${index}.png` }));
  const result = await state.sign({ uploads: files });
  assert.equal(result.uploads.length, 252);
  assert.equal(new Set(result.uploads.map((upload) => upload.mediaUrl)).size, 252);
  assert.equal((await state.provider.read()).media.length, 252);
  assert.equal(state.calls.length, 252);
  assert.ok(state.calls.every((call) => call.operation === "signature"));
});

test("unknown, local, foreign bucket and foreign key references abort the entire batch before signing", async (t) => {
  const state = await fixture(t);
  const name = "12345678-1234-1234-1234-123456789abc.png";
  for (const url of [
    null, 42, "not-a-url", reference(name), `/media/${name}`,
    `https://another-bucket.oss-cn-hangzhou.aliyuncs.com/jingjie/media/${name}`,
    `https://batch-test.oss-cn-hangzhou.aliyuncs.com/another-prefix/media/${name}`,
    reference(name).replace("https:", "http:"), reference(name).replace("https://", "https://user:pass@"),
  ]) {
    await assert.rejects(state.sign({ uploads: [image, { ...image, mediaUrl: url }] }), clientError);
  }
  assert.deepEqual(state.calls, []);
  assert.deepEqual((await state.provider.read()).media, []);
});

test("upload URL reuse requires matching registered metadata and never duplicates its entry", async (t) => {
  const state = await fixture(t);
  const { uploads: [first] } = await state.sign({ uploads: [image] });
  const reused = { ...image, mediaUrl: first.mediaUrl };
  const results = await Promise.all([state.sign({ uploads: [reused] }), state.sign({ uploads: [reused] })]);
  for (const result of results) {
    assert.equal(result.uploads[0].mediaUrl, first.mediaUrl);
    assert.equal(new URL(result.uploads[0].uploadUrl).pathname, new URL(first.uploadUrl).pathname);
  }
  assert.equal((await state.provider.read()).media.length, 1);
  state.calls.length = 0;
  for (const invalid of [
    { ...reused, name: "different.png" }, { ...reused, size: image.size + 1 },
    { ...reused, mime: "image/jpeg" }, { ...video, mediaUrl: first.mediaUrl },
    { ...reused, mediaUrl: reference("abc-456.png") },
    { ...reused, mediaUrl: first.mediaUrl.replace("batch-test.", "another-bucket.") },
  ]) await assert.rejects(state.sign({ uploads: [invalid] }), clientError);
  assert.deepEqual(state.calls, []);
  assert.equal((await state.provider.read()).media.length, 1);
});

test("a signing failure leaves every planned upload unregistered and exposes no SDK diagnostics", async (t) => {
  const state = await fixture(t);
  const signature = state.sdk.signatureUrlV4;
  let signing = 0;
  state.sdk.signatureUrlV4 = async (...args) => {
    if (++signing === 2) throw new Error("private signer diagnostic with credentials");
    return signature(...args);
  };
  await assert.rejects(state.sign({ uploads: [image, video] }), (error) => {
    assert.equal(error.status, 503);
    assert.doesNotMatch(error.message, /private signer diagnostic/);
    return true;
  });
  assert.deepEqual((await state.provider.read()).media, []);
  assert.ok(state.calls.every((call) => call.operation === "signature"));
});

test("registration failure rolls back the entire batch without touching registered metadata or OSS bytes", async (t) => {
  const state = await fixture(t);
  const { uploads: [existing] } = await state.sign({ uploads: [image] });
  const before = await readFile(path.join(state.directory, "media.json"), "utf8");
  const atomicWrite = state.provider.atomicWrite.bind(state.provider);
  let failure = true;
  state.provider.atomicWrite = async (name, text) => {
    if (failure && name === "media.json") { failure = false; throw new Error("simulated batch registration failure"); }
    return atomicWrite(name, text);
  };
  await assert.rejects(state.sign({ uploads: [image, video] }));
  assert.equal(await readFile(path.join(state.directory, "media.json"), "utf8"), before);
  assert.equal((await state.provider.read()).media.length, 1);
  assert.ok(state.calls.every((call) => call.operation === "signature"));
  const retried = await state.sign({ uploads: [image, video] });
  assert.equal(retried.uploads.length, 2);
  assert.equal((await state.provider.read()).media.length, 3);
});

test("concurrent registration of an identical planned object is atomically deduplicated", async (t) => {
  const state = await fixture(t);
  const [planned] = await state.provider.planMediaUploads([image]);
  state.provider.planMediaUploads = async () => [structuredClone(planned)];
  const results = await Promise.all([state.sign({ uploads: [image] }), state.sign({ uploads: [image] }), state.sign({ uploads: [image] })]);
  assert.ok(results.every((result) => result.uploads[0].mediaUrl === reference(planned.name)));
  assert.equal((await state.provider.read()).media.length, 1);
  assert.ok(state.calls.every((call) => call.operation === "signature"));
});

test("an atomic metadata conflict rolls back earlier additions in the same batch", async (t) => {
  const state = await fixture(t);
  const planned = await state.provider.planMediaUploads([image, video]);
  const existing = { ...planned[1], originalName: "existing-video.mp4" };
  await state.provider.update((document) => { document.media.push(existing); });
  const before = await readFile(path.join(state.directory, "media.json"), "utf8");
  state.provider.planMediaUploads = async () => structuredClone(planned);
  await assert.rejects(state.sign({ uploads: [image, video] }), (error) => error.status === 409);
  assert.deepEqual((await state.provider.read()).media, [existing]);
  assert.equal(await readFile(path.join(state.directory, "media.json"), "utf8"), before);
  assert.ok(state.calls.every((call) => call.operation === "signature"));
});
