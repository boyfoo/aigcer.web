import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { OssMediaStorage } from "../src/server/storage/oss.js";
import { JsonDataProvider } from "../src/server/storage/json.js";
import { createInitialDocument, createRepository } from "../src/server/repository.js";
import { isOssMediaUrl, mapMediaUrls, mediaNameFromUrl } from "../src/lib/mediaUrls.js";

const env = {
  JINGJIE_OSS_BUCKET: "jingjie-test", JINGJIE_OSS_REGION: "cn-hangzhou",
  JINGJIE_OSS_ACCESS_KEY_ID: "test-access-key", JINGJIE_OSS_ACCESS_KEY_SECRET: "secret-must-stay-server-side",
  JINGJIE_OSS_UPLOAD_TTL_SECONDS: "300", JINGJIE_OSS_PREFIX: "jingjie",
};
const name = "12345678-1234-1234-1234-123456789def.png";
const key = `jingjie/media/${name}`;
const mediaReference = (mediaName) => `https://${env.JINGJIE_OSS_BUCKET}.oss-${env.JINGJIE_OSS_REGION}.aliyuncs.com/jingjie/media/${mediaName}`;
const png = Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), Buffer.alloc(1100, 7)]);
const originalEtag = '"abcdef0123456789"';
const object = (bytes = png, mime = "image/png", etag = originalEtag) => ({ bytes, mime, etag });
const media = { name, mime: "image/png", size: png.length, originalName: "frame.png", storage: { provider: "oss", bucket: env.JINGJIE_OSS_BUCKET, key } };

function fixture() {
  const objects = new Map([[key, object()]]), calls = [];
  const missing = () => Object.assign(new Error("missing"), { status: 404, code: "NoSuchKey" });
  const sdk = {
    async signatureUrlV4(method, expiresSeconds, options, key) {
      assert.equal(method, "PUT");
      calls.push(["signatureUrlV4", method, expiresSeconds, options, key]);
      const signature = calls.filter(([operation]) => operation === "signatureUrlV4").length;
      return `https://jingjie-test.oss-cn-hangzhou.aliyuncs.com/${key}?x-oss-expires=${expiresSeconds}&signature=${signature}-${method}`;
    },
    async head(key) {
      calls.push(["head", key]);
      const entry = objects.get(key);
      if (!entry) throw missing();
      return { res: { headers: { "content-length": String(entry.bytes.length), "content-type": entry.mime, etag: entry.etag } } };
    },
    async getStream(key) {
      calls.push(["getStream", key]);
      const entry = objects.get(key);
      if (!entry) throw missing();
      return { stream: Readable.from([entry.bytes]) };
    },
    async delete(key) { calls.push(["delete", key]); objects.delete(key); },
  };
  return { objects, calls, sdk, storage: new OssMediaStorage({ env, clientFactory: () => sdk }) };
}

async function temporaryDirectory(t) {
  const directory = await mkdtemp(path.join(tmpdir(), "jingjie-oss-test-"));
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(tmpdir()));
    assert.ok(path.basename(directory).startsWith("jingjie-oss-test-"));
    await rm(directory, { recursive: true, force: true });
  });
  return directory;
}

const chunks = (bytes) => (async function* () { yield bytes.subarray(0, 1024); yield bytes.subarray(1024); })();

test("OSS media parsing accepts canonical and signed object URLs while rejecting unsafe authorities and filenames", () => {
  const canonical = mediaReference(name), signed = `${canonical}?x-oss-signature=expired&x-oss-expires=60`;
  for (const url of [canonical, signed]) {
    assert.equal(isOssMediaUrl(url), true);
    assert.equal(mediaNameFromUrl(url), name);
  }
  assert.equal(mediaNameFromUrl(`/media/${name}`), name);
  for (const url of [canonical.replace("https:", "http:"), canonical.replace("https://", "https://user:pass@"), canonical.replace(".com/", ".com:444/"), `https://example.com/media/${name}`, `${canonical}/another.png`, "/media/../outside.png", "/media/ordinary-name.png"]) {
    assert.equal(mediaNameFromUrl(url), null);
  }
});


