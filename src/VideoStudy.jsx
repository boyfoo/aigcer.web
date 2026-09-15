"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { App as AntApp, Button, Modal, Switch, Tag, Tooltip } from "antd";
import { ArrowLeftOutlined, BookFilled, BookOutlined, CopyOutlined, FolderAddOutlined, LeftOutlined, PlayCircleFilled, QuestionCircleOutlined, ReloadOutlined, RightOutlined } from "@ant-design/icons";
import { useReferenceProjects } from "./ReferenceProjects.jsx";
import { ShotAnnotations } from "./ShotAnnotations.jsx";
import { ShotFrames, ShotOverview, ShotRhythm } from "./ShotOverview.jsx";
import { displayTags } from "./lib/contentEntries.js";
import { annotationModes, getPromptSegments, groupPromptSegments, getShotAnnotation } from "./lib/shotPresentation.js";
import { clampSeekTime, formatVideoTime, getShotAtTime } from "./lib/videoTimeline.js";
import { caseLearningFocus, shotFactHelp } from "./lib/learningPresentation.js";
import { ReportNavigation, StudyReport } from "./StudyReport.jsx";
import { reviewFields } from "./lib/studyReport.js";
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
  const playbackAnchorRef = useRef(null);
  const playbackRef = useRef(null);
  const readingRef = useRef(null);
  const overviewScrollRef = useRef(null);
  const pendingSeekRef = useRef(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(item.video.durationSeconds);
  const [videoRatio, setVideoRatio] = useState(1440 / 2550);
  const [playing, setPlaying] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [playbackPinned, setPlaybackPinned] = useState(false);
  const [mediaError, setMediaError] = useState(false);
  const [selectedId, setSelectedId] = useState(shots[0].id);
  const [annotation, setAnnotation] = useState(null);
  const [detailTab, setDetailTab] = useState("analysis");
  const [studyMode, setStudyMode] = useState("overview");
  const [followPlayback, setFollowPlayback] = useState(false);
  const [framePreview, setFramePreview] = useState(null);
  const [personFilter, setPersonFilter] = useState("");
  const [personSelection, setPersonSelection] = useState(0);
  const [observedMetadata, setObservedMetadata] = useState({});
  const reportItem = useMemo(() => ({ ...item, video: { ...item.video, metadata: { ...item.video.metadata, ...observedMetadata } } }), [item, observedMetadata]);
  const selectedIndex = shots.findIndex(({ id }) => id === selectedId);
  const selectedShot = shots[selectedIndex];
  const studyAnnotationModes = item.video.isMock && getShotAnnotation(selectedShot) ? annotationModes : [];
  const playingShot = getShotAtTime(shots, currentTime);
  const playingIndex = shots.findIndex(({ id }) => id === playingShot?.id);
  const projectCount = projects.filter((project) => project.references.some((entry) => entry.caseId === item.id && entry.shotId === selectedId)).length;
  const annotationVisible = annotation && playingShot?.id === selectedId && !mediaError;

  const positionVideo = useCallback((shot) => {
    const video = videoRef.current;
    const target = clampSeekTime(shot.start, video?.duration || duration);
    setCurrentTime(target);
    if (!video || mediaError) return;
    if (video.readyState === 0) pendingSeekRef.current = target;
    else video.currentTime = target;
    video.play()?.catch((error) => {
      if (error.name === "NotAllowedError") message.info("已定位镜头，点击播放器继续播放");
    });
  }, [duration, mediaError, message]);
  const changeMode = useCallback((mode, shot) => {
    if (studyMode === "overview" && mode === "detail") overviewScrollRef.current = window.scrollY;
    flushSync(() => {
      setStudyMode(mode);
      if (shot) { setSelectedId(shot.id); setAnnotation(null); }
    });
    if (mode === "overview" && overviewScrollRef.current !== null) {
      window.scrollTo({ top: overviewScrollRef.current, behavior: "instant" });
    } else {
      const inset = parseFloat(getComputedStyle(readingRef.current).scrollMarginTop) || 20;
      const top = readingRef.current?.getBoundingClientRect().top;
      if (top < inset || window.innerWidth <= 800) window.scrollBy({ top: top - inset, behavior: "instant" });
    }
    document.getElementById(`study-view-panel-${mode}`)?.focus({ preventScroll: true });
  }, [studyMode]);
  const chooseShot = useCallback((shot) => {
    changeMode("detail", shot);
    positionVideo(shot);
  }, [changeMode, positionVideo]);
  const selectReference = useCallback((id) => {
    const shot = shots.find((entry) => entry.id === id);
    if (!shot) return;
    setStudyMode("detail");
    setFollowPlayback(false);
    setSelectedId(id);
    setAnnotation(null);
    const video = videoRef.current;
    video?.pause();
    const target = clampSeekTime(shot.start, video?.duration || item.video.durationSeconds);
    setCurrentTime(target);
    if (!video || video.readyState === 0) pendingSeekRef.current = target;
    else video.currentTime = target;
  }, [shots, item.video.durationSeconds]);

  const syncPlayback = (event) => {
    const time = event.currentTarget.currentTime;
    setCurrentTime(time);
    const shot = followPlayback && getShotAtTime(shots, time);
    if (shot && shot.id !== selectedId) { setSelectedId(shot.id); setAnnotation(null); }
  };
  const toggleFollow = (enabled) => {
    setFollowPlayback(enabled);
    if (enabled && playingShot) { setSelectedId(playingShot.id); setAnnotation(null); }
  };

  useEffect(() => {
    const playback = playbackRef.current;
    const navigation = readingRef.current.querySelector(".study-report-nav");
    const article = playback.closest(".video-study");
    let frame = null;
    const updatePinned = () => {
      frame = null;
      const inset = parseFloat(getComputedStyle(playback).top) || 0;
      setPlaybackPinned(playbackAnchorRef.current.getBoundingClientRect().top <= inset);
    };
    const schedulePinned = () => {
      if (frame === null) frame = window.requestAnimationFrame(updatePinned);
    };
    const updateHeadingMotion = (event) => {
      playback.dataset.instantHeading = String(event.type === "keydown");
    };
    const headingInputEvents = ["keydown", "pointerdown", "wheel", "touchstart"];
    const updateInsets = () => {
      article.style.setProperty("--study-dock-height", `${playback.getBoundingClientRect().height}px`);
      article.style.setProperty("--study-nav-height", `${navigation.getBoundingClientRect().height}px`);
      schedulePinned();
    };
    updateInsets();
    const observer = new ResizeObserver(updateInsets);
    observer.observe(playback);
    observer.observe(navigation);
    observer.observe(article.querySelector(".video-study-heading"));
    window.addEventListener("scroll", schedulePinned, { passive: true });
    window.addEventListener("resize", schedulePinned);
    headingInputEvents.forEach((type) => window.addEventListener(type, updateHeadingMotion, { passive: true }));
    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", schedulePinned);
      window.removeEventListener("resize", schedulePinned);
      headingInputEvents.forEach((type) => window.removeEventListener(type, updateHeadingMotion));
      if (frame !== null) window.cancelAnimationFrame(frame);
    };
  }, []);

  useEffect(() => {
    if (!framePreview) return;
    const onKey = (event) => {
      const index = event.key === "ArrowLeft" ? 0 : event.key === "ArrowRight" ? 1 : null;
      if (index !== null && framePreview.shot[index ? "endImage" : "image"]) { event.preventDefault(); setFramePreview((value) => ({ ...value, frameIndex: index })); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [framePreview]);

  const onMetadata = (event) => {
    const video = event.currentTarget;
    if (Number.isFinite(video.duration) && video.duration > 0) setDuration(video.duration);
    if (video.videoWidth && video.videoHeight) setVideoRatio(video.videoWidth / video.videoHeight);
    if (video.videoWidth && video.videoHeight) setObservedMetadata({ width: video.videoWidth, height: video.videoHeight });
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
        <div><h1>{item.title}</h1><p>{displayTags(item.type)}<span>·</span>{formatVideoTime(duration)}<span>·</span>{shots.length} 个镜头</p></div>
      </div>
      <div className="video-study-actions"><Button icon={saved ? <BookFilled /> : <BookOutlined />} onClick={onToggleSaved} className={`case-save${saved ? " is-saved" : ""}`}>{saved ? "已收藏" : "收藏案例"}</Button></div>
    </header>
    <div className="study-workspace">
      <div className="study-media-column">
        <div className="study-playback-anchor" ref={playbackAnchorRef} aria-hidden="true" />
        <div className={`study-playback${playbackPinned ? " is-pinned" : ""}`} ref={playbackRef}>
        <div className="study-playback-heading" aria-hidden={!playbackPinned} inert={!playbackPinned}>
          <Link href="/collections/videos" className="video-study-back" aria-label="返回视频案例"><ArrowLeftOutlined /></Link>
          <span title={item.title}>{item.title}</span>
        </div>
        <div className="study-player" style={{ "--video-ratio": videoRatio }}>
            <video ref={videoRef} src={item.video.src} poster={item.image} controls playsInline preload="metadata" aria-label={`${item.title}视频播放器`}
              onLoadedMetadata={onMetadata} onTimeUpdate={syncPlayback} onSeeking={syncPlayback}
              onPlay={() => setPlaying(true)} onPlaying={() => { setPlaying(true); setBuffering(false); }} onPause={() => { setPlaying(false); setBuffering(false); }}
              onWaiting={() => setBuffering(true)} onCanPlay={() => setBuffering(false)} onEnded={() => setPlaying(false)} onError={() => { setMediaError(true); setPlaying(false); setBuffering(false); }}>
              浏览器暂不支持视频播放，可使用<a href={item.video.src}>视频原链接</a>观看。
            </video>
            {annotationVisible && <div className="study-video-plane"><ShotAnnotations shot={selectedShot} mode={annotation} /></div>}
          {buffering && !mediaError && <span className="study-buffering" role="status">视频加载中…</span>}
          {mediaError && <div className="study-player-error" role="alert"><p>视频暂时无法加载</p><div><Button icon={<ReloadOutlined />} onClick={retryVideo}>重新加载</Button><a href={item.video.src} target="_blank" rel="noreferrer">打开视频原链接</a></div></div>}
        </div>
        <div className="study-playback-controls">
        <div className="study-playback-status"><p><span className={`playback-dot${playing ? " is-playing" : ""}`} />{playingShot ? `${playing ? "正在播放" : "播放位置"} · 镜头 ${String(playingIndex + 1).padStart(2, "0")}` : "完整视频"}</p><span className="study-time">{formatVideoTime(currentTime)} / {formatVideoTime(duration)}</span></div>
        <details className="study-tools" open><summary>播放与研究工具<span>节奏与画面标注</span></summary><div className="study-tools-body">
        {playingShot && playingShot.id !== selectedId && <button className="follow-playback" type="button" onClick={() => changeMode("detail", playingShot)}>查看播放位置的镜头 {String(playingIndex + 1).padStart(2, "0")} <RightOutlined /></button>}
        <ShotRhythm shots={shots} duration={duration} currentTime={currentTime} playingId={playingShot?.id} selectedId={selectedId} onSelect={chooseShot} />
        {studyAnnotationModes.length > 0 && <div className="study-overlay-toolbar" aria-label="画面标注"><span>画面标注</span>{studyAnnotationModes.map((mode) => <button type="button" key={mode.id} aria-pressed={annotation === mode.id} onClick={() => toggleAnnotation(mode.id)}>{mode.label}</button>)}{annotation && <button type="button" onClick={() => setAnnotation(null)}>关闭</button>}</div>}
        {annotation && !annotationVisible && !mediaError && <div className="annotation-notice">标注属于镜头 {String(selectedIndex + 1).padStart(2, "0")}<button type="button" onClick={() => positionVideo(selectedShot)}>回看这个镜头</button></div>}
        </div></details>
        </div>
        </div>
      </div>
      <div className="study-reading-column" id="selected-shot-content" ref={readingRef}>
        <ReportNavigation />
        <div className="study-follow-control"><label htmlFor="study-follow">拆解跟随播放 <Switch id="study-follow" size="small" checked={followPlayback} onChange={toggleFollow} aria-describedby="study-follow-description" aria-controls="study-view-panel-overview study-view-panel-detail" /></label><span id="study-follow-description">{followPlayback ? "已开启 · 随视频自动切换镜头" : "已关闭 · 停留在当前镜头"}</span></div>
        <div id="study-view-panel-overview" aria-label="整片总览" hidden={studyMode !== "overview"} tabIndex={-1}>
          <div className="study-learning-focus"><span>这条案例的看点</span><p>{caseLearningFocus(item)}</p></div>
          {item.video.isMock && <p className="study-sample-notice">示例拆解 · 分镜资料与视频画面不对应</p>}
          <ShotOverview key={personSelection} shots={shots} selectedId={selectedId} playingId={playingShot?.id} onSelect={chooseShot} onPreview={setFramePreview} people={item.video.cast} person={personFilter} onPersonChange={setPersonFilter} />
        </div>
        <div id="study-view-panel-detail" aria-label="单镜头细读" hidden={studyMode !== "detail"} tabIndex={-1}>
          <div className="study-detail-navigation"><Button type="text" size="small" icon={<ArrowLeftOutlined />} onClick={() => changeMode("overview")}>全部镜头</Button><div><Button type="text" size="small" icon={<LeftOutlined />} disabled={selectedIndex === 0} onClick={() => chooseShot(shots[selectedIndex - 1])}>上一镜</Button><Button type="text" size="small" disabled={selectedIndex === shots.length - 1} onClick={() => chooseShot(shots[selectedIndex + 1])}>下一镜 <RightOutlined /></Button></div></div>
          <header className="selected-shot-heading"><div><p>镜头 {String(selectedIndex + 1).padStart(2, "0")} / {String(shots.length).padStart(2, "0")}<span>{formatVideoTime(selectedShot.start)}–{formatVideoTime(selectedShot.end)}</span></p><h2>{selectedShot.title}</h2></div><div className="study-shot-actions"><Button type="text" className="study-mobile-watch" icon={<PlayCircleFilled />} onClick={() => { positionVideo(selectedShot); videoRef.current?.closest(".study-player")?.scrollIntoView({ block: "start", behavior: "instant" }); videoRef.current?.focus({ preventScroll: true }); }}>回看这镜</Button><Button type="text" icon={<FolderAddOutlined />} disabled={!ready} onClick={() => addToProject({ caseId: item.id, shotId: selectedId })}>收藏这镜</Button></div></header>
          {item.video.isMock && <p className="study-sample-notice">示例拆解 · 分镜资料与视频画面不对应</p>}
          <ShotFrames key={selectedId} shot={selectedShot} index={selectedIndex} onPreview={setFramePreview} single />
          <div className="study-shot-classification">{[["类别", selectedShot.category], ["叙事节奏", selectedShot.rhythm], ["转场", selectedShot.transition], ["人物", selectedShot.subjects?.map((id) => item.video.cast?.find((entry) => entry.id === id)?.name || id).join("、")]].filter(([, value]) => value).map(([label, value]) => <span key={label}>{label} · {value}</span>)}</div>
          {projectCount > 0 && <div className="study-reading-status"><button type="button" onClick={() => openLibrary()}>已加入 {projectCount} 个镜头收藏夹</button></div>}
          <div id="study-analysis">
            {shots.map((shot) => <section className="shot-panel" key={shot.id} hidden={selectedId !== shot.id} aria-label={`${shot.title}拉片分析`}>
              {shot.summary && <p className="shot-summary">{shot.summary}</p>}
              <div className="shot-analysis-notes">
                {shot.analysis.filter((note) => note.text).map((note, noteIndex) => <div key={noteIndex}><h3>{note.label}</h3><p>{note.text}</p></div>)}
                {[["narrative", "叙事作用"], ["sound", "声音与音乐"], ["dialogue", "台词"], ["onscreenText", "画面文字"]].filter(([key]) => shot[key]).map(([key, label]) => <div className="shot-context-note" key={key}><h3>{label}</h3><p>{shot[key]}</p></div>)}
                {!shot.summary && !shot.analysis.some((note) => note.text) && !["narrative", "sound", "dialogue", "onscreenText"].some((key) => shot[key]) && <p className="study-empty-note">这镜的分析尚未补充，可先查看画面与提示词。</p>}
              </div>
              <details className="study-shot-reference"><summary>查看镜头参数</summary><dl className="shot-facts">{Object.entries(shot.facts).filter(([, value]) => value).map(([label, value]) => <div key={label}><dt>{label}{shotFactHelp[label] && <Tooltip title={shotFactHelp[label]}><button className="study-fact-help" type="button" aria-label={`解释${label}`}><QuestionCircleOutlined /></button></Tooltip>}</dt><dd>{value}</dd></div>)}</dl></details>
              {Object.values(shot.review || {}).some((entry) => entry.note) && <details className="study-shot-reference"><summary>作者复核记录</summary>{Object.entries(shot.review).filter(([, entry]) => entry.note).map(([key, entry]) => <div key={key}><h3>{reviewFields[key]} · {entry.confirmed ? "已确认" : "待复核"}</h3><p className="shot-summary">{entry.note}</p></div>)}</details>}
            </section>)}
          </div>
          <details className="study-prompt-details" id="study-prompts" open={detailTab === "prompts"} onToggle={(event) => setDetailTab(event.currentTarget.open ? "prompts" : "analysis")}><summary>查看提示词参考</summary>
            {shots.map((shot, index) => <div className="shot-prompts" key={shot.id} hidden={selectedId !== shot.id}>{[["image", "首帧图片"], ["video", "视频动态"]].map(([kind, label]) => {
              const prompt = kind === "image" ? shot.imagePrompt : shot.videoPrompt;
              if (!prompt) return <section className="structured-prompt" key={kind}><header><h3>{label}</h3></header><p>暂未录入这段提示词。</p></section>;
              return <section className="structured-prompt" key={kind}><header><h3>{label}</h3><Button type="text" size="small" icon={<CopyOutlined />} aria-label={`复制镜头 ${index + 1} ${label}完整提示词`} onClick={() => copyText(prompt)}>复制完整提示词</Button></header><dl>{(item.video.isMock ? groupPromptSegments(getPromptSegments(shot, kind)) : [{ category: "原文", text: prompt }]).map((group) => <div key={group.category}><dt>{group.category}</dt><dd>{group.text}</dd><Button type="text" size="small" icon={<CopyOutlined />} aria-label={`复制${label}${group.category}片段`} onClick={() => copyText(group.text)} /></div>)}</dl>{item.video.isMock && <details><summary>查看原文</summary><p>{prompt}</p></details>}</section>;
            })}</div>)}
          </details>
        </div>
        <details className="video-case-context"><summary>案例信息与整体提示词</summary><p>{item.description}</p>{item.analysis && <section><h3>案例分析</h3><p>{item.analysis}</p></section>}<div className="tag-row">{item.tags.map((tag) => <Tag key={tag}>{tag}</Tag>)}</div><p>{item.prompt}</p><Button type="text" icon={<CopyOutlined />} onClick={() => copyText(item.prompt)}>复制整体提示词</Button></details>
        <StudyReport item={reportItem} onSelect={chooseShot} onPerson={(id) => { flushSync(() => { setPersonFilter(id); setPersonSelection((value) => value + 1); setStudyMode("overview"); }); readingRef.current?.scrollIntoView({ block: "start", behavior: "instant" }); document.getElementById("study-view-panel-overview")?.focus({ preventScroll: true }); }} />
      </div>
    </div>
    <Modal open={Boolean(framePreview)} onCancel={() => setFramePreview(null)} footer={null} width={960} title={framePreview ? `镜头 ${String(framePreview.index + 1).padStart(2, "0")} · ${framePreview.shot.title}` : "镜头画面"} className="study-frame-modal">
      {framePreview && <><div className="study-frame-preview-controls">{[["image", framePreview.shot.imageIsFallback ? "案例封面" : "首帧 / 代表画面"], ["endImage", "尾帧"]].map(([key, label], index) => <Button key={key} type={framePreview.frameIndex === index ? "primary" : "default"} disabled={!framePreview.shot[key]} onClick={() => setFramePreview({ ...framePreview, frameIndex: index })}>{label}</Button>)}</div><img src={framePreview.frameIndex === 0 ? framePreview.shot.image : framePreview.shot.endImage} alt={`镜头 ${framePreview.index + 1}${framePreview.frameIndex === 0 ? "首帧或代表画面" : "尾帧"}`} /></>}
    </Modal>
  </article>;
}

