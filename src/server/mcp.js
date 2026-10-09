import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod/v4";
import { withRepository } from "./repository.js";
import { sameOrigin, json } from "./http.js";
import { ContentError } from "./errors.js";
import { createSubmissionService, MAX_SUBMISSION_FILES } from "./mcpSubmissions.js";
import { MEDIA_TYPES } from "../lib/mediaFormats.js";

const guide = `镜界用于保存和学习真实视频、图片及逐镜头资料。当用户明确要求“提交到镜界”“上传到镜界”或“把拉片结果保存到镜界”时，使用本服务保存新的草稿，发布由作者在网站单独操作。
新提交依次执行：jingjie_prepare_upload 申请地址 → 本地工具 PUT 上传素材 → jingjie_submit_case 保存资料。已有 submissionId 的中断或重试先调用 jingjie_get_submission_status；不能在本地素材尚未上传时把它列为上传成功，也不要重复创建提交。
1. 在本地读取原始 shots.json 和素材目录。为这次提交生成并保留唯一 requestId，将素材 localName（输出目录内相对路径）、kind、mime、真实字节数提交给 jingjie_prepare_upload。
2. 后端按文件返回 assetId、objectKey、稳定 url、临时 uploadUrl、headers、expiresAt。使用本地 HTTP/终端工具，以 PUT 和原始文件字节上传，所有返回的 headers 必须原样携带。不要发送 FormData、文件路径字符串或外部 URL 文本作为文件内容。OSS 密钥始终在后端。
3. 上传完成后调用 jingjie_submit_case，data 传原始 shots.json（无需重写英文枚举），assets 只列真正上传成功的 assetId，可附返回的 url 和 objectKey。单张图片的 data 使用 {kind:"image",title,image:"原始localName",description,analysis,prompt}。
4. 网络中断或 uploadUrl 过期时调用 jingjie_get_submission_status；uploaded 文件跳过，只用新地址上传 awaiting_upload 文件。unavailable 表示暂时无法核验，保留标识稍后查询；invalid 表示文件核验失败，修正后用新 requestId 重新申请，原对象禁止覆盖。正常重试必须沿用 requestId、submissionId，保存结果不确定时重试原 submit 参数，不创建新的提交。
5. 视频 source 对应视频 localName；首尾帧默认 frames/S01a.jpg、frames/S01b.jpg，可在每镜 image/endImage 指定相对路径。人物图片可在 cast.image 指定。后端保留原始资料，将 frame 映射到概述、size/camera 到景别/运镜、rhythmNote 到叙事，audio 视为来源提供的台词，不视为自动转写。
6. 完成 jingjie_submit_case 登记后，需要查看私有图片或视频时，用无签名的稳定 url 调用 jingjie_get_media_access。返回的 url 是默认 1 小时有效的 GET 签名，客户端直接访问 OSS；mediaUrl 用于长期保存，expiresAt 表示访问期限。uploadUrl 只用于 PUT，不能用来读取，未登记的临时素材须先完成提交。后端不返回素材文件字节。
最多100镜头、50人物、252素材、1条原视频。图片最大20MiB、视频最大512MiB。缺失帧、未录入资料保留为空并提示；不推测提示词、模型参数，不把机器检查导入为作者人工复核。返回编辑链接、预览链接和实际缺失项。`;

