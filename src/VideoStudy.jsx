"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { App as AntApp, Button, Tag } from "antd";
import { ArrowLeftOutlined, BookFilled, BookOutlined, CopyOutlined, FolderAddOutlined, FolderOutlined, LeftOutlined, PlayCircleFilled, ReloadOutlined, RightOutlined } from "@ant-design/icons";
import { useReferenceProjects } from "./ReferenceProjects.jsx";
import { ShotAnnotations } from "./ShotAnnotations.jsx";
import { annotationModes, getPromptSegments, groupPromptSegments } from "./lib/shotPresentation.js";
import { clampSeekTime, formatVideoTime, getShotAtTime } from "./lib/videoTimeline.js";
import "./video-study.css";

function ReferenceLocation({ onSelect }) {
  const params = useSearchParams();
  const shotId = params.get("shot");
  useEffect(() => { if (shotId) onSelect(shotId); }, [shotId, onSelect]);
  return null;
}

export function VideoStudy({ item, saved, onToggleSaved }) {
  const { message } = AntApp.useApp();
  const { projects, ready, addToProject, openLibrary } = useReferenceProjects();
  const { shots } = item.video;
  const videoRef = useRef(null);
  const stripRef = useRef(null);
  const pendingSeekRef = useRef(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(item.video.durationSeconds);
  const [videoRatio, setVideoRatio] = useState(1440 / 2550);
  const [playing, setPlaying] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [mediaError, setMediaError] = useState(false);
  const [selectedId, setSelectedId] = useState(shots[0].id);
  const [annotation, setAnnotation] = useState(null);
  const [detailTab, setDetailTab] = useState("analysis");
  const selectedIndex = shots.findIndex(({ id }) => id === selectedId);
  const selectedShot = shots[selectedIndex];
  const playingShot = getShotAtTime(shots, currentTime);
  const playingIndex = shots.findIndex(({ id }) => id === playingShot?.id);
  const projectCount = projects.filter((project) => project.references.some((entry) => entry.caseId === item.id && entry.shotId === selectedId)).length;
  const annotationVisible = annotation && playingShot?.id === selectedId && !mediaError;

  const positionVideo = (shot) => {
    const video = videoRef.current;
    const target = clampSeekTime(shot.start, video?.duration || duration);
    setCurrentTime(target);
    if (!video || mediaError) return;
    if (video.readyState === 0) pendingSeekRef.current = target;
    else video.currentTime = target;
    video.play()?.catch((error) => {
      if (error.name === "NotAllowedError") message.info("已定位镜头，点击播放器继续播放");
    });
  };
  const chooseShot = (shot) => {
    setSelectedId(shot.id);
    setAnnotation(null);
    positionVideo(shot);
  };
  const selectReference = useCallback((id) => {
    const shot = shots.find((entry) => entry.id === id);
    if (!shot) return;
    setSelectedId(id);
    setAnnotation(null);
    const video = videoRef.current;
    video?.pause();
    const target = clampSeekTime(shot.start, video?.duration || item.video.durationSeconds);
    setCurrentTime(target);
    if (!video || video.readyState === 0) pendingSeekRef.current = target;
    else video.currentTime = target;
  }, [shots, item.video.durationSeconds]);

  useEffect(() => {
    const strip = stripRef.current;
    const node = strip?.children[selectedIndex];
    if (!strip || !node) return;
    const left = node.offsetLeft - strip.offsetLeft;
    if (left < strip.scrollLeft) strip.scrollLeft = left;
    else if (left + node.offsetWidth > strip.scrollLeft + strip.clientWidth) strip.scrollLeft = left + node.offsetWidth - strip.clientWidth;
  }, [selectedIndex]);

  const onMetadata = (event) => {
    const video = event.currentTarget;
    if (Number.isFinite(video.duration) && video.duration > 0) setDuration(video.duration);
    if (video.videoWidth && video.videoHeight) setVideoRatio(video.videoWidth / video.videoHeight);
    if (pendingSeekRef.current !== null) {
      video.currentTime = clampSeekTime(pendingSeekRef.current, video.duration);
      pendingSeekRef.current = null;
      setCurrentTime(video.currentTime);
    }
  };
  const copyText = async (text) => {
    try { await navigator.clipboard.writeText(text); message.success("提示词已复制"); }
    catch { message.info("可选中提示词后手动复制"); }
  };
  const toggleAnnotation = (mode) => {
    if (annotation === mode) { setAnnotation(null); return; }
    setAnnotation(mode);
    if (playingShot?.id !== selectedId) positionVideo(selectedShot);
  };
  const scrollStrip = (direction) => stripRef.current?.scrollBy({ left: direction * stripRef.current.clientWidth * 0.75, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
  const retryVideo = () => {
    setMediaError(false);
    setBuffering(false);
    pendingSeekRef.current = selectedShot.start;
    videoRef.current?.load();
  };

  return <article className="video-study">
    <Suspense fallback={null}><ReferenceLocation onSelect={selectReference} /></Suspense>
    <header className="video-study-heading">
      <div className="video-study-name">
        <Link href="/collections/videos" className="video-study-back" aria-label="返回视频案例"><ArrowLeftOutlined /></Link>
        <div><h1>{item.title}</h1><p>{item.type}<span>·</span>{formatVideoTime(duration)}<span>·</span>{shots.length} 个镜头</p></div>
      </div>
      <div className="video-study-actions"><Button icon={<FolderOutlined />} onClick={() => openLibrary()}>参考集</Button><Button icon={saved ? <BookFilled /> : <BookOutlined />} onClick={onToggleSaved} className={`case-save${saved ? " is-saved" : ""}`}>{saved ? "已收藏" : "收藏案例"}</Button></div>
    </header>
    <div className="study-workspace">
      <div className="study-media-column">
        <div className="study-player" style={{ "--video-ratio": videoRatio }}>
          <div className="study-video-plane">
            <video ref={videoRef} src={item.video.src} poster={item.image} controls playsInline preload="metadata" aria-label={`${item.title}视频播放器`}
              onLoadedMetadata={onMetadata} onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)} onSeeking={(event) => setCurrentTime(event.currentTarget.currentTime)}
              onPlay={() => setPlaying(true)} onPlaying={() => { setPlaying(true); setBuffering(false); }} onPause={() => { setPlaying(false); setBuffering(false); }}
              onWaiting={() => setBuffering(true)} onCanPlay={() => setBuffering(false)} onEnded={() => setPlaying(false)} onError={() => { setMediaError(true); setPlaying(false); setBuffering(false); }}>
              浏览器暂不支持视频播放，可使用<a href={item.video.src}>视频原链接</a>观看。
            </video>
            {annotationVisible && <ShotAnnotations shot={selectedShot} mode={annotation} />}
          </div>
          {buffering && !mediaError && <span className="study-buffering" role="status">视频加载中…</span>}
          {mediaError && <div className="study-player-error" role="alert"><p>视频暂时无法加载</p><div><Button icon={<ReloadOutlined />} onClick={retryVideo}>重新加载</Button><a href={item.video.src} target="_blank" rel="noreferrer">打开视频原链接</a></div></div>}
        </div>
        <div className="study-playback-status"><p><span className={`playback-dot${playing ? " is-playing" : ""}`} />{playingShot ? `${playing ? "正在播放" : "播放位置"} · 镜头 ${String(playingIndex + 1).padStart(2, "0")}` : "完整视频"}</p><span className="study-time">{formatVideoTime(currentTime)} / {formatVideoTime(duration)}</span></div>
        <div className="study-overlay-toolbar" aria-label="画面标注"><span>画面标注</span>{annotationModes.map((mode) => <button type="button" key={mode.id} aria-pressed={annotation === mode.id} onClick={() => toggleAnnotation(mode.id)}>{mode.label}</button>)}{annotation && <button type="button" onClick={() => setAnnotation(null)}>关闭</button>}</div>
        {annotation && !annotationVisible && !mediaError && <div className="annotation-notice">标注属于镜头 {String(selectedIndex + 1).padStart(2, "0")}<button type="button" onClick={() => positionVideo(selectedShot)}>回看这个镜头</button></div>}
        <section className="shot-filmstrip" aria-labelledby="filmstrip-title">
          <div className="filmstrip-heading"><h2 id="filmstrip-title">镜头 <span>{String(selectedIndex + 1).padStart(2, "0")} / {String(shots.length).padStart(2, "0")}</span></h2><div><Button type="text" size="small" icon={<LeftOutlined />} aria-label="向前浏览镜头" onClick={() => scrollStrip(-1)} /><Button type="text" size="small" icon={<RightOutlined />} aria-label="向后浏览镜头" onClick={() => scrollStrip(1)} /></div></div>
          <ol className="shot-timeline" ref={stripRef} aria-label="视频镜头时间轴">
            {shots.map((shot, index) => {
              const active = selectedId === shot.id;
              const atPlayback = playingShot?.id === shot.id;
              const progress = Math.max(0, Math.min(1, (currentTime - shot.start) / (shot.end - shot.start)));
              return <li key={shot.id}><button type="button" className={`shot-node${active ? " is-selected" : ""}${atPlayback ? " is-playing" : ""}`} aria-label={`镜头 ${index + 1}：${shot.title}，${formatVideoTime(shot.start)} 至 ${formatVideoTime(shot.end)}`} aria-pressed={active} aria-controls="selected-shot-content" onClick={() => chooseShot(shot)} onKeyDown={(event) => {
                const target = event.key === "ArrowLeft" ? Math.max(0, index - 1) : event.key === "ArrowRight" ? Math.min(shots.length - 1, index + 1) : event.key === "Home" ? 0 : event.key === "End" ? shots.length - 1 : null;
                if (target !== null) { event.preventDefault(); stripRef.current.children[target].querySelector("button").focus(); }
              }}><div className="shot-node-image"><img src={shot.image} alt="" /><span className="shot-number">{String(index + 1).padStart(2, "0")}</span><PlayCircleFilled className="shot-play-icon" />{atPlayback && <><span className="shot-play-state">{playing ? "播放中" : "播放位置"}</span><span className="shot-node-progress" style={{ transform: `scaleX(${progress})` }} /></>}</div><strong>{shot.title}</strong><span className="shot-time">{formatVideoTime(shot.start)} — {formatVideoTime(shot.end)}</span></button></li>;
            })}
          </ol>
        </section>
      </div>
      <div className="study-reading-column" id="selected-shot-content">
        <header className="selected-shot-heading"><div><p>正在研究 · 镜头 {String(selectedIndex + 1).padStart(2, "0")}<span>{formatVideoTime(selectedShot.start)}–{formatVideoTime(selectedShot.end)}</span></p><h2>{selectedShot.title}</h2></div><Button type="primary" icon={<FolderAddOutlined />} disabled={!ready} onClick={() => addToProject({ caseId: item.id, shotId: selectedId })}>加入项目</Button></header>
        <div className="study-reading-status">{item.video.isMock && <span>模拟拉片与标注 · 与视频画面不对应</span>}{projectCount > 0 && <button type="button" onClick={() => openLibrary()}>已加入 {projectCount} 个项目</button>}</div>
        {playingShot && playingShot.id !== selectedId && <button className="follow-playback" type="button" onClick={() => { setSelectedId(playingShot.id); setAnnotation(null); }}>查看播放位置的镜头 {String(playingIndex + 1).padStart(2, "0")} <RightOutlined /></button>}
        <div className="study-detail-tabs" role="tablist" aria-label="镜头资料">{[["analysis", "拉片分析"], ["prompts", "提示词"]].map(([id, label]) => <button key={id} type="button" role="tab" id={`study-tab-${id}`} aria-selected={detailTab === id} aria-controls={`study-${id}`} tabIndex={detailTab === id ? 0 : -1} onClick={() => setDetailTab(id)} onKeyDown={(event) => {
          if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) { event.preventDefault(); const next = event.key === "Home" ? "analysis" : event.key === "End" ? "prompts" : id === "analysis" ? "prompts" : "analysis"; setDetailTab(next); document.getElementById(`study-tab-${next}`).focus(); }
        }}>{label}</button>)}</div>
        <div id="study-analysis" role="tabpanel" aria-labelledby="study-tab-analysis" hidden={detailTab !== "analysis"} tabIndex={0}>
          {shots.map((shot) => <section className="shot-panel" key={shot.id} hidden={selectedId !== shot.id} aria-label={`${shot.title}拉片分析`}><p className="shot-summary">{shot.summary}</p><dl className="shot-facts">{Object.entries(shot.facts).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl><div className="analysis-annotation-options">{annotationModes.map((mode) => <button type="button" key={mode.id} aria-pressed={annotation === mode.id} onClick={() => toggleAnnotation(mode.id)}><span>{mode.label}标注</span><strong>{shot.facts[mode.fact]}</strong><small>{annotation === mode.id ? "关闭标注" : "在画面中查看"} <RightOutlined /></small></button>)}</div><div className="shot-analysis-notes">{shot.analysis.map((note) => <div key={note.label}><h3>{note.label}</h3><p>{note.text}</p></div>)}</div></section>)}
        </div>
        <div id="study-prompts" role="tabpanel" aria-labelledby="study-tab-prompts" hidden={detailTab !== "prompts"} tabIndex={0}>
          {shots.map((shot, index) => <div className="shot-prompts" key={shot.id} hidden={selectedId !== shot.id}>{[["image", "首帧图片"], ["video", "视频动态"]].map(([kind, label]) => {
            const prompt = kind === "image" ? shot.imagePrompt : shot.videoPrompt;
            return <section className="structured-prompt" key={kind}><header><h3>{label}</h3><Button type="text" size="small" icon={<CopyOutlined />} aria-label={`复制镜头 ${index + 1} ${label}完整提示词`} onClick={() => copyText(prompt)}>复制完整提示词</Button></header><dl>{groupPromptSegments(getPromptSegments(shot, kind)).map((group) => <div key={group.category}><dt>{group.category}</dt><dd>{group.text}</dd><Button type="text" size="small" icon={<CopyOutlined />} aria-label={`复制${label}${group.category}片段`} onClick={() => copyText(group.text)} /></div>)}</dl><details><summary>查看原文</summary><p>{prompt}</p></details></section>;
          })}</div>)}
        </div>
        <details className="video-case-context"><summary>案例信息与整体提示词</summary><p>{item.description}</p><div className="tag-row">{item.tags.map((tag) => <Tag key={tag}>{tag}</Tag>)}</div><p>{item.prompt}</p><Button type="text" icon={<CopyOutlined />} onClick={() => copyText(item.prompt)}>复制整体提示词</Button></details>
      </div>
    </div>
  </article>;
}

