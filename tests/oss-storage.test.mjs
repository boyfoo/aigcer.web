import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import OSS from "ali-oss";
import { OssMediaStorage } from "../src/server/storage/oss.js";
import { JsonDataProvider } from "../src/server/storage/json.js";
import { ContentError, createInitialDocument, createRepository } from "../src/server/repository.js";
import { mediaAccess } from "../src/server/media.js";
import { isOssMediaUrl, mapMediaUrls, mediaNameFromUrl, ossAccessExpiresAt } from "../src/lib/mediaUrls.js";
import { requestMediaAccess, requestOfflineImage } from "../src/lib/contentClient.js";

const env = {
  JINGJIE_OSS_BUCKET: "jingjie-test", JINGJIE_OSS_REGION: "cn-hangzhou",
  JINGJIE_OSS_ACCESS_KEY_ID: "test-access-key", JINGJIE_OSS_ACCESS_KEY_SECRET: "secret-must-stay-server-side",
  JINGJIE_OSS_UPLOAD_TTL_SECONDS: "300", JINGJIE_OSS_PREFIX: "jingjie",
};
const submissionId = "12345678-1234-1234-1234-123456789abc", name = "12345678-1234-1234-1234-123456789def.png";
const key = `jingjie/uploads/${submissionId}/${name}`;
const mediaReference = (mediaName) => `https://${env.JINGJIE_OSS_BUCKET}.oss-${env.JINGJIE_OSS_REGION}.aliyuncs.com/jingjie/media/${mediaName}`;
const png = Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), Buffer.alloc(1100, 7)]);
const originalEtag = '"abcdef0123456789"';
const object = (bytes = png, mime = "image/png", etag = originalEtag) => ({ bytes, mime, etag });

function fixture() {
  const objects = new Map([[key, object()]]), calls = [];
  const missing = () => Object.assign(new Error("missing"), { status: 404, code: "NoSuchKey" });
  const sdk = {
    async signatureUrlV4(method, expiresSeconds, options, key) {
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

test("OSS access expiry parsing returns exact valid and expired timestamps for V4 and legacy signatures", () => {
  const canonical = mediaReference(name);
  const validV4 = `${canonical}?x-oss-signature=valid&x-oss-date=20801009T010203Z&x-oss-expires=3600`;
  const expiredV4 = `${canonical}?x-oss-signature=expired&x-oss-date=20000101T000000Z&x-oss-expires=3600`;
  assert.equal(ossAccessExpiresAt(validV4), "2080-10-09T02:02:03.000Z");
  assert.equal(ossAccessExpiresAt(expiredV4), "2000-01-01T01:00:00.000Z");
  assert.ok(Date.parse(ossAccessExpiresAt(validV4)) > Date.now());
  assert.ok(Date.parse(ossAccessExpiresAt(expiredV4)) < Date.now());
  for (const iso of ["2080-10-09T02:02:03.000Z", "2000-01-01T01:00:00.000Z"]) {
    const legacy = `${canonical}?Signature=legacy&Expires=${Date.parse(iso) / 1000}`;
    assert.equal(ossAccessExpiresAt(legacy), iso);
  }
});

test("OSS access expiry parsing rejects missing signatures, malformed dates and invalid or overflowing expiry values", () => {
  const canonical = mediaReference(name);
  const invalidQueries = [
    "", "x-oss-date=20261009T010203Z&x-oss-expires=3600", "x-oss-signature=&x-oss-date=20261009T010203Z&x-oss-expires=3600",
    "x-oss-signature=one&x-oss-expires=3600", "x-oss-signature=one&x-oss-date=20261009T010203Z",
    ...["0", "-1", "1.5", "NaN", "8640000000000", "999999999999999999"].map((expires) => `x-oss-signature=one&x-oss-date=20261009T010203Z&x-oss-expires=${expires}`),
    ...["20260230T010203Z", "20261309T010203Z", "20261009T250203Z", "20261009T010263Z", "2026-10-09T01:02:03Z"].map((date) => `x-oss-signature=one&x-oss-date=${date}&x-oss-expires=3600`),
    "Expires=123456", "Signature=&Expires=123456", "Signature=legacy", "Signature=legacy&Expires=-1", "Signature=legacy&Expires=1.5", "Signature=legacy&Expires=8640000000001", "Signature=legacy&Expires=9999999999999999",
  ];
  for (const query of invalidQueries) assert.equal(ossAccessExpiresAt(`${canonical}?${query}`), null, query);
  for (const value of [null, undefined, "/media/abc-123.png", "not-a-url", "https://example.com/photo.jpg?Signature=external&Expires=3495678900"]) {
    assert.equal(ossAccessExpiresAt(value), null);
  }
});

test("the client reuses unexpired OSS signatures and reads offline image bytes directly from OSS", async (t) => {
  const signed = `${mediaReference(name)}?x-oss-signature=valid&x-oss-date=20801009T010203Z&x-oss-expires=3600`;
  const controller = new AbortController(), requests = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    requests.push({ url, options });
    return new Response(png, { headers: { "Content-Type": "image/png" } });
  });
  assert.deepEqual(await requestMediaAccess(signed, controller.signal), { url: signed, mediaUrl: mediaReference(name), expiresAt: "2080-10-09T02:02:03.000Z" });
  assert.deepEqual(requests, []);
  const response = await requestOfflineImage(signed, controller.signal);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), png);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, signed);
  assert.equal(requests[0].options.signal, controller.signal);
});

