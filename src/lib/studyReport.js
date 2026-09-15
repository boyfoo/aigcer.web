export const shotCategories = ["定场", "主体", "对话", "反应", "插入特写", "主观", "空镜", "产品展示", "字卡", "转场镜头", "引用素材"];
export const rhythmRoles = ["钩子", "铺垫", "递进", "重音", "转折", "兑现", "换气", "收口"];
export const shotTransitions = ["硬切", "叠化", "淡入", "淡出", "甩切", "匹配剪辑", "划像", "特效转场"];
export const shotSizes = ["无景别", "大远景", "远景", "全景", "中远景", "中景", "中近景", "近景", "特写", "大特写"];
export const cameraMoves = ["固定", "固定镜头", "推", "推进", "缓慢推进", "拉", "拉远", "变焦推", "变焦拉", "左摇", "右摇", "上摇", "下摇", "左移", "右移", "升", "降", "跟拍", "背后跟拍", "环绕", "甩镜", "手持微晃", "剧烈晃动", "变焦点", "微推", "微距推近", "旋转", "航拍移动"];
export const reviewFields = { frame: "画面描述与原片", category: "镜头类别依据", movement: "运镜与主体运动", boundary: "镜头切点", rhythm: "叙事节奏与原片" };
export const qualityLabels = { passed: "通过", warning: "需处理", pending: "待复核" };
export const decimal = (value, digits = 2) => Number(Number(value || 0).toFixed(digits));

export function videoMetadataText(meta = {}) {
  const gcd = (a, b) => b ? gcd(b, a % b) : a;
  const width = Math.round(meta.width || 0), height = Math.round(meta.height || 0);
  const divisor = width && height ? gcd(width, height) : 1;
  return [width && height ? `${width} × ${height} · ${width / divisor}:${height / divisor}` : "分辨率未记录", meta.fps ? `${meta.fps} fps` : "帧率未记录", meta.hasAudio === true ? "有声" : meta.hasAudio === false ? "无声" : "音轨未确认"].join(" · ");
}

export function shotStatistics(video = {}) {
  const shots = video.shots || [];
  const total = Math.max(0, video.durationSeconds || 0);
  const timed = shots.map((shot, index) => ({ shot, index, seconds: shot.end - shot.start })).filter(({ shot, seconds }) => Number.isFinite(seconds) && shot.start >= 0 && seconds > 0);
  const ordered = [...timed].sort((a, b) => a.seconds - b.seconds || a.index - b.index);
  let covered = 0, edge = 0, cuts = 0;
  [...timed].sort((a, b) => a.shot.start - b.shot.start).forEach(({ shot }) => {
    const end = Math.min(total, shot.end);
    covered += Math.max(0, end - Math.max(edge, shot.start));
    edge = Math.max(edge, end);
  });
  timed.forEach(({ shot, index }) => { if (index && Math.abs(shots[index - 1].end - shot.start) < .05) cuts++; });
  const middle = Math.floor(ordered.length / 2);
  return { count: shots.length, measured: timed.length, total, covered: decimal(covered, 3), coverage: total ? decimal(covered / total * 100, 1) : 0,
    average: timed.length ? decimal(timed.reduce((sum, entry) => sum + entry.seconds, 0) / timed.length) : null,
    median: ordered.length ? decimal(ordered.length % 2 ? ordered[middle].seconds : (ordered[middle - 1].seconds + ordered[middle].seconds) / 2) : null,
    shortest: ordered[0] || null, longest: ordered.at(-1) || null, cuts, cutsPerMinute: total ? decimal(cuts / total * 60, 1) : null };
}

export function shotDistributions(video = {}) {
  const stats = shotStatistics(video);
  return [["景别", (s) => s.facts?.景别], ["镜头类别", (s) => s.category], ["运镜方式", (s) => s.facts?.运镜], ["叙事节奏", (s) => s.rhythm]].map(([title, read]) => {
    const groups = new Map();
    let edge = 0;
    [...(video.shots || [])].sort((a, b) => a.start - b.start).forEach((shot) => {
      const seconds = Math.max(0, Math.min(stats.total, shot.end) - Math.max(edge, shot.start));
      edge = Math.max(edge, Math.min(stats.total, shot.end || 0));
      const label = read(shot) || "未填写";
      const group = groups.get(label) || { label, count: 0, seconds: 0 };
      group.count++; group.seconds += seconds; groups.set(label, group);
    });
    if (stats.total > stats.covered + .001) groups.set("未拆解时段", { label: "未拆解时段", count: 0, seconds: stats.total - stats.covered });
    return { title, rows: [...groups.values()].sort((a, b) => b.seconds - a.seconds).map((row) => ({ ...row, seconds: decimal(row.seconds, 3), percent: stats.total ? decimal(row.seconds / stats.total * 100, 1) : 0 })) };
  });
}

export function castIndex(video = {}) {
  return (video.cast || []).map((person) => {
    const appearances = (video.shots || []).filter((shot) => shot.subjects?.includes(person.id));
    const firstFrame = appearances.find((shot) => shot.image && !shot.imageIsFallback)?.image;
    return { ...person, name: person.name || "未命名人物", image: person.image || firstFrame || "", shots: appearances.map((shot) => shot.id), seconds: decimal(appearances.reduce((total, shot) => total + Math.max(0, shot.end - shot.start), 0)) };
  });
}

