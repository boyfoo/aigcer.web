import { useId } from "react";
import { getShotAnnotation } from "./lib/shotPresentation.js";

export function ShotAnnotations({ shot, mode }) {
  const markerId = `annotation-arrow-${useId().replace(/:/g, "")}`;
  const data = getShotAnnotation(shot);
  const fixed = data.path.every(([x, y]) => x === data.path[0][0] && y === data.path[0][1]);
  const [sourceX, sourceY, targetX, targetY] = data.light;
  return <div className={`shot-annotation-layer annotation-${mode}`} aria-hidden="true">
    <svg viewBox="0 0 100 100" preserveAspectRatio="none">
      <defs><marker id={markerId} markerWidth="5" markerHeight="5" refX="4" refY="2.5" orient="auto-start-reverse"><path d="M 0 0 L 5 2.5 L 0 5 z" fill="currentColor" /></marker></defs>
      {mode === "composition" && <g>{data.lines.map((line, index) => <line key={index} x1={line[0]} y1={line[1]} x2={line[2]} y2={line[3]} />)}<circle cx={data.point[0]} cy={data.point[1]} r="3" /><circle cx={data.point[0]} cy={data.point[1]} r="1" fill="currentColor" /></g>}
      {mode === "lighting" && <g><polygon className="annotation-light-cone" points={`${sourceX},${sourceY} ${targetX - 17},${targetY + 12} ${targetX + 17},${targetY + 12}`} /><circle cx={sourceX} cy={sourceY} r="4" /><line x1={sourceX} y1={sourceY} x2={targetX} y2={targetY} markerEnd={`url(#${markerId})`} /></g>}
      {mode === "movement" && <g>{fixed ? <><rect x="32" y="30" width="36" height="40" rx="2" /><line x1="45" y1="50" x2="55" y2="50" /><line x1="50" y1="45" x2="50" y2="55" /></> : <><polyline points={data.path.map((point) => point.join(",")).join(" ")} markerEnd={`url(#${markerId})`} /><circle cx={data.path[0][0]} cy={data.path[0][1]} r="2" /></>}</g>}
    </svg>
    <span className="annotation-caption">{mode === "composition" ? data.label : mode === "lighting" ? "主光方向" : fixed ? "固定机位" : "镜头运动方向"}</span>
    <span className="annotation-sample-label">示意标注</span>
  </div>;
}