const requestId = z.string().regex(/^[a-zA-Z0-9_-]{1,120}$/).describe("本次提交的唯一标识，建议 UUID；重试沿用，新的提交才换标识。");
const submissionId = z.string().describe("jingjie_prepare_upload 返回的 submissionId。");
const file = z.object({
  localName: z.string().min(1).max(300).describe("本地输出目录内的相对文件路径，例如 video.mp4 或 frames/S01a.jpg。"),
  kind: z.enum(["image", "video"]),
  mime: z.enum(Object.keys(MEDIA_TYPES)),
  size: z.number().int().positive().describe("文件的真实字节数。"),
}).strict();
const result = z.object({
  submissionId: z.string(), status: z.literal("draft"), caseId: z.string(), revision: z.number().int(), title: z.string(),
  previewUrl: z.string(), editUrl: z.string(), warnings: z.array(z.string()), mediaCount: z.number().int(), shotCount: z.number().int(),
});
const prepared = z.object({
  submissionId: z.string(), status: z.enum(["prepared", "submitted"]), result: result.optional(), instructions: z.string().optional(),
  uploads: z.array(file.extend({
    assetId: z.string(), objectKey: z.string(), url: z.string().describe("稳定素材网址；提交时可传回此地址。"),
    uploadUrl: z.string().describe("临时 OSS PUT 地址，仅用于上传。"), headers: z.record(z.string(), z.string()), expiresAt: z.string(),
  })).optional(),
});
const status = prepared.extend({ files: z.array(z.object({
  assetId: z.string(), localName: z.string(), status: z.enum(["uploaded", "awaiting_upload", "invalid", "unavailable"]), message: z.string().optional(),
})).optional() });
const annotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true };

export function createJingjieMcpServer({ repositoryOptions, origin = "" } = {}) {
  const server = new McpServer({ name: "jingjie", version: "1.0.0", title: "镜界 · 视频、图片与拉片资料提交" }, { instructions: guide });
  const invoke = (method) => async (arguments_) => {
    try {
      const result = await withRepository((repository) => createSubmissionService(repository, { origin })[method](arguments_), repositoryOptions);
      return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result };
    } catch (error) {
      const message = error instanceof ContentError && !error.code ? error.message : "服务器暂时无法完成提交，请保留提交标识和本地资料后重试。";
      const failure = { error: { message, status: error.status ?? 503 } };
      return { isError: true, content: [{ type: "text", text: JSON.stringify(failure) }], structuredContent: failure };
    }
  };
  server.registerTool("jingjie_prepare_upload", {
    title: "镜界 · 准备上传视频和图片",
    description: "将本地视频、图片或拉片资料提交到镜界时使用，适用于“提交到镜界”“上传到镜界”“把拉片结果保存到镜界”等请求。这是新提交的第一步：批量申请 OSS 预签名 PUT 上传 URL，返回每文件的 assetId、objectKey、稳定 url、uploadUrl、headers 和有效期。随后用本地工具直接 PUT 上传原始文件字节，上传成功后调用 jingjie_submit_case。相同 requestId 和文件清单可安全重试，不能更换清单。",
    inputSchema: z.object({ requestId, files: z.array(file).max(MAX_SUBMISSION_FILES) }).strict(), outputSchema: prepared, annotations,
  }, invoke("prepareUpload"));
  server.registerTool("jingjie_submit_case", {
    title: "镜界 · 提交拉片资料并保存草稿",
    description: "完成用户“提交到镜界”或“把拉片结果保存到镜界”的请求，将本地拉片分析、视频或图片资料保存到镜界。先调用 jingjie_prepare_upload 获取 submissionId，并用本地工具完成素材直传；再提交原始 reelbench shots.json 或单图资料，以及真正上传成功的 assetId。后端核验素材、转换分镜字段、保存新草稿，不发布、不覆盖其他案例。缺失图片允许存草稿并明确提示，机器复核不能代替作者确认。重试使用原 submissionId 和相同资料。",
    inputSchema: z.object({
      submissionId,
      data: z.record(z.string(), z.unknown()).describe("原始 shots.json 对象；或 {kind:'image',title,image:localName,description,analysis,prompt}。未知原始字段保存在私有来源资料中。"),
      assets: z.array(z.object({
        assetId: z.string(), url: z.string().optional().describe("prepare 返回的稳定 url，不能传临时 uploadUrl。"),
        objectKey: z.string().optional().describe("prepare 返回的 OSS objectKey。"),
      }).strict()).max(MAX_SUBMISSION_FILES),
    }).strict(), outputSchema: result, annotations,
  }, invoke("submitCase"));
  server.registerTool("jingjie_get_submission_status", {
    title: "镜界 · 查询提交状态和恢复上传",
    description: "用户询问“提交到镜界的进度”“镜界提交成功了吗”“继续上传到镜界”，或向镜界提交时断网、超时、上传地址过期时使用。需要先前返回的 submissionId，查询保存结果和每文件核验状态，未保存时返回新预签名地址。uploaded 跳过，awaiting_upload 沿用提交上传，unavailable 稍后查询；invalid 修正文件后用新 requestId 重新申请，原对象禁止覆盖。已保存时返回同一草稿的结果和链接。",
    inputSchema: z.object({ submissionId }).strict(), outputSchema: status,
    annotations: { ...annotations, readOnlyHint: true },
  }, invoke("getSubmissionStatus"));
  server.registerTool("jingjie_get_media_access", {
    title: "镜界 · 获取私有素材访问地址",
    description: "查看已登记的私有图片或视频时，用无签名 OSS 素材网址获取默认 1 小时有效的 GET 签名地址。客户端直接读取 OSS，后端只签发地址，不传输素材字节。新上传的临时对象须先完成 jingjie_submit_case 登记；不接受临时 PUT 地址、任意 Bucket 或对象 Key。",
    inputSchema: z.object({ url: z.string().url().max(2048).describe("已登记的无签名 OSS 素材完整网址。") }).strict(),
    outputSchema: z.object({
      url: z.string().describe("临时 OSS GET 签名地址，仅用于直接读取。"),
      mediaUrl: z.string().describe("长期保存的无签名 OSS 素材地址。"),
      expiresAt: z.string().describe("GET 签名访问期限，ISO 8601 格式。"),
    }),
    annotations: { ...annotations, readOnlyHint: true },
  }, invoke("getMediaAccess"));
  server.registerResource("submission-guide", "jingjie://submission-guide", {
    title: "镜界 · 提交流程与数据约定", description: "用户要求“提交到镜界”时，本地拉片资料、视频和图片的直传与草稿保存流程。", mimeType: "text/plain",
  }, async () => ({ contents: [{ uri: "jingjie://submission-guide", mimeType: "text/plain", text: guide }] }));
  return server;
}

