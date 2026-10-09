import test from "node:test";
import assert from "node:assert/strict";
import { createInitialDocument } from "../src/server/repository.js";
import { handleMcpRequest } from "../src/server/mcp.js";
import { OssMediaStorage } from "../src/server/storage/oss.js";
import { JsonDataProvider } from "../src/server/storage/json.js";

const endpoint = "https://jingjie.example/mcp";
const toolNames = ["jingjie_get_draft", "jingjie_get_submission_status", "jingjie_presign", "jingjie_submit_case", "jingjie_update_draft"];

function repositoryOptions() {
  let document = createInitialDocument([]);
  const oss = new OssMediaStorage({ env: {
    JINGJIE_OSS_BUCKET: "unit-bucket", JINGJIE_OSS_REGION: "cn-hangzhou",
    JINGJIE_OSS_ACCESS_KEY_ID: "unit-id", JINGJIE_OSS_ACCESS_KEY_SECRET: "unit-secret",
  } });
  const client = oss.client();
  const sign = client.signatureUrlV4.bind(client);
  client.signatureUrlV4 = async (method, ...args) => {
    assert.equal(method, "PUT");
    return sign(method, ...args);
  };
  for (const method of ["head", "get", "getStream", "put", "putStream", "copy", "delete", "request"]) {
    client[method] = async () => assert.fail(`MCP signing must not call OSS ${method}`);
  }
  const provider = {
    oss,
    async read() { return structuredClone(document); },
    async update(work) {
      const next = structuredClone(document);
      const result = await work(next);
      document = next;
      return structuredClone(result);
    },
    async close() {},
    async canonicalizeMediaUrls(value) { return structuredClone(value); },
  };
  for (const method of ["planMediaUploads", "presignMedia", "getPlannedMediaReference", "getMediaReference", "registeredMedia", "resolveMediaReference"]) {
    provider[method] = JsonDataProvider.prototype[method];
  }
  return { provider };
}

function toolOutput(message) {
  assert.notEqual(message.result.isError, true);
  return message.result.structuredContent ?? JSON.parse(message.result.content.find((item) => item.type === "text").text);
}

async function rpc(options, method, params = {}, headers = {}, id = 1) {
  const request = new Request(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...headers },
    body: JSON.stringify({ jsonrpc: "2.0", ...(id != null && { id }), method, params }),
  });
  const response = await handleMcpRequest(request, { repositoryOptions: options });
  const text = await response.text();
  const messages = text.startsWith("{") ? [JSON.parse(text)] : text.split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => JSON.parse(line.slice(5).trim()));
  return { response, message: messages.find((message) => message.id === id), text };
}

