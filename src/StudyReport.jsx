"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { App, Button, Empty } from "antd";
import { DownloadOutlined } from "@ant-design/icons";
import { castIndex, qualityLabels, shotDistributions, shotStatistics, studyQuality, videoMetadataText } from "./lib/studyReport.js";
import { formatVideoTime } from "./lib/videoTimeline.js";
import { downloadStudyJson, downloadOfflineStudy } from "./lib/studyExport.js";
import "./study-report.css";

export function jumpToReport(id) {
  const target = document.getElementById(id);
  if (!target) return;
  if (target.tagName === "DETAILS") target.open = true;
  target.scrollIntoView({ block: "start", behavior: "instant" });
  target.querySelector("summary")?.focus({ preventScroll: true });
}

const reportSections = [["selected-shot-content", "镜头拆解"], ["study-statistics", "整片统计"], ["study-cast", "出场人物"], ["study-quality", "质量检查"], ["study-export", "导出报告"]];

export function ReportNavigation() {
  const navigationRef = useRef(null);
  const [activeSection, setActiveSection] = useState(reportSections[0][0]);

  useEffect(() => {
    const navigation = navigationRef.current;
    const sections = reportSections.map(([id]) => document.getElementById(id)).filter(Boolean);
    let frame = null;
    const updateActive = () => {
      frame = null;
      const readingLine = navigation.getBoundingClientRect().bottom + 21;
      let current = sections[0].id;
      for (const section of sections.slice(1)) {
        if (section.getBoundingClientRect().top <= readingLine) current = section.id;
        else break;
      }
      // 最后一节较短时，到达页底也应能选中它。
      const last = sections[sections.length - 1];
      if (window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2 && last.getBoundingClientRect().top < window.innerHeight) current = last.id;
      setActiveSection(current);
    };
    const scheduleUpdate = () => {
      if (frame === null) frame = window.requestAnimationFrame(updateActive);
    };
    const observer = new ResizeObserver(scheduleUpdate);
    sections.forEach((section) => observer.observe(section));
    observer.observe(navigation);
    const playback = navigation.closest(".video-study")?.querySelector(".study-playback");
    if (playback) observer.observe(playback);
    window.addEventListener("scroll", scheduleUpdate, { passive: true });
    window.addEventListener("resize", scheduleUpdate);
    scheduleUpdate();
    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", scheduleUpdate);
      window.removeEventListener("resize", scheduleUpdate);
      if (frame !== null) window.cancelAnimationFrame(frame);
    };
  }, []);

  return <nav ref={navigationRef} className="study-report-nav" aria-label="拉片报告内容">{reportSections.map(([id, label]) => <a key={id} href={`#${id}`} aria-current={activeSection === id ? "location" : undefined} onClick={(event) => { event.preventDefault(); jumpToReport(id); setActiveSection(id); }}>{label}</a>)}</nav>;
}

export function QualityReport({ video, onSelect, prefix = "study" }) {
  const checks = useMemo(() => studyQuality(video), [video]);
  const totals = Object.keys(qualityLabels).map((status) => `${checks.filter((check) => check.status === status).length} 项${qualityLabels[status]}`).join(" · ");
  return <div className="study-quality-report">
    <p className="study-report-note">{totals}。结构数据自动校验；画面、运镜、切点及叙事判断需要作者对照原片复核。</p>
    <ul className="study-quality-list">{checks.map((check) => <li key={check.id} id={`${prefix}-check-${check.id}`}><div><h3>{check.title}</h3><span className={`study-check-status is-${check.status}`}>{qualityLabels[check.status]}</span></div><p>{check.message}</p>{check.shotIds.length > 0 && onSelect && <details className="study-check-shots"><summary>查看相关的 {check.shotIds.length} 个镜头</summary><div>{check.shotIds.map((id) => { const index = video.shots.findIndex((shot) => shot.id === id); return index < 0 ? null : <button type="button" key={id} onClick={() => onSelect(video.shots[index])}>{String(index + 1).padStart(2, "0")} · {video.shots[index].title || "未命名镜头"}</button>; })}</div></details>}</li>)}</ul>
  </div>;
}

