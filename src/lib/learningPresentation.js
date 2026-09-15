// Reuse authored material; a missing analysis must not become an invented lesson.
export function caseLearningFocus(item) {
  const firstShot = !item.video?.isMock && item.video?.shots.find((shot) => shot.narrative || shot.summary);
  const authored = item.analysis?.trim() || firstShot?.narrative || firstShot?.summary;
  const focus = authored ? authored.split(/(?<=[。！？\n])/u)[0] : item.tags?.slice(0, 3).join(" · ") || item.description || "观看画面，阅读案例资料";
  const chars = Array.from(focus.trim());
  return chars.length > 100 ? `${chars.slice(0, 100).join("")}…` : focus.trim();
}

export const shotFactHelp = {
  景别: "人物或物体在画面中占多大：远景看环境，近景看表情，特写看细节。",
  运镜: "摄影机怎样移动，例如固定、推进或跟随人物。",
  构图: "人物、物体和留白在画面里怎样安排。",
  光影: "光从哪里来，画面的明暗和冷暖怎样分布。",
};
