import { storyboardItems } from "../data.js";

export const collections = [
  { slug: "storyboards", title: "分镜参考", kind: "分镜", description: "从构图、人物位置与光线关系中，阅读每个分镜的视觉表达。" },
  { slug: "videos", title: "视频案例", kind: "视频", description: "观看案例画面，理解氛围、光影与镜头运动如何共同叙事。" },
  { slug: "prompts", title: "提示词参考", kind: null, description: "结合案例画面阅读提示词，理解画面描述、光线与视觉风格之间的关系。" },
];

// Keep content access behind one boundary; a database can replace this source later.
export function getCases() {
  return storyboardItems;
}

export function getCase(slug) {
  return storyboardItems.find((item) => item.id === slug) ?? null;
}

export function getCollection(slug) {
  return collections.find((collection) => collection.slug === slug) ?? null;
}

export function getCollectionCases(slug) {
  const collection = getCollection(slug);
  if (!collection) return [];
  return collection.kind ? storyboardItems.filter((item) => item.kind === collection.kind) : storyboardItems;
}

export const casePath = (id) => `/cases/${encodeURIComponent(id)}`;
export const draftPath = (id) => `/case-preview?id=${encodeURIComponent(id)}`;
export const shotPath = (caseId, shotId) => `${casePath(caseId)}${casePath(caseId).includes("?") ? "&" : "?"}shot=${encodeURIComponent(shotId)}`;
export const collectionPath = (slug) => `/collections/${encodeURIComponent(slug)}`;