test("media transformation covers record snapshots and all case media fields without rewriting prose or source data", () => {
  const original = mediaReference(name), replacement = `/media/${name}`;
  const item = {
    image: original, analysis: original, prompt: original,
    video: { src: original, shots: [{ image: original, endImage: original, narrative: original }], cast: [{ image: original, note: original }] },
  };
  const records = [{ draft: item, published: structuredClone(item), source: { image: original } }];
  const before = structuredClone(records);
  const transformed = mapMediaUrls(records, (url) => url === original ? replacement : url);
  assert.deepEqual(records, before);
  for (const snapshot of [transformed[0].draft, transformed[0].published]) {
    assert.deepEqual([snapshot.image, snapshot.video.src, snapshot.video.shots[0].image, snapshot.video.shots[0].endImage, snapshot.video.cast[0].image], Array(5).fill(replacement));
    assert.equal(snapshot.analysis, original);
    assert.equal(snapshot.prompt, original);
    assert.equal(snapshot.video.shots[0].narrative, original);
    assert.equal(snapshot.video.cast[0].note, original);
  }
  assert.equal(transformed[0].source.image, original);
});

test("OSS plans formal public object metadata and signs only its PUT upload", async () => {
  const storage = new OssMediaStorage({ env });
  assert.deepEqual(storage.getDirectUploadConfig(), { enabled: true, expiresSeconds: 300 });
  const planned = await storage.planMediaUpload({ name: "source.png", kind: "image", mime: "image/png", size: png.length });
  assert.match(planned.name, /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.png$/);
  assert.deepEqual(planned, { name: planned.name, mime: "image/png", size: png.length, originalName: "source.png", storage: { provider: "oss", bucket: env.JINGJIE_OSS_BUCKET, key: `jingjie/media/${planned.name}` } });
  const startedAt = Date.now();
  const result = await storage.presignMedia(planned);
  const finishedAt = Date.now();
  const put = new URL(result.uploadUrl);
  assert.equal(put.protocol, "https:");
  assert.equal(put.hostname, "jingjie-test.oss-cn-hangzhou.aliyuncs.com");
  assert.equal(put.pathname, `/${planned.storage.key}`);
  assert.equal(put.searchParams.get("x-oss-signature-version"), "OSS4-HMAC-SHA256");
  assert.equal(put.searchParams.get("x-oss-expires"), "300");
  assert.equal(put.searchParams.get("x-oss-additional-headers"), null);
  assert.equal(result.headers["Content-Type"], "image/png");
  assert.ok(!Object.keys(result.headers).some((header) => header.toLowerCase() === "content-length"));
  assert.equal(result.headers["x-oss-forbid-overwrite"], "true");
  assert.equal(result.headers["x-oss-object-acl"], "public-read");
  assert.ok(Date.parse(result.uploadExpiresAt) >= startedAt + 300000);
  assert.ok(Date.parse(result.uploadExpiresAt) <= finishedAt + 300000);
  assert.deepEqual(Object.keys(result).sort(), ["headers", "kind", "mediaUrl", "name", "size", "uploadExpiresAt", "uploadUrl"]);
  assert.equal(result.mediaUrl, storage.getMediaReference(planned.storage));
  assert.equal(new URL(result.mediaUrl).search, "");
  assert.ok(!JSON.stringify(result).includes(env.JINGJIE_OSS_ACCESS_KEY_SECRET));
});

test("disabled, partial and invalid OSS settings fail explicitly without returning credentials", async () => {
  const disabled = new OssMediaStorage({ env: {} });
  assert.equal(disabled.getDirectUploadConfig().enabled, false);
  await assert.rejects(disabled.presignMedia(media), (error) => error.status === 503);
  assert.throws(() => new OssMediaStorage({ env: { JINGJIE_OSS_BUCKET: "jingjie-test" } }), /配置不完整/);
  assert.throws(() => new OssMediaStorage({ env: { ...env, JINGJIE_OSS_PREFIX: "../escape" } }), /配置无效/);
  assert.throws(() => new OssMediaStorage({ env: { ...env, JINGJIE_OSS_UPLOAD_TTL_SECONDS: "9000" } }), /配置无效/);
  await assert.rejects(new OssMediaStorage({ env }).presignMedia({ ...media, storage: { ...media.storage, bucket: "another-bucket" } }), (error) => error.status === 503);
});

test("PUT lifetime accepts its bounds and rejects invalid upload settings", async () => {
  for (const seconds of [60, 600, 3600]) {
    const storage = new OssMediaStorage({ env: { ...env, JINGJIE_OSS_UPLOAD_TTL_SECONDS: String(seconds) } });
    const result = await storage.presignMedia(media);
    assert.equal(new URL(result.uploadUrl).searchParams.get("x-oss-expires"), String(seconds));
    assert.equal(storage.getDirectUploadConfig().expiresSeconds, seconds);
    assert.equal(new URL(result.mediaUrl).search, "");
  }
  for (const seconds of ["59", "3601", "1.5", "invalid"]) {
    assert.throws(() => new OssMediaStorage({ env: { ...env, JINGJIE_OSS_UPLOAD_TTL_SECONDS: seconds } }), (error) => error.status === 503);
  }
});


