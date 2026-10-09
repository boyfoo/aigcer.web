"use client";
import { useEffect, useRef, useState } from "react";
import { Button, Progress, Upload as UploadControl } from "antd";
import { RotateCw, Upload } from "lucide-react";
import { useAppMessage } from "./hooks/useAppMessage.jsx";
import { uploadFile } from "./lib/contentClient.js";

const uploadMessages = {
  preparing: "正在准备上传…",
  uploading: "正在上传素材…",
};

export function MediaUpload({ label, value, kind = "image", onChange, onBusyChange, disabled }) {
  const message = useAppMessage();
  const [progress, setProgress] = useState(null);
  const [uploadPhase, setUploadPhase] = useState("");
  const [failedSource, setFailedSource] = useState(null);
  const request = useRef(null), mounted = useRef(true);
  const pendingMetadata = useRef(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      pendingMetadata.current = null;
      request.current?.abort();
    };
  }, []);
  useEffect(() => {
    setFailedSource(null);
    if (pendingMetadata.current?.mediaUrl !== value) pendingMetadata.current = null;
  }, [value]);
  const failed = Boolean(value) && failedSource === value;
  const uploading = Boolean(uploadPhase);
  const previewError = failed ? "素材暂时无法加载，可重试预览或替换素材。" : "";
  const retryPreview = () => {
    setFailedSource(null);
  };
  const readUploadedMetadata = (event) => {
    const pending = pendingMetadata.current;
    const video = event.currentTarget;
    if (!mounted.current || !pending || value !== pending.mediaUrl || video.currentSrc !== pending.mediaUrl) return;
    pendingMetadata.current = null;
    onChange(value, {
      phase: "metadata",
      name: pending.name,
      duration: Number.isFinite(video.duration) ? Math.round(video.duration * 1000) / 1000 : 0,
      metadata: {
        ...(video.videoWidth && { width: video.videoWidth }),
        ...(video.videoHeight && { height: video.videoHeight }),
      },
    });
  };
  const cancelUpload = () => {
    pendingMetadata.current = null;
    request.current?.abort();
  };
  const remove = () => {
    pendingMetadata.current = null;
    onChange("", {});
  };
  const choose = async (file) => {
    if (request.current) return UploadControl.LIST_IGNORE;
    const max = kind === "image" ? 20 : 512;
    if (file.size > max * 1024 * 1024) { message.error(`文件不能超过 ${max} MB`); return UploadControl.LIST_IGNORE; }
    pendingMetadata.current = null;
    setProgress(null);
    setUploadPhase("preparing");
    onBusyChange(1);
    try {
      const uploaded = await uploadFile(file, kind, (percent) => {
        if (mounted.current) setProgress(percent);
      }, (controller) => {
        request.current = controller;
      }, (phase) => {
        if (!mounted.current) return;
        setUploadPhase(phase);
        if (phase === "uploading") setProgress(0);
      });
      if (request.current?.signal.aborted) {
        throw Object.assign(new Error("上传已取消"), { name: "AbortError" });
      }
      if (mounted.current) {
        setFailedSource(null);
        if (kind === "video") pendingMetadata.current = { mediaUrl: uploaded.mediaUrl, name: file.name };
        onChange(uploaded.mediaUrl, { name: file.name, ...(kind === "video" && { phase: "uploaded", duration: 0, metadata: {} }) });
        message.success("素材已上传到 OSS");
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
    <div className="entry-upload-preview">
      {value && !failed ? kind === "video" ? (
        <video key={value} src={value} controls preload="metadata" playsInline aria-label={`${label}预览`} onLoadedMetadata={readUploadedMetadata} onError={() => {
          if (pendingMetadata.current?.mediaUrl === value) pendingMetadata.current = null;
          setFailedSource(value);
        }} />
      ) : (
        <img src={value} alt={`${label}预览`} onError={() => setFailedSource(value)} />
      ) : (
        <span role={previewError ? "alert" : undefined}>
          {previewError || (kind === "video" ? "上传完整视频" : "上传图片")}
        </span>
      )}
    </div>
    <div className="entry-upload-actions">
      <UploadControl accept={kind === "video" ? ".mp4,.webm,video/mp4,video/webm" : ".png,.jpg,.jpeg,.webp,.gif,image/png,image/jpeg,image/webp,image/gif"} showUploadList={false} beforeUpload={choose} disabled={disabled || uploading}>
        <Button icon={<Upload />} disabled={disabled} loading={uploading}>{value ? `替换${kind === "video" ? "视频" : "图片"}` : `上传${kind === "video" ? "视频" : "图片"}`}</Button>
      </UploadControl>
      {uploading && <Button onClick={cancelUpload}>取消上传</Button>}
      {!uploading && value && previewError && <Button icon={<RotateCw />} disabled={disabled} onClick={retryPreview}>重试预览</Button>}
      {!uploading && value && <Button type="text" disabled={disabled} onClick={remove}>移除</Button>}
    </div>
    {uploading && <span role="status">{uploadMessages[uploadPhase]}</span>}
    {uploadPhase === "uploading" && progress !== null && <Progress percent={progress} status="active" />}
    <small>{kind === "video" ? "MP4 / WebM，单个不超过 512 MB；视频加载后自动读取时长。" : "PNG / JPG / WebP / GIF，单张不超过 20 MB。"}</small>
  </div></div>;
}
