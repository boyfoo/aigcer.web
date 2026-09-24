import { filterGroups } from "./data.js";
import { caseTagValues, tagValues } from "./lib/contentEntries.js";

export function createDefaultTagGroups() {
  return filterGroups.map((group) => ({
    id: group.key,
    label: group.label,
    options: group.options.filter((label) => label !== "全部").map((label, index) => ({
      id: `${group.key}-${index}`,
      label,
      value: label,
    })),
  }));
}

export function validateTagGroups(groups) {
  if (!Array.isArray(groups)) return "标签配置格式不正确";
  const ids = new Set();
  const groupNames = new Set();
  for (const group of groups) {
    if (!group || typeof group.id !== "string" || !group.id || ids.has(group.id)) {
      return "一级标签标识不正确";
    }
    ids.add(group.id);
    const name = typeof group.label === "string" ? group.label.trim() : "";
    if (!name) return "请填写一级标签名称";
    if (name.length > 20) return "一级标签名称最多 20 个字";
    if (groupNames.has(name.toLowerCase())) return `一级标签“${name}”已存在`;
    groupNames.add(name.toLowerCase());
    if (!Array.isArray(group.options)) return "二级标签配置格式不正确";
    const optionNames = new Set();
    for (const option of group.options) {
      if (!option || typeof option.id !== "string" || !option.id || ids.has(option.id)) {
        return "二级标签标识不正确";
      }
      ids.add(option.id);
      const label = typeof option.label === "string" ? option.label.trim() : "";
      if (!label) return `请填写“${name}”下的二级标签名称`;
      if (label.length > 20) return "二级标签名称最多 20 个字";
      if (label === "全部") return "“全部”由菜单自动提供，请使用其他名称";
      if (optionNames.has(label.toLowerCase())) return `“${name}”下的“${label}”已存在`;
      optionNames.add(label.toLowerCase());
      if (option.value != null && (typeof option.value !== "string" || !option.value.trim())) {
        return "二级标签关联格式不正确";
      }
    }
  }
  return "";
}

export function normalizeTagGroups(groups) {
  const error = validateTagGroups(groups);
  if (error) throw new Error(error);
  return groups.map((group) => ({
    id: group.id,
    label: group.label.trim(),
    options: group.options.map((option) => ({
      id: option.id,
      label: option.label.trim(),
      // Keep the case association stable when a displayed tag is renamed.
      value: option.value ?? option.label.trim(),
    })),
  }));
}

export function createInitialTagFilters(groups) {
  return Object.fromEntries(groups.map((group) => [group.id, []]));
}

export function reconcileTagFilters(groups, filters) {
  return Object.fromEntries(groups.map((group) => [
    group.id,
    tagValues(filters[group.id]).filter((id) => group.options.some((option) => option.id === id)),
  ]));
}

export function matchesTagFilters(item, groups, filters) {
  return groups.every((group) => {
    const options = group.options.filter((candidate) => tagValues(filters[group.id]).includes(candidate.id));
    if (!options.length) return true;
    return options.some((option) => caseTagValues(item, group.id).includes(option.value));
  });
}

export function moveTagEntry(entries, id, offset) {
  const index = entries.findIndex((entry) => entry.id === id);
  const target = index + offset;
  if (index < 0 || target < 0 || target >= entries.length) return entries;
  const next = [...entries];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}