test("MCP object inspection checks formal object size and MIME with HEAD and never reads bytes", async () => {
  const { storage, objects, calls } = fixture();
  const input = { key, kind: "image", size: png.length, mime: "image/png" };
  const inspected = await storage.inspectMediaObject(input);
  assert.equal(inspected.size, png.length);
  assert.equal(inspected.mime, "image/png");
  assert.deepEqual(calls, [["head", key]]);
  for (const invalid of [
    { ...input, key: `jingjie/uploads/12345678/${name}` },
    { ...input, key: `other/media/${name}` },
    { ...input, key: `jingjie/media/../${name}` },
    { ...input, kind: "video" },
    { ...input, mime: "image/jpeg" },
  ]) await assert.rejects(storage.inspectMediaObject(invalid), (error) => error.status === 415);
  assert.deepEqual(calls, [["head", key]]);
  await assert.rejects(storage.inspectMediaObject({ ...input, size: png.length - 1 }), (error) => error.status === 409);
  objects.set(key, object(Buffer.alloc(png.length), "image/png"));
  assert.equal((await storage.inspectMediaObject(input)).size, png.length);
  objects.set(key, object(png, "image/jpeg"));
  await assert.rejects(storage.inspectMediaObject(input), (error) => error.status === 415);
  objects.delete(key);
  await assert.rejects(storage.inspectMediaObject(input), (error) => error.status === 404);
  assert.ok(calls.every(([operation]) => operation === "head"));
});

test("registered public OSS storage refuses backend byte reads while preserving Sites export and local media", async (t) => {
  const directory = await temporaryDirectory(t);
  const { storage, objects, calls } = fixture();
  const remote = media.storage;
  const provider = new JsonDataProvider({ directory, initialize: () => createInitialDocument([]), oss: storage });
  await provider.update((document) => document.media.push({ name, mime: "image/png", size: png.length, originalName: "frame.png", storage: remote }));
  assert.deepEqual(await provider.statMedia(name), { size: png.length });
  await assert.rejects(provider.openMedia(name, { start: 2, end: 9 }), (error) => error.status === 404);
  await provider.close();
  assert.equal(calls.some(([method]) => method === "getStream"), false);
  const destination = path.join(directory, "export", name);
  await provider.exportMedia(name, destination);
  assert.deepEqual(await readFile(destination), png);
  assert.deepEqual(await readdir(path.dirname(destination)), [name]);
  const localName = "abc-123.png", localBytes = Buffer.from("local media remains available");
  const localProvider = new JsonDataProvider({ directory, initialize: () => createInitialDocument([]), oss: new OssMediaStorage({ env: {} }) });
  assert.equal(await localProvider.writeMedia(localName, chunks(localBytes)), undefined);
  await localProvider.close();
  assert.deepEqual(await provider.statMedia(localName), { size: localBytes.length });
  assert.deepEqual(Buffer.from(await new Response(await provider.openMedia(localName)).arrayBuffer()), localBytes);
  await provider.removeMedia(name);
  assert.equal(objects.has(remote.key), false);
  assert.equal(await provider.statMedia(name), null);
  assert.deepEqual(await provider.statMedia(localName), { size: localBytes.length });
});

