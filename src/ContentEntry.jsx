"use client";
import { useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Alert, App, Button, Collapse, Empty, Input, InputNumber, Popconfirm, Select, Tag } from "antd";
import { ArrowLeftOutlined, EyeOutlined, PlusOutlined, ReloadOutlined } from "@ant-design/icons";
import { ContentTagFields } from "./ContentTagFields.jsx";
import { useManagedContent } from "./ContentProvider.jsx";
import { casePath, draftPath } from "./lib/content.js";
import { caseTagValues, normalizeContentEntry } from "./lib/contentEntries.js";
import { MediaUpload } from "./MediaUpload.jsx";
import { contentReadOnly } from "./lib/contentClient.js";
import { CastEditor, VideoDetailsEditor } from "./StudyEntryFields.jsx";
import { QualityReport } from "./StudyReport.jsx";
import { EntryField as Field } from "./EntryField.jsx";
import { ShotEditor } from "./ShotEditor.jsx";
import { useUnsavedChanges } from "./hooks/useUnsavedChanges.js";
import "./content-entry.css";

const builtinGroups = ["type", "emotion", "lighting", "movement"];
const labels = { draft: "草稿", published: "已发布", offline: "已下架" };
const shotMotion = { motionEnter: false, motionLeave: false, motionAppear: false };
const newDraft = () => ({ id: "", title: "", kind: "视频", image: "", duration: "00:00", type: [], emotion: [], lighting: [], movement: [], tags: [], tagValues: {}, description: "", analysis: "", prompt: "", video: { src: "", durationSeconds: 0, isMock: false, shots: [] } });
const emptyShot = (start, end) => ({ id: `shot-${crypto.randomUUID()}`, start, end, title: "", image: "", summary: "", facts: { 景别: "", 运镜: "", 构图: "", 光影: "" }, analysis: [], imagePrompt: "", videoPrompt: "" });

