export const FAVORITES_KEY = "jingjie-favorites-v1";
export function decodeFavorites(raw) {
  if (!raw) return new Set();
  const parsed = JSON.parse(raw);
  if (parsed?.version !== 1 || !Array.isArray(parsed.ids) || parsed.ids.some((id) => typeof id !== "string" || id.length > 150)) throw new Error("收藏数据无法识别");
  return new Set(parsed.ids);
}
export const encodeFavorites = (ids) => JSON.stringify({ version: 1, ids: [...ids] });