function validateOrigin(request) {
  const origin = request.headers.get("origin");
  const allowed = (process.env.JINGJIE_MCP_ALLOWED_ORIGINS || "").split(",").map((item) => item.trim()).filter(Boolean);
  if (origin && allowed.includes(origin)) return;
  sameOrigin(request);
}

export async function handleMcpRequest(request, { repositoryOptions, origin } = {}) {
  try {
    validateOrigin(request);
    const publicOrigin = origin || process.env.SITE_URL || new URL(request.url).origin;
    const handler = createMcpHandler(() => createJingjieMcpServer({ repositoryOptions, origin: publicOrigin }), {
      legacy: "stateless", responseMode: "auto", maxRequestBodySize: 2 * 1024 * 1024,
    });
    const response = request.method === "OPTIONS"
      ? new Response(null, { status: 204 })
      : await handler.fetch(request);
    const headers = new Headers(response.headers);
    headers.set("Cache-Control", "no-store");
    headers.set("X-Content-Type-Options", "nosniff");
    if (request.headers.has("origin")) {
      headers.set("Access-Control-Allow-Origin", request.headers.get("origin"));
      headers.set("Vary", "Origin");
      headers.set("Access-Control-Allow-Methods", "POST, GET, DELETE, OPTIONS");
      headers.set("Access-Control-Allow-Headers", "Content-Type, Accept, MCP-Protocol-Version, Mcp-Session-Id, Mcp-Method, Mcp-Name");
    }
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  } catch (error) {
    return json({ error: error instanceof ContentError ? error.message : "MCP 服务暂时不可用，请稍后重试。" }, error.status || 503);
  }
}