test("content save, read and publication keep public canonical media fields without signing", async (t) => {
  const directory = await temporaryDirectory(t);
  const { storage, sdk, calls } = fixture();
  storage.presignMedia = async () => assert.fail("content operations must not request upload or access signatures");
  sdk.signatureUrlV4 = async () => assert.fail("content operations must not call the SDK signer");
  const provider = new JsonDataProvider({ directory, initialize: () => createInitialDocument([]), oss: storage });
  const repository = createRepository({ provider });
  const videoName = "abc-123.mp4", localName = "abc-456.png";
  await provider.update((document) => {
    for (const [mediaName, mime] of [[name, "image/png"], [videoName, "video/mp4"]]) {
      document.media.push({ name: mediaName, mime, size: png.length, originalName: mediaName, storage: { provider: "oss", bucket: env.JINGJIE_OSS_BUCKET, key: `jingjie/media/${mediaName}` } });
    }
    document.media.push({ name: localName, mime: "image/png", size: png.length, originalName: localName });
  });
  const signedImage = `${mediaReference(name)}?x-oss-signature=old-image&x-oss-expires=60`;
  const signedVideo = `${mediaReference(videoName)}?Signature=old-video&Expires=1`;
  const external = "https://another-bucket.oss-cn-hangzhou.aliyuncs.com/photo.jpg?x-oss-signature=external&size=large";
  const draft = {
    kind: "视频", title: "真实 OSS 地址", image: signedImage, analysis: `保留文字中的 /media/${name}`,
    video: {
      src: signedVideo, durationSeconds: 10,
      shots: [{ id: "s01", start: 0, end: 10, image: signedImage, endImage: `/media/${name}` }],
      cast: [{ id: "person-a", name: "人物 A", image: signedImage }, { id: "person-b", name: "外部人物", image: external }, { id: "person-c", name: "本地人物", image: `/media/${localName}` }],
    },
  };
  const saved = await repository.change({ action: "save", draft });
  const expected = [mediaReference(name), mediaReference(videoName), mediaReference(name), mediaReference(name), mediaReference(name)];
  const mediaFields = (item) => [item.image, item.video.src, item.video.shots[0].image, item.video.shots[0].endImage, item.video.cast[0].image];
  assert.deepEqual(mediaFields(saved.draft), expected);
  assert.equal(saved.draft.video.cast[1].image, external);
  assert.equal(saved.draft.video.cast[2].image, `/media/${localName}`);
  assert.equal(saved.draft.analysis, draft.analysis);
  const published = await repository.change({ action: "publish", id: saved.id, revision: saved.revision, draft: saved.draft });
  assert.equal(published.hasChanges, false);
  const stored = await readFile(path.join(directory, "content", `${saved.id}.json`), "utf8");
  const detail = JSON.parse(stored);
  assert.deepEqual(mediaFields(detail.draft), expected);
  assert.deepEqual(mediaFields(detail.published), expected);
  assert.doesNotMatch(JSON.stringify(mediaFields(detail.draft)), /signature|x-oss-/i);

  const canonicalRecords = await repository.listRecords();
  const reread = await repository.getRecord(saved.id);
  const publicSnapshot = await repository.getPublished(saved.id);
  const publicList = await repository.listPublished();
  assert.deepEqual(mediaFields(reread.draft), expected);
  assert.deepEqual(mediaFields(publicSnapshot), expected);
  assert.deepEqual(mediaFields(publicList[0]), expected);
  assert.deepEqual(mediaFields(canonicalRecords[0].draft), expected);
  for (const url of mediaFields(publicSnapshot)) assert.equal(new URL(url).search, "");
  assert.equal(reread.draft.video.cast[1].image, external);
  assert.equal(reread.draft.video.cast[2].image, `/media/${localName}`);
  assert.equal(reread.hasChanges, false);
  assert.equal(await readFile(path.join(directory, "content", `${saved.id}.json`), "utf8"), stored);

  const staticRecords = await repository.resolveStaticMedia(canonicalRecords);
  assert.deepEqual(mediaFields(staticRecords[0].draft), [`/media/${name}`, `/media/${videoName}`, `/media/${name}`, `/media/${name}`, `/media/${name}`]);
  assert.equal(staticRecords[0].draft.video.cast[1].image, external);
  assert.deepEqual(mediaFields(canonicalRecords[0].draft), expected);
  const savedAgain = await repository.change({ action: "save", id: reread.id, revision: reread.revision, draft: reread.draft });
  assert.equal(savedAgain.hasChanges, false);
  assert.deepEqual(mediaFields(savedAgain.draft), expected);
  const document = await provider.read();
  assert.deepEqual(mediaFields(document.content[0].draft), expected);
  assert.deepEqual(mediaFields(document.content[0].published), expected);
  assert.deepEqual(calls, []);
});

test("registered legacy OSS references migrate both draft and published snapshots on read without changing publication state", async (t) => {
  const directory = await temporaryDirectory(t);
  const { storage, calls } = fixture();
  const provider = new JsonDataProvider({ directory, initialize: () => createInitialDocument([]), oss: storage });
  const repository = createRepository({ provider });
  const remote = { provider: "oss", bucket: env.JINGJIE_OSS_BUCKET, key: `jingjie/media/${name}` };
  await repository.addMedia({ name, mime: "image/png", size: png.length, originalName: "remote.png", storage: remote });
  const saved = await repository.change({ action: "publish", draft: { kind: "分镜", title: "旧引用迁移", image: mediaReference(name), analysis: "迁移只更新素材字段。" } });
  const detailPath = path.join(directory, "content", `${saved.id}.json`);
  const detail = JSON.parse(await readFile(detailPath, "utf8"));
  detail.draft.image = `/media/${name}`;
  detail.published.image = `${mediaReference(name)}?x-oss-signature-version=OSS4-HMAC-SHA256&x-oss-signature=expired&x-oss-expires=60`;
  await writeFile(detailPath, JSON.stringify(detail, null, 2) + "\n");
  const before = await readFile(path.join(directory, "content.json"), "utf8");
  const row = (await provider.read()).content.find((item) => item.id === saved.id);
  assert.equal(row.draft.image, mediaReference(name));
  assert.equal(row.published.image, mediaReference(name));
  assert.equal(row.status, "published");
  assert.equal(row.revision, saved.revision);
  assert.equal(row.updatedAt, saved.updatedAt);
  assert.equal(row.publishedAt, saved.publishedAt);
  const migrated = JSON.parse(await readFile(detailPath, "utf8"));
  assert.equal(migrated.draft.image, mediaReference(name));
  assert.equal(migrated.published.image, mediaReference(name));
  assert.equal(await readFile(path.join(directory, "content.json"), "utf8"), before);
  assert.equal((await repository.getRecord(saved.id)).hasChanges, false);
  assert.equal(calls.some(([operation]) => operation === "signatureUrlV4"), false);
});

