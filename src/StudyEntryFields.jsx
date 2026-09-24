"use client";
import { useState } from "react";
import { Button, Checkbox, Input, InputNumber, Popconfirm, Select } from "antd";
import { DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import { MediaUpload } from "./MediaUpload.jsx";
import { reviewFields, rhythmRoles, shotCategories, shotTransitions } from "./lib/studyReport.js";
import { EntryField as Field } from "./EntryField.jsx";

export function VideoDetailsEditor({ video, onChange, blocked }) {
  const metadata = video.metadata || {};
  const set = (key, value) => { const next = { ...metadata }; if (value == null || value === "unknown") delete next[key]; else next[key] = value; onChange({ metadata: next }); };
  return <details className="entry-shot-context"><summary>视频参数（可选）</summary><p className="entry-hint">上传时读取宽高，无法读取的参数可手动补充；未知帧率和音轨不会自动猜测。</p><div className="entry-two-columns">{[["width", "视频宽度", 32768], ["height", "视频高度", 32768], ["fps", "视频帧率", 1000]].map(([key, label, max]) => <Field label={label} key={key}><InputNumber aria-label={label} min={key === "fps" ? .001 : 1} max={max} precision={key === "fps" ? 3 : 0} value={metadata[key]} onChange={(value) => set(key, value)} /></Field>)}<Field label="音轨"><Select disabled={blocked} aria-label="视频音轨" value={metadata.hasAudio == null ? "unknown" : metadata.hasAudio ? "yes" : "no"} options={[{ value: "unknown", label: "未确认" }, { value: "yes", label: "有声" }, { value: "no", label: "无声" }]} onChange={(value) => set("hasAudio", value === "unknown" ? value : value === "yes")} /></Field></div></details>;
}

export function CastEditor({ video, onChange, blocked, mediaBusy }) {
  const people = video.cast || [];
  const change = (id, changes) => onChange({ cast: people.map((c) => c.id === id ? { ...c, ...changes } : c) });
  const remove = (id) => onChange({ cast: people.filter((c) => c.id !== id), shots: video.shots.map((shot) => shot.subjects?.includes(id) ? { ...shot, subjects: shot.subjects.filter((s) => s !== id), review: {} } : shot) });
  return <details className="entry-section entry-cast"><summary>出场人物 <small>{people.length} 位</small></summary><p className="entry-hint">在这里添加人物资料，再在各镜头中选择出场人物；也可在编辑镜头时直接新增人物。</p>{people.map((person, index) => <div key={person.id} className="entry-person"><div className="entry-two-columns"><Field label={`人物 ${index + 1} 名称`}><Input aria-label={`人物 ${index + 1} 名称`} maxLength={80} value={person.name} onChange={(event) => change(person.id, { name: event.target.value })} /></Field><Field label="人物介绍"><Input.TextArea aria-label={`人物 ${index + 1} 介绍`} maxLength={2000} autoSize={{ minRows: 2, maxRows: 5 }} value={person.note} onChange={(event) => change(person.id, { note: event.target.value })} /></Field></div><MediaUpload label={`人物 ${index + 1} 图片（可选）`} value={person.image} onChange={(image) => change(person.id, { image })} disabled={blocked} onBusyChange={mediaBusy} /><Popconfirm title="移除这位人物及镜头中的关联？" onConfirm={() => remove(person.id)} okText="移除" cancelText="取消"><Button type="text" danger icon={<DeleteOutlined />} disabled={blocked}>移除人物</Button></Popconfirm></div>)}<Button type="dashed" icon={<PlusOutlined />} disabled={blocked || people.length >= 50} onClick={() => onChange({ cast: [...people, { id: `person-${crypto.randomUUID()}`, name: "", image: "", note: "" }] })}>添加人物</Button></details>;
}

export function ShotClassification({ shot, prefix, people, onChange, onAddPerson, blocked }) {
  const [newName, setNewName] = useState("");
  return <details className="entry-shot-context"><summary>镜头类别、节奏与人物</summary><div className="entry-two-columns">{[["category", "镜头类别", shotCategories], ["rhythm", "叙事节奏", rhythmRoles], ["transition", "进入本镜的转场", shotTransitions]].map(([key, label, choices]) => <Field key={key} label={label}><Select disabled={blocked} aria-label={`${prefix}${label}`} allowClear value={shot[key] || undefined} placeholder="未填写" options={choices.map((value) => ({ value, label: value }))} onChange={(value) => onChange({ [key]: value || "" })} /></Field>)}<Field label="出场人物"><Select disabled={blocked} aria-label={`${prefix}出场人物`} mode="multiple" value={shot.subjects || []} placeholder={Array.isArray(shot.subjects) ? "已确认无人物" : "尚未确认出场人物"} options={people.map((c) => ({ value: c.id, label: c.name || "未命名人物" }))} onChange={(subjects) => onChange({ subjects })} /><Checkbox checked={Array.isArray(shot.subjects) && !shot.subjects.length} onChange={(event) => onChange({ subjects: event.target.checked ? [] : undefined })}>确认此镜无人物</Checkbox></Field></div><div className="entry-inline-person"><Input aria-label={`${prefix}新增人物名称`} value={newName} maxLength={80} placeholder="直接新增人物，无需离开镜头" onChange={(event) => setNewName(event.target.value)} /><Button icon={<PlusOutlined />} disabled={blocked || !newName.trim() || people.length >= 50} onClick={() => { onAddPerson(newName.trim()); setNewName(""); }}>新增并关联</Button></div></details>;
}

export function ShotReview({ shot, prefix, onChange }) {
  return <details className="entry-shot-context"><summary>对照原片复核（可选）</summary><p className="entry-hint">确认前请对照原视频，写下判断依据。修改镜头资料后，这些确认会清除，需要重新复核。</p>{Object.entries(reviewFields).map(([key, label]) => {
    const value = shot.review?.[key] || { confirmed: false, note: "" };
    const set = (changes) => onChange({ review: { ...shot.review, [key]: { ...value, ...changes } } });
    return <div className="entry-review-field" key={key}><Checkbox checked={value.confirmed} onChange={(event) => set({ confirmed: event.target.checked })}>{label}已复核</Checkbox><Input.TextArea aria-label={`${prefix}${label}复核结论`} value={value.note} maxLength={1000} placeholder="记录依据或待确认的问题" autoSize={{ minRows: 2, maxRows: 5 }} onChange={(event) => set({ note: event.target.value })} /></div>;
  })}</details>;
}