test("a remote client initializes, discovers the server's tool contracts, and calls a tool", async () => {
  const options = repositoryOptions();
  const initialized = await rpc(options, "initialize", {
    protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "local-shot-analysis", version: "1.0.0" },
  });
  assert.equal(initialized.response.status, 200);
  assert.equal(initialized.message.result.protocolVersion, "2025-11-25");
  assert.ok(initialized.message.result.capabilities.tools);
  assert.match(initialized.message.result.instructions, /草稿|draft/i);

  const notification = await rpc(options, "notifications/initialized", {}, { "MCP-Protocol-Version": "2025-11-25" }, null);
  assert.equal(notification.response.status, 202);

  const listed = await rpc(options, "tools/list", {}, { "MCP-Protocol-Version": "2025-11-25" });
  assert.equal(listed.response.status, 200);
  const tools = listed.message.result.tools;
  assert.deepEqual(tools.map((tool) => tool.name).sort(), toolNames);
  for (const tool of tools) {
    assert.ok(tool.description.length > 20);
    assert.equal(tool.inputSchema.type, "object");
  }
  const prepare = tools.find((tool) => tool.name === "jingjie_presign");
  assert.equal(prepare.inputSchema.properties.requestId.type, "string");
  assert.deepEqual(prepare.inputSchema.required.sort(), ["files", "requestId"]);
  assert.equal(prepare.inputSchema.properties.urls, undefined);
  assert.equal(prepare.inputSchema.additionalProperties, false);
  const file = prepare.inputSchema.properties.files.items;
  for (const field of ["localName", "kind", "mime", "size"]) assert.ok(file.required.includes(field));
  const submit = tools.find((tool) => tool.name === "jingjie_submit_case");
  for (const field of ["submissionId", "data", "assets"]) assert.ok(submit.inputSchema.required.includes(field));
  assert.equal(prepare.outputSchema.properties.uploads.items.properties.uploadUrl.type, "string");
  assert.equal(prepare.outputSchema.properties.uploads.items.properties.headers.type, "object");
  assert.equal(prepare.outputSchema.properties.uploads.items.properties.mediaUrl.type, "string");
  assert.equal(prepare.outputSchema.properties.uploads.items.properties.uploadExpiresAt.type, "string");
  assert.equal(prepare.outputSchema.properties.accesses, undefined);
  assert.equal(prepare.outputSchema.properties.uploads.items.properties.url, undefined);
  assert.equal(prepare.outputSchema.properties.uploads.items.properties.expiresAt, undefined);
  assert.equal(submit.outputSchema.properties.status.const, "draft");
  assert.match(submit.outputSchema.properties.caseId.description, /草稿 ID/);
  assert.equal(submit.outputSchema.properties.warnings.items.type, "string");
  const getDraft = tools.find((tool) => tool.name === "jingjie_get_draft");
  assert.equal(getDraft.annotations.readOnlyHint, true);
  assert.deepEqual(getDraft.inputSchema.required, ["caseId"]);
  const updateDraft = tools.find((tool) => tool.name === "jingjie_update_draft");
  assert.deepEqual(updateDraft.inputSchema.required.sort(), ["caseId", "patch", "revision"]);
  assert.equal(updateDraft.inputSchema.properties.patch.additionalProperties, false);
  assert.equal(updateDraft.inputSchema.properties.patch.properties.video.properties.durationSeconds.type, "number");
  const status = tools.find((tool) => tool.name === "jingjie_get_submission_status");
  assert.equal(status.annotations.readOnlyHint, true);
  assert.equal(status.outputSchema.properties.uploads, undefined);

  const called = await rpc(options, "tools/call", {
    name: "jingjie_get_submission_status", arguments: { submissionId: "submission-not-found" },
  }, { "MCP-Protocol-Version": "2025-11-25" });
  assert.equal(called.response.status, 200);
  assert.equal(called.message.result.isError, true);
  assert.match(called.message.result.content.map((item) => item.text ?? "").join("\n"), /不存在|not found/i);
  assert.equal(called.message.result.structuredContent.error.status, 404);
});

test("clients can discover and read the backend's submission guide as an MCP resource", async () => {
  const options = repositoryOptions();
  const listed = await rpc(options, "resources/list");
  assert.equal(listed.response.status, 200);
  const resource = listed.message.result.resources.find((item) => item.uri === "jingjie://submission-guide");
  assert.ok(resource);
  assert.equal(resource.mimeType, "text/plain");
  const read = await rpc(options, "resources/read", { uri: resource.uri });
  assert.equal(read.response.status, 200);
  const guide = read.message.result.contents[0];
  assert.equal(guide.uri, resource.uri);
  assert.match(guide.text, /PUT/);
  assert.match(guide.text, /原始文件字节/);
  assert.match(guide.text, /草稿/);
  assert.match(guide.text, /jingjie_get_submission_status/);
  assert.match(guide.text, /jingjie_presign/);
  assert.match(guide.text, /PUT 成功即可直接用 mediaUrl 预览，无需确认或复制/);
  assert.match(guide.text, /public-read/);
  assert.doesNotMatch(guide.text, /GET 签名|续签|accesses/);
  assert.doesNotMatch(guide.text, /jingjie_prepare_upload|jingjie_get_media_access/);
});


