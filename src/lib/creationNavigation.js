const navigationEntries = [
  { id: "content", label: "内容与环境", groupIds: ["subject", "props", "environment"] },
  { id: "action", label: "动作与变化", groupIds: ["action", "transformation", "effects"] },
  { id: "camera", label: "视角与拍摄", groupIds: ["viewpoint", "shot-size", "angle", "movement"] },
  { id: "image", label: "构图与光影", groupIds: ["composition", "focus", "lighting"] },
  { id: "direction", label: "导演与剪辑", groupIds: ["shot-purpose", "blocking", "editing", "time", "rhythm"] },
  { id: "expression", label: "表达与类型", groupIds: ["intent", "emotion", "type"] },
];
const knownGroupIds = new Set(navigationEntries.flatMap(({ groupIds }) => groupIds));

export function groupCreationFilters(groups) {
  const entries = navigationEntries.map(({ id, label, groupIds }) => ({
    id,
    label,
    groups: groups.filter((group) => groupIds.includes(group.id)),
  })).filter((entry) => entry.groups.length);
  const otherGroups = groups.filter((group) => !knownGroupIds.has(group.id));
  if (otherGroups.length) entries.push({ id: "other", label: "其他分类", groups: otherGroups });
  return entries;
}
