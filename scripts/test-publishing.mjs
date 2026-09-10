import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const directory = await mkdtemp(path.join(tmpdir(), "jingjie-http-"));
const socket = createServer();
await new Promise((resolve) => socket.listen(0, "127.0.0.1", resolve));
const port = socket.address().port;
await new Promise((resolve) => socket.close(resolve));
const origin = `http://127.0.0.1:${port}`;
let child, output = "", checks = 0;
const stop = () => {
  if (!child || child.exitCode !== null) return;
  if (process.platform === "win32") spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore", timeout: 5000 });
  else child.kill("SIGTERM");
};
const deadline = setTimeout(() => { stop(); console.error("Publishing HTTP checks exceeded 60 seconds"); process.exit(1); }, 60000);
const request = async (url, options = {}) => fetch(origin + url, { ...options, signal: AbortSignal.timeout(10000) });
const json = async (url, body, expected = 200) => {
  const response = await request(url, body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify(body) });
  const data = await response.json();
  assert.equal(response.status, expected, JSON.stringify(data)); checks++;
  return data;
};
const start = async () => {
  child = spawn(process.execPath, [path.join(root, "node_modules/next/dist/bin/next"), "start", "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, JINGJIE_DATA_DIR: directory, SITE_URL: origin, JINGJIE_BUILD_TARGET: "server" },
  });
  child.stdout.on("data", (value) => { output += value; });
  child.stderr.on("data", (value) => { output += value; });
  const end = Date.now() + 20000;
  while (Date.now() < end) {
    if (child.exitCode !== null) throw new Error(output);
    try { if ((await request("/api/public")).ok) return; } catch { /* Server is starting. */ }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("Server did not become ready: " + output);
};
try {
  await start();
  const image = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
  const upload = await request("/api/uploads?kind=image&name=reference.png", { method: "POST", headers: { "Content-Type": "application/octet-stream", Origin: origin }, body: image });
  assert.equal(upload.status, 201, await upload.clone().text());
  const media = await upload.json(); checks++;
  assert.deepEqual(Buffer.from(await (await request(media.url)).arrayBuffer()), image); checks++;
  const head = await request(media.url, { method: "HEAD" });
  assert.equal(head.headers.get("content-length"), String(image.length)); assert.equal((await head.arrayBuffer()).byteLength, 0); checks++;
  const range = await request(media.url, { headers: { Range: "bytes=0-7" } });
  assert.equal(range.status, 206); assert.deepEqual(Buffer.from(await range.arrayBuffer()), image.subarray(0, 8)); checks++;
  assert.equal((await request(media.url, { headers: { Range: "bytes=999999999-" } })).status, 416); checks++;
  assert.equal((await request("/api/uploads?kind=image", { method: "POST", body: "<svg>not a supported image</svg>" })).status, 415); checks++;
  assert.equal((await request("/api/uploads?kind=image", { method: "POST", body: Buffer.alloc(20 * 1024 * 1024 + 1) })).status, 413); checks++;
  assert.equal((await request("/api/content", { method: "POST", headers: { Origin: "https://another.example", "Content-Type": "application/json" }, body: "{}" })).status, 403); checks++;
  console.log("PASS upload, HEAD, streaming ranges, file limits and origin checks");

  let record = (await json("/api/content", { action: "save", draft: { kind: "分镜", title: "独立流程测试", image: media.url } })).record;
  const id = record.id;
  assert.equal(record.status, "draft");
  assert.ok(!(await json("/api/public")).items.some((item) => item.id === id));
  assert.equal((await request(`/cases/${id}`)).status, 404); checks++;
  await json("/api/content", { action: "publish", id, revision: record.revision, draft: record.draft }, 400);
  record = (await json("/api/content", { action: "publish", id, revision: record.revision, draft: { ...record.draft, analysis: "首个公开版本：侧逆光形成轮廓。" } })).record;
  const detail = async () => {
    const response = await request(`/cases/${id}`);
    assert.equal(response.status, 200); checks++;
    return response.text();
  };
  let html = await detail();
  const visibleHtml = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
  assert.match(visibleHtml, /独立流程测试/); assert.match(visibleHtml, /首个公开版本/);
  assert.match(await (await request("/sitemap.xml")).text(), new RegExp(`/cases/${id}`)); checks++;
  const oldRevision = record.revision;
  record = (await json("/api/content", { action: "save", id, revision: record.revision, draft: { ...record.draft, title: "待发布修改标题", analysis: "未发布秘密内容" } })).record;
  html = await detail();
  assert.match(html, /首个公开版本/); assert.doesNotMatch(html, /未发布秘密内容|待发布修改标题/); checks++;
  assert.equal((await json("/api/public")).items.find((item) => item.id === id).title, "独立流程测试");
  await json("/api/content", { action: "save", id, revision: oldRevision, draft: record.draft }, 409);
  console.log("PASS drafts excluded, analysis-only publication, initial HTML and snapshot isolation");

  record = (await json("/api/content", { action: "unlist", id, revision: record.revision })).record;
  assert.equal(record.status, "offline");
  assert.equal((await request(`/cases/${id}`)).status, 404); checks++;
  assert.ok(!(await json("/api/public")).items.some((item) => item.id === id));
  assert.doesNotMatch(await (await request("/sitemap.xml")).text(), new RegExp(`/cases/${id}`)); checks++;
  record = (await json("/api/content", { action: "relist", id, revision: record.revision })).record;
  html = await detail(); assert.match(html, /首个公开版本/); assert.doesNotMatch(html, /未发布秘密内容/);
  record = (await json("/api/content", { action: "publish", id, revision: record.revision, draft: record.draft })).record;
  assert.match(await detail(), /未发布秘密内容/);
  await json("/api/content", { action: "delete", id, revision: record.revision }, 400);
  const tags = (await json("/api/public")).tags;
  tags.groups[0].label = "共享标签测试";
  await json("/api/tags", tags);
  assert.equal((await json("/api/public")).tags.groups[0].label, "共享标签测试");
  await json("/api/tags", tags, 409);
  console.log("PASS unlist, relist previous version, explicit republish and shared tags");

  const stopped = new Promise((resolve) => child.once("exit", resolve));
  stop(); await stopped;
  await start();
  assert.match(await detail(), /未发布秘密内容/);
  assert.deepEqual(Buffer.from(await (await request(media.url)).arrayBuffer()), image); checks++;
  assert.equal((await json("/api/public")).tags.groups[0].label, "共享标签测试");
  console.log(`PASS ${checks} HTTP checks, including persistence after a full server restart`);
} catch (error) {
  console.error(error); console.error(output.slice(-7000)); process.exitCode = 1;
} finally {
  clearTimeout(deadline);
  const stopped = child && child.exitCode === null ? new Promise((resolve) => child.once("exit", resolve)) : Promise.resolve();
  stop(); await stopped;
  const resolved = path.resolve(directory);
  if (path.dirname(resolved) !== path.resolve(tmpdir()) || !path.basename(resolved).startsWith("jingjie-http-")) throw new Error("Unsafe test cleanup path");
  await rm(resolved, { recursive: true, force: true });
}