test("same-origin requests and clients without Origin can connect; foreign browser origins are rejected", async () => {
  const options = repositoryOptions();
  for (const headers of [{}, { Origin: "https://jingjie.example" }]) {
    const { response, message } = await rpc(options, "tools/list", {}, headers);
    assert.equal(response.status, 200);
    assert.deepEqual(message.result.tools.map((tool) => tool.name).sort(), toolNames);
  }
  const response = await handleMcpRequest(new Request(endpoint, {
    method: "POST",
    headers: { Origin: "https://unrelated.example", "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
  }), { repositoryOptions: options });
  assert.equal(response.status, 403);
});

test("tool calls return upload URLs and save an incomplete draft without exposing server credentials", async () => {
  const options = repositoryOptions();
  const prepared = await rpc(options, "tools/call", {
    name: "jingjie_presign",
    arguments: { requestId: "http-import", files: [{ localName: "cover.png", kind: "image", mime: "image/png", size: 12 }] },
  });
  assert.equal(prepared.response.status, 200);
  const planned = toolOutput(prepared.message);
  assert.equal(planned.status, "prepared");
  assert.ok(new URL(planned.uploads[0].uploadUrl).searchParams.get("x-oss-signature"));
  assert.equal(planned.uploads[0].url, undefined);
  assert.equal(planned.uploads[0].expiresAt, undefined);
  assert.equal(planned.accesses, undefined);
  assert.equal(new URL(planned.uploads[0].mediaUrl).search, "");
  assert.match(planned.uploads[0].objectKey, /^jingjie\/media\//);
  assert.equal(planned.uploads[0].headers["Content-Type"], "image/png");
  assert.equal(planned.uploads[0].headers["x-oss-object-acl"], "public-read");
  assert.doesNotMatch(prepared.text, /accessKeySecret|securityToken/i);

  const committed = await rpc(options, "tools/call", {
    name: "jingjie_submit_case",
    arguments: { submissionId: planned.submissionId, data: { kind: "image", title: "尚未上传图片", image: "cover.png" }, assets: [] },
  });
  assert.equal(committed.response.status, 200);
  const saved = toolOutput(committed.message);
  assert.equal(saved.status, "draft");
  assert.ok(saved.warnings.length);
  assert.match(saved.previewUrl, /^https:\/\/jingjie\.example\/case-preview\?id=/);
  const document = await options.provider.read();
  assert.equal(document.content.length, 1);
  assert.equal(document.content[0].published, null);
  assert.equal(document.content[0].status, "draft");
});

test("a client reads and repairs an imported draft by its returned case ID without resubmitting", async () => {
  const options = repositoryOptions();
  const call = async (name, arguments_) => rpc(options, "tools/call", { name, arguments: arguments_ });
  const planned = toolOutput((await call("jingjie_presign", { requestId: "repair-duration", files: [] })).message);
  const data = { title: "待补真实时长", shots: [{ id: "S01", start: 0, end: 10, frame: "已记录镜头" }] };
  const saved = toolOutput((await call("jingjie_submit_case", { submissionId: planned.submissionId, data, assets: [] })).message);
  assert.ok(saved.caseId);
  assert.ok(saved.warnings.some((warning) => /meta.durationSeconds/.test(warning)));

  const current = toolOutput((await call("jingjie_get_draft", { caseId: saved.caseId })).message);
  assert.equal(current.caseId, saved.caseId);
  assert.equal(current.revision, 1);
  assert.equal(current.draft.video.durationSeconds, 0);
  const patch = { video: { durationSeconds: 29.966667 } };
  const updated = toolOutput((await call("jingjie_update_draft", { caseId: current.caseId, revision: current.revision, patch })).message);
  assert.equal(updated.revision, 2);
  assert.equal(updated.draft.video.durationSeconds, 29.966667);
  assert.deepEqual(updated.draft.video.shots, current.draft.video.shots);
  assert.equal(updated.status, "draft");
  const reread = toolOutput((await call("jingjie_get_draft", { caseId: saved.caseId })).message);
  assert.deepEqual(reread, updated);

  const stale = await call("jingjie_update_draft", { caseId: saved.caseId, revision: 1, patch: { title: "过期修改" } });
  assert.equal(stale.message.result.isError, true);
  assert.equal(stale.message.result.structuredContent.error.status, 409);
  const invalid = await call("jingjie_update_draft", { caseId: saved.caseId, revision: 2, patch: { video: { durationSeconds: -1 } } });
  assert.equal(invalid.message.result.structuredContent.error.status, 400);
  assert.match(invalid.message.result.structuredContent.error.message, /时长/);
  for (const [name, arguments_] of [
    ["jingjie_get_draft", { caseId: "missing-draft" }],
    ["jingjie_update_draft", { caseId: "missing-draft", revision: 1, patch: { title: "不得新建" } }],
  ]) assert.equal((await call(name, arguments_)).message.result.structuredContent.error.status, 404);

  for (const patch of [{ id: "other-case" }, { meta: { durationSeconds: 30 } }, { video: { duration: 30 } }]) {
    const rejected = await call("jingjie_update_draft", { caseId: saved.caseId, revision: 2, patch });
    assert.ok(rejected.message.error || rejected.message.result?.isError);
  }
  const status = toolOutput((await call("jingjie_get_submission_status", { submissionId: planned.submissionId })).message);
  assert.deepEqual(status.result, saved);
  assert.deepEqual(toolOutput((await call("jingjie_submit_case", { submissionId: planned.submissionId, data, assets: [] })).message), saved);
  const document = await options.provider.read();
  assert.equal(document.content.length, 1);
  assert.equal(document.content[0].revision, 2);
  assert.equal(document.content[0].draft.title, data.title);
  assert.equal(document.content[0].published, null);
  assert.equal(document.submissions[0].source.data.meta, undefined);
});

test("invalid tool arguments and malformed JSON produce explicit protocol errors without writing a draft", async () => {
  const options = repositoryOptions();
  const malformed = await handleMcpRequest(new Request(endpoint, {
    method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" }, body: "{broken",
  }), { repositoryOptions: options });
  assert.equal(malformed.status, 400);

  const invalid = await rpc(options, "tools/call", { name: "jingjie_presign", arguments: { files: [] } });
  assert.equal(invalid.response.status, 200);
  assert.ok(invalid.message.error || invalid.message.result?.isError);
  const planned = toolOutput((await rpc(options, "tools/call", {
    name: "jingjie_presign", arguments: { requestId: "invalid-source", files: [] },
  })).message);
  const invalidSource = await rpc(options, "tools/call", {
    name: "jingjie_submit_case", arguments: { submissionId: planned.submissionId, data: { kind: "image", title: 123 }, assets: [] },
  });
  assert.equal(invalidSource.message.result.isError, true);
  assert.equal(invalidSource.message.result.structuredContent.error.status, 400);
  assert.match(invalidSource.message.result.structuredContent.error.message, /title/);
  assert.deepEqual((await options.provider.read()).content, []);
});

test("the upload signing tool rejects removed access inputs without registering media or submissions", async () => {
  const options = repositoryOptions();
  const mediaUrl = "https://unit-bucket.oss-cn-hangzhou.aliyuncs.com/jingjie/media/12345678-1234-4234-9234-123456789abc.png";
  for (const arguments_ of [
    { urls: [mediaUrl] },
    { requestId: "removed-access-input", files: [], urls: [mediaUrl] },
    { requestId: "missing-files" },
    { files: [] },
  ]) {
    const called = await rpc(options, "tools/call", { name: "jingjie_presign", arguments: arguments_ });
    assert.ok(called.message.error || called.message.result?.isError);
  }
  const document = await options.provider.read();
  assert.deepEqual(document.media, []);
  assert.deepEqual(document.submissions, []);
});

test("the stateless HTTP endpoint does not leave an anonymous GET waiting on a stream", async () => {
  const response = await handleMcpRequest(new Request(endpoint, {
    headers: { Accept: "application/json, text/event-stream" },
  }), { repositoryOptions: repositoryOptions() });
  assert.equal(response.status, 405);
});

test("modern MCP discovery exposes the same tools without the legacy initialize handshake", async () => {
  const options = repositoryOptions();
  const metadata = {
    "io.modelcontextprotocol/protocolVersion": "2026-07-28",
    "io.modelcontextprotocol/clientInfo": { name: "local-shot-analysis", version: "1.0.0" },
    "io.modelcontextprotocol/clientCapabilities": {},
  };
  const discover = await rpc(options, "server/discover", { _meta: metadata }, { "MCP-Protocol-Version": "2026-07-28", "Mcp-Method": "server/discover" });
  assert.equal(discover.response.status, 200, discover.text);
  assert.ok(discover.message.result.capabilities.tools);
  const listed = await rpc(options, "tools/list", { _meta: metadata }, { "MCP-Protocol-Version": "2026-07-28", "Mcp-Method": "tools/list" });
  assert.equal(listed.response.status, 200);
  assert.deepEqual(listed.message.result.tools.map((tool) => tool.name).sort(), toolNames);
  const called = await rpc(options, "tools/call", {
    _meta: metadata, name: "jingjie_presign", arguments: { requestId: "modern-upload", files: [] },
  }, { "MCP-Protocol-Version": "2026-07-28", "Mcp-Method": "tools/call", "Mcp-Name": "jingjie_presign" });
  assert.equal(called.response.status, 200, called.text);
  assert.equal(toolOutput(called.message).status, "prepared");
  const failure = await rpc(options, "tools/call", {
    _meta: metadata, name: "jingjie_get_submission_status", arguments: { submissionId: "missing-modern-submission" },
  }, { "MCP-Protocol-Version": "2026-07-28", "Mcp-Method": "tools/call", "Mcp-Name": "jingjie_get_submission_status" });
  assert.equal(failure.response.status, 200, failure.text);
  assert.equal(failure.message.result.isError, true);
  assert.equal(failure.message.result.structuredContent.error.status, 404);
});