test("without OSS configuration registered local references remain intact and planned references use the configured OSS namespace", async (t) => {
  const directory = await temporaryDirectory(t);
  const document = createInitialDocument([{ id: "existing-case", kind: "分镜", title: "待配置 OSS", image: `/media/${name}`, analysis: "保留已有资料。" }]);
  document.media.push({ name, mime: "image/png", size: png.length, originalName: "remote.png", storage: { provider: "oss", bucket: env.JINGJIE_OSS_BUCKET, key: `jingjie/media/${name}` } });
  const provider = new JsonDataProvider({ directory, initialize: () => document, oss: new OssMediaStorage({ env: {} }) });
  assert.equal((await provider.read()).content[0].draft.image, `/media/${name}`);
  assert.equal(JSON.parse(await readFile(path.join(directory, "content", "existing-case.json"), "utf8")).published.image, `/media/${name}`);
  const configured = new JsonDataProvider({ directory, initialize: () => createInitialDocument([]), oss: fixture().storage });
  assert.equal(await configured.getPlannedMediaReference(name), mediaReference(name));
  assert.equal((await configured.read()).content[0].draft.image, mediaReference(name));
  assert.equal((await configured.resolveMediaReference(mediaReference(name))).name, name);
  assert.equal((await configured.resolveMediaReference(`${mediaReference(name)}?x-oss-signature=expired`)).name, name);
  assert.equal(await configured.resolveMediaReference(`https://another-bucket.oss-cn-hangzhou.aliyuncs.com/jingjie/media/${name}`), null);
  assert.equal(await configured.resolveMediaReference(mediaReference("abc-456.png")), null);
});

test("the provider reuses registered OSS upload metadata and rejects local or unknown objects before signing", async (t) => {
  const directory = await temporaryDirectory(t);
  const { storage, calls } = fixture();
  const provider = new JsonDataProvider({ directory, initialize: () => createInitialDocument([]), oss: storage });
  const localName = "abc-123.png";
  await provider.update((document) => {
    document.media.push(media);
    document.media.push({ name: localName, mime: "image/png", size: png.length, originalName: "local.png" });
  });
  const upload = { name: media.originalName, kind: "image", mime: media.mime, size: media.size, mediaUrl: mediaReference(name) };
  const signedBatch = await provider.presignMedia({ uploads: [upload] });
  assert.deepEqual(Object.keys(signedBatch), ["uploads"]);
  const signed = signedBatch.uploads[0];
  assert.equal(signed.mediaUrl, mediaReference(name));
  assert.equal(new URL(signed.uploadUrl).pathname, "/" + key);
  assert.deepEqual(calls, [["signatureUrlV4", "PUT", 300, { headers: {
    "Content-Type": "image/png", "x-oss-forbid-overwrite": "true", "x-oss-object-acl": "public-read",
  } }, key]]);
  for (const url of ["/media/" + localName, mediaReference("abc-456.png")]) {
    await assert.rejects(provider.presignMedia({ uploads: [{ ...upload, mediaUrl: url }] }), (error) => error.status === 404);
  }
  assert.equal(calls.length, 1);
  assert.equal((await provider.read()).media.length, 2);
});

test("OSS signing failures surface as 503 without leaking SDK diagnostics or reading bytes", async () => {
  const { storage, sdk, calls } = fixture();
  sdk.signatureUrlV4 = async () => { throw new Error("private SDK signing diagnostic"); };
  await assert.rejects(storage.presignMedia(media), (error) => {
    assert.equal(error.status, 503);
    assert.match(error.message, /OSS/);
    assert.doesNotMatch(error.message, /private SDK signing diagnostic/);
    return true;
  });
  assert.deepEqual(calls, []);
});
