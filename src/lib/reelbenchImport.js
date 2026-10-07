import { normalizeDraft, validCaseId } from "./contentEntries.js";
import { cameraMoves, rhythmRoles, shotCategories, shotSizes, shotTransitions } from "./studyReport.js";

const enums = {
  size: { none: "无景别", "extreme-wide": "大远景", wide: "全景", "medium-wide": "中远景", medium: "中景", "medium-close": "中近景", close: "特写", "extreme-close": "大特写" },
  category: { establishing: "定场", subject: "主体", dialogue: "对话", reaction: "反应", insert: "插入特写", pov: "主观", empty: "空镜", product: "产品展示", "text-card": "字卡", transition: "转场镜头", archive: "引用素材" },
  camera: { static: "固定", "push-in": "推", "pull-out": "拉", "zoom-in": "变焦推", "zoom-out": "变焦拉", "pan-left": "左摇", "pan-right": "右摇", "tilt-up": "上摇", "tilt-down": "下摇", "truck-left": "左移", "truck-right": "右移", "pedestal-up": "升", "pedestal-down": "降", tracking: "跟拍", arc: "环绕", "whip-pan": "甩镜", handheld: "手持微晃", shake: "剧烈晃动", "rack-focus": "变焦点", "micro-push": "微推", roll: "旋转", drone: "航拍移动" },
  transitionIn: { cut: "硬切", dissolve: "叠化", "fade-in": "淡入", "fade-out": "淡出", whip: "甩切", "match-cut": "匹配剪辑", wipe: "划像", morph: "特效转场" },
  rhythm: { hook: "钩子", setup: "铺垫", build: "递进", beat: "重音", turn: "转折", payoff: "兑现", breath: "换气", close: "收口" },
};
const choices = { size: shotSizes, category: shotCategories, camera: cameraMoves, transitionIn: shotTransitions, rhythm: rhythmRoles };

