import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { prepareBrowserUpload, completeBrowserUpload } from "../src/server/media.js";
import { createInitialDocument } from "../src/server/repository.js";
import { JsonDataProvider } from "../src/server/storage/json.js";
import { OssMediaStorage } from "../src/server/storage/oss.js";
import { MEDIA_LIMITS } from "../src/lib/mediaFormats.js";
import * as contentClient from "../src/lib/contentClient.js";

const env = {
  JINGJIE_OSS_BUCKET: "browser-test", JINGJIE_OSS_REGION: "cn-hangzhou",
  JINGJIE_OSS_ACCESS_KEY_ID: "browser-test-key", JINGJIE_OSS_ACCESS_KEY_SECRET: "browser-upload-secret-stays-server-side",
  JINGJIE_OSS_PREFIX: "jingjie", JINGJIE_OSS_UPLOAD_TTL_SECONDS: "300",
};
const png = Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), Buffer.alloc(1100, 7)]);
const fileInfo = { name: "cover.png", kind: "image", mime: "image/png", size: png.length };
const object = (bytes = png, mime = "image/png") => ({ bytes, mime, etag: `"${createHash("md5").update(bytes).digest("hex")}"` });

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), "jingjie-browser-upload-"));
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(tmpdir()));
    assert.ok(path.basename(directory).startsWith("jingjie-browser-upload-"));
    await rm(directory, { recursive: true, force: true });
  });
  const objects = new Map(), calls = [];
  let signatures = 0;
  const missing = () => Object.assign(new Error("missing"), { status: 404, code: "NoSuchKey" });
  const sdk = {
    async signatureUrlV4(method, expires, options, key, additionalHeaders) {
      calls.push({ operation: "signature", method, expires, options, key, additionalHeaders });
      const date = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
      const query = new URLSearchParams({ "x-oss-signature-version": "OSS4-HMAC-SHA256", "x-oss-date": date, "x-oss-expires": String(expires), "x-oss-signature": `signature-${++signatures}` });
      return `https://${env.JINGJIE_OSS_BUCKET}.oss-cn-hangzhou.aliyuncs.com/${key}?${query}`;
    },
    async head(key) {
      calls.push({ operation: "head", key });
      const entry = objects.get(key);
      if (!entry) throw missing();
      return { res: { headers: { "content-length": String(entry.bytes.length), "content-type": entry.mime, etag: entry.etag } } };
    },
    async get(key, options) {
      calls.push({ operation: "get", key, options });
      const entry = objects.get(key);
      if (!entry) throw missing();
      if (entry.etag !== options.headers["If-Match"]) throw Object.assign(new Error("changed"), { status: 412 });
      const range = /^bytes=(\d+)-(\d+)$/.exec(options.headers.Range);
      return { content: entry.bytes.subarray(Number(range[1]), Number(range[2]) + 1) };
    },
    async copy(target, source, options) {
      calls.push({ operation: "copy", target, source, options });
      const entry = objects.get(source);
      if (!entry) throw missing();
      if (entry.etag !== options.headers["If-Match"]) throw Object.assign(new Error("changed"), { status: 412 });
      if (objects.has(target)) throw Object.assign(new Error("existing"), { status: 409 });
      objects.set(target, { ...entry, bytes: Buffer.from(entry.bytes) });
    },
    async delete(key) {
      calls.push({ operation: "delete", key });
      objects.delete(key);
    },
  };
  const storage = new OssMediaStorage({ env, clientFactory: () => sdk });
  const provider = new JsonDataProvider({ directory, initialize: () => createInitialDocument([]), oss: storage });
  const prepare = (input = fileInfo) => prepareBrowserUpload(input, { provider });
  const complete = (prepared) => completeBrowserUpload({ uploadToken: prepared.uploadToken }, { provider });
  const upload = (prepared, bytes = png, mime = "image/png") => {
    const key = new URL(prepared.uploadUrl).pathname.slice(1);
    objects.set(key, object(bytes, mime));
    return key;
  };
  return { directory, objects, calls, sdk, storage, provider, prepare, complete, upload };
}

