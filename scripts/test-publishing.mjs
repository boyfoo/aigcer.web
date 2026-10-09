import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, rm, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import nextEnv from "@next/env";
import { createDataProvider } from "../src/server/storage/provider.js";

const root = fileURLToPath(new URL("../", import.meta.url));
nextEnv.loadEnvConfig(root, false);
const directory = await mkdtemp(path.join(tmpdir(), "jingjie-http-"));
const socket = createServer();
await new Promise((resolve) => socket.listen(0, "127.0.0.1", resolve));
const port = socket.address().port;
await new Promise((resolve) => socket.close(resolve));
const origin = `http://127.0.0.1:${port}`;
let child, media, output = "", checks = 0;
const stop = () => {
  if (!child || child.exitCode !== null) return;
  if (process.platform === "win32") spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore", timeout: 5000 });
  else child.kill("SIGTERM");
};
const deadline = setTimeout(() => { stop(); console.error("Publishing HTTP checks exceeded 60 seconds"); process.exit(1); }, 60000);
const request = async (url, options = {}) => fetch(new URL(url, origin), { ...options, signal: AbortSignal.timeout(10000) });
const json = async (url, body, expected = 200) => {
  const response = await request(url, body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify(body) });
  const data = await response.json();
  assert.equal(response.status, expected, JSON.stringify(data)); checks++;
  return data;
};
const start = async () => {
  child = spawn(process.execPath, [path.join(root, "node_modules/next/dist/bin/next"), "start", "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, JINGJIE_DATA_PROVIDER: "json", JINGJIE_DATA_DIR: directory, SITE_URL: origin, JINGJIE_BUILD_TARGET: "server" },
  });
  console.log(`Publishing check server PID: ${child.pid}; readiness timeout: 20 seconds`);
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
  const mcp = async (method, params = {}) => {
    const response = await request("/mcp", {
      method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", "MCP-Protocol-Version": "2025-11-25" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    const text = await response.text();
    assert.equal(response.status, 200, text);
    checks++;
    return text.startsWith("{") ? JSON.parse(text) : JSON.parse(text.split(/\r?\n/).find((line) => line.startsWith("data:")).slice(5));
  };
  const initialized = await mcp("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "next-http-check", version: "1.0.0" } });
  assert.equal(initialized.result.serverInfo.name, "jingjie");
  const discovered = await mcp("tools/list");
  assert.deepEqual(discovered.result.tools.map((tool) => tool.name).sort(), ["jingjie_get_submission_status", "jingjie_presign", "jingjie_submit_case"]);
  const missingSubmission = await mcp("tools/call", { name: "jingjie_get_submission_status", arguments: { submissionId: "missing" } });
  assert.equal(missingSubmission.result.isError, true);
  assert.match(missingSubmission.result.content[0].text, /不存在/);
  console.log("PASS remote MCP discovery and tool invocation through the production Next.js route");
  const image = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
  const signed = await json("/api/oss/presign", { uploads: [{ name: "reference.png", kind: "image", mime: "image/png", size: image.length }] });
  media = signed.uploads[0];
  assert.deepEqual(Object.keys(signed), ["uploads"]);
  assert.equal(new URL(media.mediaUrl).search, "");
  assert.equal(media.url, undefined);
  assert.equal(media.expiresAt, undefined);
  assert.equal(media.headers["x-oss-object-acl"], "public-read");
  const upload = await request(media.uploadUrl, { method: "PUT", headers: media.headers, body: image });
  assert.equal(upload.status, 200); checks++;
  assert.deepEqual(Buffer.from(await (await request(media.mediaUrl)).arrayBuffer()), image); checks++;
  const range = await request(media.mediaUrl, { headers: { Range: "bytes=0-7" } });
  assert.equal(range.status, 206); assert.deepEqual(Buffer.from(await range.arrayBuffer()), image.subarray(0, 8)); checks++;
  await json("/api/oss/presign", { urls: [media.mediaUrl] }, 400);
  await json("/api/oss/presign", { uploads: [{ name: "unsupported.svg", kind: "image", mime: "image/svg+xml", size: 32 }] }, 415);
  await json("/api/oss/presign", { uploads: [{ name: "oversized.png", kind: "image", mime: "image/png", size: 20 * 1024 * 1024 + 1 }] }, 413);
  assert.equal((await request("/api/content", { method: "POST", headers: { Origin: "https://another.example", "Content-Type": "application/json" }, body: "{}" })).status, 403); checks++;
  console.log("PASS batch presigning, direct OSS upload and playback, ranges, file limits and origin checks");

  let record = (await json("/api/content", { action: "save", draft: { kind: "分镜", title: "独立流程测试", image: media.mediaUrl } })).record;
  assert.equal(record.draft.image, media.mediaUrl);
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

  const videoSample = (await json("/api/public")).items.find((item) => item.video?.src);
  let study = (await json("/api/content", { action: "save", draft: { kind: "视频", title: "整片阅读验证", image: media.mediaUrl, video: { src: videoSample.video.src, durationSeconds: 6, metadata: { width: 1920, height: 1080, fps: 24, hasAudio: true }, cast: [{ id: "keeper", name: "守门人", note: "带领观众进入故事", image: media.mediaUrl }], shots: [{ id: "context-shot", start: 0, end: 6, title: "进入画面", endImage: media.mediaUrl, narrative: "通过停顿引出下一段", sound: "远处钟声", dialogue: "继续向前", onscreenText: "入口", category: "定场", rhythm: "铺垫", transition: "淡入", subjects: ["keeper"], review: { boundary: { confirmed: true, note: "已对照片头的切点" } } }] } } })).record;
  study = (await json("/api/content", { action: "publish", id: study.id, revision: study.revision, draft: study.draft })).record;
  const studyHtml = (await (await request(`/cases/${study.id}`)).text()).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
  for (const text of ["整片总览", "单镜头细读", "跟随播放", "镜头时间轴", "通过停顿引出下一段", "远处钟声", "继续向前", "画面文字", "整片统计", "平均镜长", "出场人物", "守门人", "质量检查", "已对照片头的切点", "导出", "定场", "铺垫", media.mediaUrl]) assert.ok(studyHtml.includes(text), text);
  // Metadata is in the on-demand export dialog, so verify its persisted public data.
  assert.deepEqual((await json("/api/public")).items.find((item) => item.id === study.id).video.metadata, study.draft.video.metadata);
  assert.doesNotMatch(studyHtml, /模拟拉片与标注|示例拆解/);
  assert.equal((await json("/api/content")).records.find((record) => record.id === study.id).draft.video.shots[0].endImage, media.mediaUrl);
  study = (await json("/api/content", { action: "save", id: study.id, revision: study.revision, draft: { ...study.draft, video: { ...study.draft.video, cast: [{ ...study.draft.video.cast[0], name: "尚未发布的人物姓名" }] } } })).record;
  assert.doesNotMatch(await (await request(`/cases/${study.id}`)).text(), /尚未发布的人物姓名/);
  console.log("PASS shot tail upload, optional context and overview in initial HTML");

  const stopped = new Promise((resolve) => child.once("exit", resolve));
  stop(); await stopped;
  await start();
  const restoredStudy = (await json("/api/public")).items.find((item) => item.id === study.id);
  assert.equal(restoredStudy.video.shots[0].sound, "远处钟声");
  assert.equal(restoredStudy.video.shots[0].endImage, media.mediaUrl);
  assert.equal(restoredStudy.video.metadata.fps, 24);
  assert.equal(restoredStudy.video.cast[0].name, "守门人");
  assert.deepEqual(restoredStudy.video.shots[0].subjects, ["keeper"]);
  assert.equal(restoredStudy.video.shots[0].review.boundary.note, "已对照片头的切点");
  assert.match(await detail(), /未发布秘密内容/);
  assert.deepEqual(Buffer.from(await (await request(media.mediaUrl)).arrayBuffer()), image); checks++;
  assert.equal((await json("/api/public")).tags.groups[0].label, "共享标签测试");
  const stored = JSON.parse(await readFile(path.join(directory, "content.json"), "utf8"));
  assert.equal(stored.version, 3);
  assert.ok(stored.items.some((row) => row.id === study.id));
  assert.equal(stored.items.find((row) => row.id === study.id).draft, undefined);
  const studyFile = JSON.parse(await readFile(path.join(directory, "content", `${study.id}.json`), "utf8"));
  assert.equal(studyFile.draft.video.cast[0].name, "尚未发布的人物姓名");
  assert.equal(studyFile.published.video.cast[0].name, "守门人");
  const mediaFile = JSON.parse(await readFile(path.join(directory, "media.json"), "utf8"));
  assert.equal(mediaFile.items.find((item) => media.mediaUrl.endsWith(`/${item.name}`)).originalName, "reference.png");
  const tagFile = JSON.parse(await readFile(path.join(directory, "tags.json"), "utf8"));
  assert.equal(tagFile.groups[0].label, "共享标签测试");
  const submissions = JSON.parse(await readFile(path.join(directory, "submissions.json"), "utf8"));
  assert.equal(submissions.version, 1);
  assert.deepEqual(submissions.items, []);
  assert.ok(!(await readdir(directory)).some((name) => name.includes("sqlite")));
  checks++;
  console.log(`PASS ${checks} HTTP checks, including persistence after a full server restart`);
} catch (error) {
  console.error(error); console.error(output.slice(-7000)); process.exitCode = 1;
} finally {
  clearTimeout(deadline);
  const stopped = child && child.exitCode === null ? new Promise((resolve) => child.once("exit", resolve)) : Promise.resolve();
  stop(); await stopped;
  if (media) {
    const provider = createDataProvider({ directory });
    const ownMedia = await provider.resolveMediaReference(media.mediaUrl);
    assert.equal(ownMedia?.originalName, "reference.png");
    await provider.removeMedia(ownMedia.name);
    await provider.close();
  }
  const resolved = path.resolve(directory);
  if (path.dirname(resolved) !== path.resolve(tmpdir()) || !path.basename(resolved).startsWith("jingjie-http-")) throw new Error("Unsafe test cleanup path");
  await rm(resolved, { recursive: true, force: true });
}
