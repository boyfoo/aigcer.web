import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod/v4";
import { withRepository } from "./repository.js";
import { sameOrigin, json } from "./http.js";
import { ContentError } from "./errors.js";
import { createSubmissionService, MAX_SUBMISSION_FILES } from "./mcpSubmissions.js";
import { createDraftService, draftPatchSchema } from "./mcpDrafts.js";
import { MEDIA_TYPES } from "../lib/mediaFormats.js";

const guide = `镜界用于保存和学习真实视频、图片及逐镜头资料。当用户明确要求“提交到镜界”“上传到镜界”或“把拉片结果保存到镜界”时，使用本服务保存新的草稿，发布由作者在网站单独操作。
新提交依次执行：jingjie_presign 批量申请地址 → 本地工具 PUT 直接上传正式 OSS 对象并预览 → jingjie_submit_case 保存资料。已有 submissionId 的中断或重试先调用 jingjie_get_submission_status；不能在本地素材尚未上传时把它列为上传成功，也不要重复创建提交。
1. 在本地读取原始 shots.json 和素材目录。为这次提交生成并保留唯一 requestId，将 files 的 localName（输出目录内相对路径）、kind、mime、真实字节数提交给 jingjie_presign。没有素材的草稿可传 files:[]。
2. 后端按文件返回 assetId、objectKey、公开 mediaUrl、PUT 签名 uploadUrl 及 uploadExpiresAt、headers。使用本地 HTTP/终端工具，以 PUT 和原始文件字节直接上传正式 OSS 对象，所有返回的 headers 必须原样携带，包含 public-read 权限；PUT 成功即可直接用 mediaUrl 预览，无需确认或复制。不要发送 FormData、文件路径字符串或外部 URL 文本作为文件内容。OSS 密钥始终在后端。
3. 上传完成后调用 jingjie_submit_case，data 传原始 shots.json（无需重写英文枚举），assets 只列真正上传成功的 assetId，可附返回的 mediaUrl 和 objectKey；不能传 PUT 签名地址。单张图片的 data 使用 {kind:"image",title,image:"原始localName",description,analysis,prompt}。保存后保留 caseId（草稿 ID，也是稳定案例 ID）与 revision；submissionId 用于上传恢复，不是草稿 ID。
4. 网络中断先调用 jingjie_get_submission_status；uploaded 文件跳过，awaiting_upload 继续上传，unavailable 保留标识稍后查询，invalid 修正文件后用新 requestId 重新申请，原对象禁止覆盖。查询状态只核对对象元信息，不签发地址。PUT 签名过期时，用原 requestId 和相同 files 再调用 jingjie_presign。保存结果不确定时重试原 submit 参数，不创建新的提交。
5. 视频 source 对应视频 localName；真实视频时长必须使用 meta.durationSeconds（秒），分辨率与帧率用 meta.width、meta.height、meta.fps。顶层 duration 不会映射为视频时长；缺失时长会留为 0 并提示，发布前必须补充。首尾帧默认 frames/S01a.jpg、frames/S01b.jpg，可在每镜 image/endImage 指定相对路径。人物图片可在 cast.image 指定。后端保留原始资料，将 frame 映射到概述、size/camera 到景别/运镜、rhythmNote 到叙事，audio 视为来源提供的台词，不视为自动转写。
6. 查看图片或视频时直接访问公开 mediaUrl，不需要访问签名，也没有预览到期时间。上传时已预登记素材，PUT 成功后无需等待保存草稿即可读取。后端只签发 PUT 上传地址，不接收或返回素材文件字节。
7. 修改已有资料先调用 jingjie_get_draft({caseId})，获取当前 draft 与 revision，再调用 jingjie_update_draft({caseId,revision,patch})。patch 使用网站草稿字段，不使用原始 shots.json：例如补时长使用 {video:{durationSeconds:29.966667}}。未提供的字段保留；video、video.metadata、顶层 tagValues 按字段合并；shots、cast 和其他数组整体替换，编辑镜头先读取完整数组并沿用镜头 id。空字符串或 [] 清空对应值，案例 id 与类型不能修改。替换视频 src 时重置旧时长和参数，可在本次 patch 中明确提供新测量。新增素材先申请上传并 PUT，再使用公开 mediaUrl，后端核对登记、类型与 OSS HEAD 元信息。
8. 更新只保存编辑稿，不发布，不改变已发布或下架状态及公开快照；MCP 不导入人工复核确认，资料变化会清除受影响的旧确认。提交状态与原 submit 重试返回的是初次结果，当前版本必须用 jingjie_get_draft 读取。revision 冲突返回 409，重新读取后合并修改；更新结果不确定时读取最新草稿核对，不创建新案例或盲目重试覆盖。
最多100镜头、50人物、252素材、1条原视频。图片最大20MiB、视频最大512MiB。缺失帧、未录入资料保留为空并提示；不推测提示词、模型参数，不把机器检查导入为作者人工复核。返回草稿 ID caseId、版本 revision、编辑链接、预览链接和实际缺失项。`;

