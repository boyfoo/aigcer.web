import { useState } from "react";
import Link from "next/link";
import { CirclePlay } from "lucide-react";
import { CaseCover } from "./CaseCover.jsx";
import { CreationClipPreview } from "./CreationClipPreview.jsx";
import { getReferenceTagValues } from "./lib/creationReferences.js";
import { formatVideoTime } from "./lib/videoTimeline.js";
import "./creation-reference.css";

export function CreationReferenceResults({ references, groups, showPrompts }) {
  const [preview, setPreview] = useState(null);

  return (
    <>
      <section className="case-results-masonry" aria-label="镜头参考结果">
        {references.map((reference) => {
          const labels = groups.flatMap((group) => group.options
            .filter((option) => getReferenceTagValues(reference, group.id).includes(option.value))
            .map((option) => option.label));
          const prompt = reference.shot
            ? reference.shot.videoPrompt || reference.shot.imagePrompt
            : reference.item.prompt;
          return (
            <article className="browse-case creation-reference" key={reference.id} data-reference-id={reference.id}>
              <div className="browse-case-image">
                <Link href={reference.href} aria-label={`查看${reference.kind === "shot" ? "镜头" : "参考"}：${reference.title}`}>
                  <CaseCover src={reference.image} />
                </Link>
                <span className="duration-badge">
                  {reference.kind === "shot" ? `镜头 ${String(reference.index + 1).padStart(2, "0")} · ${formatVideoTime(reference.duration)}` : reference.kind === "video" ? "整片 · 未拆解" : "分镜画面"}
                </span>
                {reference.item.video?.src && (
                  <button className="creation-preview-button" type="button" aria-label={`预览：${reference.title}`} onClick={() => setPreview(reference)}>
                    <CirclePlay aria-hidden="true" />预览
                  </button>
                )}
              </div>
              <Link className="creation-reference-body" href={reference.href}>
                <h2>{reference.title}</h2>
                {reference.shot && <p className="creation-reference-source">{reference.item.title} · {formatVideoTime(reference.shot.start)}–{formatVideoTime(reference.shot.end)}</p>}
                {reference.description && <p className="creation-reference-description">{reference.description}</p>}
                {reference.isMock && <p className="creation-reference-note">示例拆解</p>}
                {reference.imageFallback && <p className="creation-reference-note">代表画面未录入 · 使用案例封面</p>}
                {labels.length > 0 && <p className="creation-reference-tags">{[...new Set(labels)].slice(0, 5).join(" · ")}</p>}
                {showPrompts && <p className="browse-prompt-excerpt">{prompt || "暂未录入提示词"}</p>}
              </Link>
            </article>
          );
        })}
      </section>
      {preview && <CreationClipPreview key={preview.id} reference={preview} onClose={() => setPreview(null)} />}
    </>
  );
}
