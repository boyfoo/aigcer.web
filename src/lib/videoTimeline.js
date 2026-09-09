export function formatVideoTime(seconds) {
  const value = Math.floor(Number.isFinite(seconds) ? Math.max(0, seconds) : 0);
  const minutes = Math.floor(value / 60).toString().padStart(2, "0");
  return `${minutes}:${(value % 60).toString().padStart(2, "0")}`;
}

export function getShotAtTime(shots, time) {
  if (!Number.isFinite(time) || time < 0) return null;
  return shots.find((shot, index) => time >= shot.start && (
    time < shot.end || (index === shots.length - 1 && time === shot.end)
  )) ?? null;
}

export function clampSeekTime(time, duration) {
  const target = Number.isFinite(time) ? Math.max(0, time) : 0;
  return Number.isFinite(duration) && duration > 0
    ? Math.min(target, Math.max(0, duration - 0.01))
    : target;
}
