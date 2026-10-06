import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button, Modal } from "antd";
import { RotateCcw } from "lucide-react";
import { formatVideoTime } from "./lib/videoTimeline.js";

export function CreationClipPreview({ reference, onClose }) {
  const videoRef = useRef(null);
  const [error, setError] = useState("");
  const start = reference.shot?.start ?? 0;
  const end = reference.shot?.end ?? reference.item.video.durationSeconds;

  useEffect(() => {
    const video = videoRef.current;
    return () => video?.pause();
  }, []);

  const playSegment = () => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = start;
    video.play().catch(() => setError("自动播放未开始，请使用视频播放按钮。"));
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
        onLoadedMetadata={playSegment}
        onPlay={() => {
          const video = videoRef.current;
          if (video.currentTime < start || video.currentTime >= end) video.currentTime = start;
        }}
        onSeeking={() => {
          const video = videoRef.current;
          if (video.currentTime < start) video.currentTime = start;
          else if (end > start && video.currentTime > end) video.currentTime = end;
        }}
        onTimeUpdate={() => {
          const video = videoRef.current;
          if (!video.paused && end > start && video.currentTime >= end) {
            video.pause();
            video.currentTime = end;
          }
        }}
        onError={() => setError("视频暂时无法播放，请打开案例检查原素材。")}
      />
      {error && <p role="alert" className="creation-preview-error">{error}</p>}
    </Modal>
  );
}
