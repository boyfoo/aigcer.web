"use client";

import { memo, useMemo, useState } from "react";
import { Button, Empty, Input, Select, Segmented } from "antd";
import { AppstoreOutlined, BarsOutlined, RightOutlined, SearchOutlined } from "@ant-design/icons";
import { filterStudyShots, formatShotDuration, shotSegments, shotSizeTone } from "./lib/shotOverview.js";
import { formatVideoTime } from "./lib/videoTimeline.js";

export function ShotFrames({ shot, index, onPreview }) {
  return <div className={`study-frame-pair${shot.endImage ? "" : " is-single"}`}>{[[shot.image, shot.imageIsFallback ? "案例封面" : "首帧 / 代表画面"], [shot.endImage, "尾帧"]].map(([src, label], frameIndex) => src &&
    <div className="study-frame" key={frameIndex}><button type="button" aria-label={`放大镜头 ${index + 1}${label}`} onClick={() => onPreview({ shot, index, frameIndex })}><img src={src} alt={`镜头 ${index + 1}${label}`} loading="lazy" /><span>{label}</span></button></div>
  )}</div>;
}

export function ShotRhythm({ shots, duration, currentTime, playingId, selectedId, onSelect }) {
  const segments = useMemo(() => shotSegments(shots, duration), [shots, duration]);
  const sizes = [...new Set(shots.map((shot) => shot.facts?.景别).filter(Boolean))];
  if (!segments.length) return <section className="study-rhythm"><div className="study-rhythm-heading"><h2>整片节奏</h2></div><p className="study-empty-note">补全镜头时间后展示节奏带。</p></section>;
  return <section className="study-rhythm" aria-labelledby="rhythm-title">
    <div className="study-rhythm-heading"><h2 id="rhythm-title">整片节奏</h2><span>宽度代表镜长</span></div>
    <div className="study-rhythm-strip" role="group" aria-label="按镜头时长排列的节奏带">{segments.map((segment) => {
      if (!segment.shot) return <span key={segment.key} className="rhythm-gap" style={{ flex: `${segment.fraction} 1 0` }} title={`${formatVideoTime(segment.start)}–${formatVideoTime(segment.end)} 暂无拆解`} />;
      const { shot, index } = segment;
      return <button key={segment.key} type="button" className={`rhythm-segment${selectedId === shot.id ? " is-selected" : ""}${playingId === shot.id ? " is-playing" : ""}`}
        style={{ flex: `${segment.fraction} 1 0`, "--shot-tone": shotSizeTone(shot.facts?.景别), "--shot-progress": `${Math.max(0, Math.min(1, (currentTime - shot.start) / (shot.end - shot.start))) * 100}%` }}
        title={`${String(index + 1).padStart(2, "0")} · ${shot.title} · ${formatShotDuration(shot)} · ${shot.facts?.景别 || "景别未填写"}`}
        aria-label={`定位镜头 ${index + 1}：${shot.title}，${formatShotDuration(shot)}`} aria-pressed={selectedId === shot.id} aria-current={playingId === shot.id ? "true" : undefined} onClick={() => onSelect(shot)} />;
    })}</div>
    <div className="study-rhythm-scale"><span>00:00</span><span>{formatVideoTime(Math.max(duration, ...shots.map((shot) => shot.end)))}</span></div>
    {!!sizes.length && <div className="study-rhythm-legend" aria-label="景别图例">{sizes.map((size) => <span key={size}><i style={{ "--shot-tone": shotSizeTone(size) }} />{size}</span>)}</div>}
  </section>;
}

