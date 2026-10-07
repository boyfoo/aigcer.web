import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button, Modal } from "antd";
import { CircleCheck, LoaderCircle, RotateCcw } from "lucide-react";
import { formatVideoTime } from "./lib/videoTimeline.js";
import "./creation-preview.css";

const loadingDelay = 240;

export function CreationClipPreview({ reference, onClose }) {
  const videoRef = useRef(null);
  const loadingTimerRef = useRef(null);
  const loadingVisibleRef = useRef(false);
  const pendingLoadingRef = useRef("");
  const requestsRef = useRef({ active: true, loading: 0, play: 0 });
  const [error, setError] = useState("");
  const [loadingPhase, setLoadingPhase] = useState("");
  const [segmentEnded, setSegmentEnded] = useState(false);
  const start = reference.shot?.start ?? 0;
  const end = reference.shot?.end ?? reference.item.video.durationSeconds;
  const loadingMessage = (loadingPhase || pendingLoadingRef.current) === "buffering" ? "正在缓冲片段…" : "正在加载视频…";
  const endedMessage = reference.shot ? "片段已结束，可重看片段。" : "视频已结束，可重新播放。";

  const clearLoading = () => {
    clearTimeout(loadingTimerRef.current);
    loadingTimerRef.current = null;
    loadingVisibleRef.current = false;
    requestsRef.current.loading += 1;
    if (requestsRef.current.active) setLoadingPhase("");
  };

  const waitForVideo = (phase) => {
    if (!requestsRef.current.active) return;
    pendingLoadingRef.current = phase;
    if (loadingVisibleRef.current) {
      setLoadingPhase(phase);
      return;
    }
    if (loadingTimerRef.current !== null) return;
    const request = ++requestsRef.current.loading;
    // Cached playback should not flash a loading message; only sustained waits are shown.
    loadingTimerRef.current = setTimeout(() => {
      if (!requestsRef.current.active || request !== requestsRef.current.loading) return;
      loadingTimerRef.current = null;
      loadingVisibleRef.current = true;
      setLoadingPhase(pendingLoadingRef.current);
    }, loadingDelay);
  };

  const finishSegment = () => {
    requestsRef.current.play += 1;
    clearLoading();
    setSegmentEnded(true);
  };

  useEffect(() => {
    requestsRef.current.active = true;
    const video = videoRef.current;
    return () => {
      requestsRef.current.active = false;
      requestsRef.current.loading += 1;
      requestsRef.current.play += 1;
      clearTimeout(loadingTimerRef.current);
      loadingTimerRef.current = null;
      loadingVisibleRef.current = false;
      pendingLoadingRef.current = "";
      video?.pause();
    };
  }, []);

  const playSegment = () => {
    const video = videoRef.current;
    if (!video) return;
    const request = ++requestsRef.current.play;
    clearLoading();
    setError("");
    setSegmentEnded(false);
    video.currentTime = start;
    if (video.readyState < 3) waitForVideo("buffering");
    video.play().catch(() => {
      if (!requestsRef.current.active || request !== requestsRef.current.play) return;
      clearLoading();
      setError("自动播放未开始，请使用视频播放按钮。");
    });
  };

  return (
    <Modal
      open
      title={reference.title}
      onCancel={onClose}
      footer={<><Button icon={<RotateCcw />} onClick={playSegment}>重看片段</Button><Link className="creation-preview-link" href={reference.href}>打开拆解</Link></>}
      width={800}
      destroyOnHidden
    >
      <p className="creation-preview-source">{reference.item.title} · {reference.shot ? `${formatVideoTime(start)}–${formatVideoTime(end)}` : "整片参考 · 尚未拆解镜头"}</p>
      <video
        ref={videoRef}
        className="creation-preview-video"
        src={reference.item.video.src}
        poster={reference.image}
        controls
        playsInline
        preload="metadata"
        aria-label={`${reference.title}参考片段播放器`}
        onLoadStart={() => waitForVideo("loading")}
        onLoadedMetadata={playSegment}
        onPlay={() => {
          const video = videoRef.current;
          setSegmentEnded(false);
          setError("");
          if (video.currentTime < start || video.currentTime >= end) video.currentTime = start;
          if (video.readyState < 3) waitForVideo("buffering");
          else clearLoading();
        }}
        onPlaying={() => {
          if (videoRef.current.paused) return;
          clearLoading();
          setError("");
          setSegmentEnded(false);
        }}
        onCanPlay={clearLoading}
        onLoadedData={() => {
          if (videoRef.current.paused) clearLoading();
        }}
        onWaiting={() => {
          const video = videoRef.current;
          if (video.paused || (end > start && video.currentTime >= end)) return;
          waitForVideo("buffering");
        }}
        onStalled={() => {
          const video = videoRef.current;
          if (video.readyState < 3 && !video.paused) waitForVideo("buffering");
        }}
        onPause={() => {
          if (!videoRef.current.paused) return;
          requestsRef.current.play += 1;
          clearLoading();
        }}
        onSeeking={() => {
          const video = videoRef.current;
          if (video.currentTime < start) video.currentTime = start;
          else if (end > start && video.currentTime > end) video.currentTime = end;
          if (video.currentTime < end) {
            setSegmentEnded(false);
            if (video.readyState < 3) waitForVideo("buffering");
          }
        }}
        onSeeked={() => {
          const video = videoRef.current;
          if (video.seeking) return;
          if (video.paused && end > start && video.currentTime >= end) {
            finishSegment();
            return;
          }
          if (video.currentTime < end) setSegmentEnded(false);
          if (video.readyState >= 3 || (video.paused && video.readyState >= 2)) clearLoading();
        }}
        onTimeUpdate={() => {
          const video = videoRef.current;
          if (!video.paused && end > start && video.currentTime >= end) {
            video.pause();
            video.currentTime = end;
            finishSegment();
          }
        }}
        onEnded={finishSegment}
        onError={() => {
          requestsRef.current.play += 1;
          clearLoading();
          setSegmentEnded(false);
          setError("视频暂时无法播放，请打开案例检查原素材。");
        }}
      />
      <div className="creation-preview-feedback" role="status" aria-live="polite" aria-atomic="true">
        <span className="visually-hidden">{loadingPhase ? loadingMessage : segmentEnded ? endedMessage : ""}</span>
        <p className={`creation-preview-status${loadingPhase ? " is-visible" : ""}`} aria-hidden="true">
          <LoaderCircle className="creation-preview-loading-icon" aria-hidden="true" />
          <span>{loadingMessage}</span>
        </p>
        <p className={`creation-preview-status${segmentEnded ? " is-visible" : ""}`} aria-hidden="true">
          <CircleCheck aria-hidden="true" />
          <span>{endedMessage}</span>
        </p>
      </div>
      {error && <p role="alert" className="creation-preview-error">{error}</p>}
    </Modal>
  );
}