// Structural checks are computed; visual judgements require an explicit, recorded author review.
export function studyQuality(video = {}) {
  const shots = video.shots || [], total = video.durationSeconds || 0, n = shots.length;
  const results = [];
  const add = (id, title, status, message, affected = []) => results.push({ id, title, status: n ? status : "pending", message: n ? message : "尚未录入镜头", shotIds: affected.map((shot) => shot.id) });
  const badTime = shots.filter((s, i) => !Number.isFinite(s.start) || !Number.isFinite(s.end) || s.start < 0 || s.end <= s.start || s.end > total + .05 || (i > 0 && s.start < shots[i - 1].end));
  const gaps = shots.filter((s, i) => Math.abs(s.start - (i ? shots[i - 1].end : 0)) > .05);
  const uncoveredEnd = n && Math.abs(shots.at(-1).end - total) > .05;
  add("timeline", "时间轴连续", gaps.length || uncoveredEnd || badTime.length ? "warning" : "passed", gaps.length || uncoveredEnd || badTime.length ? "有未拆解时段、重叠或越界；未拆解时段不会计作镜头。" : "镜头连续覆盖整条视频。", [...new Set([...gaps, ...badTime, ...(uncoveredEnd ? [shots.at(-1)] : [])])]);
  add("duration", "时长自洽", badTime.length || total <= 0 ? "warning" : "passed", badTime.length || total <= 0 ? "请检查起止时间、顺序及视频总时长。" : "镜头时间有效、按顺序排列，且未超出视频。", badTime);
  const ids = new Set(); const repeated = shots.filter((s) => { const bad = !s.id || ids.has(s.id); ids.add(s.id); return bad; });
  add("ids", "镜号纪律", repeated.length ? "warning" : "passed", repeated.length ? "存在缺失或重复的镜头标识。" : "镜头标识唯一，筛选与排序保留原镜号。", repeated);
  const enumeration = (id, title, read, options) => {
    const missing = shots.filter((s) => !read(s)), unknown = shots.filter((s) => read(s) && !options.includes(read(s)));
    add(id, title, unknown.length ? "warning" : missing.length ? "pending" : "passed", unknown.length ? "含自定义值，请确认术语含义；不会阻止保存。" : missing.length ? "部分镜头尚未填写。" : "所有镜头均已填写，术语可识别。", [...missing, ...unknown]);
  };
  enumeration("size", "景别标注", (s) => s.facts?.景别, shotSizes);
  enumeration("category", "类别标注", (s) => s.category, shotCategories);
  enumeration("camera", "运镜标注", (s) => s.facts?.运镜, cameraMoves);
  enumeration("transition", "转场标注", (s) => s.transition, shotTransitions);
  const visual = (id, title, key, hasMaterial) => {
    const missing = shots.filter((s) => !hasMaterial(s) || !s.review?.[key]?.confirmed || !s.review[key].note?.trim());
    add(id, title, missing.length || video.isMock ? "pending" : "passed", video.isMock ? "示例拆解与视频不对应，不能判为已核对。" : missing.length ? "需要作者对照原片复核，并记录结论；文字齐全不代表画面正确。" : "作者已逐镜人工复核并记录结论；不是自动识别结果。", video.isMock ? shots : missing);
  };
  visual("frame", "画面描述可核对", "frame", (s) => Boolean(s.summary && s.image && !s.imageIsFallback));
  const descriptions = new Map(), duplicates = [];
  shots.forEach((s) => { const key = (s.summary || "").replace(/[\s，。！？、,.!?]/g, ""); if (!key) return; if (descriptions.has(key)) { duplicates.push(descriptions.get(key), s); } descriptions.set(key, s); });
  add("duplicates", "画面描述不重复", duplicates.length ? "warning" : shots.some((s) => !s.summary) ? "pending" : "passed", duplicates.length ? "多镜使用相同描述，建议确认是否遗漏镜头变化。" : shots.some((s) => !s.summary) ? "部分镜头缺少概述。" : "没有完全重复的镜头概述。", [...new Set(duplicates)]);
  const castIds = new Set((video.cast || []).map((c) => c.id));
  const badSubjects = shots.filter((s) => s.subjects?.some((id) => !castIds.has(id)));
  const missingSubjects = shots.filter((s) => !Array.isArray(s.subjects));
  add("subjects", "主体对账", badSubjects.length ? "warning" : missingSubjects.length ? "pending" : "passed", badSubjects.length ? "有镜头引用不存在的人物。" : missingSubjects.length ? "部分镜头尚未确认出场人物；可以明确选择无人物。" : "人物关联均可找到；无人物的镜头已明确记录。", [...badSubjects, ...missingSubjects]);
  visual("category-evidence", "类别有依据", "category", (s) => Boolean(s.category && s.summary));
  visual("motion", "运镜与主体运动核对", "movement", (s) => Boolean(s.facts?.运镜));
  visual("boundary", "切点依据核对", "boundary", (s) => s.end > s.start);
  const framesMissing = shots.filter((s) => !s.image || s.imageIsFallback || !s.endImage);
  add("frames", "首尾关键帧齐全", framesMissing.length ? "pending" : "passed", framesMissing.length ? "部分镜头缺首帧或尾帧；案例封面不算已提取首帧。" : "每镜已提供首尾帧地址；画面对应关系另行复核。", framesMissing);
  visual("rhythm", "节奏分析可核对", "rhythm", (s) => Boolean(s.rhythm && s.narrative));
  return results;
}

export function createStudyReport(item) {
  const video = item.video || {};
  return { format: "jingjie-study-report", version: 1, case: item, statistics: shotStatistics(video), distributions: shotDistributions(video), cast: castIndex(video), quality: studyQuality(video) };
}
