export const REFERENCE_STORAGE_KEY = "jingjie.reference-projects.v1";

const cleanName = (value) => {
  const name = typeof value === "string" ? value.trim() : "";
  if (!name || name.length > 60) throw new Error("名称请填写 1–60 个字");
  return name;
};
const cleanNote = (value) => {
  if (typeof value !== "string" || value.length > 2000) throw new Error("备注最多 2000 个字");
  return value;
};
const validId = (value) => typeof value === "string" && value.length > 0 && value.length <= 150;

export function decodeReferenceProjects(raw) {
  if (!raw) return [];
  const data = JSON.parse(raw);
  if (data.version !== 1 || !Array.isArray(data.projects)) throw new Error("参考集数据格式无法识别");
  const projectIds = new Set();
  for (const project of data.projects) {
    if (!validId(project.id) || projectIds.has(project.id) || !Array.isArray(project.groups) || !Array.isArray(project.references)) throw new Error("参考集数据不完整");
    projectIds.add(project.id);
    cleanName(project.name);
    const groupIds = new Set([""]);
    for (const group of project.groups) {
      if (!validId(group.id) || groupIds.has(group.id)) throw new Error("参考集分组数据不完整");
      groupIds.add(group.id);
      cleanName(group.name);
    }
    const referenceIds = new Set();
    const sources = new Set();
    for (const reference of project.references) {
      const source = `${reference.caseId}/${reference.shotId}`;
      if (!validId(reference.id) || referenceIds.has(reference.id) || !validId(reference.caseId) || !validId(reference.shotId) || sources.has(source) || !groupIds.has(reference.groupId)) throw new Error("参考镜头数据不完整");
      referenceIds.add(reference.id);
      sources.add(source);
      cleanNote(reference.note);
    }
  }
  return data.projects;
}

export function encodeReferenceProjects(projects) {
  const raw = JSON.stringify({ version: 1, projects });
  decodeReferenceProjects(raw);
  return raw;
}

export function updateReferenceProjects(projects, action) {
  if (action.type === "createProject") {
    const name = cleanName(action.name);
    if (projects.some((project) => project.name === name)) throw new Error("已有同名项目，请换一个名称");
    if (!validId(action.id) || projects.some((project) => project.id === action.id)) throw new Error("项目标识无效");
    return [...projects, { id: action.id, name, groups: [], references: [] }];
  }
  const project = projects.find(({ id }) => id === action.projectId);
  if (!project) throw new Error("这个项目已不存在，请重新选择");
  if (action.type === "removeProject") return projects.filter(({ id }) => id !== project.id);
  let next = { ...project };
  const checkGroup = (groupId) => {
    if (groupId !== "" && !project.groups.some(({ id }) => id === groupId)) throw new Error("这个分组已不存在");
  };
  switch (action.type) {
    case "renameProject":
      next.name = cleanName(action.name);
      if (projects.some(({ id, name }) => id !== project.id && name === next.name)) throw new Error("已有同名项目");
      break;
    case "addGroup": {
      const name = cleanName(action.name);
      if (!validId(action.id) || project.groups.some((group) => group.id === action.id || group.name === name)) throw new Error("已有同名分组");
      next.groups = [...project.groups, { id: action.id, name }];
      break;
    }
    case "renameGroup": {
      checkGroup(action.groupId);
      const name = cleanName(action.name);
      if (project.groups.some((group) => group.id !== action.groupId && group.name === name)) throw new Error("已有同名分组");
      next.groups = project.groups.map((group) => group.id === action.groupId ? { ...group, name } : group);
      break;
    }
    case "removeGroup":
      checkGroup(action.groupId);
      next.groups = project.groups.filter(({ id }) => id !== action.groupId);
      next.references = project.references.map((reference) => reference.groupId === action.groupId ? { ...reference, groupId: "" } : reference);
      break;
    case "addReference":
      checkGroup(action.reference.groupId);
      if (project.references.some((reference) => reference.caseId === action.reference.caseId && reference.shotId === action.reference.shotId)) throw new Error("这个镜头已经在该项目中");
      next.references = [...project.references, { ...action.reference, note: cleanNote(action.reference.note) }];
      break;
    case "editReference":
      if (!project.references.some(({ id }) => id === action.referenceId)) throw new Error("这个镜头已被移出项目");
      if (action.groupId !== undefined) checkGroup(action.groupId);
      next.references = project.references.map((reference) => reference.id === action.referenceId ? {
        ...reference,
        ...(action.note !== undefined && { note: cleanNote(action.note) }),
        ...(action.groupId !== undefined && { groupId: action.groupId }),
      } : reference);
      break;
    case "removeReference":
      next.references = project.references.filter(({ id }) => id !== action.referenceId);
      break;
    case "moveReference": {
      const references = [...project.references];
      const index = references.findIndex(({ id }) => id === action.referenceId);
      if (index < 0) throw new Error("这个镜头已被移出项目");
      const sameGroup = references.filter(({ groupId }) => groupId === references[index].groupId);
      const sibling = sameGroup[sameGroup.findIndex(({ id }) => id === action.referenceId) + action.direction];
      if (!sibling) return projects;
      const other = references.findIndex(({ id }) => id === sibling.id);
      [references[index], references[other]] = [references[other], references[index]];
      next.references = references;
      break;
    }
    case "placeReference": {
      const reference = project.references.find(({ id }) => id === action.referenceId);
      const target = project.references.find(({ id }) => id === action.beforeId);
      if (!reference || !target) throw new Error("排序对象已不存在");
      if (reference.id === target.id) return projects;
      const references = project.references.filter(({ id }) => id !== reference.id);
      references.splice(references.findIndex(({ id }) => id === target.id), 0, { ...reference, groupId: target.groupId });
      next.references = references;
      break;
    }
    default: throw new Error("无法识别这个操作");
  }
  const result = projects.map((current) => current.id === next.id ? next : current);
  encodeReferenceProjects(result);
  return result;
}