test("unsigned and expired OSS image requests obtain only metadata before fetching OSS bytes", async (t) => {
  const canonical = mediaReference(name);
  const current = `${canonical}?x-oss-signature=current&x-oss-date=20801009T010203Z&x-oss-expires=3600`;
  for (const source of [canonical, `${canonical}?x-oss-signature=expired&x-oss-date=20000101T000000Z&x-oss-expires=3600`]) {
    await t.test(source === canonical ? "unsigned URL" : "expired URL", async (t) => {
      const requests = [];
      t.mock.method(globalThis, "fetch", async (url, options) => {
        requests.push({ url, options });
        if (url === "/api/media/access") return Response.json({ url: current, mediaUrl: canonical, expiresAt: "2080-10-09T02:02:03.000Z" });
        assert.equal(url, current);
        return new Response(png, { headers: { "Content-Type": "image/png" } });
      });
      const response = await requestOfflineImage(source);
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), png);
      assert.deepEqual(requests.map(({ url }) => url), ["/api/media/access", current]);
      assert.equal(requests[0].options.method, "POST");
      assert.deepEqual(JSON.parse(requests[0].options.body), { url: source });
      assert.equal(requests[0].options.cache, "no-store");
      assert.equal(requests[1].options.method, undefined);
    });
  }
});

test("local and external media keep their addresses and failed OSS reads do not fall back to a byte proxy", async (t) => {
  const canonical = mediaReference(name);
  const signed = `${canonical}?x-oss-signature=valid&x-oss-date=20801009T010203Z&x-oss-expires=3600`;
  const requests = [];
  t.mock.method(globalThis, "fetch", async (url) => {
    requests.push(url);
    return new Response("OSS read failed", { status: 403 });
  });
  for (const source of [`/media/${name}`, "https://example.com/photo.jpg?size=large", "https://oayun.oss-cn-shenzhen.aliyuncs.com/b/260901/public-video.mp4"]) {
    assert.deepEqual(await requestMediaAccess(source), { url: source, mediaUrl: source, expiresAt: null });
  }
  assert.deepEqual(requests, []);
  const response = await requestOfflineImage(signed);
  assert.equal(response.status, 403);
  assert.deepEqual(requests, [signed]);
});

