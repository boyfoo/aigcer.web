export const shotSeconds = (shot) => Math.max(0, shot.end - shot.start);
export const formatShotDuration = (shot) => `${Number(shotSeconds(shot).toFixed(2))} 秒`;

export function filterStudyShots(shots, { query = "", size = "", movement = "", category = "", rhythm = "", person = "", people = [], sort = "timeline" } = {}) {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const matches = shots.map((shot, index) => ({ shot, index })).filter(({ shot, index }) => {
    if (size && shot.facts?.景别 !== size) return false;
    if (movement && shot.facts?.运镜 !== movement) return false;
    if (category && shot.category !== category) return false;
    if (rhythm && shot.rhythm !== rhythm) return false;
    if (person && !shot.subjects?.includes(person)) return false;
    const searchable = [String(index + 1).padStart(2, "0"), shot.title, shot.summary, shot.sound, shot.dialogue, shot.onscreenText, shot.narrative,
      shot.category, shot.rhythm, shot.transition, ...(shot.subjects || []).map((id) => people.find((entry) => entry.id === id)?.name || id),
      ...Object.values(shot.facts ?? {}), ...(shot.analysis ?? []).flatMap((note) => [note.label, note.text])].filter(Boolean).join(" ").toLocaleLowerCase();
    return words.every((word) => searchable.includes(word));
  });
  if (sort !== "timeline") matches.sort((a, b) => (sort === "longest" ? shotSeconds(b.shot) - shotSeconds(a.shot) : shotSeconds(a.shot) - shotSeconds(b.shot)) || a.index - b.index);
  return matches;
}

// Gaps remain visible: the rhythm strip must not pretend that unannotated time is a shot.
export function shotSegments(shots, duration) {
  if (shots.some((shot, index) => shot.end <= shot.start || (index > 0 && shot.start < shots[index - 1].end))) return [];
  const total = Math.max(duration || 0, ...shots.map((shot) => shot.end), 0);
  if (!total) return [];
  const segments = [];
  let end = 0;
  shots.forEach((shot, index) => {
    if (shot.start > end) segments.push({ key: `gap-${index}`, start: end, end: shot.start, fraction: (shot.start - end) / total });
    if (shot.end > shot.start) segments.push({ key: shot.id, shot, index, start: shot.start, end: shot.end, fraction: (shot.end - shot.start) / total });
    end = Math.max(end, shot.end);
  });
  if (end < total) segments.push({ key: "gap-end", start: end, end: total, fraction: (total - end) / total });
  return segments;
}

const sizeTones = { 大远景: 0, 远景: 0, 全景: 1, 中远景: 1, 中景: 2, 中近景: 3, 近景: 3, 特写: 4, 大特写: 4 };
export const shotSizeTone = (size) => sizeTones[size] ?? 2;
