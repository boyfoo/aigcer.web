import test from "node:test";
import assert from "node:assert/strict";
import { requestOfflineImage, uploadFile } from "../src/lib/contentClient.js";

const png = Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), Buffer.alloc(1100, 7)]);
const mediaUrl = "https://browser-test.oss-cn-hangzhou.aliyuncs.com/jingjie/media/abc-123.png";

function browserFixture(t, { outcome = "success", presign = "success", respectAbort = true } = {}) {
  const requests = [], instances = [];
  let notifyPut, notifyPresign, releasePresign;
  const putStarted = new Promise((resolve) => { notifyPut = resolve; });
  const presignStarted = new Promise((resolve) => { notifyPresign = resolve; });
  const prepared = {
    mediaUrl, name: "cover.png", size: png.length, kind: "image",
    uploadUrl: `${mediaUrl}?x-oss-signature=put&x-oss-expires=300`,
    headers: { "Content-Type": "image/png", "x-oss-forbid-overwrite": "true", "x-oss-object-acl": "public-read" },
    uploadExpiresAt: "2080-10-09T01:07:03.000Z",
  };
  class MockXHR {
    constructor() { this.upload = {}; this.headers = {}; this.abortCount = 0; instances.push(this); }
    open(method, url) { this.method = method; this.url = url; }
    setRequestHeader(name, value) { this.headers[name] = value; }
    send(body) {
      this.body = body;
      notifyPut(this);
      if (outcome === "pending") return;
      queueMicrotask(() => {
        if (this.abortCount) return;
        if (outcome === "network-error") { this.onerror?.(); return; }
        if (outcome === "timeout") { this.ontimeout?.(); return; }
        this.upload.onprogress?.({ lengthComputable: true, loaded: body.size, total: body.size });
        this.status = outcome === "http-error" ? 403 : 200;
        this.onload?.();
      });
    }
    abort() { this.abortCount++; this.onabort?.(); }
  }
  t.mock.method(globalThis, "fetch", async (url, options) => {
    const body = JSON.parse(options.body);
    requests.push({ url, options, body });
    notifyPresign({ signal: options.signal });
    if (presign === "pending") {
      return new Promise((resolve, reject) => {
        const abort = () => reject(options.signal.reason);
        if (respectAbort) options.signal.addEventListener("abort", abort, { once: true });
        releasePresign = () => {
          options.signal.removeEventListener("abort", abort);
          resolve(Response.json({ uploads: [prepared] }));
        };
        if (respectAbort && options.signal.aborted) abort();
      });
    }
    if (presign === "http-error") return Response.json({ error: "签名服务暂时不可用" }, { status: 503 });
    if (presign === "network-error") throw new TypeError("Failed to fetch");
    if (presign === "timeout") throw new DOMException("Request timed out", "TimeoutError");
    return Response.json({ uploads: [prepared] });
  });
  const oldXHR = globalThis.XMLHttpRequest;
  globalThis.XMLHttpRequest = MockXHR;
  t.after(() => {
    releasePresign?.();
    if (oldXHR === undefined) delete globalThis.XMLHttpRequest;
    else globalThis.XMLHttpRequest = oldXHR;
  });
  return { requests, instances, prepared, putStarted, presignStarted, releasePresign: () => releasePresign?.() };
}

test("one JSON presign request followed by direct OSS PUT immediately returns a public media URL", async (t) => {
  const browser = browserFixture(t);
  const file = new File([png], "cover.png", { type: "image/png" });
  const progress = [], phases = [];
  const uploaded = await uploadFile(file, "image", (percent) => progress.push(percent), () => {}, (phase) => phases.push(phase));
  assert.deepEqual(uploaded, browser.prepared);
  assert.equal(new URL(uploaded.mediaUrl).search, "");
  assert.equal("url" in uploaded, false);
  assert.equal("expiresAt" in uploaded, false);
  assert.deepEqual(phases, ["preparing", "uploading"]);
  assert.equal(browser.requests.length, 1);
  assert.equal(browser.requests[0].url, "/api/oss/presign");
  assert.deepEqual(browser.requests[0].body, { uploads: [{ name: "cover.png", kind: "image", mime: "image/png", size: png.length }] });
  assert.equal(browser.requests[0].options.method, "POST");
  assert.equal(browser.requests[0].options.headers["Content-Type"], "application/json");
  assert.equal(browser.instances.length, 1);
  const xhr = browser.instances[0];
  assert.equal(xhr.method, "PUT");
  assert.equal(xhr.url, browser.prepared.uploadUrl);
  assert.equal(new URL(xhr.url).pathname, new URL(uploaded.mediaUrl).pathname);
  assert.equal(xhr.body, file);
  assert.deepEqual(xhr.headers, browser.prepared.headers);
  assert.equal(xhr.headers["Content-Length"], undefined);
  assert.ok(progress.includes(100));
  assert.equal(xhr.upload.onprogress, null);
  for (const event of ["onload", "onerror", "ontimeout", "onabort"]) assert.equal(xhr[event], null);
});