const fail = (path, message) => { throw new Error(`${path}: ${message}`); };
const object = (value, path) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(path, "需要 JSON 对象");
  return value;
};
const text = (value, path, max) => {
  if (value == null) return "";
  if (typeof value !== "string" || value.length > max) fail(path, `需要不超过 ${max} 字的文本`);
  return value.trim();
};
const number = (value, path, { max = 86400, positive = false, integer = false } = {}) => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > max || (positive && value === 0) || (integer && !Number.isInteger(value))) fail(path, "数值无效");
  return value;
};
const localPath = (value) => value.replaceAll("\\", "/").replace(/^\.\//, "");
const basename = (value) => localPath(value).split("/").at(-1);

function sourceHash(value) {
  let hash = 2166136261;
  for (const char of value) hash = Math.imul(hash ^ char.codePointAt(0), 16777619);
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function sourceIdentifiers(entries, path, prefix, warnings) {
  const sourceIds = new Map();
  const rows = entries.map((entry, index) => {
    object(entry, `${path}[${index}]`);
    const sourceId = text(entry.id, `${path}[${index}].id`, 150);
    if (sourceId && sourceIds.has(sourceId)) fail(`${path}[${index}].id`, `来源标识 ${sourceId} 重复`);
    if (sourceId) sourceIds.set(sourceId, "");
    else warnings.push(`${path}[${index}].id: 缺少来源标识，已生成本地标识`);
    const id = sourceId.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || (sourceId ? `${prefix}-${sourceHash(sourceId)}` : `${prefix}-${String(index + 1).padStart(3, "0")}`);
    return { sourceId, id: id.slice(0, 140).replace(/-$/, "") };
  });
  const counts = new Map();
  for (const { id } of rows) counts.set(id, (counts.get(id) || 0) + 1);
  const used = new Set();
  rows.forEach((row, index) => {
    if (counts.get(row.id) > 1) row.id += `-${sourceHash(row.sourceId || `${prefix}:${index}`)}`;
    if (used.has(row.id)) fail(`${path}[${index}].id`, "转换后的标识重复");
    used.add(row.id);
    if (row.sourceId) sourceIds.set(row.sourceId, row.id);
  });
  return { rows, sourceIds };
}

function mediaResolver(media, warnings) {
  if (!Array.isArray(media)) fail("media", "需要已确认素材数组");
  const files = media.map((item, index) => {
    object(item, `media[${index}]`);
    const localName = text(item.localName, `media[${index}].localName`, 2048);
    if (!localName) fail(`media[${index}].localName`, "本地文件名不能为空");
    if (!["image", "video"].includes(item.kind)) fail(`media[${index}].kind`, "素材类型无效");
    if (typeof item.url !== "string" || !/^\/media\/[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(item.url)) fail(`media[${index}].url`, "需要已登记的 /media/ 素材地址");
    return { ...item, path: localPath(localName) };
  });
  const paths = new Set();
  for (const file of files) {
    if (paths.has(file.path)) fail("media", `本地文件名 ${file.localName} 重复`);
    paths.add(file.path);
  }
  return (value, kind, path, { optional = false } = {}) => {
    const name = text(value, path, 2048);
    if (!name) {
      if (!optional) warnings.push(`${path}: 未提供${kind === "video" ? "视频" : "图片"}素材`);
      return "";
    }
    const sourcePath = localPath(name);
    const exact = files.filter((file) => file.path === sourcePath);
    const matches = exact.length ? exact : files.filter((file) => basename(file.path) === basename(sourcePath));
    if (matches.length > 1) {
      warnings.push(`${path}: ${name} 对应多个素材，请使用完整 localName，已留空`);
      return "";
    }
    if (!matches.length) {
      warnings.push(`${path}: 未上传 ${name}，已留空`);
      return "";
    }
    if (matches[0].kind !== kind) fail(path, `${name} 的素材类型应为 ${kind}`);
    return matches[0].url;
  };
}

function enumValue(value, key, path, warnings) {
  const input = text(value, path, 120);
  if (!input) return "";
  if (Object.hasOwn(enums[key], input)) return enums[key][input];
  if (choices[key].includes(input)) return input;
  warnings.push(`${path}: 无法识别枚举值 ${input}，已留空，请人工确认`);
  return "";
}

function videoMetadata(meta) {
  const result = {};
  for (const key of ["width", "height", "fps"]) {
    if (meta[key] == null) continue;
    result[key] = number(meta[key], `meta.${key}`, { positive: true, integer: key !== "fps", max: key === "fps" ? 1000 : 32768 });
  }
  if (meta.hasAudio != null) {
    if (typeof meta.hasAudio !== "boolean") fail("meta.hasAudio", "需要布尔值");
    result.hasAudio = meta.hasAudio;
  }
  return result;
}

// Only confirmed uploaded media can become case references. Source URLs and local paths
// remain source material; machine checks never become an author's review confirmation.
export function convertReelbenchImport(data, media, { caseId } = {}) {
  object(data, "data");
  if (!validCaseId(caseId)) fail("caseId", "案例标识无效");
  if (data.kind != null && !["image", "video"].includes(data.kind)) fail("kind", "需要 image 或 video");
  const warnings = [];
  const resolve = mediaResolver(media, warnings);
  const draft = {
    id: caseId,
    kind: data.kind === "image" ? "分镜" : "视频",
    title: text(data.title, "title", 80),
    description: text(data.description, "description", 2000),
    analysis: text(data.analysis, "analysis", 16000),
    prompt: text(data.prompt, "prompt", 12000),
    image: resolve(data.image, "image", "image", { optional: data.kind !== "image" }),
  };
  if (data.kind === "image") return { draft: normalizeDraft(draft), warnings, sourceIds: { cast: {}, shots: {} } };

  const inputShots = data.shots ?? [];
  if (!Array.isArray(inputShots) || inputShots.length > 100) fail("shots", "需要镜头数组，最多 100 个镜头");
  const inputCast = data.cast ?? [];
  if (!Array.isArray(inputCast) || inputCast.length > 50) fail("cast", "需要人物数组，最多 50 位人物");
  const castIds = sourceIdentifiers(inputCast, "cast", "person", warnings);
  const shotIds = sourceIdentifiers(inputShots, "shots", "shot", warnings);
  const meta = data.meta == null ? {} : object(data.meta, "meta");
  const hasDuration = meta.durationSeconds != null;
  const duration = hasDuration ? number(meta.durationSeconds, "meta.durationSeconds") : 0;
  if (!hasDuration) warnings.push("meta.durationSeconds: 未记录真实视频时长，已留待补充");
  const metadata = videoMetadata(meta);
  const cast = inputCast.map((person, index) => ({
    id: castIds.rows[index].id,
    name: text(person.name, `cast[${index}].name`, 80),
    note: text(person.note, `cast[${index}].note`, 2000),
    image: resolve(person.image, "image", `cast[${index}].image`, { optional: true }),
  }));
  let previousEnd = 0;
  const shots = inputShots.map((source, index) => {
    const path = `shots[${index}]`;
    const identity = shotIds.rows[index];
    const hasStart = source.start != null;
    const hasEnd = source.end != null;
    if (hasStart !== hasEnd) fail(`${path}.${hasStart ? "end" : "start"}`, "起止时间需要同时提供，请补全后提交");
    const start = hasStart ? number(source.start, `${path}.start`) : 0;
    const end = hasEnd ? number(source.end, `${path}.end`) : 0;
    if (hasStart && start < previousEnd) fail(`${path}.start`, "镜头时间必须按顺序排列，不能重叠");
    if (hasStart && hasEnd && end <= start) fail(`${path}.end`, "结束时间必须大于开始时间");
    if (hasEnd) previousEnd = end;
    if (!hasStart || !hasEnd) warnings.push(`${path}: 缺少起止时间，已留待补充，不推算镜头时长`);
    if (hasDuration && start > duration) fail(`${path}.start`, "镜头时间超出真实视频时长");
    if (hasDuration && end > duration) fail(`${path}.end`, "镜头时间超出真实视频时长");
    if (source.seconds != null) {
      number(source.seconds, `${path}.seconds`);
      if (hasStart && hasEnd && Math.abs(source.seconds - (end - start)) > 0.001) fail(`${path}.seconds`, "镜头时长与起止时间不一致");
    }
    const size = enumValue(source.size, "size", `${path}.size`, warnings);
    const camera = enumValue(source.camera, "camera", `${path}.camera`, warnings);
    const facts = {};
    if (size) facts.景别 = size;
    if (camera) facts.运镜 = camera;
    const category = enumValue(source.category, "category", `${path}.category`, warnings);
    const rhythm = enumValue(source.rhythm, "rhythm", `${path}.rhythm`, warnings);
    const transition = enumValue(source.transitionIn, "transitionIn", `${path}.transitionIn`, warnings);
    let subjects;
    if (source.subjects != null) {
      if (!Array.isArray(source.subjects) || source.subjects.length > 50) fail(`${path}.subjects`, "需要人物标识数组，最多 50 位人物");
      subjects = [...new Set(source.subjects.map((value, subjectIndex) => {
        const sourceId = text(value, `${path}.subjects[${subjectIndex}]`, 150);
        if (!castIds.sourceIds.has(sourceId)) fail(`${path}.subjects[${subjectIndex}]`, `来源人物 ${sourceId || "（空）"} 不存在于 cast`);
        return castIds.sourceIds.get(sourceId);
      }))];
    }
    if (source.review != null) warnings.push(`${path}.review: 来源复核记录不会转为作者人工复核确认，已保持待复核`);
    const note = text(source.note, `${path}.note`, 4000);
    const imageName = source.image ?? (identity.sourceId ? `frames/${identity.sourceId}a.jpg` : undefined);
    const tailName = source.endImage ?? (identity.sourceId ? `frames/${identity.sourceId}b.jpg` : undefined);
    const image = resolve(imageName, "image", `${path}.image`);
    const endImage = resolve(tailName, "image", `${path}.endImage`);
    return {
      id: identity.id, start, end, image,
      ...(endImage && { endImage }),
      ...(category && { category }),
      ...(rhythm && { rhythm }),
      ...(transition && { transition }),
      ...(subjects && { subjects }),
      title: text(source.title, `${path}.title`, 80),
      summary: text(source.frame, `${path}.frame`, 2000),
      narrative: text(source.rhythmNote, `${path}.rhythmNote`, 2000),
      dialogue: text(source.audio, `${path}.audio`, 2000),
      onscreenText: text(source.onscreenText, `${path}.onscreenText`, 2000),
      facts,
      analysis: note ? [{ label: "来源备注", text: note }] : [],
    };
  });
  draft.video = { src: resolve(data.source, "video", "source"), durationSeconds: duration, shots, ...(data.cast != null && { cast }), ...(Object.keys(metadata).length && { metadata }) };
  return {
    draft: normalizeDraft(draft),
    warnings,
    sourceIds: { cast: Object.fromEntries(castIds.sourceIds), shots: Object.fromEntries(shotIds.sourceIds) },
  };
}
