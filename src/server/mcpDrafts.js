import { z } from "zod/v4";
import { normalizeDraft, validCaseId } from "../lib/contentEntries.js";
import { ContentError } from "./errors.js";
import { MEDIA_TYPES } from "../lib/mediaFormats.js";

const text = z.string();
const tags = z.array(text).max(30);
const groupedTags = z.record(z.string(), tags);
const metadata = z.object({
  width: z.number().nullable().optional(),
  height: z.number().nullable().optional(),
  fps: z.number().nullable().optional(),
  hasAudio: z.boolean().nullable().optional(),
}).strict().describe("视频测量参数按字段合并；null 清除对应参数。");
const person = z.object({
  id: text, name: text.optional(), note: text.optional(), image: text.optional(),
}).strict();
const shot = z.object({
  id: text,
  start: z.number().optional(), end: z.number().optional(),
  image: text.optional(), endImage: text.optional(),
  title: text.optional(), summary: text.optional(),
  category: text.optional(), rhythm: text.optional(), transition: text.optional(),
  subjects: z.array(text).max(50).optional(),
  sound: text.optional(), dialogue: text.optional(), onscreenText: text.optional(), narrative: text.optional(),
  facts: z.record(z.string(), text).optional(),
  tagValues: groupedTags.optional(),
  analysis: z.array(z.object({ label: text, text }).strict()).max(20).optional(),
  imagePrompt: text.optional(), videoPrompt: text.optional(),
  review: z.record(z.string(), z.unknown()).optional().describe("读取结果中的原有复核可原样回传，但不会导入新的人工确认；修改镜头资料后清除旧复核。"),
}).strict();

export const draftPatchSchema = z.object({
  title: text.optional(), description: text.optional(), analysis: text.optional(), prompt: text.optional(),
  image: text.optional(), duration: text.optional().describe("仅用于图片分镜的 分:秒 文本；视频时长使用 video.durationSeconds。"),
  tags: tags.optional(), tagValues: groupedTags.optional(),
  type: tags.optional(), emotion: tags.optional(), lighting: tags.optional(), movement: tags.optional(),
  video: z.object({
    src: text.optional(), durationSeconds: z.number().optional(), metadata: metadata.optional(),
    cast: z.array(person).max(50).optional(),
    shots: z.array(shot).max(100).optional().describe("完整镜头数组，整体替换；沿用读取结果中的镜头 id，[] 清空，未提供则保留。"),
  }).strict().optional(),
}).strict().describe("网站草稿字段的局部修改。未提供的字段保留；video、metadata、tagValues 按字段合并；数组整体替换，空字符串或 [] 清空。视频时长使用 video.durationSeconds，不使用导入时的 meta.durationSeconds。案例 id 和类型不可修改。以 jingjie_get_draft 返回的 draft 为字段参考。");

const withoutReview = ({ review, ...value }) => value;
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

function mediaReferences(draft) {
  return [
    { url: draft.image, kind: "image" },
    { url: draft.video?.src, kind: "video" },
    ...(draft.video?.cast ?? []).map((person) => ({ url: person.image, kind: "image" })),
    ...(draft.video?.shots ?? []).flatMap((shot) => [
      { url: shot.image, kind: "image" }, { url: shot.endImage, kind: "image" },
    ]),
  ].filter(({ url }) => url);
}

export function createDraftService(repository, { origin = "" } = {}) {
  const address = (pathname) => origin ? new URL(pathname, origin).href : pathname;
  const read = async (caseId) => {
    if (!validCaseId(caseId)) throw new ContentError("caseId 需要是有效的草稿／案例 ID。");
    const record = await repository.getRecord(caseId);
    if (!record) throw new ContentError("草稿不存在或已被删除。", 404);
    return record;
  };
  const present = ({ id, ...record }) => ({
    caseId: id,
    ...record,
    previewUrl: address(`/case-preview?id=${encodeURIComponent(id)}`),
    editUrl: address("/content"),
  });

  return {
    async getDraft({ caseId }) {
      return present(await read(caseId));
    },

    async updateDraft({ caseId, revision, patch }) {
      if (!Number.isSafeInteger(revision) || revision < 1) throw new ContentError("revision 需要是读取草稿时返回的正整数版本号。");
      const parsed = draftPatchSchema.safeParse(patch);
      if (!parsed.success) throw new ContentError(`patch 格式无效：${parsed.error.issues.map((issue) => `${issue.path.join(".") || "patch"}: ${issue.message}`).join("；")}`);
      patch = parsed.data;
      if (!Object.keys(patch).length || (Object.keys(patch).length === 1 && patch.video && !Object.keys(patch.video).length)) {
        throw new ContentError("patch 至少需要提供一个要修改的字段。");
      }
      const record = await read(caseId);
      if (record.revision !== revision) throw new ContentError("内容已在其他页面更新，请重新读取草稿后合并修改。", 409);
      if (patch.video && record.draft.kind !== "视频") throw new ContentError("图片草稿不能修改视频字段。");
      if (patch.duration !== undefined && record.draft.kind === "视频") throw new ContentError("视频时长请修改 video.durationSeconds（秒），不能使用顶层 duration。");
      const previous = record.draft;
      const merged = { ...previous, ...patch };
      if (patch.tagValues) merged.tagValues = { ...previous.tagValues, ...patch.tagValues };
      if (patch.video) {
        merged.video = { ...previous.video, ...patch.video };
        const replacedVideo = patch.video.src !== undefined && patch.video.src !== previous.video.src;
        if (replacedVideo) {
          merged.video.durationSeconds = patch.video.durationSeconds ?? 0;
          merged.video.metadata = patch.video.metadata ?? {};
          merged.video.isMock = false;
        } else if (patch.video.metadata) {
          merged.video.metadata = { ...previous.video.metadata, ...patch.video.metadata };
        }
        // MCP 资料更新不能产生作者人工确认。先移除输入中的复核，再仅保留资料未变镜头的原确认。
        merged.video.shots = merged.video.shots.map(withoutReview);
      }
      let draft;
      try { draft = normalizeDraft(merged); }
      catch (error) { throw new ContentError(error.message); }
      const previousMedia = new Set(mediaReferences(previous).map(({ url, kind }) => `${kind}:${url}`));
      const checked = new Set(previousMedia);
      for (const { url, kind } of mediaReferences(draft)) {
        const key = `${kind}:${url}`;
        if (checked.has(key)) continue;
        const media = await repository.resolveMediaReference(url);
        if (media?.storage?.provider !== "oss" || MEDIA_TYPES[media.mime]?.kind !== kind || url !== await repository.getMediaReference(media.name, media.storage)) {
          throw new ContentError("新增或替换素材需使用已申请并上传的对应类型公开 mediaUrl，不能使用外部或签名地址。");
        }
        await repository.inspectMediaObject({ key: media.storage.key, kind, size: media.size, mime: media.mime });
        checked.add(key);
      }
      if (draft.video) {
        const { shots: previousShots, ...previousVideo } = previous.video;
        const { shots, ...nextVideo } = draft.video;
        const videoChanged = !same(previousVideo, nextVideo);
        draft.video.shots = shots.map((current) => {
          const original = previousShots.find((entry) => entry.id === current.id);
          if (!videoChanged && original?.review && same(withoutReview(original), withoutReview(current))) {
            return { ...current, review: original.review };
          }
          return withoutReview(current);
        });
      }
      return present(await repository.change({ action: "save", id: caseId, revision, draft }));
    },
  };
}
