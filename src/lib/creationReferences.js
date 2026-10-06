import { casePath, shotPath } from "./content.js";
import { caseTagValues, tagValues } from "./contentEntries.js";
import { CREATION_SHOT_FACT_GROUPS } from "./creationTags.js";

const caseFieldGroups = ["type", "emotion", "lighting", "movement"];
const textValues = (value) => tagValues(value).filter((entry) => typeof entry === "string" && entry.trim());

export function getReferenceTagValues(reference, groupId) {
  const source = reference.shot ?? reference.item;
  if (reference.shot && Object.hasOwn(CREATION_SHOT_FACT_GROUPS, groupId)) {
    return textValues(source.facts?.[CREATION_SHOT_FACT_GROUPS[groupId]]);
  }
  if (!reference.shot) return textValues(caseTagValues(source, groupId));
  const explicit = textValues(source.tagValues?.[groupId]);
  return [...new Set(explicit)];
}

const durationSeconds = (duration) => {
  if (typeof duration === "number") return Number.isFinite(duration) && duration >= 0 ? duration : null;
  if (typeof duration !== "string" || !/^\d{2,4}:[0-5]\d$/.test(duration)) return null;
  const [minutes, seconds] = duration.split(":").map(Number);
  return minutes * 60 + seconds;
};

export function createCreationReferences(items) {
  return items.flatMap((item) => {
    const shots = item.kind === "视频" ? item.video?.shots ?? [] : [];
    if (shots.length) {
      return shots.map((shot, index) => ({
        id: `${item.id}/${shot.id}`,
        kind: "shot",
        caseId: item.id,
        shotId: shot.id,
        item,
        shot,
        index,
        title: shot.title || `镜头 ${index + 1}`,
        description: shot.summary || "",
        image: shot.image || item.image || "",
        imageFallback: Boolean(shot.imageIsFallback || (!shot.image && item.image)),
        duration: durationSeconds(shot.end - shot.start),
        href: shotPath(item.id, shot.id),
        isMock: Boolean(item.video.isMock),
      }));
    }
    const isVideo = item.kind === "视频";
    return [{
      id: `${item.id}/${isVideo ? "whole" : "frame"}`,
      kind: isVideo ? "video" : "frame",
      caseId: item.id,
      shotId: null,
      item,
      shot: null,
      index: 0,
      title: item.title,
      description: isVideo ? ["整片参考，尚未录入镜头拆解", item.description].filter(Boolean).join("。") : item.description || "",
      image: item.image || "",
      imageFallback: false,
      duration: durationSeconds(isVideo ? item.video?.durationSeconds : item.duration),
      href: casePath(item.id),
      isMock: Boolean(isVideo && item.video?.isMock),
    }];
  });
}

const analysisText = (analysis) => Array.isArray(analysis)
  ? analysis.flatMap((note) => [note.label, note.text])
  : [analysis];

function searchableText(reference) {
  const { item, shot } = reference;
  const source = shot ?? item;
  // Case titles identify the source. Other case text cannot describe every shot.
  const parts = [
    item.title,
    source.title,
    source.summary,
    !shot && source.description,
    ...analysisText(source.analysis),
    ...Object.entries(source.facts ?? {}).flat(),
    source.prompt,
    source.imagePrompt,
    source.videoPrompt,
    source.narrative,
    source.sound,
    source.dialogue,
    source.onscreenText,
    source.category,
    source.rhythm,
    source.transition,
    ...Object.values(source.tagValues ?? {}).flatMap(textValues),
    ...(!shot ? [...textValues(source.tags), ...caseFieldGroups.flatMap((groupId) => textValues(source[groupId]))] : []),
    ...(shot?.subjects ?? []).map((id) => item.video.cast?.find((person) => person.id === id)?.name || id),
  ];
  return parts.filter((part) => typeof part === "string" && part).join(" ").toLocaleLowerCase();
}

export function filterCreationReferences(references, { groups = [], filters = {}, query = "" } = {}) {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return references.filter((reference) => {
    const tagsMatch = groups.every((group) => {
      const selected = textValues(filters[group.id]);
      const options = group.options.filter((option) => selected.includes(option.id));
      if (!options.length) return true;
      const values = getReferenceTagValues(reference, group.id);
      return options.some((option) => values.includes(option.value ?? option.label));
    });
    if (!tagsMatch) return false;
    if (!words.length) return true;
    const searchable = searchableText(reference);
    return words.every((word) => searchable.includes(word));
  });
}
