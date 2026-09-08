import { createRoot } from "react-dom/client";
import "@fontsource-variable/noto-sans-sc/wght.css";
import "@fontsource-variable/noto-serif-sc/wght.css";
import "@fontsource/zcool-xiaowei";
import { storyboardItems } from "./data.js";
import "./styles.css";
import "./font-test.css";

const sampleItem = storyboardItems[0];

const candidates = [
  {
    key: "noto-sans",
    name: "思源黑体",
    meta: "Noto Sans SC · 现代、克制",
    family: '"Noto Sans SC Variable", sans-serif',
    titleWeight: 500,
  },
  {
    key: "yahei",
    name: "微软雅黑",
    meta: "Microsoft YaHei · 清晰、偏 UI",
    family: '"Microsoft YaHei", sans-serif',
    titleWeight: 400,
  },
  {
    key: "zcool",
    name: "站酷小薇体",
    meta: "ZCOOL XiaoWei · 文艺、轻复古",
    family: '"ZCOOL XiaoWei", serif',
    titleWeight: 400,
  },
  {
    key: "kaiti",
    name: "楷体",
    meta: "KaiTi · 手写感、温润",
    family: 'KaiTi, "STKaiti", serif',
    titleWeight: 400,
  },
  {
    key: "fangsong",
    name: "仿宋",
    meta: "FangSong · 编辑感、细长",
    family: 'FangSong, "STFangsong", serif',
    titleWeight: 400,
  },
  {
    key: "noto-serif",
    name: "思源宋体（当前基准）",
    meta: "Noto Serif SC · 古典、正式",
    family: '"Noto Serif SC Variable", serif',
    titleWeight: 500,
  },
];

function Title() {
  return (
    <>
      为下一个镜头，找到它的<span>情绪</span>
    </>
  );
}

function DetailPreview({ candidate }) {
  return (
    <div className="detail-preview" style={{ "--candidate-font": candidate.family }}>
      <p className="sample-description">
        {sampleItem.description}
      </p>
      <div className="sample-tags" aria-label="标签示例">
        {sampleItem.tags.map((tag) => <span key={tag}>{tag}</span>)}
      </div>
      <div className="sample-prompt">
        <strong>提示词</strong>
        <p>
          {sampleItem.prompt}
        </p>
      </div>
      <div className="sample-actions">
        <span>查看完整提示词</span>
        <span>收藏参考</span>
      </div>
    </div>
  );
}

function FontTest() {
  return (
    <main>
      <header className="page-heading">
        <div>
          <p className="eyebrow">镜界 · 字体实机对比</p>
          <h1>同一句话，直接看字形差异</h1>
          <p className="intro">每组都用同一套主标题和下方内容结构渲染，标签保持黑体，避免变量太多。</p>
        </div>
        <a href="/">返回当前页面</a>
      </header>

      <div className="candidate-list">
        {candidates.map((candidate, index) => (
          <section className="candidate" key={candidate.key}>
            <div className="candidate-heading">
              <span className="candidate-number">{String(index + 1).padStart(2, "0")}</span>
              <div>
                <h2>{candidate.name}</h2>
                <p>{candidate.meta}</p>
              </div>
            </div>
            <div
              className="candidate-title"
              style={{ fontFamily: candidate.family, fontWeight: candidate.titleWeight }}
            >
              <Title />
            </div>
            <DetailPreview candidate={candidate} />
          </section>
        ))}
      </div>
    </main>
  );
}

const rootElement = document.getElementById("font-test-root");
window.__jingjieFontTestRoot ??= createRoot(rootElement);
window.__jingjieFontTestRoot.render(<FontTest />);
