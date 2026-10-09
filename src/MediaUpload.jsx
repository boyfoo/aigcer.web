"use client";
import { useEffect, useRef, useState } from "react";
import { Button, Progress, Upload as UploadControl } from "antd";
import { RotateCw, Upload } from "lucide-react";
import { useAppMessage } from "./hooks/useAppMessage.jsx";
import { useMediaAccess } from "./hooks/useMediaAccess.js";
import { uploadFile } from "./lib/contentClient.js";

const uploadMessages = {
  preparing: "正在准备上传…",
  uploading: "正在上传素材…",
  confirming: "正在确认素材…",
};

const videoMetadata = (file) => new Promise((resolve) => {
  const video = document.createElement("video"), url = URL.createObjectURL(file);
  let settled = false;
  const done = () => {
    if (settled) return; settled = true;
    clearTimeout(timer); URL.revokeObjectURL(url);
    resolve({ duration: Number.isFinite(video.duration) ? Math.round(video.duration * 1000) / 1000 : 0, metadata: { ...(video.videoWidth && { width: video.videoWidth }), ...(video.videoHeight && { height: video.videoHeight }) } });
    video.removeAttribute("src"); video.load();
  };
  const timer = setTimeout(done, 5000);
  video.preload = "metadata"; video.onloadedmetadata = done; video.onerror = done; video.src = url;
});

export function MediaUpload({ label, value, kind = "image", onChange, onBusyChange, disabled }) {
  const message = useAppMessage();
  const access = useMediaAccess(value);
  const [progress, setProgress] = useState(null);
  const [uploadPhase, setUploadPhase] = useState("");
  const [failedSource, setFailedSource] = useState(null);
  const request = useRef(null), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; request.current?.abort(); }; }, []);
  useEffect(() => { setFailedSource(null); }, [value]);
  const failed = Boolean(access.url) && failedSource === access.url;
  const expired = access.expiresAt && Date.parse(access.expiresAt) <= Date.now();
  const uploading = Boolean(uploadPhase);
  let previewError = access.error;
  if (failed && !previewError) {
    previewError = expired ? "预览地址已过期，请重新获取。" : "素材暂时无法加载，可重试预览或替换素材。";
  }
  const retryPreview = () => {
    setFailedSource(null);
    access.retry();
  };
  const choose = async (file) => {
    if (request.current) return UploadControl.LIST_IGNORE;
    const max = kind === "image" ? 20 : 512;
    if (file.size > max * 1024 * 1024) { message.error(`文件不能超过 ${max} MB`); return UploadControl.LIST_IGNORE; }
    setProgress(null);
    setUploadPhase("preparing");
    onBusyChange(1);
    try {
      const [uploaded, info] = await Promise.all([
        uploadFile(file, kind, (percent) => {
          if (mounted.current) setProgress(percent);
        }, (controller) => {
          request.current = controller;
        }, (phase) => {
          if (!mounted.current) return;
          setUploadPhase(phase);
          if (phase === "uploading") setProgress(0);
        }),
        kind === "video" ? videoMetadata(file) : Promise.resolve({}),
      ]);
      if (request.current?.signal.aborted) {
        throw Object.assign(new Error("上传已取消"), { name: "AbortError" });
      }
      if (mounted.current) {
        setFailedSource(null);
        access.acceptUpload(uploaded);
        onChange(uploaded.mediaUrl, { name: file.name, ...info });
        message.success(uploaded.expiresAt ? "素材已上传到 OSS" : "素材已上传");
      }
    } catch (error) {
      if (mounted.current) {
        if (error.name === "AbortError") message.info("上传已取消，当前资料已保留。");
        else message.error(error.message);
      }
    } finally {
      request.current = null;
      onBusyChange(-1);
      if (mounted.current) {
        setProgress(null);
        setUploadPhase("");
      }
    }
    return UploadControl.LIST_IGNORE;
  };
  return <div className="entry-field"><div className="entry-field-label">{label}</div><div className={`entry-upload ${kind === "video" ? "is-video" : ""}`}>
    <div className="entry-upload-preview" aria-busy={access.loading}>
      {access.url && !failed ? kind === "video" ? (
        <video src={access.url} controls preload="metadata" playsInline aria-label={`${label}预览`} onError={() => setFailedSource(access.url)} />
      ) : (
        <img src={access.url} alt={`${label}预览`} onError={() => setFailedSource(access.url)} />
      ) : (
        <span role={previewError ? "alert" : value ? "status" : undefined}>
          {previewError || (value ? "正在读取素材预览…" : kind === "video" ? "上传完整视频" : "上传图片")}
        </span>
      )}
    </div>
    <div className="entry-upload-actions">
      <UploadControl accept={kind === "video" ? ".mp4,.webm,video/mp4,video/webm" : ".png,.jpg,.jpeg,.webp,.gif,image/png,image/jpeg,image/webp,image/gif"} showUploadList={false} beforeUpload={choose} disabled={disabled || uploading}>
        <Button icon={<Upload />} disabled={disabled} loading={uploading}>{value ? `替换${kind === "video" ? "视频" : "图片"}` : `上传${kind === "video" ? "视频" : "图片"}`}</Button>
      </UploadControl>
      {uploading && <Button onClick={() => request.current?.abort()}>取消上传</Button>}
      {!uploading && value && previewError && <Button icon={<RotateCw />} disabled={disabled || access.loading} onClick={retryPreview}>{expired || access.error ? "重新获取预览" : "重试预览"}</Button>}
      {!uploading && value && <Button type="text" disabled={disabled} onClick={() => onChange("", {})}>移除</Button>}
    </div>
    {uploading && <span role="status">{uploadMessages[uploadPhase]}</span>}
    {uploadPhase === "uploading" && progress !== null && <Progress percent={progress} status="active" />}
    <small>{kind === "video" ? "MP4 / WebM，单个不超过 512 MB；上传后自动读取时长。" : "PNG / JPG / WebP / GIF，单张不超过 20 MB。"}</small>
  </div></div>;
}
