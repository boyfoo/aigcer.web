import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import OSS from "ali-oss";
import { OssMediaStorage } from "../src/server/storage/oss.js";
import { JsonDataProvider } from "../src/server/storage/json.js";
import { createInitialDocument } from "../src/server/repository.js";

const env = {
  JINGJIE_OSS_BUCKET: "jingjie-test", JINGJIE_OSS_REGION: "cn-hangzhou",
  JINGJIE_OSS_ACCESS_KEY_ID: "test-access-key", JINGJIE_OSS_ACCESS_KEY_SECRET: "secret-must-stay-server-side",
  JINGJIE_OSS_UPLOAD_TTL_SECONDS: "300", JINGJIE_OSS_PREFIX: "jingjie",
};
const submissionId = "12345678-1234-1234-1234-123456789abc", name = "12345678-1234-1234-1234-123456789def.png";
const key = `jingjie/uploads/${submissionId}/${name}`;
const png = Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), Buffer.alloc(1100, 7)]);
const originalEtag = '"abcdef0123456789"';
const object = (bytes = png, mime = "image/png", etag = originalEtag) => ({ bytes, mime, etag });

function fixture() {
  const objects = new Map([[key, object()]]), calls = [];
  const missing = () => Object.assign(new Error("missing"), { status: 404, code: "NoSuchKey" });
  const sdk = {
    async head(key) {
      calls.push(["head", key]);
      const entry = objects.get(key);
      if (!entry) throw missing();
      return { res: { headers: { "content-length": String(entry.bytes.length), "content-type": entry.mime, etag: entry.etag } } };
    },
    async get(key, options) {
      calls.push(["get", key, options]);
      const entry = objects.get(key);
      if (!entry) throw missing();
      if (options.headers["If-Match"] !== entry.etag) throw Object.assign(new Error("changed"), { status: 412 });
      const range = /^bytes=(\d+)-(\d+)$/.exec(options.headers.Range);
      return { content: entry.bytes.subarray(Number(range[1]), Number(range[2]) + 1) };
    },
    async copy(target, source, options) {
      calls.push(["copy", target, source, options]);
      const entry = objects.get(source);
      if (!entry) throw missing();
      if (entry.etag !== options.headers["If-Match"]) throw Object.assign(new Error("changed"), { status: 412 });
      if (objects.has(target)) throw Object.assign(new Error("existing"), { status: 409 });
      objects.set(target, { ...entry, bytes: Buffer.from(entry.bytes) });
    },
    async getStream(key, options) {
      calls.push(["getStream", key, options]);
      const entry = objects.get(key);
      if (!entry) throw missing();
      const range = options?.headers?.Range && /^bytes=(\d+)-(\d+)$/.exec(options.headers.Range);
      return { stream: Readable.from([range ? entry.bytes.subarray(Number(range[1]), Number(range[2]) + 1) : entry.bytes]) };
    },
    async delete(key) { calls.push(["delete", key]); objects.delete(key); },
  };
  return { objects, calls, sdk, storage: new OssMediaStorage({ env, clientFactory: () => sdk }) };
}

test("OSS V4 upload URLs sign exact headers without disclosing the server secret", async () => {
  const storage = new OssMediaStorage({ env });
  assert.deepEqual(storage.getDirectUploadConfig(), { enabled: true, expiresSeconds: 300 });
  assert.equal(storage.makeUploadKey(submissionId, name), key);
  const result = await storage.createUploadUrl({ key, mime: "image/png", size: png.length });
  const url = new URL(result.uploadUrl);
  assert.equal(url.protocol, "https:");
  assert.equal(url.hostname, "jingjie-test.oss-cn-hangzhou.aliyuncs.com");
  assert.equal(url.pathname, `/${key}`);
  assert.equal(url.searchParams.get("x-oss-signature-version"), "OSS4-HMAC-SHA256");
  assert.equal(url.searchParams.get("x-oss-expires"), "300");
  assert.equal(url.searchParams.get("x-oss-additional-headers"), "content-length");
  assert.equal(result.headers["Content-Type"], "image/png");
  assert.equal(result.headers["Content-Length"], String(png.length));
  assert.equal(result.headers["x-oss-forbid-overwrite"], "true");
  assert.equal(result.headers["x-oss-object-acl"], "private");
  assert.ok(Date.parse(result.expiresAt) > Date.now());
  assert.ok(!JSON.stringify(result).includes(env.JINGJIE_OSS_ACCESS_KEY_SECRET));
  await assert.rejects(storage.createUploadUrl({ key: `jingjie/media/${name}`, mime: "image/png", size: 1 }), /上传目录/);
  await assert.rejects(storage.createUploadUrl({ key, mime: "image/jpeg", size: 1 }), (error) => error.status === 415);
  await assert.rejects(storage.createUploadUrl({ key, mime: "image/png", size: 21 * 1024 * 1024 }), (error) => error.status === 413);
  assert.throws(() => storage.makeUploadKey("../escape", name), /标识/);
});

test("disabled, partial and invalid OSS settings fail explicitly without returning credentials", async () => {
  const disabled = new OssMediaStorage({ env: {} });
  assert.equal(disabled.getDirectUploadConfig().enabled, false);
  await assert.rejects(disabled.createUploadUrl({ key, mime: "image/png", size: 1 }), (error) => error.status === 503);
  assert.throws(() => new OssMediaStorage({ env: { JINGJIE_OSS_BUCKET: "jingjie-test" } }), /配置不完整/);
  assert.throws(() => new OssMediaStorage({ env: { ...env, JINGJIE_OSS_PREFIX: "../escape" } }), /配置无效/);
  assert.throws(() => new OssMediaStorage({ env: { ...env, JINGJIE_OSS_UPLOAD_TTL_SECONDS: "9000" } }), /配置无效/);
});

