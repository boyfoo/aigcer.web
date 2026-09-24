"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal, flushSync } from "react-dom";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { App as AntApp, Button, Modal, Switch, Tag, Tooltip } from "antd";
import { ArrowLeftOutlined, BookFilled, BookOutlined, CloseOutlined, CopyOutlined, FolderAddOutlined, LeftOutlined, PlayCircleFilled, QuestionCircleOutlined, ReloadOutlined, RightOutlined } from "@ant-design/icons";
import { useReferenceProjects } from "./ReferenceProjects.jsx";
import { ShotAnnotations } from "./ShotAnnotations.jsx";
import { ShotFrames, ShotOverview, ShotRhythm } from "./ShotOverview.jsx";
import { displayTags } from "./lib/contentEntries.js";
import { annotationModes, getPromptSegments, groupPromptSegments, getShotAnnotation } from "./lib/shotPresentation.js";
import { clampSeekTime, formatVideoTime, getShotAtTime } from "./lib/videoTimeline.js";
import { shotFactHelp } from "./lib/learningPresentation.js";
import { ReportNavigation, StudyReport, reportSections } from "./StudyReport.jsx";
import { reviewFields } from "./lib/studyReport.js";
import "./video-study.css";

function ReferenceLocation({ onSelect }) {
  const params = useSearchParams();
  const shotId = params.get("shot");
  useEffect(() => { if (shotId) onSelect(shotId); }, [shotId, onSelect]);
  return null;
}

const researchToolLabels = { composition: "取景构图", lighting: "光影分析", movement: "运镜分析" };
const playbackHintDuration = 3000;

function ResearchToolIcon({ mode }) {
  return <svg viewBox="0 0 28 28" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {mode === "composition" && <path d="M10 4H4v6m14-6h6v6M4 18v6h6m14-6v6h-6" />}
    {mode === "lighting" && <><circle cx="14" cy="14" r="5.5" /><path d="M14 2v3m0 18v3M2 14h3m18 0h3M5.5 5.5l2.1 2.1m12.8 12.8 2.1 2.1m0-17-2.1 2.1M7.6 20.4l-2.1 2.1" /></>}
    {mode === "movement" && <><rect x="3" y="7" width="14" height="14" rx="2" /><path d="m17 11 7-4v14l-7-4M7 14h6m-3-3 3 3-3 3" /></>}
  </svg>;
}

