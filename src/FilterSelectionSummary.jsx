"use client";

import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import "./filter-selection-summary.css";

const duration = 140;
const labelFor = (count) => count > 0 ? `已选 ${count}` : "不限";

export function FilterSelectionSummary({ count, animate }) {
  const incomingRowRef = useRef(null);
  const incomingNumberRef = useRef(null);
  const outgoingRowRef = useRef(null);
  const outgoingLabelRef = useRef(null);
  const outgoingNumberRef = useRef(null);
  const previousCountRef = useRef(count);
  const transitionRef = useRef(null);
  const reducedMotionRef = useRef(null);

  const settle = useCallback(() => {
    const transition = transitionRef.current;
    transitionRef.current = null;
    if (transition) {
      transition.incomingAnimation.onfinish = null;
      transition.incomingAnimation.cancel();
      transition.outgoingAnimation.cancel();
    }
    if (outgoingRowRef.current) outgoingRowRef.current.style.display = "none";
  }, []);

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    reducedMotionRef.current = preference;
    preference.addEventListener("change", settle);
    return () => {
      preference.removeEventListener("change", settle);
      settle();
    };
  }, [settle]);

  useLayoutEffect(() => {
    const previousCount = previousCountRef.current;
    previousCountRef.current = count;
    const reduced = reducedMotionRef.current?.matches
      ?? window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (count === previousCount) {
      if (!animate || reduced) settle();
      return;
    }

    let sourceCount = previousCount;
    let sourceTransform = "translateY(0%)";
    let sourceOpacity = 1;
    const current = transitionRef.current;
    if (current) {
      const incomingStyle = window.getComputedStyle(current.incomingTarget);
      const outgoingStyle = window.getComputedStyle(current.outgoingTarget);
      const incomingOpacity = Number(incomingStyle.opacity);
      const outgoingOpacity = Number(outgoingStyle.opacity);
      const sourceStyle = incomingOpacity >= outgoingOpacity ? incomingStyle : outgoingStyle;
      sourceCount = incomingOpacity >= outgoingOpacity ? current.count : current.sourceCount;
      sourceTransform = sourceStyle.transform;
      sourceOpacity = Number(sourceStyle.opacity);
    }
    settle();

    const incomingRow = incomingRowRef.current;
    const outgoingRow = outgoingRowRef.current;
    if (!animate || reduced || sourceCount === count || typeof incomingRow.animate !== "function") return;

    const numberOnly = sourceCount > 0 && count > 0;
    const incomingTarget = numberOnly ? incomingNumberRef.current : incomingRow;
    const outgoingTarget = numberOnly ? outgoingNumberRef.current : outgoingRow;
    outgoingLabelRef.current.textContent = sourceCount > 0 ? "已选" : "不限";
    outgoingLabelRef.current.style.visibility = numberOnly ? "hidden" : "visible";
    outgoingNumberRef.current.textContent = sourceCount > 0 ? String(sourceCount) : "";
    outgoingNumberRef.current.style.display = sourceCount > 0 ? "" : "none";
    outgoingRow.style.display = "flex";

    const direction = count > previousCount ? 1 : -1;
    const options = { duration, easing: "cubic-bezier(0.23, 1, 0.32, 1)", fill: "both" };
    const outgoingAnimation = outgoingTarget.animate([
      { transform: sourceTransform, opacity: sourceOpacity },
      { transform: `translateY(${-direction * 100}%)`, opacity: 0 },
    ], options);
    const incomingAnimation = incomingTarget.animate([
      { transform: `translateY(${direction * 100}%)`, opacity: 0 },
      { transform: "translateY(0%)", opacity: 1 },
    ], options);
    transitionRef.current = {
      count,
      sourceCount,
      incomingTarget,
      outgoingTarget,
      incomingAnimation,
      outgoingAnimation,
    };
    incomingAnimation.onfinish = settle;
  }, [count, animate, settle]);

  const active = count > 0;
  return <span
    className="filter-selection-summary"
    style={{ "--filter-selection-number-width": `${Math.max(3, String(count).length)}ch` }}
  >
    <span className="filter-selection-summary-accessible">{labelFor(count)}</span>
    <span className="filter-selection-summary-visual" aria-hidden="true">
      <span className="filter-selection-summary-row is-outgoing" ref={outgoingRowRef}>
        <span ref={outgoingLabelRef} />
        <span className="filter-selection-summary-number" ref={outgoingNumberRef} />
      </span>
      <span className="filter-selection-summary-row" ref={incomingRowRef}>
        <span>{active ? "已选" : "不限"}</span>
        <span
          className="filter-selection-summary-number"
          ref={incomingNumberRef}
          style={{ display: active ? undefined : "none" }}
        >{active ? count : ""}</span>
      </span>
    </span>
  </span>;
}