const requestId = z.string().regex(/^[a-zA-Z0-9_-]{1,120}$/).describe("本次提交的唯一标识，建议 UUID；重试沿用，新的提交才换标识。");
const submissionId = z.string().describe("jingjie_presign 返回的 submissionId。");
const caseId = z.string().min(1).max(150).describe("保存草稿返回的 caseId，即草稿 ID／稳定案例 ID；不是 submissionId。");
const revision = z.number().int().positive().describe("jingjie_get_draft 返回的当前版本；版本冲突时重新读取并合并修改。");
const file = z.object({
  localName: z.string().min(1).max(300).describe("本地输出目录内的相对文件路径，例如 video.mp4 或 frames/S01a.jpg。"),
  kind: z.enum(["image", "video"]),
  mime: z.enum(Object.keys(MEDIA_TYPES)),
  size: z.number().int().positive().describe("文件的真实字节数。"),
}).strict();
const result = z.object({
  submissionId: z.string(), status: z.literal("draft"), caseId, revision: z.number().int(), title: z.string(),
  previewUrl: z.string(), editUrl: z.string(), warnings: z.array(z.string()), mediaCount: z.number().int(), shotCount: z.number().int(),
});
const presigned = z.object({
  submissionId: z.string(), status: z.enum(["prepared", "submitted"]), result: result.optional(), instructions: z.string().optional(),
  uploads: z.array(file.extend({
    name: z.string(), assetId: z.string(), objectKey: z.string(), mediaUrl: z.string().describe("公开 OSS 素材网址，PUT 成功后直接预览并长期保存。"),
    uploadUrl: z.string().describe("临时 OSS PUT 地址，直接写入正式对象。"), headers: z.record(z.string(), z.string()), uploadExpiresAt: z.string(),
  })),
});
const status = z.object({ submissionId: z.string(), status: z.enum(["prepared", "submitted"]), result: result.optional(), files: z.array(z.object({
  assetId: z.string(), localName: z.string(), status: z.enum(["uploaded", "awaiting_upload", "invalid", "unavailable"]), message: z.string().optional(),
})).optional() });
const annotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true };
const draftResult = z.object({
  caseId, status: z.enum(["draft", "published", "offline"]), revision,
  draft: z.record(z.string(), z.unknown()).describe("当前网站编辑稿；包括稳定 id、类型与完整 video/shots/cast 字段。"),
  updatedAt: z.string(), publishedAt: z.string().nullable(), hasChanges: z.boolean(),
  previewUrl: z.string(), editUrl: z.string(),
});