test("media transformation covers record snapshots and all case media fields without rewriting prose or source data", () => {
  const original = mediaReference(name), replacement = `${original}?x-oss-signature=one-hour`;
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

test("private media access URLs sign GET and HEAD for one hour without revealing the server secret", async () => {
  const storage = new OssMediaStorage({ env });
  const remote = { provider: "oss", bucket: env.JINGJIE_OSS_BUCKET, key: `jingjie/media/${name}` };
  const startedAt = Date.now();
  const get = await storage.createMediaUrl(remote);
  const head = await storage.createMediaUrl(remote, "HEAD");
  for (const result of [get, head]) {
    const url = new URL(result.url);
    assert.equal(url.protocol, "https:");
    assert.equal(url.hostname, "jingjie-test.oss-cn-hangzhou.aliyuncs.com");
    assert.equal(url.pathname, `/${remote.key}`);
    assert.equal(url.searchParams.get("x-oss-signature-version"), "OSS4-HMAC-SHA256");
    assert.equal(url.searchParams.get("x-oss-expires"), "3600");
    assert.equal(url.searchParams.get("x-oss-additional-headers"), null);
    assert.ok(Date.parse(result.expiresAt) >= startedAt + 3600000);
    assert.ok(Date.parse(result.expiresAt) <= Date.now() + 3600000);
    assert.ok(Date.parse(ossAccessExpiresAt(result.url)) >= startedAt + 3599000);
    assert.ok(Math.abs(Date.parse(ossAccessExpiresAt(result.url)) - Date.parse(result.expiresAt)) < 1000);
    assert.doesNotMatch(JSON.stringify(result), new RegExp(env.JINGJIE_OSS_ACCESS_KEY_SECRET));
  }
  assert.notEqual(new URL(get.url).searchParams.get("x-oss-signature"), new URL(head.url).searchParams.get("x-oss-signature"));
});

test("media access TTL has explicit configuration bounds and is independent of upload TTL", async () => {
  const remote = { provider: "oss", bucket: env.JINGJIE_OSS_BUCKET, key: `jingjie/media/${name}` };
  for (const seconds of [60, 600, 86400]) {
    const storage = new OssMediaStorage({ env: { ...env, JINGJIE_OSS_ACCESS_TTL_SECONDS: String(seconds) } });
    assert.equal(new URL((await storage.createMediaUrl(remote)).url).searchParams.get("x-oss-expires"), String(seconds));
    assert.equal(storage.getDirectUploadConfig().expiresSeconds, 300);
  }
  for (const seconds of ["59", "86401", "1.5", "invalid"]) {
    assert.throws(() => new OssMediaStorage({ env: { ...env, JINGJIE_OSS_ACCESS_TTL_SECONDS: seconds } }), (error) => error.status === 503);
  }
  await assert.rejects(new OssMediaStorage({ env: {} }).createMediaUrl(remote), (error) => error.status === 503);
  await assert.rejects(new OssMediaStorage({ env }).createMediaUrl({ ...remote, bucket: "another-bucket" }), (error) => error.status === 503);
  await assert.rejects(new OssMediaStorage({ env }).createMediaUrl(remote, "PUT"), (error) => error.status === 405);
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

test("registered private OSS storage refuses backend byte reads while preserving Sites export and local media", async (t) => {
  const directory = await temporaryDirectory(t);
  const { storage, objects, calls } = fixture();
  const remote = await storage.promoteUploadedObject({ sourceKey: key, name, etag: originalEtag });
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

test("saving signed OSS media persists canonical addresses across cover, video, frames and cast", async (t) => {
  const directory = await temporaryDirectory(t);
  const { storage } = fixture();
  const provider = new JsonDataProvider({ directory, initialize: () => createInitialDocument([]), oss: storage });
  const repository = createRepository({ provider });
  const videoName = "abc-123.mp4", localName = "abc-456.png";
  await provider.update((document) => {
    for (const [mediaName, mime] of [[name, "image/png"], [videoName, "video/mp4"]]) {
      document.media.push({ name: mediaName, mime, size: png.length, originalName: mediaName, storage: { provider: "oss", bucket: env.JINGJIE_OSS_BUCKET, key: `jingjie/media/${mediaName}` } });
    }
    document.media.push({ name: localName, mime: "image/png", size: png.length, originalName: localName });
  });
  const signedImage = (await provider.createMediaUrl(name)).url;
  const signedVideo = (await provider.createMediaUrl(videoName)).url;
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
  const first = await repository.resolveMediaAccess(canonicalRecords);
  const second = await repository.resolveMediaAccess(canonicalRecords);
  assert.notEqual(first[0].draft.image, second[0].draft.image);
  assert.deepEqual(mediaFields(canonicalRecords[0].draft), expected);
  for (const signed of mediaFields(first[0].draft)) assert.ok(new URL(signed).searchParams.has("x-oss-expires"));
  assert.equal(first[0].draft.video.cast[1].image, external);
  assert.equal(first[0].draft.video.cast[2].image, `/media/${localName}`);
  assert.equal(first[0].hasChanges, false);
  assert.equal(await readFile(path.join(directory, "content", `${saved.id}.json`), "utf8"), stored);

  const staticRecords = await repository.resolveStaticMedia(canonicalRecords);
  assert.deepEqual(mediaFields(staticRecords[0].draft), [`/media/${name}`, `/media/${videoName}`, `/media/${name}`, `/media/${name}`, `/media/${name}`]);
  assert.equal(staticRecords[0].draft.video.cast[1].image, external);
  assert.deepEqual(mediaFields(canonicalRecords[0].draft), expected);
  const signedSaved = await repository.change({ action: "save", id: first[0].id, revision: first[0].revision, draft: first[0].draft });
  assert.equal(signedSaved.hasChanges, false);
  assert.deepEqual(mediaFields(signedSaved.draft), expected);
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

test("the media access endpoint refreshes registered canonical and signed OSS addresses without reading bytes", async (t) => {
  const directory = await temporaryDirectory(t);
  const { storage, calls } = fixture();
  const provider = new JsonDataProvider({ directory, initialize: () => createInitialDocument([]), oss: storage });
  const remote = { provider: "oss", bucket: env.JINGJIE_OSS_BUCKET, key: `jingjie/media/${name}` };
  await provider.update((document) => document.media.push({ name, mime: "image/png", size: png.length, originalName: "frame.png", storage: remote }));
  const request = new Request("http://localhost/api/media/access", { method: "POST" });
  const urls = [];
  for (const reference of [mediaReference(name), `${mediaReference(name)}?x-oss-signature=expired&x-oss-expires=60`]) {
    const response = await mediaAccess(request, { url: reference }, { provider });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    assert.equal(response.headers.get("Location"), null);
    const result = await response.json();
    assert.equal(result.mediaUrl, mediaReference(name));
    assert.equal(new URL(result.url).pathname, `/${remote.key}`);
    assert.equal(new URL(result.url).searchParams.get("x-oss-expires"), "3600");
    assert.ok(Date.parse(result.expiresAt) > Date.now());
    urls.push(result.url);
  }
  assert.notEqual(urls[0], urls[1]);
  assert.equal(calls.filter(([operation]) => operation === "signatureUrlV4").length, 2);
  assert.equal(calls.some(([operation]) => ["getStream", "head", "get"].includes(operation)), false);
  for (const reference of ["not-a-url", mediaReference("abc-456.png"), `https://another-bucket.oss-cn-hangzhou.aliyuncs.com/jingjie/media/${name}`, `https://jingjie-test.oss-cn-hangzhou.aliyuncs.com/another-prefix/media/${name}`]) {
    await assert.rejects(mediaAccess(request, { url: reference }, { provider }), (error) => error.status === 404);
  }
  assert.equal(calls.filter(([operation]) => operation === "signatureUrlV4").length, 2);
  assert.doesNotMatch(await readFile(path.join(directory, "media.json"), "utf8"), /signature|expiresAt|x-oss-/i);
});

test("the media access endpoint rejects download parameters without reading or signing media", async (t) => {
  const directory = await temporaryDirectory(t);
  const { storage, calls } = fixture();
  const provider = new JsonDataProvider({ directory, initialize: () => createInitialDocument([]), oss: storage });
  const request = new Request("http://localhost/api/media/access", { method: "POST" });
  for (const download of ["offline-report", "download", null, true]) {
    await assert.rejects(mediaAccess(request, { url: mediaReference(name), download }, { provider }), (error) => error.status === 400);
  }
  assert.deepEqual(calls, []);
});
test("the provider signs registered OSS media and keeps local media on the local read path", async (t) => {
  const directory = await temporaryDirectory(t);
  const { storage, calls } = fixture();
  const provider = new JsonDataProvider({ directory, initialize: () => createInitialDocument([]), oss: storage });
  const remote = { provider: "oss", bucket: env.JINGJIE_OSS_BUCKET, key: `jingjie/media/${name}` };
  const localName = "abc-123.png";
  await provider.update((document) => {
    document.media.push({ name, mime: "image/png", size: png.length, originalName: "remote.png", storage: remote });
    document.media.push({ name: localName, mime: "image/png", size: png.length, originalName: "local.png" });
  });
  const signed = await provider.createMediaUrl(name, "HEAD");
  assert.equal(new URL(signed.url).pathname, `/${remote.key}`);
  assert.deepEqual(calls, [["signatureUrlV4", "HEAD", 3600, {}, remote.key]]);
  assert.equal(await provider.createMediaUrl(localName), null);
  assert.equal(await provider.createMediaUrl("abc-456.png"), null);
  assert.equal(calls.length, 1);
});

test("media access refuses local media without signing or reading the local file", async (t) => {
  const directory = await temporaryDirectory(t);
  const { storage, calls } = fixture();
  const provider = new JsonDataProvider({ directory, initialize: () => createInitialDocument([]), oss: storage });
  await provider.update((document) => document.media.push({ name, mime: "image/png", size: png.length, originalName: "local.png" }));
  await assert.rejects(mediaAccess(new Request("http://localhost/api/media/access", { method: "POST" }), { url: `/media/${name}` }, { provider }), (error) => error.status === 404);
  assert.deepEqual(calls, []);
  await assert.rejects(readdir(path.join(directory, "uploads")), { code: "ENOENT" });
});

test("OSS access signing failures surface as 503 without reading media bytes", async (t) => {
  const directory = await temporaryDirectory(t);
  const { storage, sdk, calls } = fixture();
  sdk.signatureUrlV4 = async () => { throw new Error("private SDK signing diagnostic"); };
  const provider = new JsonDataProvider({ directory, initialize: () => createInitialDocument([]), oss: storage });
  const remote = { provider: "oss", bucket: env.JINGJIE_OSS_BUCKET, key: `jingjie/media/${name}` };
  await provider.update((document) => document.media.push({ name, mime: "image/png", size: png.length, originalName: "frame.png", storage: remote }));
  await assert.rejects(mediaAccess(new Request("http://localhost/api/media/access", { method: "POST" }), { url: mediaReference(name) }, { provider }), (error) => {
    assert.equal(error.status, 503);
    assert.match(error.message, /OSS/);
    assert.doesNotMatch(error.message, /private SDK signing diagnostic/);
    return true;
  });
  assert.deepEqual(calls, []);
});