test("uploaded objects require matching size and actual file signatures, not only Content-Type", async () => {
  const { storage, objects, calls } = fixture();
  const input = { key, kind: "image", size: png.length, mime: "image/png" };
  assert.deepEqual(await storage.inspectUploadedObject(input), { size: png.length, mime: "image/png", etag: originalEtag });
  const read = calls.find(([method]) => method === "get");
  assert.equal(read[2].headers.Range, "bytes=0-1023");
  assert.equal(read[2].headers["If-Match"], originalEtag);
  await assert.rejects(storage.inspectUploadedObject({ ...input, size: png.length - 1 }), (error) => error.status === 409);
  objects.set(key, object(Buffer.alloc(png.length), "image/png"));
  await assert.rejects(storage.inspectUploadedObject(input), (error) => error.status === 415);
  objects.set(key, object(png, "image/jpeg"));
  await assert.rejects(storage.inspectUploadedObject(input), (error) => error.status === 415);
  objects.delete(key);
  await assert.rejects(storage.inspectUploadedObject(input), (error) => error.status === 404);
});

test("promotion copies the verified ETag into a protected namespace and retries reuse only identical bytes", async () => {
  const { storage, objects, calls } = fixture();
  const input = { sourceKey: key, name, etag: originalEtag };
  const result = await storage.promoteUploadedObject(input);
  assert.deepEqual(result, { provider: "oss", bucket: "jingjie-test", key: `jingjie/media/${name}` });
  const copy = calls.find(([method]) => method === "copy");
  assert.equal(copy[3].headers["If-Match"], originalEtag);
  assert.equal(copy[3].headers["x-oss-forbid-overwrite"], "true");
  assert.equal(copy[3].headers["x-oss-object-acl"], "private");
  assert.deepEqual(await storage.promoteUploadedObject(input), result);
  assert.equal(calls.filter(([method]) => method === "copy").length, 1);
  objects.set(result.key, object(png, "image/png", '"deadbeef"'));
  await assert.rejects(storage.promoteUploadedObject(input), (error) => error.status === 409);
  objects.delete(result.key);
  objects.set(key, object(png, "image/png", '"c0ffee"'));
  await assert.rejects(storage.promoteUploadedObject(input), (error) => error.status === 409);
  assert.equal(objects.has(result.key), false);
  await assert.rejects(storage.promoteUploadedObject({ ...input, sourceKey: `jingjie/media/${name}` }), /上传目录/);
});

test("the installed SDK emits source ETag and target overwrite protection for CopyObject", async () => {
  let request;
  const client = new OSS({ region: "oss-cn-hangzhou", bucket: "jingjie-test", accessKeyId: "id", accessKeySecret: "secret", authorizationV4: true });
  client.request = async (params) => {
    request = params;
    return { data: { ETag: originalEtag }, res: {} };
  };
  await client.copy(`jingjie/media/${name}`, key, { headers: { "If-Match": originalEtag, "x-oss-forbid-overwrite": "true" } });
  assert.equal(request.method, "PUT");
  assert.equal(request.headers["x-oss-copy-source-if-match"], originalEtag);
  assert.equal(request.headers["x-oss-forbid-overwrite"], "true");
  assert.ok(request.headers["x-oss-copy-source"].includes(encodeURIComponent(key)));
});

test("registered private OSS media supports playback ranges, Sites export and local media together", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "jingjie-oss-test-"));
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(tmpdir()));
    assert.ok(path.basename(directory).startsWith("jingjie-oss-test-"));
    await rm(directory, { recursive: true, force: true });
  });
  const { storage, objects, calls } = fixture();
  const remote = await storage.promoteUploadedObject({ sourceKey: key, name, etag: originalEtag });
  const provider = new JsonDataProvider({ directory, initialize: () => createInitialDocument([]), oss: storage });
  await provider.update((document) => document.media.push({ name, mime: "image/png", size: png.length, originalName: "frame.png", storage: remote }));
  assert.deepEqual(await provider.statMedia(name), { size: png.length });
  const stream = await provider.openMedia(name, { start: 2, end: 9 });
  await provider.close();
  assert.deepEqual(Buffer.from(await new Response(stream).arrayBuffer()), png.subarray(2, 10));
  assert.equal(calls.find(([method]) => method === "getStream")[2].headers.Range, "bytes=2-9");
  const destination = path.join(directory, "export", name);
  await provider.exportMedia(name, destination);
  assert.deepEqual(await readFile(destination), png);
  assert.deepEqual(await readdir(path.dirname(destination)), [name]);
  const localName = "abc-123.png", localBytes = Buffer.from("local media remains available");
  await provider.writeMedia(localName, (async function* () { yield localBytes; })());
  assert.deepEqual(await provider.statMedia(localName), { size: localBytes.length });
  assert.deepEqual(Buffer.from(await new Response(await provider.openMedia(localName)).arrayBuffer()), localBytes);
  await provider.removeMedia(name);
  assert.equal(objects.has(remote.key), false);
  assert.equal(await provider.statMedia(name), null);
  assert.deepEqual(await provider.statMedia(localName), { size: localBytes.length });
});
