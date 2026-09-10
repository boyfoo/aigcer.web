import { formatVideoTime } from "./videoTimeline.js";

// Old browser data is retained for migration into server drafts.
export const CONTENT_STORAGE_KEY = "jingjie-content-v1";
export const isLocalCase = (id) => id.startsWith("local-");
export const validCaseId = (id) => typeof id === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) && id.length <= 150;
export const tagValues = (value) => Array.isArray(value) ? value : typeof value === "string" && value ? [value] : [];
export const displayTags = (value) => tagValues(value).join("、");
export const caseTagValues = (item, groupId) => item.tagValues?.[groupId] ?? (["type", "emotion", "lighting", "movement"].includes(groupId) ? tagValues(item[groupId]) : item.tags ?? []);

export function isMediaUrl(value, image = false, legacy = false) {
  if (typeof value !== "string" || !value.trim()) return false;
  if (image && legacy && /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(value)) return value.length <= 2800000;
  if (/^\/(?!\/)/.test(value) && !/[\\\s]/.test(value)) return true;
  try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password; }
  catch { return false; }
}

const text = (value, label, max) => {
  if (value == null) return "";
  if (typeof value !== "string" || value.length > max) throw new Error(`${label}最多 ${max} 个字`);
  return value.trim();
};
const values = (value) => {
  const list = tagValues(value);
  if (list.length > 30) throw new Error("每组最多添加 30 个标签");
  return [...new Set(list.map((tag) => text(tag, "标签", 60)).filter(Boolean))];
};

export function normalizeContentEntry(draft, { publish = true, legacy = false } = {}) {
  if (!draft || !validCaseId(draft.id)) throw new Error("案例标识无效");
  if (!["分镜", "视频"].includes(draft.kind)) throw new Error("请选择分镜或视频");
  const item = { id: draft.id, kind: draft.kind, title: text(draft.title, "案例名称", 80), description: text(draft.description, "案例介绍", 2000), analysis: text(draft.analysis, "案例分析", 16000), prompt: text(draft.prompt, "整体提示词", 12000), image: text(draft.image, "封面地址", legacy ? 2800000 : 2048), duration: text(draft.duration, "分镜时长", 7), tags: values(draft.tags), tagValues: {} };
  if (item.image && !isMediaUrl(item.image, true, legacy)) throw new Error("封面地址无效，请重新上传图片");
  for (const key of ["type", "emotion", "lighting", "movement"]) item[key] = values(draft[key]);
  if (draft.tagValues != null) {
    if (typeof draft.tagValues !== "object" || Array.isArray(draft.tagValues) || Object.keys(draft.tagValues).length > 50) throw new Error("标签分组格式无效");
    for (const [key, entries] of Object.entries(draft.tagValues)) {
      if (!validCaseId(key)) throw new Error("标签分组标识无效");
      Object.defineProperty(item.tagValues, key, { value: values(entries), enumerable: true });
    }
  }
  if (item.kind === "视频") {
    const video = draft.video ?? {};
    const src = text(video.src, "视频地址", 2048);
    if (src && !isMediaUrl(src)) throw new Error("视频地址无效，请重新上传视频");
    const duration = video.durationSeconds ?? 0;
    if (typeof duration !== "number" || !Number.isFinite(duration) || duration < 0 || duration > 86400) throw new Error("视频时长需在 0–86400 秒之间");
    const inputShots = video.shots ?? [];
    if (!Array.isArray(inputShots) || inputShots.length > 100) throw new Error("最多添加 100 个分镜");
    let previousEnd = 0;
    const ids = new Set();
    const shots = inputShots.map((shot, index) => {
      const label = `镜头 ${index + 1}`;
      if (!shot || !validCaseId(shot.id) || ids.has(shot.id)) throw new Error(`${label}标识重复或无效`);
      ids.add(shot.id);
      const start = shot.start ?? 0, end = shot.end ?? 0;
      if (![start, end].every((value) => Number.isFinite(value) && value >= 0 && value <= 86400)) throw new Error(`${label}的时间格式无效`);
      if (publish && (start < previousEnd || end <= start || end > duration)) throw new Error(`${label}的时间需按顺序排列，不能重叠或超出视频时长`);
      previousEnd = end;
      const image = text(shot.image, `${label}画面地址`, legacy ? 2800000 : 2048);
      if (image && !isMediaUrl(image, true, legacy)) throw new Error(`${label}画面地址无效`);
      const facts = {};
      if (shot.facts != null && (typeof shot.facts !== "object" || Array.isArray(shot.facts) || Object.keys(shot.facts).length > 12)) throw new Error(`${label}的画面信息格式无效`);
      for (const [key, value] of Object.entries(shot.facts ?? {})) Object.defineProperty(facts, text(key, "信息名称", 30), { value: text(value, "画面信息", 120), enumerable: true });
      if (!Array.isArray(shot.analysis ?? []) || (shot.analysis ?? []).length > 20) throw new Error(`${label}最多填写 20 条拆解`);
      const analysis = (shot.analysis ?? []).map((note) => ({ label: text(note?.label, "拆解标题", 30), text: text(note?.text, "拆解内容", 4000) }));
      return { id: shot.id, start, end, image, title: text(shot.title, `${label}名称`, 80), summary: text(shot.summary, `${label}概述`, 2000), facts, analysis, imagePrompt: text(shot.imagePrompt, "首帧提示词", 12000), videoPrompt: text(shot.videoPrompt, "动态提示词", 12000) };
    });
    item.video = { src, durationSeconds: duration, isMock: Boolean(video.isMock), shots };
    item.duration = formatVideoTime(duration);
  } else if (item.duration && !/^\d{2,4}:[0-5]\d$/.test(item.duration)) throw new Error("分镜时长请使用 分:秒 格式，例如 00:08");
  if (publish) {
    if (!item.title) throw new Error("发布前请填写案例名称");
    if (item.kind === "视频" ? !item.video.src : !item.image) throw new Error("发布前请上传视频或图片素材");
    if (item.video && item.video.durationSeconds <= 0) throw new Error("发布前请确认视频时长");
    if (!(item.prompt || item.analysis || item.video?.shots.some((shot) => shot.imagePrompt || shot.videoPrompt || shot.analysis.some((note) => note.text)))) throw new Error("发布前请至少填写提示词或分析中的一项");
  }
  return item;
}
export const normalizeDraft = (draft) => normalizeContentEntry(draft, { publish: false });
export function presentCase(item) {
  const image = item.image || "/images/media-placeholder.svg";
  return { ...item, title: item.title || "未命名案例", image, ...(item.video && { video: { ...item.video, shots: item.video.shots.map((shot, index) => ({ ...shot, title: shot.title || `镜头 ${index + 1}`, image: shot.image || image })) } }) };
}
export function decodeContentEntries(raw) {
  if (!raw) return [];
  const data = JSON.parse(raw);
  if (data?.version !== 1 || !Array.isArray(data.entries)) throw new Error("无法识别旧版内容");
  const entries = data.entries.map((item) => normalizeContentEntry(item, { publish: false, legacy: true }));
  if (new Set(entries.map(({ id }) => id)).size !== entries.length) throw new Error("案例标识重复");
  return entries;
}
export const encodeContentEntries = (entries) => JSON.stringify({ version: 1, entries: entries.map(normalizeDraft) });
export function mergeContentEntries(originals, entries) {
  const overrides = new Map(entries.map((item) => [item.id, item]));
  const ids = new Set(originals.map(({ id }) => id));
  return [...entries.filter(({ id }) => !ids.has(id)), ...originals.map((item) => overrides.get(item.id) ?? item)];
}
