"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { App as AntApp, Alert, Button, Drawer, Empty, Input, Modal, Popconfirm, Select } from "antd";
import { ArrowDownOutlined, ArrowUpOutlined, DeleteOutlined, EditOutlined, FolderOutlined, HolderOutlined, PlusOutlined } from "@ant-design/icons";
import { shotPath } from "./lib/content.js";
import { useContentCases } from "./ContentProvider.jsx";
import { formatVideoTime } from "./lib/videoTimeline.js";
import { REFERENCE_STORAGE_KEY, decodeReferenceProjects, encodeReferenceProjects, updateReferenceProjects } from "./lib/referenceProjects.js";
import "./reference-projects.css";

const ReferenceContext = createContext(null);
export const useReferenceProjects = () => useContext(ReferenceContext);
const newId = () => crypto.randomUUID();

export function ReferenceProjectsProvider({ children }) {
  const { message } = AntApp.useApp();
  const [projects, setProjects] = useState([]);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [pendingReference, setPendingReference] = useState(null);
  const [activeProjectId, setActiveProjectId] = useState("");
  const projectsRef = useRef([]);
  const readyRef = useRef(false);
  const guardRef = useRef(null);

  useEffect(() => {
    const load = () => {
      try {
        const next = decodeReferenceProjects(localStorage.getItem(REFERENCE_STORAGE_KEY));
        projectsRef.current = next;
        readyRef.current = true;
        setProjects(next);
        setReady(true);
        setLoadError(false);
      } catch {
        readyRef.current = false;
        setReady(false);
        setLoadError(true);
      }
    };
    load();
    const onStorage = (event) => { if (event.key === REFERENCE_STORAGE_KEY || event.key === null) load(); };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const commit = (actions) => {
    if (!readyRef.current) { message.error("收藏夹尚未读取完成，请稍后重试"); return false; }
    try {
      const next = (Array.isArray(actions) ? actions : [actions]).reduce(updateReferenceProjects, projectsRef.current);
      localStorage.setItem(REFERENCE_STORAGE_KEY, encodeReferenceProjects(next));
      projectsRef.current = next;
      setProjects(next);
      return true;
    } catch (error) {
      message.error(error.name === "QuotaExceededError" ? "浏览器存储空间不足，本次修改未保存" : error.message || "无法保存收藏夹，请检查浏览器存储权限");
      return false;
    }
  };
  const openLibrary = (guard) => { guardRef.current = typeof guard === "function" ? guard : null; setLibraryOpen(true); };
  return (
    <ReferenceContext.Provider value={{ projects, ready, commit, openLibrary, addToProject: setPendingReference }}>
      {children}
      <ProjectLibrary open={libraryOpen} onClose={() => setLibraryOpen(false)} activeId={activeProjectId} setActiveId={setActiveProjectId} loadError={loadError} guardNavigation={(event) => guardRef.current?.(event)} />
      {pendingReference && <AddReferenceDialog reference={pendingReference} preferredId={activeProjectId} onClose={() => setPendingReference(null)} onAdded={setActiveProjectId} />}
    </ReferenceContext.Provider>
  );
}

function AddReferenceDialog({ reference, preferredId, onClose, onAdded }) {
  const { projects, ready, commit } = useReferenceProjects();
  const { message } = AntApp.useApp();
  const [projectId, setProjectId] = useState(projects.some(({ id }) => id === preferredId) ? preferredId : projects[0]?.id ?? "new");
  const [name, setName] = useState("");
  const [groupId, setGroupId] = useState("");
  const [note, setNote] = useState("");
  const { items } = useContentCases();
  const item = items.find(({ id }) => id === reference.caseId);
  const shot = item?.video?.shots.find(({ id }) => id === reference.shotId);
  const project = projects.find(({ id }) => id === projectId);
  const exists = project?.references.some((entry) => entry.caseId === reference.caseId && entry.shotId === reference.shotId);
  const save = () => {
    if (!shot) return;
    const id = projectId === "new" ? newId() : projectId;
    const actions = projectId === "new" ? [{ type: "createProject", id, name }] : [];
    actions.push({ type: "addReference", projectId: id, reference: { id: newId(), ...reference, groupId: projectId === "new" ? "" : groupId, note } });
    if (commit(actions)) { onAdded(id); message.success("镜头已加入镜头收藏夹"); onClose(); }
  };
  return <Modal className="reference-modal" open title="加入镜头收藏夹" onCancel={onClose} onOk={save} okText={exists ? "已在收藏夹中" : "加入收藏夹"} okButtonProps={{ disabled: !ready || !shot || exists || (projectId === "new" && !name.trim()) }} cancelText="取消">
    {shot && <div className="reference-preview"><img src={shot.image} alt="" /><div><strong>{shot.title}</strong><p>{item.title} · {formatVideoTime(shot.start)}–{formatVideoTime(shot.end)}</p></div></div>}
    <label className="reference-field">收藏夹<Select aria-label="选择镜头收藏夹" value={projectId} onChange={(value) => { setProjectId(value); setGroupId(""); }} options={[...projects.map(({ id, name: label }) => ({ value: id, label })), { value: "new", label: "＋ 新建收藏夹" }]} /></label>
    {projectId === "new" ? <label className="reference-field">收藏夹名称<Input autoFocus aria-label="新收藏夹名称" placeholder="例如：雨夜品牌短片" value={name} maxLength={60} onChange={(event) => setName(event.target.value)} onPressEnter={save} /></label> : <label className="reference-field">分组<Select aria-label="选择镜头分组" value={groupId} onChange={setGroupId} options={[{ value: "", label: "未分组" }, ...(project?.groups ?? []).map(({ id, name: label }) => ({ value: id, label }))]} /></label>}
    <label className="reference-field">参考备注<Input.TextArea aria-label="镜头参考备注" placeholder="记录你想回顾的细节" value={note} onChange={(event) => setNote(event.target.value)} maxLength={2000} autoSize={{ minRows: 3, maxRows: 5 }} /></label>
    <p className="reference-storage-note">收藏夹保存在当前浏览器。</p>
  </Modal>;
}

function ProjectLibrary({ open, onClose, activeId, setActiveId, loadError, guardNavigation }) {
  const { projects, ready, commit } = useReferenceProjects();
  const [newProjectName, setNewProjectName] = useState("");
  const [newGroupName, setNewGroupName] = useState("");
  const [editingName, setEditingName] = useState(null);
  const [draggedId, setDraggedId] = useState(null);
  const project = projects.find(({ id }) => id === activeId) ?? projects[0];
  const createProject = () => {
    const id = newId();
    if (commit({ type: "createProject", id, name: newProjectName })) { setActiveId(id); setNewProjectName(""); }
  };
  const addGroup = () => {
    if (commit({ type: "addGroup", projectId: project.id, id: newId(), name: newGroupName })) setNewGroupName("");
  };
  const groups = project ? [{ id: "", name: "未分组" }, ...project.groups] : [];
  return <>
    <Drawer title="镜头收藏夹" open={open} onClose={onClose} size={1000} className="reference-library" extra={<span className="reference-storage-note">保存在当前浏览器</span>}>
      {loadError ? <Alert type="error" title="暂时无法读取收藏夹" description="本地数据未被覆盖。请检查浏览器存储权限，或恢复数据后刷新页面。" /> : !ready ? <p>正在读取收藏夹…</p> : <div className="reference-library-layout">
        <aside className="reference-project-list" aria-label="镜头收藏夹">
          <div className="reference-new-project"><Input aria-label="创建收藏夹名称" placeholder="新收藏夹名称" value={newProjectName} onChange={(event) => setNewProjectName(event.target.value)} maxLength={60} onPressEnter={createProject} /><Button icon={<PlusOutlined />} aria-label="创建收藏夹" onClick={createProject} disabled={!newProjectName.trim()} /></div>
          {projects.map((entry) => <button key={entry.id} type="button" className={entry.id === project?.id ? "reference-project is-active" : "reference-project"} aria-pressed={entry.id === project?.id} onClick={() => setActiveId(entry.id)}><FolderOutlined /><span>{entry.name}</span><small>{entry.references.length}</small></button>)}
        </aside>
        <div className="reference-project-content">
          {!project ? <Empty description="新建一个收藏夹，把想回看的镜头放在一起" /> : <>
            <header className="reference-project-heading"><div><h2>{project.name}</h2><p>{project.references.length} 个镜头 · {project.groups.length} 个分组</p></div><div><Button type="text" icon={<EditOutlined />} aria-label="重命名收藏夹" onClick={() => setEditingName({ kind: "project", id: project.id, name: project.name })} /><Popconfirm title="删除这个收藏夹？" description="只删除收藏夹，不会删除视频案例。" okText="删除" cancelText="取消" onConfirm={() => commit({ type: "removeProject", projectId: project.id })}><Button type="text" danger icon={<DeleteOutlined />} aria-label="删除收藏夹" /></Popconfirm></div></header>
            <div className="reference-new-group"><Input aria-label="新分组名称" placeholder="分组名称，例如：开场 / 光影 / 结尾" value={newGroupName} onChange={(event) => setNewGroupName(event.target.value)} maxLength={60} onPressEnter={addGroup} /><Button icon={<PlusOutlined />} onClick={addGroup} disabled={!newGroupName.trim()}>新建分组</Button></div>
            {!project.references.length && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="在案例拆解页选择镜头，点击“收藏这镜”" />}
            {groups.map((group) => {
              const references = project.references.filter(({ groupId }) => groupId === group.id);
              if (!group.id && !references.length) return null;
              return <section className="reference-group" key={group.id || "ungrouped"}>
                <div className="reference-group-heading"><h3>{group.name} <small>{references.length}</small></h3>{group.id && <div><Button type="text" size="small" icon={<EditOutlined />} aria-label={`重命名分组 ${group.name}`} onClick={() => setEditingName({ kind: "group", projectId: project.id, id: group.id, name: group.name })} /><Popconfirm title="移除分组？" description="镜头会保留在“未分组”中。" okText="移除" cancelText="取消" onConfirm={() => commit({ type: "removeGroup", projectId: project.id, groupId: group.id })}><Button type="text" size="small" icon={<DeleteOutlined />} aria-label={`移除分组 ${group.name}`} /></Popconfirm></div>}</div>
                {!references.length && <p className="reference-empty-group">将已有镜头移到这个分组，或从视频页加入。</p>}
                {references.map((reference, index) => <ReferenceEntry key={reference.id} reference={reference} project={project} index={index} count={references.length} onNavigate={(event) => { guardNavigation(event); if (!event.defaultPrevented) onClose(); }} onDragStart={() => setDraggedId(reference.id)} onDragEnd={() => setDraggedId(null)} onDrop={() => { if (draggedId) commit({ type: "placeReference", projectId: project.id, referenceId: draggedId, beforeId: reference.id }); setDraggedId(null); }} />)}
              </section>;
            })}
          </>}
        </div>
      </div>}
    </Drawer>
    <Modal className="reference-modal" title={editingName?.kind === "project" ? "重命名收藏夹" : "重命名分组"} open={!!editingName} onCancel={() => setEditingName(null)} okText="保存" cancelText="取消" onOk={() => {
      if (commit(editingName.kind === "project" ? { type: "renameProject", projectId: editingName.id, name: editingName.name } : { type: "renameGroup", projectId: editingName.projectId, groupId: editingName.id, name: editingName.name })) setEditingName(null);
    }}><Input aria-label="修改名称" value={editingName?.name ?? ""} maxLength={60} onChange={(event) => setEditingName({ ...editingName, name: event.target.value })} /></Modal>
  </>;
}

function ReferenceEntry({ reference, project, index, count, onNavigate, onDragStart, onDragEnd, onDrop }) {
  const { commit } = useReferenceProjects();
  const { message } = AntApp.useApp();
  const [note, setNote] = useState(reference.note);
  const { items } = useContentCases();
  const item = items.find(({ id }) => id === reference.caseId);
  const shot = item?.video?.shots.find(({ id }) => id === reference.shotId);
  useEffect(() => setNote(reference.note), [reference.note]);
  return <article className="reference-entry" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); onDrop(); }}>
    <div className="reference-entry-top">
      <span className="reference-drag" draggable onDragStart={(event) => { event.dataTransfer.setData("text/plain", reference.id); event.dataTransfer.effectAllowed = "move"; onDragStart(); }} onDragEnd={onDragEnd} title="拖动调整顺序"><HolderOutlined /></span>
      {shot ? <a className="reference-entry-link" href={shotPath(item.id, shot.id)} onClick={onNavigate}><img src={shot.image} alt="" draggable={false} /><span><strong>{shot.title}</strong><small>{item.title} · {formatVideoTime(shot.start)}–{formatVideoTime(shot.end)}</small></span></a> : <strong>原镜头暂不可用</strong>}
      <div className="reference-entry-order"><Button size="small" type="text" icon={<ArrowUpOutlined />} aria-label={`上移 ${shot?.title ?? "镜头"}`} disabled={index === 0} onClick={() => commit({ type: "moveReference", projectId: project.id, referenceId: reference.id, direction: -1 })} /><Button size="small" type="text" icon={<ArrowDownOutlined />} aria-label={`下移 ${shot?.title ?? "镜头"}`} disabled={index === count - 1} onClick={() => commit({ type: "moveReference", projectId: project.id, referenceId: reference.id, direction: 1 })} /><Popconfirm title="从收藏夹中移除这个镜头？" okText="移除" cancelText="取消" onConfirm={() => commit({ type: "removeReference", projectId: project.id, referenceId: reference.id })}><Button size="small" type="text" icon={<DeleteOutlined />} aria-label={`移除 ${shot?.title ?? "镜头"}`} /></Popconfirm></div>
    </div>
    <Input.TextArea aria-label={`${shot?.title ?? "镜头"}的收藏夹备注`} value={note} onChange={(event) => setNote(event.target.value)} placeholder="这个镜头有哪些值得回顾的细节？" maxLength={2000} autoSize={{ minRows: 2, maxRows: 6 }} />
    <div className="reference-entry-footer"><Select aria-label={`${shot?.title ?? "镜头"}所属分组`} value={reference.groupId} onChange={(groupId) => commit({ type: "editReference", projectId: project.id, referenceId: reference.id, groupId, note })} options={[{ value: "", label: "未分组" }, ...project.groups.map(({ id, name: label }) => ({ value: id, label }))]} /><Button disabled={note === reference.note} onClick={() => { if (commit({ type: "editReference", projectId: project.id, referenceId: reference.id, note })) message.success("备注已保存"); }}>保存备注</Button></div>
  </article>;
}