export function ContentEntry({ onBack, onNavigate, onDirtyChange }) {
  const { message, modal } = App.useApp();
  const { records, ready, error, refresh, change } = useManagedContent();
  const [draft, setDraft] = useState(newDraft);
  const [current, setCurrent] = useState(null);
  const [baseline, setBaseline] = useState(() => JSON.stringify(newDraft()));
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [saveError, setSaveError] = useState("");
  const [busy, setBusy] = useState("");
  const [uploads, setUploads] = useState(0);
  const [savingTags, setSavingTags] = useState(false);
  const [openShots, setOpenShots] = useState([]);
  const shotListRef = useRef(null);
  const dirty = JSON.stringify(draft) !== baseline;
  const blocked = Boolean(busy || uploads || savingTags);
  const filtered = records.filter((record) => (status === "all" || record.status === status) && record.draft.title.toLowerCase().includes(search.trim().toLowerCase()));

  useUnsavedChanges(dirty || blocked, onDirtyChange);

  const update = (changes) => { setDraft((value) => ({ ...value, ...changes })); setSaveError(""); };
  const updateVideo = (changes) => update({ video: { ...draft.video, ...changes } });
  const updateShot = (id, changes) => updateVideo({ shots: draft.video.shots.map((entry) => entry.id === id ? { ...entry, ...changes, ...(!("review" in changes) && { review: {} }) } : entry) });
  const addPersonToShot = (id, name) => {
    const person = { id: `person-${crypto.randomUUID()}`, name, image: "", note: "" };
    updateVideo({ cast: [...(draft.video.cast || []), person], shots: draft.video.shots.map((shot) => shot.id === id ? { ...shot, subjects: [...(shot.subjects || []), person.id], review: {} } : shot) });
  };
  const shotHeader = (id) => shotListRef.current?.querySelector(`[data-shot-id="${CSS.escape(id)}"] .ant-collapse-header`);
  const keepShotPosition = (id, applyChange, anchor = shotHeader(id)) => {
    const top = anchor?.getBoundingClientRect().top;
    // Commit the full accordion switch before measuring, including Ant Design's panel visibility.
    flushSync(applyChange);
    const header = shotHeader(id);
    if (header && top !== undefined) {
      window.scrollBy({ top: header.getBoundingClientRect().top - top, behavior: "instant" });
    }
  };
  const changeOpenShots = (keys) => keepShotPosition(keys[0] ?? openShots[0], () => setOpenShots(keys));
  const addShot = (event) => {
    const start = draft.video.shots.at(-1)?.end ?? 0;
    const shot = emptyShot(start, draft.video.durationSeconds > start ? draft.video.durationSeconds : start);
    keepShotPosition(shot.id, () => {
      updateVideo({ shots: [...draft.video.shots, shot] });
      setOpenShots([shot.id]);
    }, event.currentTarget);
    shotHeader(shot.id)?.focus({ preventScroll: true });
  };
  const selectTags = (groupId, values, append = false) => {
    setDraft((value) => {
      const selected = append ? [...new Set([...caseTagValues(value, groupId), ...values])] : values;
      return { ...value, ...(builtinGroups.includes(groupId) && { [groupId]: selected }), tagValues: { ...value.tagValues, [groupId]: selected } };
    });
    setSaveError("");
  };
  const loadDraft = (record) => { const next = record ? structuredClone(record.draft) : newDraft(); setCurrent(record); setDraft(next); setBaseline(JSON.stringify(next)); setSaveError(""); setOpenShots([]); };
  const choose = (record) => {
    if (blocked) return;
    if (!dirty) return loadDraft(record);
    modal.confirm({ title: "放弃未保存的修改？", content: "网站仍会保留上次保存的草稿。", okText: "放弃修改", cancelText: "继续编辑", onOk: () => loadDraft(record) });
  };
  const act = async (action) => {
    if (blocked) return;
    setSaveError(""); setBusy(action);
    try {
      if (action === "publish") normalizeContentEntry({ ...draft, id: draft.id || "new-case" });
      const saved = await change(action, draft, current);
      loadDraft(saved);
      message.success({ save: "草稿已保存，公开版本保持原样", publish: "已发布，访客现在可以看到这个版本", unlist: "已下架，原内容已保留", relist: "已重新上架上次发布的版本", delete: "草稿已删除" }[action]);
    } catch (failure) { setSaveError(failure.message); message.error(failure.message); }
    finally { setBusy(""); }
  };
  const mediaBusy = (delta) => setUploads((count) => Math.max(0, count + delta));
  const imageInput = (label, value, onChange) => <MediaUpload label={label} value={value} onChange={onChange} onBusyChange={mediaBusy} disabled={blocked} />;
  return <main className="tag-settings-page content-entry-page" aria-labelledby="content-title">
    <div className="tag-settings-page-nav"><Button type="text" icon={<ArrowLeftOutlined />} onClick={onBack}>返回镜头参考</Button><span>内容管理 / 录入</span></div>
    <div className="tag-settings-intro"><h1 id="content-title">内容录入</h1><p>先积累素材，再补充提示词与分析，整理好后发布。</p><span>草稿保存在网站；只有已发布内容会出现在访客列表中。</span></div>
    {error ? <Alert type="error" title="内容读取失败" description={error} action={!contentReadOnly && <Button onClick={refresh}>重新读取</Button>} /> : !ready ? <p role="status">正在读取内容…</p> : <div className="entry-layout">
      <aside className="entry-library" aria-label="案例列表">
        <Button type="primary" block icon={<PlusOutlined />} disabled={blocked} onClick={() => choose(null)}>新增案例</Button>
        <Input aria-label="搜索已录入案例" placeholder="搜索案例名称" value={search} allowClear onChange={(event) => setSearch(event.target.value)} />
        <Select aria-label="按发布状态筛选" value={status} onChange={setStatus} options={[{ value: "all", label: "全部内容" }, ...Object.entries(labels).map(([value, label]) => ({ value, label }))]} />
        <div className="entry-list-heading"><h2>案例资料</h2><span>{filtered.length}</span><Button type="text" size="small" icon={<ReloadOutlined />} aria-label="刷新案例列表" disabled={blocked} onClick={refresh} /></div>
        <div className="entry-case-list">{filtered.map((record) => <button key={record.id} type="button" disabled={blocked} className={`entry-case${draft.id === record.id ? " is-active" : ""}`} aria-pressed={draft.id === record.id} onClick={() => choose(record)}><img src={record.draft.image || "/images/media-placeholder.svg"} alt="" /><span><strong>{record.draft.title || "未命名案例"}</strong><small>{labels[record.status]}{record.status !== "draft" && record.hasChanges ? " · 有待发布修改" : ""}</small></span></button>)}</div>
        {!filtered.length && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="这里还没有内容" />}
      </aside>
      <form className="entry-editor" onSubmit={(event) => { event.preventDefault(); act("save"); }} aria-label="案例录入表单">
        <div className="entry-editor-heading"><h2>{draft.id ? "编辑案例" : "新增案例"} <Tag>{labels[current?.status || "draft"]}</Tag></h2><div>{current && <Button icon={<EyeOutlined />} disabled={blocked} onClick={() => onNavigate(draftPath(current.id))}>预览草稿</Button>}{current?.status === "published" && <Button type="text" disabled={blocked} onClick={() => onNavigate(casePath(current.id))}>查看已发布版本</Button>}</div></div>
        <p className="entry-state-note">{current?.status === "published" ? "保存修改不会影响访客看到的内容，再次发布后才会更新。" : current?.status === "offline" ? "当前内容已下架。重新上架恢复上次发布的版本；发布则使用当前编辑内容。" : "可以先上传素材保存草稿，发布前至少补充提示词或分析中的一项。"}</p>
        <fieldset className="entry-fields" disabled={blocked}>
        <section className="entry-section" aria-labelledby="entry-basic"><h3 id="entry-basic">基本信息</h3><div className="entry-two-columns"><Field label="案例名称"><Input aria-label="案例名称" value={draft.title} maxLength={80} placeholder="上传时可自动使用文件名" onChange={(event) => update({ title: event.target.value })} /></Field><Field label="内容类型"><Select aria-label="内容类型" disabled={blocked} value={draft.kind} options={[{ value: "分镜", label: "分镜" }, { value: "视频", label: "视频" }]} onChange={(kind) => update({ kind, ...(kind === "视频" && !draft.video ? { video: { src: "", durationSeconds: 0, isMock: false, shots: [] } } : {}) })} /></Field></div>
          {draft.kind === "视频" && <><MediaUpload label="案例视频" value={draft.video.src} kind="video" onBusyChange={mediaBusy} disabled={blocked} onChange={(src, info) => update({ title: draft.title || (info.name || "").replace(/\.[^.]+$/, "").slice(0, 80), video: { ...draft.video, src, durationSeconds: info.duration || 0, metadata: info.metadata || {}, isMock: false, shots: draft.video.shots.map((shot) => ({ ...shot, review: {} })) } })} /><Field label="视频时长（秒）" hint="自动读取失败时可以手动填写。"><InputNumber aria-label="视频时长秒数" min={0} max={86400} precision={3} value={draft.video.durationSeconds} onChange={(durationSeconds) => updateVideo({ durationSeconds, shots: draft.video.shots.map((shot) => ({ ...shot, review: {} })) })} /></Field><VideoDetailsEditor video={draft.video} onChange={updateVideo} blocked={blocked} /></>}
          {imageInput(draft.kind === "视频" ? "案例封面（可后补）" : "案例图片", draft.image, (image, info) => update({ image, title: draft.title || (info.name || "").replace(/\.[^.]+$/, "").slice(0, 80) }))}
          {draft.kind === "分镜" && <Field label="分镜时长（可选）"><Input aria-label="分镜时长" value={draft.duration} placeholder="00:08" maxLength={7} onChange={(event) => update({ duration: event.target.value })} /></Field>}
          <Field label="案例介绍（可选）"><Input.TextArea aria-label="案例介绍" value={draft.description} maxLength={2000} showCount autoSize={{ minRows: 3, maxRows: 8 }} placeholder="简要描述画面与学习重点" onChange={(event) => update({ description: event.target.value })} /></Field>
        </section>
        <ContentTagFields draft={draft} disabled={blocked} onSelect={selectTags} onBusyChange={setSavingTags} onExtraTagsChange={(tags) => update({ tags })} />
        <section className="entry-section" aria-labelledby="entry-reference"><h3 id="entry-reference">提示词与分析</h3><p className="entry-hint">发布前至少完成其中一项，也可以填写在下方的具体镜头中。</p><Field label="整体提示词"><Input.TextArea aria-label="整体提示词" value={draft.prompt} maxLength={12000} showCount autoSize={{ minRows: 4, maxRows: 14 }} placeholder="记录对应素材的提示词" onChange={(event) => update({ prompt: event.target.value })} /></Field><Field label="案例分析"><Input.TextArea aria-label="案例分析" value={draft.analysis} maxLength={16000} showCount autoSize={{ minRows: 4, maxRows: 16 }} placeholder="记录镜头、构图、光影与叙事的观察和理解" onChange={(event) => update({ analysis: event.target.value })} /></Field></section>
        {draft.kind === "视频" && <CastEditor video={draft.video} onChange={updateVideo} blocked={blocked} mediaBusy={mediaBusy} />}
        {draft.kind === "视频" && <section ref={shotListRef} className="entry-section entry-shots" aria-labelledby="entry-shots">
          <h3 id="entry-shots">分镜拆解 <small>{draft.video.shots.length} 个镜头</small></h3>
          <p className="entry-hint">按视频时间顺序整理，可逐步补充。</p>
          <Collapse accordion activeKey={openShots} onChange={changeOpenShots} openMotion={shotMotion} items={draft.video.shots.map((shot, index) => ({
            key: shot.id,
            "data-shot-id": shot.id,
            label: `${String(index + 1).padStart(2, "0")} · ${shot.title || "未命名镜头"}`,
            children: <ShotEditor shot={shot} index={index} duration={draft.video.durationSeconds} blocked={blocked} mediaBusy={mediaBusy} people={draft.video.cast || []} onAddPerson={(name) => addPersonToShot(shot.id, name)}
              onChange={(changes) => updateShot(shot.id, changes)}
              onRemove={() => updateVideo({ shots: draft.video.shots.filter((entry) => entry.id !== shot.id) })} />,
          }))} />
          <Button className="entry-add-shot" block type="dashed" icon={<PlusOutlined />} disabled={blocked || draft.video.shots.length >= 100} onClick={addShot}>添加镜头</Button>
        </section>}
        {draft.kind === "视频" && <details className="entry-section entry-quality"><summary>质量检查 · 15 项</summary><QualityReport video={draft.video} prefix="entry" onSelect={(shot) => { flushSync(() => setOpenShots([shot.id])); shotHeader(shot.id)?.scrollIntoView({ block: "start", behavior: "instant" }); shotHeader(shot.id)?.focus({ preventScroll: true }); }} /></details>}
        </fieldset>
        {saveError && <Alert className="entry-error" type="error" title={saveError} showIcon />}
        <div className="entry-save-bar"><span role="status">{uploads ? "素材上传中…" : dirty ? "有未保存的修改" : current?.hasChanges ? "草稿已保存，待发布" : current ? labels[current.status] : "可先上传素材保存"}</span><div>
          {current?.status === "draft" && <Popconfirm title="删除这个草稿？" okText="删除" cancelText="取消" onConfirm={() => act("delete")}><Button type="text" danger disabled={blocked}>删除草稿</Button></Popconfirm>}
          {current?.status === "published" && <Popconfirm title="下架这条内容？" description="访客暂时看不到，资料仍会保留，之后可以重新上架。" okText="下架" cancelText="取消" onConfirm={() => act("unlist")}><Button disabled={blocked || dirty}>下架</Button></Popconfirm>}
          {current?.status === "offline" && <Button disabled={blocked || dirty} loading={busy === "relist"} onClick={() => act("relist")}>重新上架</Button>}
          <Button htmlType="submit" disabled={blocked || !dirty} loading={busy === "save"}>保存草稿</Button>
          <Button type="primary" disabled={blocked || (current?.status === "published" && !dirty && !current.hasChanges)} loading={busy === "publish"} onClick={() => act("publish")}>{current?.publishedAt ? "发布更新" : "发布"}</Button>
        </div></div>
      </form>
    </div>}
  </main>;
}
