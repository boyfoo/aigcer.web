import { Button, Input, InputNumber, Popconfirm } from "antd";
import { DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import { EntryField as Field } from "./EntryField.jsx";
import { MediaUpload } from "./MediaUpload.jsx";
import { ShotClassification, ShotReview } from "./StudyEntryFields.jsx";

export function ShotEditor({ shot, index, duration, blocked, mediaBusy, onChange, onRemove, people, onAddPerson }) {
  const prefix = `镜头 ${index + 1}`;
  const input = (key, label, max = 2000) => (
    <Field label={label}>
      <Input.TextArea
        aria-label={`${prefix}${label}`}
        value={shot[key] ?? ""}
        onChange={(event) => onChange({ [key]: event.target.value })}
        maxLength={max}
        autoSize={{ minRows: 3, maxRows: 8 }}
      />
    </Field>
  );
  const updateAnalysis = (noteIndex, changes) => {
    onChange({
      analysis: shot.analysis.map((note, i) => i === noteIndex ? { ...note, ...changes } : note),
    });
  };

  return (
    <div className="entry-shot">
      <div className="entry-two-columns">
        <Field label="镜头名称" required>
          <Input aria-label={`${prefix}名称`} value={shot.title} onChange={(event) => onChange({ title: event.target.value })} maxLength={80} />
        </Field>
        <div className="entry-two-columns">
          <Field label="开始（秒）" required>
            <InputNumber aria-label={`${prefix}开始秒数`} min={0} max={duration} precision={3} value={shot.start} onChange={(start) => onChange({ start })} />
          </Field>
          <Field label="结束（秒）" required>
            <InputNumber aria-label={`${prefix}结束秒数`} min={0} max={duration} precision={3} value={shot.end} onChange={(end) => onChange({ end })} />
          </Field>
        </div>
      </div>
      <div className="entry-two-columns">
        <MediaUpload label={`${prefix}首帧 / 代表画面`} value={shot.image} disabled={blocked} onBusyChange={mediaBusy} onChange={(image) => onChange({ image })} />
        <MediaUpload label={`${prefix}尾帧（可选）`} value={shot.endImage || ""} disabled={blocked} onBusyChange={mediaBusy} onChange={(endImage) => onChange({ endImage })} />
      </div>
      <small className="entry-hint">首帧留空时会标明使用案例封面；尾帧可后补。按视频顺序填写时间段，不能重叠。</small>
      {input("summary", "镜头概述")}
      <ShotClassification shot={shot} prefix={prefix} people={people} onChange={onChange} onAddPerson={onAddPerson} blocked={blocked} />
      <details className="entry-shot-context">
        <summary>声音与叙事（可选）</summary>
        <div className="entry-two-columns">
          {input("sound", "声音与音乐")}
          {input("dialogue", "台词")}
          {input("onscreenText", "画面文字")}
          {input("narrative", "叙事作用")}
        </div>
      </details>
      <div className="entry-two-columns">
        {Object.entries(shot.facts).map(([label, value]) => (
          <Field key={label} label={label}>
            <Input
              aria-label={`${prefix}${label}`}
              value={value}
              maxLength={120}
              onChange={(event) => onChange({ facts: { ...shot.facts, [label]: event.target.value } })}
            />
          </Field>
        ))}
      </div>
      <div className="entry-analysis">
        <h3>拉片拆解</h3>
        {shot.analysis.map((note, noteIndex) => (
          <div key={noteIndex} className="entry-analysis-row">
            <Input
              aria-label={`${prefix}拆解 ${noteIndex + 1} 标题`}
              placeholder="例如：构图"
              value={note.label}
              maxLength={30}
              onChange={(event) => updateAnalysis(noteIndex, { label: event.target.value })}
            />
            <Input.TextArea
              aria-label={`${prefix}拆解 ${noteIndex + 1} 内容`}
              placeholder="解释这个镜头的视觉效果与作用"
              value={note.text}
              maxLength={4000}
              autoSize={{ minRows: 2, maxRows: 8 }}
              onChange={(event) => updateAnalysis(noteIndex, { text: event.target.value })}
            />
            <Button
              type="text" danger icon={<DeleteOutlined />}
              aria-label={`删除${prefix}拆解 ${noteIndex + 1}`}
              onClick={() => onChange({ analysis: shot.analysis.filter((_, i) => i !== noteIndex) })}
            />
          </div>
        ))}
        <Button
          type="dashed" icon={<PlusOutlined />}
          disabled={shot.analysis.length >= 20}
          onClick={() => onChange({ analysis: [...shot.analysis, { label: "", text: "" }] })}
        >添加拆解</Button>
      </div>
      {input("imagePrompt", "首帧图片提示词", 12000)}
      {input("videoPrompt", "视频动态提示词", 12000)}
      <ShotReview shot={shot} prefix={prefix} onChange={onChange} />
      <Popconfirm title={`删除${prefix}？`} description="保存案例后生效。" onConfirm={onRemove} okText="删除" cancelText="取消">
        <Button danger type="text" icon={<DeleteOutlined />}>删除这个镜头</Button>
      </Popconfirm>
    </div>
  );
}
