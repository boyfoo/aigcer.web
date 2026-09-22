"use client";

import { memo, useMemo, useState } from "react";
import { Button, Empty, Input, Select, Segmented, Tag } from "antd";
import { AppstoreOutlined, BarsOutlined, FilterOutlined, RightOutlined, SearchOutlined, ZoomInOutlined } from "@ant-design/icons";
import { filterStudyShots, formatShotDuration, shotSegments, shotSizeTone } from "./lib/shotOverview.js";
import { formatVideoTime } from "./lib/videoTimeline.js";

export function ShotFrames({ shot, index, onPreview, onSelect, single = false }) {
  const [activeFrame, setActiveFrame] = useState(0);
  const frames = [[shot.image, shot.imageIsFallback ? "案例封面" : "首帧 / 代表画面"], [shot.endImage, "尾帧"]]
    .map(([src, label], frameIndex) => ({ src, label, frameIndex })).filter((frame) => frame.src);
  if (!frames.length) return null;
  const selectedFrame = frames.find((frame) => frame.frameIndex === activeFrame) || frames[0];
  const renderFrame = ({ src, label, frameIndex }) => <div className="study-frame" key={frameIndex}>
    <button type="button" aria-label={onSelect ? `查看镜头 ${index + 1}拆解` : `放大镜头 ${index + 1}${label}`} onClick={() => onSelect ? onSelect(shot) : onPreview({ shot, index, frameIndex })}><img src={src} alt={`镜头 ${index + 1}${label}`} loading="lazy" /><span>{label}</span></button>
    {onSelect && <button type="button" className="study-frame-zoom" aria-label={`放大镜头 ${index + 1}${label}`} onClick={() => onPreview({ shot, index, frameIndex })}><ZoomInOutlined /></button>}
  </div>;
  if (single) return <div className="study-reading-frame">
    {frames.length > 1 && <div className="study-frame-switch" role="group" aria-label="镜头画面选择">{frames.map(({ label, frameIndex }) => <button type="button" key={frameIndex} aria-pressed={selectedFrame.frameIndex === frameIndex} onClick={() => setActiveFrame(frameIndex)}>{label}</button>)}</div>}
    {renderFrame(selectedFrame)}
  </div>;
  return <div className={`study-frame-pair${frames.length === 1 ? " is-single" : ""}`}>{frames.map(renderFrame)}</div>;
}

export function ShotRhythm({ shots, duration, currentTime, playingId, selectedId, onSelect }) {
  const segments = useMemo(() => shotSegments(shots, duration), [shots, duration]);
  const sizes = [...new Set(shots.map((shot) => shot.facts?.景别).filter(Boolean))];
  if (!segments.length) return <section className="study-rhythm" aria-label="镜头时间轴"><p className="study-empty-note">补全镜头时间后展示时间轴。</p></section>;
  return <section className="study-rhythm" aria-label="镜头时间轴">
    <div className="study-rhythm-strip" role="group" aria-label="按镜头时长排列的节奏带">{segments.map((segment) => {
      if (!segment.shot) return <span key={segment.key} className="rhythm-gap" style={{ flex: `${segment.fraction} 1 0` }} title={`${formatVideoTime(segment.start)}–${formatVideoTime(segment.end)} 暂无拆解`} />;
      const { shot, index } = segment;
      const timeRange = `${formatVideoTime(segment.start)} – ${formatVideoTime(segment.end)}`;
      return <button key={segment.key} type="button" className={`rhythm-segment${selectedId === shot.id ? " is-selected" : ""}${playingId === shot.id ? " is-playing" : ""}`}
        style={{ flex: `${segment.fraction} 1 0`, "--shot-tone": shotSizeTone(shot.facts?.景别), "--shot-progress": `${Math.max(0, Math.min(1, (currentTime - shot.start) / (shot.end - shot.start))) * 100}%` }}
        title={`${String(index + 1).padStart(2, "0")} · ${shot.title} · ${timeRange} · ${shot.facts?.景别 || "景别未填写"}`}
        aria-label={`定位镜头 ${index + 1}：${shot.title}，${timeRange}，${formatShotDuration(shot)}`} aria-pressed={selectedId === shot.id} aria-current={playingId === shot.id ? "true" : undefined} onClick={() => onSelect(shot)}>
        <span className="rhythm-segment-bar" aria-hidden="true" />
        <span className="rhythm-segment-time" aria-hidden="true"><span>{formatVideoTime(segment.start)}</span><span>–</span><span>{formatVideoTime(segment.end)}</span></span>
      </button>;
    })}</div>
    {!!sizes.length && <div className="study-rhythm-legend" aria-label="景别图例">{sizes.map((size) => <span key={size}><i style={{ "--shot-tone": shotSizeTone(size) }} aria-hidden="true" />{size}</span>)}</div>}
  </section>;
}

