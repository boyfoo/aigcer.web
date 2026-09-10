const promptLabels = {
  establishing: {
    image: ["环境", "环境", "构图", "主体", "光线", "光线", "光线", "风格", "风格"],
    video: ["运镜", "构图", "动作", "动作", "主体", "风格"],
  },
  character: {
    image: ["主体", "动作", "构图", "环境", "光线", "光线", "构图", "风格"],
    video: ["运镜", "动作", "动作", "环境", "环境", "主体"],
  },
  detail: {
    image: ["主体", "构图", "构图", "光线", "主体", "环境", "构图", "风格"],
    video: ["运镜", "构图", "动作", "光线", "风格", "主体"],
  },
  movement: {
    image: ["环境", "主体", "构图", "构图", "构图", "光线", "构图", "运镜", "风格"],
    video: ["运镜", "构图", "动作", "环境", "光线", "风格"],
  },
  ending: {
    image: ["环境", "构图", "光线", "环境", "主体", "风格", "光线", "风格"],
    video: ["运镜", "环境", "光线", "动作", "构图", "风格"],
  },
};

export function getPromptSegments(shot, kind) {
  const prompt = kind === "image" ? shot.imagePrompt : shot.videoPrompt;
  const parts = prompt.match(/[^，。；！？]+[，。；！？]*/gu) ?? [prompt];
  return parts.map((text, index) => ({ text, category: promptLabels[shot.id]?.[kind]?.[index] ?? "描述" }));
}

export function groupPromptSegments(segments) {
  const groups = [];
  for (const segment of segments) {
    let group = groups.find(({ category }) => category === segment.category);
    if (!group) { group = { category: segment.category, text: "" }; groups.push(group); }
    group.text += segment.text;
  }
  return groups;
}

export const annotationModes = [
  { id: "composition", label: "构图", fact: "构图" },
  { id: "lighting", label: "光影", fact: "光影" },
  { id: "movement", label: "运镜", fact: "运镜" },
];

const annotations = {
  establishing: { point: [51, 43], lines: [[0, 96, 51, 43], [100, 96, 51, 43], [0, 16, 51, 43], [100, 16, 51, 43]], light: [79, 21, 51, 65], path: [[50, 88], [50, 61], [50, 43]], label: "视线汇聚点" },
  character: { point: [35, 40], lines: [[33, 0, 33, 100], [0, 38, 100, 38]], light: [89, 27, 35, 44], path: [[35, 40], [35, 40]], label: "视线方向留白" },
  detail: { point: [54, 48], lines: [[12, 85, 85, 17], [7, 68, 72, 7]], light: [82, 12, 47, 54], path: [[52, 85], [52, 65], [54, 48]], label: "对角线引导" },
  movement: { point: [50, 38], lines: [[4, 98, 50, 38], [96, 98, 50, 38], [50, 15, 50, 93]], light: [85, 20, 55, 74], path: [[50, 90], [48, 69], [50, 43]], label: "纵深与人物位置" },
  ending: { point: [63, 54], lines: [[17, 12, 83, 12], [83, 12, 83, 87], [83, 87, 17, 87], [17, 87, 17, 12]], light: [72, 42, 47, 74], path: [[50, 50], [50, 50]], label: "框中框" },
};
export const getShotAnnotation = (shot) => annotations[shot.id] ?? null;