export function VideoStudy({ item, saved, onToggleSaved }) {
  const { message } = AntApp.useApp();
  const { projects, ready, addToProject, openLibrary } = useReferenceProjects();
  const { shots } = item.video;
  const videoRef = useRef(null);
  const headingRef = useRef(null);
  const headingSlotRef = useRef(null);
  const playbackAnchorRef = useRef(null);
  const playbackRef = useRef(null);
  const readingRef = useRef(null);
  const navigationSlotRef = useRef(null);
  const overviewScrollRef = useRef(null);
  const scrollOriginRef = useRef(0);
  const pendingSeekRef = useRef(null);
  const videoInteractionRef = useRef(null);
  const playbackHintSequenceRef = useRef(0);
  const [playbackHint, setPlaybackHint] = useState(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(item.video.durationSeconds);
  const [videoRatio, setVideoRatio] = useState(1440 / 2550);
  const [playing, setPlaying] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [headingMode, setHeadingMode] = useState("full");
  const [mediaError, setMediaError] = useState(false);
  const [selectedId, setSelectedId] = useState(shots[0].id);
  const [annotation, setAnnotation] = useState(null);
  const [detailTab, setDetailTab] = useState("analysis");
  const [studyMode, setStudyMode] = useState("overview");
  const [followPlayback, setFollowPlayback] = useState(false);
  const [framePreview, setFramePreview] = useState(null);
  const [personFilter, setPersonFilter] = useState("");
  const [readingSection, setReadingSection] = useState("shots");
  const [reportSection, setReportSection] = useState("study-statistics");
  const [reportOrigin, setReportOrigin] = useState(null);
  const [exportOpen, setExportOpen] = useState(false);
  const sectionScrollRef = useRef({});
  const activeReadingKey = readingSection === "shots" ? "shots" : reportSection;
  const navigateReading = (target) => {
    setPlaybackHint(null);
    if (target === activeReadingKey) return;
    sectionScrollRef.current[activeReadingKey] = window.scrollY + scrollOriginRef.current;
    const initialTop = scrollOriginRef.current + Math.max(0, window.scrollY + Math.min(0, readingRef.current.getBoundingClientRect().top - (parseFloat(getComputedStyle(readingRef.current).scrollMarginTop) || 0)));
    flushSync(() => {
      setReadingSection(target === "shots" ? "shots" : "report");
      if (target !== "shots") setReportSection(target);
      setReportOrigin(null);
    });
    window.scrollTo({ top: Math.max(0, (sectionScrollRef.current[target] ?? initialTop) - scrollOriginRef.current), behavior: "instant" });
    window.history.replaceState(null, "", `#${target === "shots" ? "selected-shot-content" : target}`);
  };
  const [observedMetadata, setObservedMetadata] = useState({});
  const reportItem = useMemo(() => ({ ...item, video: { ...item.video, metadata: { ...item.video.metadata, ...observedMetadata } } }), [item, observedMetadata]);
  const selectedIndex = shots.findIndex(({ id }) => id === selectedId);
  const selectedShot = shots[selectedIndex];
  const studyAnnotationModes = item.video.isMock && getShotAnnotation(selectedShot) ? annotationModes : [];
  const playingShot = getShotAtTime(shots, currentTime);
  const playingIndex = shots.findIndex(({ id }) => id === playingShot?.id);
  const projectCount = projects.filter((project) => project.references.some((entry) => entry.caseId === item.id && entry.shotId === selectedId)).length;
  const annotationVisible = annotation && playingShot?.id === selectedId && !mediaError;

  useEffect(() => {
    if (!playbackHint) return;
    const dismiss = () => setPlaybackHint(null);
    const onKeyDown = (event) => { if (event.key === "Escape") dismiss(); };
    const timer = window.setTimeout(dismiss, playbackHintDuration);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("wheel", dismiss, { passive: true });
    window.addEventListener("touchmove", dismiss, { passive: true });
    window.addEventListener("resize", dismiss);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("wheel", dismiss);
      window.removeEventListener("touchmove", dismiss);
      window.removeEventListener("resize", dismiss);
    };
  }, [playbackHint]);

  useEffect(() => {
    if (!playingShot || playingShot.id === selectedId) setPlaybackHint(null);
  }, [playingShot?.id, selectedId]);

  const showPlaybackHint = (shot, point) => {
    if (!point || !shot || shot.id === selectedId || followPlayback || (readingSection === "shots" && studyMode === "detail")) {
      setPlaybackHint(null);
      return;
    }
    const gap = 12;
    const width = Math.min(260, window.innerWidth - gap * 2);
    const height = 40;
    const maxLeft = window.innerWidth - width - gap;
    const maxTop = window.innerHeight - height - gap;
    let left = Math.max(gap, Math.min(point.x + gap, maxLeft));
    let top = Math.max(gap, Math.min(point.y + gap, maxTop));
    const video = videoRef.current.getBoundingClientRect();
    if (left < video.right && left + width > video.left && top < video.bottom && top + height > video.top) {
      if (video.bottom + gap <= maxTop) top = video.bottom + gap;
      else if (video.top - height - gap >= gap) top = video.top - height - gap;
      else if (video.right + gap <= maxLeft) left = video.right + gap;
      else if (video.left - width - gap >= gap) left = video.left - width - gap;
      else { setPlaybackHint(null); return; }
    }
    setPlaybackHint({ style: { left, top, maxWidth: width }, sequence: ++playbackHintSequenceRef.current });
  };
  const captureVideoInteraction = (event) => {
    if (event.type === "keydown" && !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const bounds = videoRef.current.getBoundingClientRect();
    videoInteractionRef.current = {
      x: event.type === "keydown" ? bounds.left + bounds.width / 2 : event.clientX,
      y: event.type === "keydown" ? bounds.bottom - 24 : event.clientY,
    };
    setPlaybackHint(null);
  };

  const positionVideo = useCallback((shot) => {
    videoInteractionRef.current = null;
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
    setPlaybackHint(null);
    if (readingSection === "report") {
      sectionScrollRef.current[reportSection] = window.scrollY + scrollOriginRef.current;
      setReportOrigin(reportSection);
    } else if (studyMode === "overview" && mode === "detail") overviewScrollRef.current = window.scrollY + scrollOriginRef.current;
    flushSync(() => {
      setReadingSection("shots");
      setStudyMode(mode);
      if (shot) { setSelectedId(shot.id); setAnnotation(null); }
    });
    if (mode === "overview" && overviewScrollRef.current !== null) {
      window.scrollTo({ top: Math.max(0, overviewScrollRef.current - scrollOriginRef.current), behavior: "instant" });
    } else {
      const inset = parseFloat(getComputedStyle(readingRef.current).scrollMarginTop) || 0;
      const top = readingRef.current?.getBoundingClientRect().top;
      if (top < inset || window.innerWidth <= 800) window.scrollBy({ top: top - inset, behavior: "instant" });
    }
    document.getElementById(`study-view-panel-${mode}`)?.focus({ preventScroll: true });
  }, [studyMode, readingSection, reportSection]);
  const chooseShot = useCallback((shot) => {
    changeMode("detail", shot);
    positionVideo(shot);
  }, [changeMode, positionVideo]);
  const seekShot = (shot, event) => {
    if (readingSection === "shots" && studyMode === "detail") {
      setSelectedId(shot.id);
      setAnnotation(null);
    }
    positionVideo(shot);
    const bounds = event.currentTarget.getBoundingClientRect();
    showPlaybackHint(shot, event.detail ? { x: event.clientX, y: event.clientY } : { x: bounds.left + bounds.width / 2, y: bounds.top });
  };
  const selectReference = useCallback((id) => {
    const shot = shots.find((entry) => entry.id === id);
    if (!shot) return;
    videoInteractionRef.current = null;
    setStudyMode("detail");
    setReadingSection("shots");
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

  useEffect(() => {
    let frame;
    const openFragment = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const id = window.location.hash.slice(1);
        if (id === "study-export") { setExportOpen(true); return; }
        const section = reportSections.find(([key]) => key === id)?.[0] || (id.startsWith("study-check-") ? "study-quality" : null);
        if (!section && !["selected-shot-content", "study-prompts"].includes(id)) return;
        flushSync(() => {
          setReadingSection(section ? "report" : "shots");
          if (section) setReportSection(section);
          if (id === "study-prompts") { setStudyMode("detail"); setDetailTab("prompts"); }
        });
        const target = document.getElementById(id);
        if (target?.tagName === "DETAILS") target.open = true;
        target?.scrollIntoView({ block: "start", behavior: "instant" });
      });
    };
    openFragment();
    window.addEventListener("hashchange", openFragment);
    return () => { cancelAnimationFrame(frame); window.removeEventListener("hashchange", openFragment); };
  }, []);

  const syncPlayback = (event) => {
    const time = event.currentTarget.currentTime;
    setCurrentTime(time);
    const syncDetail = event.type === "seeking" && readingSection === "shots" && studyMode === "detail";
    const shot = (followPlayback || syncDetail) && getShotAtTime(shots, time);
    if (shot && shot.id !== selectedId) { setSelectedId(shot.id); setAnnotation(null); }
    if (event.type === "seeking") {
      const interaction = videoInteractionRef.current;
      if (interaction) showPlaybackHint(getShotAtTime(shots, time), interaction);
    }
  };
  const toggleFollow = (enabled) => {
    setFollowPlayback(enabled);
    if (enabled && playingShot) { setSelectedId(playingShot.id); setAnnotation(null); }
  };

  useEffect(() => {
    const playback = playbackRef.current;
    const navigation = readingRef.current.querySelector(".study-report-nav");
    const navigationSlot = navigationSlotRef.current;
    const article = playback.closest(".video-study");
    const shell = article.closest(".app-shell");
    const siteHeader = shell.querySelector(".topbar");
    const headerWasInert = siteHeader?.inert;
    const heading = headingRef.current;
    const slot = headingSlotRef.current;
    const movingParts = [heading.querySelector(".video-study-back"), heading.querySelector("h1")];
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = null;
    let mode = article.dataset.headingMode;
    let destinationKey = "";
    let navigationPinned = false;
    let playbackBoundary = 0;
    let navigationBoundary = 0;
    let sideBySide = false;
    let animations = [];
    let motionVersion = 0;
    const cancelMotion = () => {
      motionVersion += 1;
      animations.forEach((animation) => animation.cancel());
      animations = [];
    };
    const moveHeading = (instant = false) => {
      const slotBounds = slot.getBoundingClientRect();
      const dockBounds = playback.getBoundingClientRect();
      const dockStyle = getComputedStyle(playback);
      const dockTop = (parseFloat(dockStyle.top) || 0) - parseFloat(dockStyle.getPropertyValue("--study-compact-heading-height"));
      const target = {
        left: dockBounds.left,
        top: dockTop,
        width: dockBounds.width,
      };
      const nextKey = `${target.left}:${target.top}:${target.width}`;
      if (mode === "compact" && destinationKey === nextKey) {
        if (instant) cancelMotion();
        return;
      }

      // Measure the one live title before cancelling an interrupted movement.
      const first = heading.getBoundingClientRect();
      const firstParts = movingParts.map((element) => element.getBoundingClientRect());
      if (mode === "full") slot.style.height = `${slotBounds.height}px`;
      cancelMotion();
      destinationKey = nextKey;
      mode = "compact";
      heading.style.setProperty("--study-title-left", `${target.left}px`);
      heading.style.setProperty("--study-title-top", `${target.top}px`);
      heading.style.setProperty("--study-title-width", `${target.width}px`);
      flushSync(() => setHeadingMode("compact"));
      if (instant) return;

      const last = heading.getBoundingClientRect();
      const lastParts = movingParts.map((element) => element.getBoundingClientRect());
      const dx = first.left - last.left;
      const dy = first.top - last.top;
      // Settle directly at the dock without overshoot or rebound.
      const options = { duration: 180, easing: "cubic-bezier(0.22, 1, 0.36, 1)" };
      animations = [heading.animate([
        { transform: `translate(${dx}px, ${dy}px)` },
        { transform: "translate(0, 0)" },
      ], options), ...movingParts.map((element, index) => {
        const before = firstParts[index];
        const after = lastParts[index];
        // Use offsets within the heading so scrolling does not become another title animation.
        const scale = after.height ? before.height / after.height : 1;
        return element.animate([
          { transform: `translate(${before.left - after.left - dx}px, ${before.top - after.top - dy}px) scale(${scale})` },
          { transform: "translate(0, 0) scale(1)" },
        ], options);
      })];
      const version = motionVersion;
      Promise.all(animations.map((animation) => animation.finished)).then(() => {
        if (version !== motionVersion) return;
        animations = [];
      }, () => {});
    };
    const updatePinned = () => {
      frame = null;
      const pinned = window.scrollY >= playbackBoundary;
      const instant = article.dataset.instantHeading === "true" || reducedMotion.matches;
      if (pinned || mode === "compact") {
        moveHeading(instant);
        advanceScrollOrigin();
      }
    };
    const advanceScrollOrigin = (layoutChanged = false) => {
      if (mode !== "compact") return;
      if (sideBySide && !navigationPinned && window.scrollY >= navigationBoundary) {
        navigationPinned = true;
        navigationSlot.dataset.pinned = "true";
      }
      const boundary = Math.max(playbackBoundary, sideBySide && navigationPinned ? navigationBoundary : playbackBoundary);
      const shift = Math.max(-scrollOriginRef.current, boundary);
      if (Math.abs(shift) < 0.5 || (shift < 0 && !layoutChanged)) return;
      // Remove the passed header region once, preserving the visible content position.
      // The dock is now the native scroll origin (0), so upward scrolling never needs correction.
      const currentTop = window.scrollY;
      scrollOriginRef.current += shift;
      shell.style.setProperty("--study-scroll-origin", `${scrollOriginRef.current}px`);
      playbackBoundary -= shift;
      navigationBoundary -= shift;
      window.scrollTo({ top: Math.max(0, currentTop - shift), behavior: "instant" });
      if (siteHeader) siteHeader.inert = headerWasInert || siteHeader.getBoundingClientRect().bottom <= 0;
    };
    const schedulePinned = () => {
      advanceScrollOrigin();
      if (mode === "full" && frame === null) frame = window.requestAnimationFrame(updatePinned);
    };
    const updateHeadingMotion = (event) => {
      article.dataset.instantHeading = String(event.type === "keydown");
      if (event.type === "keydown") { cancelMotion(); schedulePinned(); }
    };
    const headingInputEvents = ["keydown", "pointerdown", "wheel", "touchstart"];
    const updateInsets = () => {
      const playbackSlotBounds = playbackAnchorRef.current.getBoundingClientRect();
      playback.style.setProperty("--study-playback-left", `${playbackSlotBounds.left}px`);
      playback.style.setProperty("--study-playback-width", `${playbackSlotBounds.width}px`);
      const bounds = playback.getBoundingClientRect();
      const navSlotBounds = navigationSlot.getBoundingClientRect();
      // The fixed navigation keeps the column's width; its slot preserves document flow.
      navigation.style.setProperty("--study-nav-left", `${navSlotBounds.left}px`);
      navigation.style.setProperty("--study-nav-width", `${navSlotBounds.width}px`);
      const navHeight = navigation.getBoundingClientRect().height;
      if (navigationSlot.style.height !== `${navHeight}px`) navigationSlot.style.height = `${navHeight}px`;
      if (article.style.getPropertyValue("--study-dock-height") !== `${bounds.height}px`) article.style.setProperty("--study-dock-height", `${bounds.height}px`);
      if (article.style.getPropertyValue("--study-nav-height") !== `${navHeight}px`) article.style.setProperty("--study-nav-height", `${navHeight}px`);
      // Cache geometry only on layout changes; wheel/scroll events do not force layout.
      playbackBoundary = Math.ceil(window.scrollY + playbackAnchorRef.current.getBoundingClientRect().top - (parseFloat(getComputedStyle(playback).top) || 0));
      navigationBoundary = Math.ceil(window.scrollY + readingRef.current.getBoundingClientRect().top - (parseFloat(getComputedStyle(navigationSlot).top) || 0));
      sideBySide = window.matchMedia("(min-width: 801px)").matches;
      navigationSlot.dataset.pinned = String(sideBySide && navigationPinned);
      advanceScrollOrigin(true);
      if (frame === null) frame = window.requestAnimationFrame(updatePinned);
    };
    const updateMotionPreference = () => { if (reducedMotion.matches) cancelMotion(); updateInsets(); };
    updateInsets();
    const observer = new ResizeObserver(updateInsets);
    observer.observe(playback);
    observer.observe(navigation);
    observer.observe(slot);
    observer.observe(readingRef.current);
    window.addEventListener("scroll", schedulePinned, { passive: true });
    window.addEventListener("resize", updateInsets);
    reducedMotion.addEventListener("change", updateMotionPreference);
    headingInputEvents.forEach((type) => window.addEventListener(type, updateHeadingMotion, { passive: true }));
    return () => {
      observer.disconnect();
      shell.style.removeProperty("--study-scroll-origin");
      scrollOriginRef.current = 0;
      if (siteHeader) siteHeader.inert = headerWasInert;
      delete navigationSlot.dataset.pinned;
      navigationSlot.style.removeProperty("height");
      navigation.style.removeProperty("--study-nav-left");
      navigation.style.removeProperty("--study-nav-width");
      playback.style.removeProperty("--study-playback-left");
      playback.style.removeProperty("--study-playback-width");
      window.removeEventListener("scroll", schedulePinned);
      window.removeEventListener("resize", updateInsets);
      reducedMotion.removeEventListener("change", updateMotionPreference);
      headingInputEvents.forEach((type) => window.removeEventListener(type, updateHeadingMotion));
      cancelMotion();
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

  return <article className="video-study" data-heading-mode={headingMode}>
    <Suspense fallback={null}><ReferenceLocation onSelect={selectReference} /></Suspense>
    <header className="video-study-heading">
      <div className="video-study-heading-slot" ref={headingSlotRef}>
      <div className="video-study-name" ref={headingRef}>
        <Link href="/collections/videos" className="video-study-back" aria-label="返回视频案例"><ArrowLeftOutlined /></Link>
        <div className="video-study-title-copy"><h1 title={item.title}>{item.title}</h1><p aria-hidden={headingMode !== "full"}>{displayTags(item.type)}<span>·</span>{formatVideoTime(duration)}<span>·</span>{shots.length} 个镜头</p></div>
      </div>
      </div>
      <div className="video-study-actions" aria-hidden={headingMode !== "full"} inert={headingMode !== "full"}><Button icon={saved ? <BookFilled /> : <BookOutlined />} onClick={onToggleSaved} className={`case-save${saved ? " is-saved" : ""}`}>{saved ? "已收藏" : "收藏案例"}</Button></div>
    </header>
    <div className="study-workspace">
      <div className="study-media-column">
        <div className="study-playback-anchor" ref={playbackAnchorRef} aria-hidden="true" />
        <div className="study-playback" ref={playbackRef}>
        <div className="study-player" style={{ "--video-ratio": videoRatio }} onPointerDownCapture={captureVideoInteraction} onKeyDownCapture={captureVideoInteraction}
          onPointerMoveCapture={(event) => { videoInteractionRef.current = { x: event.clientX, y: event.clientY }; }} onPointerLeave={() => { videoInteractionRef.current = null; }}>
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
        <details className="study-tools" open><summary>播放与研究工具</summary><div className="study-tools-body">
        <ShotRhythm shots={shots} duration={duration} currentTime={currentTime} playingId={playingShot?.id} selectedId={selectedId} onSelect={seekShot} />
        {studyAnnotationModes.length > 0 && <div className="study-overlay-toolbar" role="group" aria-label="画面标注">{studyAnnotationModes.map((mode) => <button type="button" key={mode.id} aria-pressed={annotation === mode.id} onClick={() => toggleAnnotation(mode.id)}><ResearchToolIcon mode={mode.id} /><span>{researchToolLabels[mode.id]}</span></button>)}</div>}
        {annotation && !annotationVisible && !mediaError && <div className="annotation-notice">标注属于镜头 {String(selectedIndex + 1).padStart(2, "0")}<button type="button" onClick={() => positionVideo(selectedShot)}>回看这个镜头</button></div>}
        </div></details>
        </div>
        </div>
      </div>
      <div className="study-reading-column" id="selected-shot-content" ref={readingRef}>
        <div className="study-navigation-slot" ref={navigationSlotRef}>
        <ReportNavigation section={readingSection} reportSection={reportSection} onNavigate={navigateReading} onExport={() => setExportOpen(true)}>
          <div className="study-follow-control"><label htmlFor="study-follow">拆解跟随播放 <Switch id="study-follow" size="small" checked={followPlayback} onChange={toggleFollow} aria-describedby="study-follow-description" aria-controls="study-view-panel-overview study-view-panel-detail" /></label><span id="study-follow-description">{followPlayback ? "随视频自动切换" : "已关闭 · 自由阅读"}</span><Tooltip title="开启后，拆解随视频自动切换镜头；关闭后可停留阅读。手动跳转进度时，列表仅更新播放标识，详情同步到对应镜头。"><button type="button" className="study-fact-help" aria-label="了解拆解跟随播放"><QuestionCircleOutlined /></button></Tooltip></div>
        </ReportNavigation>
        </div>
        <div id="study-panel-shots" role="tabpanel" aria-labelledby="study-tab-shots" hidden={readingSection !== "shots"}>
        {reportOrigin && <Button className="study-return-report" type="text" size="small" icon={<ArrowLeftOutlined />} onClick={() => { const origin = reportOrigin; navigateReading(origin); document.getElementById(origin)?.focus({ preventScroll: true }); }}>返回{reportSections.find(([id]) => id === reportOrigin)?.[1]}</Button>}
        <div id="study-view-panel-overview" aria-label="整片总览" hidden={studyMode !== "overview"} tabIndex={-1}>
          <ShotOverview shots={shots} playingId={playingShot?.id} playing={playing} onSelect={chooseShot} onPreview={setFramePreview} people={item.video.cast} person={personFilter} onPersonChange={setPersonFilter} />
        </div>
        <div id="study-view-panel-detail" aria-label="单镜头细读" hidden={studyMode !== "detail"} tabIndex={-1}>
          <div className="study-detail-navigation"><Button type="text" size="small" icon={<ArrowLeftOutlined />} onClick={() => changeMode("overview")}>全部镜头</Button><div><Button type="text" size="small" icon={<LeftOutlined />} disabled={selectedIndex === 0} onClick={() => chooseShot(shots[selectedIndex - 1])}>上一镜</Button><Button type="text" size="small" disabled={selectedIndex === shots.length - 1} onClick={() => chooseShot(shots[selectedIndex + 1])}>下一镜 <RightOutlined /></Button></div></div>
          <header className="selected-shot-heading"><div><p>正在阅读 · 镜头 {String(selectedIndex + 1).padStart(2, "0")} / {String(shots.length).padStart(2, "0")}<span>{formatVideoTime(selectedShot.start)}–{formatVideoTime(selectedShot.end)}</span></p><h2>{selectedShot.title}</h2></div><div className="study-shot-actions"><Button type="text" className="study-watch-shot" icon={<PlayCircleFilled />} onClick={() => { positionVideo(selectedShot); if (window.innerWidth <= 800) videoRef.current?.closest(".study-player")?.scrollIntoView({ block: "start", behavior: "instant" }); videoRef.current?.focus({ preventScroll: true }); }}>回看这镜</Button><Button type="text" icon={<FolderAddOutlined />} disabled={!ready} onClick={() => addToProject({ caseId: item.id, shotId: selectedId })}>收藏这镜</Button></div></header>
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
        </div>
        <div id="study-panel-report" role="tabpanel" aria-labelledby="study-tab-report" hidden={readingSection !== "report"}>
        <StudyReport item={reportItem} activeSection={reportSection} exportOpen={exportOpen} onExportClose={() => setExportOpen(false)} onSelect={chooseShot} onPerson={(id) => {
          sectionScrollRef.current[reportSection] = window.scrollY + scrollOriginRef.current;
          flushSync(() => { setReportOrigin(reportSection); setPersonFilter(id); setReadingSection("shots"); setStudyMode("overview"); });
          readingRef.current?.scrollIntoView({ block: "start", behavior: "instant" });
          document.getElementById("study-view-panel-overview")?.focus({ preventScroll: true });
        }} />
        </div>
      </div>
    </div>
    {playbackHint && playingShot && playingShot.id !== selectedId && createPortal(<div className="study-playback-hint" role="group" aria-label="播放位置提示" style={{ ...playbackHint.style, "--playback-hint-duration": `${playbackHintDuration}ms` }}>
      <button type="button" className="study-playback-hint-open" onClick={() => changeMode("detail", playingShot)}>查看播放位置的镜头 <span>{String(playingIndex + 1).padStart(2, "0")}</span><RightOutlined /></button>
      <button type="button" className="study-playback-hint-close" aria-label="关闭播放位置提示" onClick={() => setPlaybackHint(null)}><CloseOutlined /></button>
      <span key={playbackHint.sequence} className="study-playback-hint-countdown" aria-hidden="true" />
    </div>, document.body)}
    <Modal open={Boolean(framePreview)} onCancel={() => setFramePreview(null)} footer={null} width={960} title={framePreview ? `镜头 ${String(framePreview.index + 1).padStart(2, "0")} · ${framePreview.shot.title}` : "镜头画面"} className="study-frame-modal">
      {framePreview && <><div className="study-frame-preview-controls">{[["image", framePreview.shot.imageIsFallback ? "案例封面" : "首帧 / 代表画面"], ["endImage", "尾帧"]].map(([key, label], index) => <Button key={key} type={framePreview.frameIndex === index ? "primary" : "default"} disabled={!framePreview.shot[key]} onClick={() => setFramePreview({ ...framePreview, frameIndex: index })}>{label}</Button>)}</div><img src={framePreview.frameIndex === 0 ? framePreview.shot.image : framePreview.shot.endImage} alt={`镜头 ${framePreview.index + 1}${framePreview.frameIndex === 0 ? "首帧或代表画面" : "尾帧"}`} /></>}
    </Modal>
  </article>;
}