test("browser preparation issues a scoped upload URL without Content-Length and stores no upload ticket", async (t) => {
  const { prepare, provider, objects, calls, directory } = await fixture(t);
  const prepared = await prepare();
  assert.ok(prepared.uploadToken);
  assert.match(prepared.uploadUrl, /^https:\/\/browser-test\.oss-cn-hangzhou\.aliyuncs\.com\/jingjie\/uploads\//);
  assert.match(prepared.mediaUrl, /^https:\/\/browser-test\.oss-cn-hangzhou\.aliyuncs\.com\/jingjie\/media\/[a-f0-9-]+\.png$/);
  assert.equal(new URL(prepared.mediaUrl).search, "");
  assert.equal(prepared.headers["Content-Type"], "image/png");
  assert.equal(prepared.headers["x-oss-forbid-overwrite"], "true");
  assert.equal(prepared.headers["x-oss-object-acl"], "private");
  assert.ok(!Object.keys(prepared.headers).some((key) => key.toLowerCase() === "content-length"));
  assert.ok(!(calls[0].additionalHeaders ?? []).includes("content-length"));
  assert.equal(calls[0].method, "PUT");
  assert.equal(calls[0].expires, 300);
  assert.equal(objects.size, 0);
  assert.doesNotMatch(JSON.stringify(prepared), new RegExp(env.JINGJIE_OSS_ACCESS_KEY_SECRET));
  const afterRestart = new OssMediaStorage({ env, clientFactory: () => ({}) });
  const plan = await afterRestart.verifyBrowserUpload(prepared.uploadToken);
  assert.equal(plan.expiresAt, Date.parse(prepared.expiresAt) + 10 * 60 * 1000);
  assert.equal(plan.originalName, fileInfo.name);
  assert.equal(plan.storage.key, new URL(prepared.mediaUrl).pathname.slice(1));
  const document = await provider.read();
  assert.deepEqual(document.media, []);
  assert.deepEqual(document.content, []);
  assert.deepEqual(document.submissions, []);
  assert.ok(!(await readdir(directory)).some((name) => /upload|ticket/.test(name)));
});

test("real OSS browser signatures omit the forbidden length header while MCP signatures retain it", async () => {
  const storage = new OssMediaStorage({ env });
  const browser = await storage.createBrowserUpload(fileInfo);
  assert.equal(new URL(browser.uploadUrl).searchParams.get("x-oss-additional-headers"), null);
  assert.equal(browser.headers["Content-Length"], undefined);
  const key = new URL(browser.uploadUrl).pathname.slice(1);
  const mcp = await storage.createUploadUrl({ key, mime: fileInfo.mime, size: fileInfo.size });
  assert.equal(new URL(mcp.uploadUrl).searchParams.get("x-oss-additional-headers"), "content-length");
  assert.equal(mcp.headers["Content-Length"], String(fileInfo.size));
});

test("browser preparation validates type and size before signing", async (t) => {
  const { prepare, calls } = await fixture(t);
  for (const input of [
    null,
    { ...fileInfo, kind: "unknown" },
    { ...fileInfo, mime: "" },
    { ...fileInfo, mime: "image/svg+xml" },
    { ...fileInfo, kind: "video" },
    { ...fileInfo, size: 0 },
    { ...fileInfo, size: 1.5 },
    { ...fileInfo, size: MEDIA_LIMITS.image + 1 },
  ]) await assert.rejects(prepare(input));
  assert.deepEqual(calls, []);
});

test("tampered, expired and differently scoped tickets cannot inspect or register OSS objects", async (t) => {
  const state = await fixture(t);
  const prepared = await state.prepare();
  state.upload(prepared);
  state.calls.length = 0;
  const at = Math.floor(prepared.uploadToken.length / 2);
  const changed = prepared.uploadToken.slice(0, at) + (prepared.uploadToken[at] === "A" ? "B" : "A") + prepared.uploadToken.slice(at + 1);
  for (const uploadToken of ["", "not-a-ticket", changed]) {
    await assert.rejects(completeBrowserUpload({ uploadToken }, { provider: state.provider }), (error) => error.status >= 400 && error.status < 500);
  }
  for (const settings of [{ JINGJIE_OSS_BUCKET: "different-bucket" }, { JINGJIE_OSS_PREFIX: "different-prefix" }]) {
    const elsewhere = new OssMediaStorage({ env: { ...env, ...settings }, clientFactory: () => state.sdk });
    await assert.rejects(async () => elsewhere.verifyBrowserUpload(prepared.uploadToken), (error) => error.status >= 400 && error.status < 500);
  }
  const originalNow = Date.now;
  const clock = t.mock.method(Date, "now", () => originalNow() - 2 * 60 * 60 * 1000);
  let expired;
  try { expired = await state.prepare(); }
  finally { clock.mock.restore(); }
  state.calls.length = 0;
  await assert.rejects(state.complete(expired), (error) => error.status >= 400 && error.status < 500);
  assert.deepEqual(state.calls, []);
  assert.deepEqual((await state.provider.read()).media, []);
});

test("completion registers verified OSS bytes once and leaves case drafts and ticket storage untouched", async (t) => {
  const state = await fixture(t);
  const prepared = await state.prepare();
  const uploadKey = state.upload(prepared);
  const completed = await state.complete(prepared);
  assert.equal(completed.mediaUrl, prepared.mediaUrl);
  assert.equal(new URL(completed.url).pathname, new URL(prepared.mediaUrl).pathname);
  assert.ok(new URL(completed.url).searchParams.has("x-oss-signature"));
  assert.ok(Date.parse(completed.expiresAt) > Date.now());
  assert.deepEqual({ name: completed.name, size: completed.size, kind: completed.kind }, { name: "cover.png", size: png.length, kind: "image" });
  const document = await state.provider.read();
  assert.equal(document.media.length, 1);
  const media = document.media[0];
  assert.deepEqual(media, { name: media.name, mime: "image/png", size: png.length, originalName: "cover.png", storage: { provider: "oss", bucket: env.JINGJIE_OSS_BUCKET, key: `jingjie/media/${media.name}` } });
  assert.deepEqual(state.objects.get(media.storage.key).bytes, png);
  assert.equal(state.objects.has(uploadKey), false);
  assert.deepEqual(document.content, []);
  assert.deepEqual(document.submissions, []);
  assert.doesNotMatch(await readFile(path.join(state.directory, "media.json"), "utf8"), /uploadToken|uploadUrl|Signature=|x-oss-signature/i);
  await assert.rejects(readdir(path.join(state.directory, "uploads")), { code: "ENOENT" });
});

test("wrong actual format and size cannot complete or register browser media", async (t) => {
  for (const [label, bytes, mime, status] of [
    ["size", Buffer.concat([png, Buffer.from([1])]), "image/png", 409],
    ["signature", Buffer.alloc(png.length), "image/png", 415],
    ["content-type", png, "image/jpeg", 415],
  ]) {
    await t.test(label, async (t) => {
      const state = await fixture(t);
      const prepared = await state.prepare();
      state.upload(prepared, bytes, mime);
      await assert.rejects(state.complete(prepared), (error) => error.status === status);
      assert.deepEqual((await state.provider.read()).media, []);
      assert.equal(state.calls.some((call) => call.operation === "copy"), false);
      assert.equal(state.calls.some((call) => call.operation === "delete"), false);
    });
  }
});

test("concurrent and repeated completion never duplicate registration or delete the successful object", async (t) => {
  const state = await fixture(t);
  const prepared = await state.prepare();
  state.upload(prepared);
  const results = await Promise.all([state.complete(prepared), state.complete(prepared), state.complete(prepared)]);
  assert.ok(results.every((result) => result.mediaUrl === prepared.mediaUrl));
  await state.complete(prepared);
  const document = await state.provider.read();
  assert.equal(document.media.length, 1);
  const key = document.media[0].storage.key;
  assert.deepEqual(state.objects.get(key).bytes, png);
  assert.equal(state.calls.some((call) => call.operation === "delete" && call.key === key), false);
});

test("a delayed concurrent confirmation succeeds after another confirmation removes its temporary source", async (t) => {
  const state = await fixture(t);
  const prepared = await state.prepare();
  const uploadKey = state.upload(prepared);
  const head = state.sdk.head;
  let sourceRequests = 0;
  let firstEntered, bothEntered, releaseSecond;
  const firstInspect = new Promise((resolve) => { firstEntered = resolve; });
  const bothInspect = new Promise((resolve) => { bothEntered = resolve; });
  const secondContinue = new Promise((resolve) => { releaseSecond = resolve; });
  state.sdk.head = async (key) => {
    if (key === uploadKey) {
      sourceRequests += 1;
      if (sourceRequests === 1) {
        firstEntered();
        await bothInspect;
      } else if (sourceRequests === 2) {
        bothEntered();
        await secondContinue;
      }
    }
    return head(key);
  };
  let first, second;
  try {
    first = state.complete(prepared);
    await firstInspect;
    second = state.complete(prepared);
    await bothInspect;
    await first;
    assert.equal(state.objects.has(uploadKey), false);
    releaseSecond();
    assert.equal((await second).mediaUrl, prepared.mediaUrl);
    assert.equal((await state.provider.read()).media.length, 1);
  } finally {
    bothEntered();
    releaseSecond();
    await Promise.allSettled([first, second]);
  }
});

test("completion rejects conflicting registered metadata without changing or removing its object", async (t) => {
  const state = await fixture(t);
  const prepared = await state.prepare();
  const plan = await state.storage.verifyBrowserUpload(prepared.uploadToken);
  state.objects.set(plan.storage.key, object());
  await state.provider.update((document) => {
    document.media.push({ name: plan.name, mime: plan.mime, size: plan.size, originalName: "existing.png", storage: plan.storage });
  });
  state.calls.length = 0;
  await assert.rejects(state.complete(prepared), (error) => error.status === 409);
  assert.deepEqual(state.calls, []);
  assert.equal(state.objects.has(plan.storage.key), true);
  assert.equal((await state.provider.read()).media[0].originalName, "existing.png");
});

test("registration failure retains the promoted object and can retry the same ticket", async (t) => {
  const state = await fixture(t);
  const prepared = await state.prepare();
  const uploadKey = state.upload(prepared);
  await state.provider.read();
  const atomicWrite = state.provider.atomicWrite.bind(state.provider);
  let failed = false;
  state.provider.atomicWrite = async (name, text) => {
    if (!failed && name === "media.json") { failed = true; throw new Error("simulated registration failure"); }
    return atomicWrite(name, text);
  };
  await assert.rejects(state.complete(prepared));
  assert.deepEqual((await state.provider.read()).media, []);
  assert.equal(state.objects.has(uploadKey), true);
  assert.equal(state.objects.has(new URL(prepared.mediaUrl).pathname.slice(1)), true);
  const retried = await state.complete(prepared);
  assert.equal(retried.mediaUrl, prepared.mediaUrl);
  assert.equal((await state.provider.read()).media.length, 1);
  assert.equal(state.objects.has(uploadKey), false);
});

test("temporary object cleanup failure does not fail success and is retried by repeated completion", async (t) => {
  const state = await fixture(t);
  const prepared = await state.prepare();
  const uploadKey = state.upload(prepared);
  const remove = state.sdk.delete;
  let failCleanup = true;
  state.sdk.delete = async (key) => {
    if (failCleanup && key === uploadKey) { failCleanup = false; throw new Error("temporary cleanup unavailable"); }
    return remove(key);
  };
  assert.equal((await state.complete(prepared)).mediaUrl, prepared.mediaUrl);
  assert.equal(state.objects.has(uploadKey), true);
  assert.equal((await state.complete(prepared)).mediaUrl, prepared.mediaUrl);
  assert.equal(state.objects.has(uploadKey), false);
  assert.equal((await state.provider.read()).media.length, 1);
});

test("public OSS media under another namespace bypasses this site's signing API", async (t) => {
  t.mock.method(globalThis, "fetch", () => { throw new Error("External media must not request local signing"); });
  const source = "https://oayun.oss-cn-shenzhen.aliyuncs.com/b/260901/public-video.mp4";
  assert.deepEqual(await contentClient.requestMediaAccess(source), { url: source, mediaUrl: source, expiresAt: null });
});

function browserFixture(t, outcome = "success", pendingAction = null) {
  const requests = [], instances = [];
  let started, requestStarted, finishPending;
  const putStarted = new Promise((resolve) => { started = resolve; });
  const pendingRequest = new Promise((resolve) => { requestStarted = resolve; });
  const prepared = { uploadToken: "signed-browser-ticket", uploadUrl: "https://browser-test.oss-cn-hangzhou.aliyuncs.com/jingjie/uploads/task/abc.png?signature=put", headers: { "Content-Type": "image/png", "x-oss-forbid-overwrite": "true", "x-oss-object-acl": "private" }, expiresAt: "2099-01-01T00:00:00.000Z", mediaUrl: "https://browser-test.oss-cn-hangzhou.aliyuncs.com/jingjie/media/abc.png" };
  const completed = { url: prepared.mediaUrl + "?x-oss-signature=get", mediaUrl: prepared.mediaUrl, expiresAt: prepared.expiresAt, name: "cover.png", size: png.length, kind: "image" };
  class MockXHR {
    constructor() { this.upload = {}; this.headers = {}; instances.push(this); }
    open(method, url) { this.method = method; this.url = url; }
    setRequestHeader(name, value) { this.headers[name] = value; }
    send(body) {
      this.body = body;
      started(this);
      if (outcome === "pending") return;
      queueMicrotask(() => {
        if (outcome === "network-error") { this.onerror?.(); return; }
        if (outcome === "timeout") { this.ontimeout?.(); return; }
        this.upload.onprogress?.({ lengthComputable: true, loaded: body.size, total: body.size });
        this.status = outcome === "http-error" ? 403 : 200;
        this.responseText = "";
        this.onload?.();
      });
    }
    abort() { this.onabort?.(); }
  }
  t.mock.method(globalThis, "fetch", async (url, options) => {
    const body = JSON.parse(options.body);
    requests.push({ url, options, body });
    if (body.action === pendingAction) {
      return new Promise((resolve, reject) => {
        const abort = () => reject(options.signal.reason);
        options.signal.addEventListener("abort", abort, { once: true });
        finishPending = () => {
          options.signal.removeEventListener("abort", abort);
          resolve(Response.json(body.action === "prepare" ? prepared : completed));
        };
        requestStarted({ action: body.action, signal: options.signal });
        if (options.signal.aborted) abort();
      });
    }
    return Response.json(body.action === "prepare" ? prepared : completed);
  });
  const oldXHR = globalThis.XMLHttpRequest;
  globalThis.XMLHttpRequest = MockXHR;
  t.after(() => {
    finishPending?.();
    if (oldXHR === undefined) delete globalThis.XMLHttpRequest;
    else globalThis.XMLHttpRequest = oldXHR;
  });
  return { requests, instances, prepared, completed, putStarted, pendingRequest, finishPending: () => finishPending?.() };
}

test("the browser sends JSON preparation, raw File bytes to OSS, and only the ticket for completion", async (t) => {
  const browser = browserFixture(t);
  const file = new File([png], "cover.png", { type: "image/png" });
  const progress = [], phases = [];
  const uploaded = await contentClient.uploadFile(file, "image", (value) => progress.push(value), () => {}, (phase) => phases.push(phase));
  assert.deepEqual(uploaded, browser.completed);
  assert.deepEqual(phases, ["preparing", "uploading", "confirming"]);
  assert.equal(browser.requests.length, 2);
  assert.deepEqual(browser.requests.map((request) => request.url), ["/api/uploads", "/api/uploads"]);
  assert.deepEqual(browser.requests[0].body, { action: "prepare", name: "cover.png", kind: "image", mime: "image/png", size: png.length });
  assert.deepEqual(browser.requests[1].body, { action: "complete", uploadToken: browser.prepared.uploadToken });
  for (const request of browser.requests) assert.equal(request.options.headers["Content-Type"], "application/json");
  assert.equal(browser.instances.length, 1);
  const xhr = browser.instances[0];
  assert.equal(xhr.method, "PUT");
  assert.equal(xhr.url, browser.prepared.uploadUrl);
  assert.equal(xhr.body, file);
  assert.deepEqual(xhr.headers, browser.prepared.headers);
  assert.ok(progress.includes(100));
});

test("a file with an empty browser MIME type is prepared using its supported extension", async (t) => {
  const browser = browserFixture(t);
  const file = new File([png], "cover.png");
  await contentClient.uploadFile(file, "image");
  assert.equal(browser.requests[0].body.mime, "image/png");
});

test("OSS HTTP failure, network error, timeout and cancellation never submit a completion ticket", async (t) => {
  for (const [outcome, expected] of [
    ["http-error", /HTTP 403/],
    ["network-error", /素材直传中断/],
    ["timeout", /上传超时/],
    ["pending", (error) => error.name === "AbortError"],
  ]) {
    await t.test(outcome === "pending" ? "cancel" : outcome, async (t) => {
      const browser = browserFixture(t, outcome);
      const file = new File([png], "cover.png", { type: "image/png" });
      const phases = [];
      let control;
      const uploading = contentClient.uploadFile(file, "image", () => {}, (request) => { control = request; }, (phase) => phases.push(phase));
      const rejected = assert.rejects(uploading, expected);
      await browser.putStarted;
      if (outcome === "pending") control.abort();
      await rejected;
      assert.equal(browser.requests.length, 1);
      assert.equal(browser.requests[0].body.action, "prepare");
      assert.deepEqual(phases, ["preparing", "uploading"]);
      assert.equal(browser.instances[0].body, file);
      assert.equal(browser.instances[0].timeout, 10 * 60 * 1000);
      for (const event of ["onload", "onerror", "ontimeout", "onabort"]) assert.equal(browser.instances[0][event], null);
    });
  }
});

test("cancelling preparation or completion aborts its JSON request and never applies a result", async (t) => {
  for (const action of ["prepare", "complete"]) {
    await t.test(action, { timeout: 5000 }, async (t) => {
      const browser = browserFixture(t, "success", action);
      const file = new File([png], "cover.png", { type: "image/png" });
      const phases = [], applied = [];
      let control;
      const uploading = contentClient.uploadFile(file, "image", () => {}, (request) => { control = request; }, (phase) => phases.push(phase))
        .then((result) => { applied.push(result); return result; });
      const rejected = assert.rejects(uploading, (error) => error.name === "AbortError");
      const pending = await browser.pendingRequest;
      assert.equal(pending.action, action);
      control.abort();
      await rejected;
      assert.equal(pending.signal.aborted, true);
      browser.finishPending();
      await Promise.resolve();
      assert.deepEqual(applied, []);
      if (action === "prepare") {
        assert.equal(browser.instances.length, 0);
        assert.deepEqual(browser.requests.map((request) => request.body.action), ["prepare"]);
        assert.deepEqual(phases, ["preparing"]);
      } else {
        assert.equal(browser.instances.length, 1);
        assert.equal(browser.instances[0].body, file);
        assert.deepEqual(browser.requests.map((request) => request.body.action), ["prepare", "complete"]);
        assert.deepEqual(phases, ["preparing", "uploading", "confirming"]);
      }
    });
  }
});
