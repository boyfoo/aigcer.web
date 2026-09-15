"use client";
import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Alert, App, Button, Collapse, Empty, Input, InputNumber, Popconfirm, Select, Tag } from "antd";
import { ArrowLeftOutlined, DeleteOutlined, EyeOutlined, PlusOutlined, ReloadOutlined } from "@ant-design/icons";
import { ContentTagFields } from "./ContentTagFields.jsx";
import { useManagedContent } from "./ContentProvider.jsx";
import { casePath, draftPath } from "./lib/content.js";
import { caseTagValues, CONTENT_STORAGE_KEY, decodeContentEntries, normalizeContentEntry } from "./lib/contentEntries.js";
import { MediaUpload, uploadFile } from "./MediaUpload.jsx";
import { contentReadOnly } from "./lib/contentClient.js";
import { CastEditor, ShotClassification, ShotReview, VideoDetailsEditor } from "./StudyEntryFields.jsx";
import { QualityReport } from "./StudyReport.jsx";
import "./content-entry.css";

const builtinGroups = ["type", "emotion", "lighting", "movement"];
const labels = { draft: "草稿", published: "已发布", offline: "已下架" };
const shotMotion = { motionEnter: false, motionLeave: false, motionAppear: false };
const newDraft = () => ({ id: "", title: "", kind: "视频", image: "", duration: "00:00", type: [], emotion: [], lighting: [], movement: [], tags: [], tagValues: {}, description: "", analysis: "", prompt: "", video: { src: "", durationSeconds: 0, isMock: false, shots: [] } });
const emptyShot = (start, end) => ({ id: `shot-${crypto.randomUUID()}`, start, end, title: "", image: "", summary: "", facts: { 景别: "", 运镜: "", 构图: "", 光影: "" }, analysis: [], imagePrompt: "", videoPrompt: "" });
function Field({ label, children, hint, required }) {
  return <div className="entry-field"><div className="entry-field-label">{label}{required && <span aria-hidden="true"> *</span>}</div>{children}{hint && <small>{hint}</small>}</div>;
}

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
  const [legacy, setLegacy] = useState([]);
  const dirty = JSON.stringify(draft) !== baseline;
  const blocked = Boolean(busy || uploads || savingTags);
  const filtered = records.filter((record) => (status === "all" || record.status === status) && record.draft.title.toLowerCase().includes(search.trim().toLowerCase()));

  useEffect(() => {
    try {
      const done = JSON.parse(localStorage.getItem("jingjie-legacy-migrated-v1") || "[]");
      setLegacy(decodeContentEntries(localStorage.getItem(CONTENT_STORAGE_KEY)).filter((item) => !done.includes(item.id)));
    } catch { /* Existing legacy data is never removed or overwritten on a failed read. */ }
  }, []);
  useEffect(() => {
    onDirtyChange(dirty || blocked);
    const unload = (event) => { event.preventDefault(); event.returnValue = ""; };
    if (dirty || blocked) window.addEventListener("beforeunload", unload);
    return () => { onDirtyChange(false); window.removeEventListener("beforeunload", unload); };
  }, [dirty, blocked, onDirtyChange]);

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
  const migrate = async () => {
    setBusy("migrate");
    try {
      const completed = JSON.parse(localStorage.getItem("jingjie-legacy-migrated-v1") || "[]");
      for (const source of legacy) {
        const item = structuredClone(source);
        const convert = async (url) => url?.startsWith("data:") ? (await uploadFile(new File([await (await fetch(url)).blob()], "legacy.png", { type: "image/png" }), "image")).url : url;
        item.image = await convert(item.image);
        for (const shot of item.video?.shots ?? []) { shot.image = await convert(shot.image); if (shot.endImage) shot.endImage = await convert(shot.endImage); }
        const previous = records.find(({ id }) => id === item.id);
        // Keep an already edited server copy intact when importing the browser backup.
        await change("save", item, previous ? { id: `case-${crypto.randomUUID()}` } : { id: item.id });
        completed.push(item.id);
        localStorage.setItem("jingjie-legacy-migrated-v1", JSON.stringify(completed));
        setLegacy((all) => all.filter(({ id }) => id !== item.id));
      }
      message.success("旧版内容已转存为网站草稿，原浏览器记录仍保留");
    } catch (failure) { setSaveError(failure.message); message.error(failure.message); }
    finally { setBusy(""); }
  };

  return <main className="tag-settings-page content-entry-page" aria-labelledby="content-title">
    <div className="tag-settings-page-nav"><Button type="text" icon={<ArrowLeftOutlined />} onClick={onBack}>返回镜头参考</Button><span>内容管理 / 录入</span></div>
    <div className="tag-settings-intro"><h1 id="content-title">内容录入</h1><p>先积累素材，再补充提示词与分析，整理好后发布。</p><span>草稿保存在网站；只有已发布内容会出现在访客列表中。</span></div>
    {!!legacy.length && !contentReadOnly && <Alert className="entry-error" type="info" title={`发现 ${legacy.length} 条旧版浏览器内容`} description="可转存到网站草稿，不会自动发布；同名网站内容会保留。" action={<Button disabled={blocked || !ready || dirty} loading={busy === "migrate"} onClick={migrate}>转存为草稿</Button>} />}
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

