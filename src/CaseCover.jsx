"use client";

import { useEffect, useRef, useState } from "react";
import "./case-cover.css";

export function CaseCover({ src, alt = "" }) {
  const [failedSource, setFailedSource] = useState(null);
  const failed = failedSource === src;
  const rootRef = useRef(null);
  const imageRef = useRef(null);
  const motionRef = useRef(null);
  const frameRef = useRef(0);
  const pointRef = useRef(null);

  const stop = () => {
    cancelAnimationFrame(frameRef.current);
    frameRef.current = 0;
    pointRef.current = null;
    rootRef.current?.removeAttribute("data-pointer-active");
  };

  useEffect(() => {
    // A failed server-rendered image can finish before React attaches its error handler.
    const image = imageRef.current;
    if (!image) return;
    const imageFailed = image.complete && image.naturalWidth === 0;
    if (imageFailed) stop();
    setFailedSource(imageFailed ? src : null);
  }, [src]);

  useEffect(() => {
    const motion = window.matchMedia("(prefers-reduced-motion: no-preference) and (hover: hover) and (pointer: fine)");
    motionRef.current = motion;
    const onChange = () => { if (!motion.matches) stop(); };
    motion.addEventListener("change", onChange);
    window.addEventListener("blur", stop);
    return () => {
      motion.removeEventListener("change", onChange);
      window.removeEventListener("blur", stop);
      stop();
    };
  }, []);

  const updateLight = () => {
    frameRef.current = 0;
    const point = pointRef.current;
    if (!point || !rootRef.current) return;
    const bounds = rootRef.current.getBoundingClientRect();
    if (!bounds.width || !bounds.height) {
      stop();
      return;
    }
    rootRef.current.style.setProperty("--cover-pointer-x", `${point.x - bounds.left}px`);
    rootRef.current.style.setProperty("--cover-pointer-y", `${point.y - bounds.top}px`);
    rootRef.current.setAttribute("data-pointer-active", "true");
  };

  const move = (event) => {
    if (event.pointerType !== "mouse" || !motionRef.current?.matches) return;
    pointRef.current = { x: event.clientX, y: event.clientY };
    if (!frameRef.current) frameRef.current = requestAnimationFrame(updateLight);
  };

  const fail = () => {
    stop();
    setFailedSource(src);
  };

  return <span className={`case-cover${failed ? " has-error" : ""}`} ref={rootRef} onPointerMove={move} onPointerLeave={stop}>
    {failed ? <span className="case-cover-error">封面加载失败</span> : <img ref={imageRef} src={src} alt={alt} onError={fail} />}
  </span>;
}