export const ShotOverview = memo(function ShotOverview({ shots, selectedId, playingId, onSelect, onPreview, people = [], person = "", onPersonChange }) {
  const [filtersOpen, setFiltersOpen] = useState(false);
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
  const reset = () => { setQuery(""); setSize(""); setMovement(""); setCategory(""); setRhythm(""); onPersonChange?.(""); setSort("timeline"); };
  const activeFilters = [
    ["搜索", query, () => setQuery("")], ["景别", size, () => setSize("")], ["运镜", movement, () => setMovement("")],
    ["类别", category, () => setCategory("")], ["节奏", rhythm, () => setRhythm("")],
    ["人物", person && (people.find((entry) => entry.id === person)?.name || "人物"), () => onPersonChange?.("")],
    ["排序", sort === "timeline" ? "" : sort === "longest" ? "镜长从长到短" : "镜长从短到长", () => setSort("timeline")],
  ].filter(([, value]) => value);
  return <section className="study-overview" aria-labelledby="overview-title">
    <div className="study-overview-heading"><h2 id="overview-title">全部镜头 <span>{shots.length}</span></h2><div><Button type="text" size="small" onClick={() => onSelect(shots[0])}>从第 1 镜开始 <RightOutlined /></Button><Button type="text" size="small" icon={<FilterOutlined />} aria-expanded={filtersOpen} aria-controls="study-overview-search" onClick={() => setFiltersOpen((value) => !value)}>筛选</Button></div></div>
    <div className="study-overview-search" id="study-overview-search" hidden={!filtersOpen}><div className="study-overview-search-body">
      <div className="study-overview-search-row"><Input aria-label="搜索片内镜头" placeholder="搜索镜号、画面、台词…" prefix={<SearchOutlined />} value={query} onChange={(event) => setQuery(event.target.value)} allowClear /><Segmented aria-label="总览排列方式" value={layout} onChange={setLayout} options={[{ value: "list", icon: <BarsOutlined />, label: "列表" }, { value: "grid", icon: <AppstoreOutlined />, label: "网格" }]} /></div>
      <div className="study-overview-filters"><Select aria-label="筛选镜头景别" value={size} options={options("景别", "全部景别")} onChange={setSize} /><Select aria-label="筛选镜头运镜" value={movement} options={options("运镜", "全部运镜")} onChange={setMovement} /></div>
      <details className="study-more-filters"><summary>更多条件与排序</summary><div className="study-overview-filters"><Select aria-label="筛选镜头类别" value={category} options={fieldOptions("category", "全部类别")} onChange={setCategory} /><Select aria-label="筛选叙事节奏" value={rhythm} options={fieldOptions("rhythm", "全部节奏")} onChange={setRhythm} /><Select aria-label="筛选出场人物" value={person} options={[{ value: "", label: "全部人物" }, ...people.map((entry) => ({ value: entry.id, label: entry.name || "未命名人物" }))]} onChange={onPersonChange} /><Select aria-label="镜头排序" value={sort} options={[{ value: "timeline", label: "时间顺序" }, { value: "longest", label: "镜长从长到短" }, { value: "shortest", label: "镜长从短到长" }]} onChange={setSort} /></div></details>
    </div></div>
    {activeFilters.length > 0 && <div className="study-active-filters"><div>{activeFilters.map(([label, value, clear]) => <Tag key={label} closable onClose={(event) => { event.preventDefault(); clear(); }}>{label}：{value}</Tag>)}</div><div className="study-overview-results"><span role="status">找到 {matches.length} / {shots.length} 个镜头</span><Button type="text" size="small" onClick={reset}>清除筛选与排序</Button></div></div>}
    <ol className={`study-overview-shots is-${layout}`}>{matches.map(({ shot, index }) => <li key={shot.id} data-overview-shot={shot.id} className={selectedId === shot.id ? "is-selected" : ""}>
      <ShotFrames shot={shot} index={index} onPreview={onPreview} onSelect={onSelect} />
      <button type="button" className="study-overview-open" aria-label={`研究镜头 ${index + 1}：${shot.title}`} aria-current={playingId === shot.id ? "true" : undefined} onClick={() => onSelect(shot)}>
        <strong><span className="overview-shot-number">{String(index + 1).padStart(2, "0")}</span>{shot.title}</strong>
        <span className="overview-shot-facts">{formatVideoTime(shot.start)}–{formatVideoTime(shot.end)} · {[shot.facts?.景别, shot.facts?.运镜].filter(Boolean).join(" · ") || "画面信息待补充"}</span>
        {shot.summary && <span className="overview-shot-summary">{shot.summary}</span>}
        <span className="overview-shot-meta"><span>{formatShotDuration(shot)}{playingId === shot.id ? " · 播放位置" : ""}</span><RightOutlined /></span>
      </button>
      {Boolean(shot.category || shot.rhythm || shot.transition || shot.subjects?.length || shot.sound || shot.dialogue || shot.onscreenText || shot.narrative) && <details className="overview-shot-extra"><summary>更多镜头资料</summary><div className="overview-shot-context">{[shot.category, shot.rhythm, shot.transition].filter(Boolean).length > 0 && <span>{[shot.category, shot.rhythm, shot.transition].filter(Boolean).join(" · ")}</span>}{shot.subjects?.length > 0 && <span>人物：{shot.subjects.map((id) => people.find((entry) => entry.id === id)?.name || id).join("、")}</span>}{[["sound", "声音"], ["dialogue", "台词"], ["onscreenText", "画面文字"], ["narrative", "叙事作用"]].filter(([key]) => shot[key]).map(([key, label]) => <span key={key}>{label}：{shot[key]}</span>)}</div></details>}
    </li>)}</ol>
    {!matches.length && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有找到符合条件的镜头"><Button onClick={reset}>查看全部镜头</Button></Empty>}
  </section>;
});