export function createJingjieMcpServer({ repositoryOptions, origin = "" } = {}) {
  const server = new McpServer({ name: "jingjie", version: "1.1.0", title: "镜界 · 视频、图片与拉片资料提交" }, { instructions: guide });
  const invoke = (method, service = createSubmissionService) => async (arguments_) => {
    try {
      const result = await withRepository((repository) => service(repository, { origin })[method](arguments_), repositoryOptions);
      return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result };
    } catch (error) {
      const message = error instanceof ContentError && !error.code ? error.message : "服务器暂时无法完成操作，请保留案例或提交标识和本地资料后重试。";
      const failure = { error: { message, status: error.status ?? 503 } };
      return { isError: true, content: [{ type: "text", text: JSON.stringify(failure) }], structuredContent: failure };
    }
  };
  server.registerTool("jingjie_presign", {
    title: "镜界 · 批量签发 OSS 上传地址",
    description: "唯一 OSS 上传签名工具。上传视频、图片或提交拉片资料时，传 requestId 和 files，返回 submissionId、assetId、objectKey、公开 mediaUrl 和 PUT 上传签名 uploadUrl；本地直接 PUT 写入正式 OSS 对象，成功即可用 mediaUrl 预览，无需确认或复制。保存资料另调用 jingjie_submit_case。同一 requestId 和清单可安全重试。最多 252 个文件，files:[] 可创建无素材草稿；后端不传输文件字节。",
    inputSchema: z.object({ requestId, files: z.array(file).max(MAX_SUBMISSION_FILES) }).strict(),
    outputSchema: presigned, annotations,
  }, invoke("presign"));
  server.registerTool("jingjie_submit_case", {
    title: "镜界 · 提交拉片资料并保存草稿",
    description: "完成用户“提交到镜界”或“把拉片结果保存到镜界”的请求，将本地拉片分析、视频或图片资料保存到镜界。先调用 jingjie_presign 获取 submissionId，并用本地工具直接 PUT 正式 OSS 对象；再提交原始 reelbench shots.json 或单图资料，以及真正上传成功的 assetId。视频总时长用 data.meta.durationSeconds。返回 caseId（草稿 ID）、revision 与编辑/预览链接，后续修改用 jingjie_get_draft 和 jingjie_update_draft。后端仅核对素材元信息、转换分镜字段、保存新草稿，不读取或复制文件，不发布、不覆盖其他案例。缺失图片允许存草稿并明确提示，机器复核不能代替作者确认。重试使用原 submissionId 和相同资料。",
    inputSchema: z.object({
      submissionId,
      data: z.record(z.string(), z.unknown()).describe("原始 shots.json 对象；或 {kind:'image',title,image:localName,description,analysis,prompt}。未知原始字段保存在私有来源资料中。"),
      assets: z.array(z.object({
        assetId: z.string(), mediaUrl: z.string().optional().describe("presign 返回的公开 mediaUrl，不能传 PUT 签名地址。"),
        objectKey: z.string().optional().describe("presign 返回的正式 OSS objectKey。"),
      }).strict()).max(MAX_SUBMISSION_FILES),
    }).strict(), outputSchema: result, annotations,
  }, invoke("submitCase"));
  server.registerTool("jingjie_get_submission_status", {
    title: "镜界 · 查询提交状态和恢复上传",
    description: "本地直传中断或提交返回不确定时，用原 submissionId 查询状态。已提交时返回原结果；未提交时仅通过 OSS HEAD 元信息逐文件返回 uploaded、awaiting_upload、invalid 或 unavailable，不读取文件、不签发地址。uploaded 跳过，awaiting_upload 继续上传；需要新签名时沿用 requestId 和 files 调用 jingjie_presign。unavailable 保留标识稍后查询，invalid 修正文件后用新 requestId 重新申请。",
    inputSchema: z.object({ submissionId }).strict(), outputSchema: status,
    annotations: { ...annotations, readOnlyHint: true },
  }, invoke("getSubmissionStatus"));
  server.registerTool("jingjie_get_draft", {
    title: "镜界 · 根据草稿 ID 读取当前资料",
    description: "用新增草稿返回的 caseId 读取当前编辑稿 draft、最新 revision、发布状态与编辑/预览链接。支持网页或 MCP 创建的案例，包括已发布与下架案例的编辑稿。修改前先读取，不使用提交状态中的初次 revision。",
    inputSchema: z.object({ caseId }).strict(), outputSchema: draftResult,
    annotations: { ...annotations, readOnlyHint: true, openWorldHint: false },
  }, invoke("getDraft", createDraftService));
  server.registerTool("jingjie_update_draft", {
    title: "镜界 · 根据草稿 ID 修改资料",
    description: "按 caseId 和最新 revision 局部修改已有编辑稿，返回保存后的完整 draft 与新 revision。先 jingjie_get_draft 读取。patch 使用网站字段：补视频时长传 {video:{durationSeconds:29.966667}}；修改标题传 {title:'新标题'}。省略保留，video/metadata/tagValues 按字段合并，shots/cast 数组整体替换，[] 清空。替换视频 src 重置旧时长/参数；新素材使用已 PUT 上传的公开 mediaUrl。不会导入人工复核确认。只保存、不发布，保留公开快照；未知 ID 返回 404，版本冲突 409 后重新读取合并，结果不确定时读取核对。",
    inputSchema: z.object({ caseId, revision, patch: draftPatchSchema }).strict(), outputSchema: draftResult,
    annotations: { ...annotations, idempotentHint: false },
  }, invoke("updateDraft", createDraftService));
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