export const ShotOverview = memo(function ShotOverview({ shots, selectedId, playingId, onSelect, onPreview, people = [], person = "", onPersonChange }) {
  const [query, setQuery] = useState("");
  const [size, setSize] = useState("");
  const [movement, setMovement] = useState("");
  const [category, setCategory] = useState("");
  const [rhythm, setRhythm] = useState("");
  const [sort, setSort] = useState("timeline");
  const [layout, setLayout] = useState("list");
  const matches = useMemo(() => filterStudyShots(shots, { query, size, movement, category, rhythm, person, people, sort }), [shots, query, size, movement, category, rhythm, person, people, sort]);
  const options = (fact, label) => [{ value: "", label }, ...[...new Set(shots.map((shot) => shot.facts?.[fact]).filter(Boolean))].map((value) => ({ value, label: value }))];
  const fieldOptions = (field, label) => [{ value: "", label }, ...[...new Set(shots.map((shot) => shot[field]).filter(Boolean))].map((value) => ({ value, label: value }))];
  const hasFilters = Boolean(query || size || movement || category || rhythm || person);
  const reset = () => { setQuery(""); setSize(""); setMovement(""); setCategory(""); setRhythm(""); onPersonChange?.(""); setSort("timeline"); };
  return <section className="study-overview" aria-labelledby="overview-title">
    <div className="study-overview-heading"><div><h2 id="overview-title" className="study-step-heading"><span>2</span>看镜头拆解</h2><p>按顺序看，也可以选择感兴趣的一镜。</p></div><Button type="primary" onClick={() => onSelect(shots[0])}>从第 1 镜开始 <RightOutlined /></Button></div>
    <details className="study-overview-search"><summary>查找与排列镜头<span>{hasFilters ? `${matches.length} / ${shots.length} 镜头` : `${shots.length} 个镜头`}</span></summary><div className="study-overview-search-body"><Segmented aria-label="总览排列方式" value={layout} onChange={setLayout} options={[{ value: "list", icon: <BarsOutlined />, label: "列表" }, { value: "grid", icon: <AppstoreOutlined />, label: "网格" }]} />
    <Input aria-label="搜索片内镜头" placeholder="搜索镜号、画面、台词…" prefix={<SearchOutlined />} value={query} onChange={(event) => setQuery(event.target.value)} allowClear />
    <div className="study-overview-filters"><Select aria-label="筛选镜头景别" value={size} options={options("景别", "全部景别")} onChange={setSize} /><Select aria-label="筛选镜头运镜" value={movement} options={options("运镜", "全部运镜")} onChange={setMovement} /><Select aria-label="镜头排序" value={sort} options={[{ value: "timeline", label: "时间顺序" }, { value: "longest", label: "镜长从长到短" }, { value: "shortest", label: "镜长从短到长" }]} onChange={setSort} /></div>
    <div className="study-overview-filters"><Select aria-label="筛选镜头类别" value={category} options={fieldOptions("category", "全部类别")} onChange={setCategory} /><Select aria-label="筛选叙事节奏" value={rhythm} options={fieldOptions("rhythm", "全部节奏")} onChange={setRhythm} /><Select aria-label="筛选出场人物" value={person} options={[{ value: "", label: "全部人物" }, ...people.map((entry) => ({ value: entry.id, label: entry.name || "未命名人物" }))]} onChange={onPersonChange} /></div>
    </div></details>
    {hasFilters && <div className="study-overview-results"><span role="status">{person ? `${people.find((entry) => entry.id === person)?.name || "人物"} · ` : ""}找到 {matches.length} / {shots.length} 个镜头</span><Button type="text" size="small" onClick={reset}>清除筛选</Button></div>}
    <ol className={`study-overview-shots is-${layout}`}>{matches.map(({ shot, index }) => <li key={shot.id} data-overview-shot={shot.id} className={selectedId === shot.id ? "is-selected" : ""}>
      <ShotFrames shot={shot} index={index} onPreview={onPreview} />
      <button type="button" className="study-overview-open" aria-label={`研究镜头 ${index + 1}：${shot.title}`} aria-current={playingId === shot.id ? "true" : undefined} onClick={() => onSelect(shot)}>
        <span className="overview-shot-meta"><span>{String(index + 1).padStart(2, "0")} <span>· {formatVideoTime(shot.start)}–{formatVideoTime(shot.end)}</span></span><span>{formatShotDuration(shot)}</span></span>
        <strong>{shot.title}</strong><span className="overview-shot-facts">{[shot.facts?.景别, shot.facts?.运镜].filter(Boolean).join(" · ") || "画面信息待补充"}</span>
        {shot.summary && <span className="overview-shot-summary">{shot.summary}</span>}
        <span className="overview-shot-context">{[shot.category, shot.rhythm, shot.transition].filter(Boolean).length > 0 && <span>{[shot.category, shot.rhythm, shot.transition].filter(Boolean).join(" · ")}</span>}{shot.subjects?.length > 0 && <span>人物：{shot.subjects.map((id) => people.find((entry) => entry.id === id)?.name || id).join("、")}</span>}{[["sound", "声音"], ["dialogue", "台词"], ["onscreenText", "画面文字"], ["narrative", "叙事作用"]].filter(([key]) => shot[key]).map(([key, label]) => <span key={key}>{label}：{shot[key]}</span>)}</span>
        <span className="overview-shot-action">{playingId === shot.id ? "播放位置 · " : ""}查看分析 <RightOutlined /></span>
      </button>
    </li>)}</ol>
    {!matches.length && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有找到符合条件的镜头"><Button onClick={reset}>查看全部镜头</Button></Empty>}
  </section>;
});
