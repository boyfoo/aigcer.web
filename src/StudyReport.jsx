"use client";
import { useMemo, useState } from "react";
import { App, Button, Empty, Modal } from "antd";
import { DownloadOutlined } from "@ant-design/icons";
import { castIndex, qualityLabels, shotDistributions, shotStatistics, studyQuality, videoMetadataText } from "./lib/studyReport.js";
import { formatVideoTime } from "./lib/videoTimeline.js";
import { downloadStudyJson, downloadOfflineStudy } from "./lib/studyExport.js";
import "./study-report.css";

export const reportSections = [["study-statistics", "整片统计"], ["study-cast", "出场人物"], ["study-quality", "质量检查"]];

function navigateTabs(event) {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  const tabs = [...event.currentTarget.querySelectorAll('[role="tab"]')];
  const index = tabs.indexOf(document.activeElement);
  if (index < 0) return;
  event.preventDefault();
  const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
  tabs[next].click();
  tabs[next].focus({ preventScroll: true });
}

export function ReportNavigation({ section, reportSection, onNavigate, onExport, children }) {
  return <div className="study-report-nav">
    <div className="study-report-primary"><div role="tablist" aria-label="案例阅读内容" onKeyDown={navigateTabs}>
      {[["shots", "镜头拆解"], ["report", "整体分析"]].map(([id, label]) => <button type="button" role="tab" id={`study-tab-${id}`} key={id} aria-selected={section === id} tabIndex={section === id ? 0 : -1} aria-controls={`study-panel-${id}`} onClick={() => onNavigate(id === "shots" ? "shots" : reportSection)}>{label}</button>)}
    </div><Button type="text" icon={<DownloadOutlined />} onClick={onExport}>导出</Button></div>
    {section === "report" ? <div className="study-report-subnav" role="tablist" aria-label="整体分析栏目" onKeyDown={navigateTabs}>{reportSections.map(([id, label]) => <button type="button" role="tab" id={`${id}-tab`} key={id} aria-controls={id} aria-selected={reportSection === id} tabIndex={reportSection === id ? 0 : -1} onClick={() => onNavigate(id)}>{label}</button>)}</div> : children}
  </div>;
}

export function QualityReport({ video, onSelect, prefix = "study", filterable = false }) {
  const checks = useMemo(() => studyQuality(video), [video]);
  const [status, setStatus] = useState("all");
  const totals = Object.keys(qualityLabels).map((status) => `${checks.filter((check) => check.status === status).length} 项${qualityLabels[status]}`).join(" · ");
  return <div className="study-quality-report">
    <p className="study-report-note">{totals}。结构数据自动校验；画面、运镜、切点及叙事判断需要作者对照原片复核。</p>
    {filterable && <div className="study-quality-filters" role="group" aria-label="按检查状态查看">{[["all", "全部"], ["warning", "需处理"], ["pending", "待复核"], ["passed", "已通过"]].map(([value, label]) => <button type="button" key={value} aria-pressed={status === value} onClick={() => setStatus(value)}>{label} <span>{value === "all" ? checks.length : checks.filter((check) => check.status === value).length}</span></button>)}</div>}
    {filterable && status !== "all" && !checks.some((check) => check.status === status) && <p className="study-report-note" role="status">没有{qualityLabels[status]}的检查项。</p>}
    <ul className="study-quality-list">{checks.map((check) => <li key={check.id} id={`${prefix}-check-${check.id}`} hidden={filterable && status !== "all" && check.status !== status}><div><h3>{check.title}</h3><span className={`study-check-status is-${check.status}`}>{qualityLabels[check.status]}</span></div><p>{check.message}</p>{check.shotIds.length > 0 && onSelect && <details className="study-check-shots"><summary>查看相关的 {check.shotIds.length} 个镜头</summary><div>{check.shotIds.map((id) => { const index = video.shots.findIndex((shot) => shot.id === id); return index < 0 ? null : <button type="button" key={id} onClick={() => onSelect(video.shots[index])}>{String(index + 1).padStart(2, "0")} · {video.shots[index].title || "未命名镜头"}</button>; })}</div></details>}</li>)}</ul>
  </div>;
}