test("empty browser MIME types use supported filename extensions in the upload array", async (t) => {
  for (const [filename, kind, mime] of [["cover.png", "image", "image/png"], ["cover.jpeg", "image", "image/jpeg"], ["clip.webm", "video", "video/webm"]]) {
    await t.test(filename, async (t) => {
      const browser = browserFixture(t);
      await uploadFile(new File([png], filename), kind);
      assert.equal(browser.requests[0].body.uploads[0].mime, mime);
      assert.equal(browser.requests.length, 1);
    });
  }
});

test("OSS errors and cancellation reject without making any backend call after presigning", async (t) => {
  for (const [outcome, expected] of [["http-error", /HTTP 403/], ["network-error", /素材直传中断/], ["timeout", /上传超时/], ["pending", (error) => error.name === "AbortError"]]) {
    await t.test(outcome === "pending" ? "cancel PUT" : outcome, async (t) => {
      const browser = browserFixture(t, { outcome });
      const file = new File([png], "cover.png", { type: "image/png" });
      const phases = [];
      let controller;
      const uploading = uploadFile(file, "image", () => {}, (request) => { controller = request; }, (phase) => phases.push(phase));
      const rejected = assert.rejects(uploading, expected);
      await browser.putStarted;
      if (outcome === "pending") controller.abort();
      await rejected;
      assert.deepEqual(phases, ["preparing", "uploading"]);
      assert.equal(browser.requests.length, 1);
      assert.equal(browser.requests[0].url, "/api/oss/presign");
      const xhr = browser.instances[0];
      assert.equal(xhr.body, file);
      assert.equal(xhr.timeout, 10 * 60 * 1000);
      assert.equal(xhr.upload.onprogress, null);
      for (const event of ["onload", "onerror", "ontimeout", "onabort"]) assert.equal(xhr[event], null);
      if (outcome === "pending") assert.equal(xhr.abortCount, 1);
    });
  }
});

test("cancelling presigning aborts the JSON request and ignores a late result", async (t) => {
  for (const respectAbort of [true, false]) {
    await t.test(respectAbort ? "request honours abort" : "late response", { timeout: 5000 }, async (t) => {
      const browser = browserFixture(t, { presign: "pending", respectAbort });
      const phases = [], applied = [];
      let controller;
      const uploading = uploadFile(new File([png], "cover.png", { type: "image/png" }), "image", () => {}, (request) => { controller = request; }, (phase) => phases.push(phase))
        .then((result) => { applied.push(result); return result; });
      const rejected = assert.rejects(uploading, (error) => error.name === "AbortError");
      const pending = await browser.presignStarted;
      controller.abort();
      assert.equal(pending.signal.aborted, true);
      browser.releasePresign();
      await rejected;
      assert.deepEqual(phases, ["preparing"]);
      assert.equal(browser.requests.length, 1);
      assert.deepEqual(browser.instances, []);
      assert.deepEqual(applied, []);
    });
  }
});

test("presigning HTTP failures, network errors and timeouts never start a PUT", async (t) => {
  for (const [presign, expected] of [["http-error", /签名服务暂时不可用/], ["network-error", /无法连接网站/], ["timeout", /上传准备超时/]]) {
    await t.test(presign, async (t) => {
      const browser = browserFixture(t, { presign });
      const phases = [];
      await assert.rejects(uploadFile(new File([png], "cover.png"), "image", () => {}, () => {}, (phase) => phases.push(phase)), expected);
      assert.equal(browser.requests.length, 1);
      assert.deepEqual(browser.instances, []);
      assert.deepEqual(phases, ["preparing"]);
    });
  }
});

test("offline images read public OSS and external URLs directly with zero backend requests", async (t) => {
  const publicUrl = "https://oayun.oss-cn-shenzhen.aliyuncs.com/b/260901/public-image.jpg";
  const external = "https://example.com/image.jpg?size=large";
  const requests = [], controller = new AbortController();
  t.mock.method(globalThis, "fetch", async (url, options) => {
    requests.push({ url, options });
    assert.ok([mediaUrl, publicUrl, external].includes(url));
    return new Response(png, { headers: { "Content-Type": "image/png" } });
  });
  for (const source of [mediaUrl, publicUrl, external]) {
    const response = await requestOfflineImage(source, controller.signal);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), png);
  }
  assert.deepEqual(requests.map(({ url }) => url), [mediaUrl, publicUrl, external]);
  for (const { options } of requests) {
    assert.equal(options.signal, controller.signal);
    assert.equal(options.method, undefined);
    assert.equal(options.body, undefined);
  }
});

test("failed OSS image reads have no signing or byte-proxy fallback", async (t) => {
  const requests = [];
  t.mock.method(globalThis, "fetch", async (url) => {
    requests.push(url);
    return new Response("OSS read failed", { status: 403 });
  });
  assert.equal((await requestOfflineImage(mediaUrl)).status, 403);
  assert.deepEqual(requests, [mediaUrl]);
});