export function StudyReport({ item, onSelect, onPerson }) {
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
    <details id="study-statistics" className="study-report-section" open><summary>整片统计<span>{stats.count} 镜 · 已拆解 {stats.coverage}%</span></summary><div className="study-report-body">
      <dl className="study-statistics">{[["视频总时长", formatVideoTime(stats.total)], ["镜头数量", `${stats.count} 镜`], ["平均镜长", stats.average == null ? "—" : `${stats.average} 秒`], ["中位镜长", stats.median == null ? "—" : `${stats.median} 秒`], ["每分钟切换", stats.cutsPerMinute == null ? "—" : `${stats.cutsPerMinute} 次`]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}{[["最短镜头", stats.shortest], ["最长镜头", stats.longest]].map(([label, entry]) => <div key={label}><dt>{label}</dt><dd>{entry ? <button type="button" onClick={() => onSelect(entry.shot)}>{Number(entry.seconds.toFixed(2))} 秒 <small>镜头 {String(entry.index + 1).padStart(2, "0")} ↗</small></button> : "—"}</dd></div>)}</dl>
      <p className="study-report-note">镜长统计基于已录入的 {stats.measured} 个有效镜头；切换次数按相邻镜头边界计算。分布占比以视频总时长为分母，未填写资料与未拆解时段单独列出。</p>
      <div className="study-distributions">{distributions.map((group) => <section key={group.title}><h3>{group.title}</h3>{!group.rows.length ? <p className="study-report-note">暂无镜头资料</p> : group.rows.map((row) => <div className="study-distribution" key={row.label}><div><span>{row.label}</span><small>{row.count ? `${row.count} 镜 · ` : ""}{row.seconds} 秒 · {row.percent}%</small></div><div className="study-distribution-track"><span style={{ width: `${Math.min(100, row.percent)}%` }} /></div></div>)}</section>)}</div>
    </div></details>
    <details id="study-cast" className="study-report-section" open><summary>出场人物<span>{people.length ? `${people.length} 位人物` : "尚未录入"}</span></summary><div className="study-report-body">{people.length ? <div className="study-cast-grid">{people.map((person) => <article key={person.id}>{person.image ? <img src={person.image} alt={person.name} loading="lazy" /> : <div className="study-cast-placeholder">暂无人物图片</div>}<h3>{person.name}</h3>{person.note && <p>{person.note}</p>}<span>{person.shots.length} 个镜头 · {person.seconds} 秒</span><Button type="text" disabled={!person.shots.length} onClick={() => onPerson(person.id)}>查看相关镜头 →</Button></article>)}</div> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="尚未录入出场人物；可在录入页添加人物并关联镜头。" />}</div></details>
    <details id="study-quality" className="study-report-section" open><summary>质量检查<span>15 项检查</span></summary><div className="study-report-body"><QualityReport video={video} onSelect={onSelect} /></div></details>
    <details id="study-export" className="study-report-section" open><summary>视频信息与导出<span>JSON / 离线 HTML</span></summary><div className="study-report-body"><p className="study-video-metadata">{videoMetadataText(video.metadata)}</p><p className="study-report-note">JSON 包含当前案例的镜头、人物、统计和复核记录。离线 HTML 包含图片与拆解，双击即可阅读，也能选择本地原视频同步播放。视频文件需另行保留。</p><div className="study-export-actions"><Button icon={<DownloadOutlined />} onClick={() => downloadStudyJson(item)}>导出 JSON</Button><Button icon={<DownloadOutlined />} loading={exporting} disabled={exporting} onClick={exportHtml}>导出离线报告</Button></div></div></details>
  </div>;
}