export function StudyReport({ item, onSelect, onPerson, activeSection, exportOpen, onExportClose }) {
  const video = item.video;
  const stats = useMemo(() => shotStatistics(video), [video]);
  const distributions = useMemo(() => shotDistributions(video), [video]);
  const people = useMemo(() => castIndex(video), [video]);
  const { message } = App.useApp();
  const [exporting, setExporting] = useState(false);
  const exportHtml = async () => {
    setExporting(true);
    try { const missing = await downloadOfflineStudy(item); if (missing) message.warning(`报告已导出；${missing} 张图片未能读取，已在报告中注明。`); else message.success("离线报告已导出，可双击打开并选择本地视频"); }
    catch (error) { message.error(error.message || "导出失败，请重试"); }
    finally { setExporting(false); }
  };
  return <div className="study-report-sections">
    <details id="study-statistics" role="tabpanel" aria-labelledby="study-statistics-tab" tabIndex={-1} hidden={activeSection !== "study-statistics"} className="study-report-section" open><summary>整片统计<span>{stats.count} 镜 · 已拆解 {stats.coverage}%</span></summary><div className="study-report-body">
      <dl className="study-statistics">{[["视频总时长", formatVideoTime(stats.total)], ["镜头数量", `${stats.count} 镜`], ["平均镜长", stats.average == null ? "—" : `${stats.average} 秒`], ["中位镜长", stats.median == null ? "—" : `${stats.median} 秒`], ["每分钟切换", stats.cutsPerMinute == null ? "—" : `${stats.cutsPerMinute} 次`]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}{[["最短镜头", stats.shortest], ["最长镜头", stats.longest]].map(([label, entry]) => <div key={label}><dt>{label}</dt><dd>{entry ? <button type="button" onClick={() => onSelect(entry.shot)}>{Number(entry.seconds.toFixed(2))} 秒 <small>镜头 {String(entry.index + 1).padStart(2, "0")} ↗</small></button> : "—"}</dd></div>)}</dl>
      <p className="study-report-note">镜长统计基于已录入的 {stats.measured} 个有效镜头；切换次数按相邻镜头边界计算。分布占比以视频总时长为分母，未填写资料与未拆解时段单独列出。</p>
      <div className="study-distributions">{distributions.map((group) => <section key={group.title}><h3>{group.title}</h3>{!group.rows.length ? <p className="study-report-note">暂无镜头资料</p> : group.rows.map((row) => <div className="study-distribution" key={row.label}><div><span>{row.label}</span><small>{row.count ? `${row.count} 镜 · ` : ""}{row.seconds} 秒 · {row.percent}%</small></div><div className="study-distribution-track"><span style={{ width: `${Math.min(100, row.percent)}%` }} /></div></div>)}</section>)}</div>
    </div></details>
    <details id="study-cast" role="tabpanel" aria-labelledby="study-cast-tab" tabIndex={-1} hidden={activeSection !== "study-cast"} className="study-report-section" open><summary>出场人物<span>{people.length ? `${people.length} 位人物` : "尚未录入"}</span></summary><div className="study-report-body">{people.length ? <div className="study-cast-grid">{people.map((person) => <article key={person.id}>{person.image ? <img src={person.image} alt={person.name} loading="lazy" /> : <div className="study-cast-placeholder">暂无人物图片</div>}<h3>{person.name}</h3>{person.note && <p>{person.note}</p>}<span>{person.shots.length} 个镜头 · {person.seconds} 秒</span><Button type="text" disabled={!person.shots.length} onClick={() => onPerson(person.id)}>查看相关镜头 →</Button></article>)}</div> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="尚未录入出场人物；可在录入页添加人物并关联镜头。" />}</div></details>
    <details id="study-quality" role="tabpanel" aria-labelledby="study-quality-tab" tabIndex={-1} hidden={activeSection !== "study-quality"} className="study-report-section" open><summary>质量检查<span>15 项检查</span></summary><div className="study-report-body"><QualityReport video={video} onSelect={onSelect} filterable /></div></details>
    <Modal open={exportOpen} onCancel={onExportClose} footer={null} title="视频信息与导出" width={560}><div id="study-export"><div className="study-report-body"><p className="study-video-metadata">{videoMetadataText(video.metadata)}</p><p className="study-report-note">JSON 包含当前案例的镜头、人物、统计和复核记录。离线 HTML 包含图片与拆解，双击即可阅读，也能选择本地原视频同步播放。视频文件需另行保留。</p><div className="study-export-actions"><Button icon={<DownloadOutlined />} onClick={() => downloadStudyJson(item)}>导出 JSON</Button><Button icon={<DownloadOutlined />} loading={exporting} disabled={exporting} onClick={exportHtml}>导出离线报告</Button></div></div></div></Modal>
  </div>;
}