function ShotEditor({ shot, index, duration, blocked, mediaBusy, onChange, onRemove, people, onAddPerson }) {
  const prefix = `镜头 ${index + 1}`;
  const input = (key, label, multiline = false, max = 2000) => <Field label={label}><Input.TextArea aria-label={`${prefix}${label}`} value={shot[key] ?? ""} onChange={(event) => onChange({ [key]: event.target.value })} maxLength={max} autoSize={{ minRows: multiline ? 3 : 1, maxRows: 8 }} /></Field>;
  return <div className="entry-shot">
    <div className="entry-two-columns"><Field label="镜头名称" required><Input aria-label={`${prefix}名称`} value={shot.title} onChange={(event) => onChange({ title: event.target.value })} maxLength={80} /></Field><div className="entry-two-columns"><Field label="开始（秒）" required><InputNumber aria-label={`${prefix}开始秒数`} min={0} max={duration} precision={3} value={shot.start} onChange={(start) => onChange({ start })} /></Field><Field label="结束（秒）" required><InputNumber aria-label={`${prefix}结束秒数`} min={0} max={duration} precision={3} value={shot.end} onChange={(end) => onChange({ end })} /></Field></div></div>
    <div className="entry-two-columns"><MediaUpload label={`${prefix}首帧 / 代表画面`} value={shot.image} disabled={blocked} onBusyChange={mediaBusy} onChange={(image) => onChange({ image })} /><MediaUpload label={`${prefix}尾帧（可选）`} value={shot.endImage || ""} disabled={blocked} onBusyChange={mediaBusy} onChange={(endImage) => onChange({ endImage })} /></div>
    <small className="entry-hint">首帧留空时会标明使用案例封面；尾帧可后补。按视频顺序填写时间段，不能重叠。</small>
    {input("summary", "镜头概述", true)}
    <ShotClassification shot={shot} prefix={prefix} people={people} onChange={onChange} onAddPerson={onAddPerson} blocked={blocked} />
    <details className="entry-shot-context"><summary>声音与叙事（可选）</summary><div className="entry-two-columns">{input("sound", "声音与音乐", true)}{input("dialogue", "台词", true)}{input("onscreenText", "画面文字", true)}{input("narrative", "叙事作用", true)}</div></details>
    <div className="entry-two-columns">{Object.entries(shot.facts).map(([label, value]) => <Field key={label} label={label}><Input aria-label={`${prefix}${label}`} value={value} maxLength={120} onChange={(event) => onChange({ facts: { ...shot.facts, [label]: event.target.value } })} /></Field>)}</div>
    <div className="entry-analysis"><h3>拉片拆解</h3>{shot.analysis.map((note, noteIndex) => <div key={noteIndex} className="entry-analysis-row"><Input aria-label={`${prefix}拆解 ${noteIndex + 1} 标题`} placeholder="例如：构图" value={note.label} maxLength={30} onChange={(event) => onChange({ analysis: shot.analysis.map((entry, i) => i === noteIndex ? { ...entry, label: event.target.value } : entry) })} /><Input.TextArea aria-label={`${prefix}拆解 ${noteIndex + 1} 内容`} placeholder="解释这个镜头的视觉效果与作用" value={note.text} maxLength={4000} autoSize={{ minRows: 2, maxRows: 8 }} onChange={(event) => onChange({ analysis: shot.analysis.map((entry, i) => i === noteIndex ? { ...entry, text: event.target.value } : entry) })} /><Button type="text" danger icon={<DeleteOutlined />} aria-label={`删除${prefix}拆解 ${noteIndex + 1}`} onClick={() => onChange({ analysis: shot.analysis.filter((_, i) => i !== noteIndex) })} /></div>)}<Button type="dashed" icon={<PlusOutlined />} disabled={shot.analysis.length >= 20} onClick={() => onChange({ analysis: [...shot.analysis, { label: "", text: "" }] })}>添加拆解</Button></div>
    {input("imagePrompt", "首帧图片提示词", true, 12000)}
    {input("videoPrompt", "视频动态提示词", true, 12000)}
    <ShotReview shot={shot} prefix={prefix} onChange={onChange} />
    <Popconfirm title={`删除${prefix}？`} description="保存案例后生效。" onConfirm={onRemove} okText="删除" cancelText="取消"><Button danger type="text" icon={<DeleteOutlined />}>删除这个镜头</Button></Popconfirm>
  </div>;
}
