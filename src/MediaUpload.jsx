"use client";
import { useEffect, useRef, useState } from "react";
import { App, Button, Progress, Upload } from "antd";
import { UploadOutlined } from "@ant-design/icons";

export function uploadFile(file, kind, onProgress = () => {}, onRequest = () => {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    onRequest(xhr);
    xhr.open("POST", `/api/uploads?kind=${kind}&name=${encodeURIComponent(file.name || "image.png")}`);
    xhr.timeout = 10 * 60 * 1000;
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.upload.onprogress = (event) => { if (event.lengthComputable) onProgress(Math.round(event.loaded / event.total * 100)); };
    xhr.onload = () => {
      let result; try { result = JSON.parse(xhr.responseText); } catch { result = {}; }
      if (xhr.status >= 200 && xhr.status < 300) resolve(result);
      else reject(new Error(result.error || "上传失败，请重试"));
    };
    xhr.onerror = () => reject(new Error("上传中断，请检查网络后重新选择文件"));
    xhr.ontimeout = () => reject(new Error("上传超时，请重试或选择较小的文件"));
    xhr.onabort = () => reject(new Error("上传已取消"));
    xhr.send(file);
  });
}

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
  const { message } = App.useApp();
  const [progress, setProgress] = useState(null);
  const [failed, setFailed] = useState(false);
  const request = useRef(null), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; request.current?.abort(); }; }, []);
  useEffect(() => setFailed(false), [value]);
  const choose = async (file) => {
    const max = kind === "image" ? 20 : 512;
    if (file.size > max * 1024 * 1024) { message.error(`文件不能超过 ${max} MB`); return Upload.LIST_IGNORE; }
    setProgress(0); onBusyChange(1);
    try {
      const [uploaded, info] = await Promise.all([uploadFile(file, kind, setProgress, (xhr) => { request.current = xhr; }), kind === "video" ? videoMetadata(file) : Promise.resolve({})]);
      if (mounted.current) { onChange(uploaded.url, { name: file.name, ...info }); message.success("素材已上传到网站"); }
    } catch (error) { if (mounted.current) message.error(error.message); }
    finally { request.current = null; onBusyChange(-1); if (mounted.current) setProgress(null); }
    return Upload.LIST_IGNORE;
  };
  return <div className="entry-field"><div className="entry-field-label">{label}</div><div className={`entry-upload ${kind === "video" ? "is-video" : ""}`}>
    <div className="entry-upload-preview">{value && !failed ? kind === "video" ? <video src={value} controls preload="metadata" playsInline aria-label={`${label}预览`} onError={() => setFailed(true)} /> : <img src={value} alt={`${label}预览`} onError={() => setFailed(true)} /> : <span>{failed ? "素材暂时无法加载，可重新上传" : kind === "video" ? "上传完整视频" : "上传图片"}</span>}</div>
    <div className="entry-upload-actions"><Upload accept={kind === "video" ? ".mp4,.webm,video/mp4,video/webm" : ".png,.jpg,.jpeg,.webp,.gif,image/png,image/jpeg,image/webp,image/gif"} showUploadList={false} beforeUpload={choose} disabled={disabled || progress !== null}><Button icon={<UploadOutlined />} disabled={disabled} loading={progress !== null}>{value ? `替换${kind === "video" ? "视频" : "图片"}` : `上传${kind === "video" ? "视频" : "图片"}`}</Button></Upload>{value && <Button type="text" disabled={disabled || progress !== null} onClick={() => onChange("", {})}>移除</Button>}</div>
    {progress !== null && <Progress percent={progress} status="active" />}
    <small>{kind === "video" ? "MP4 / WebM，单个不超过 512 MB；上传后自动读取时长。" : "PNG / JPG / WebP / GIF，单张不超过 20 MB。"}</small>
  </div></div>;
}
