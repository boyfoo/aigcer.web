import { createRoot } from "react-dom/client";
import "@fontsource-variable/noto-serif-sc/wght.css";
import "@fontsource/zcool-xiaowei";
import "@fontsource/ma-shan-zheng";
import "./font-test.css";

const candidates = [
  { name: "Noto Serif SC · 500", family: "Noto Serif SC Variable", weight: 500 },
  { name: "Noto Serif SC · 600", family: "Noto Serif SC Variable", weight: 600 },
  { name: "ZCOOL XiaoWei · 400", family: "ZCOOL XiaoWei", weight: 400 },
  { name: "Ma Shan Zheng · 400", family: "Ma Shan Zheng", weight: 400 },
  { name: "FangSong · 400", family: "FangSong", weight: 400 },
  { name: "SimSun · 700", family: "SimSun", weight: 700 },
];

function Title() {
  return (
    <>
      为下一个镜头，找到它的<span>情绪</span>
    </>
  );
}

function FontTest() {
  return (
    <main>
      <h1>参考图标题与候选字体（1:1 像素）</h1>
      <section className="source-row">
        <strong>参考图</strong>
        <div className="source-crop">
          <img src="/qa/reference-light.png" alt="参考图标题裁切" />
        </div>
      </section>
      {candidates.map((candidate) => (
        <section className="candidate" key={candidate.name}>
          <strong>{candidate.name}</strong>
          <div
            className="candidate-title"
            style={{ fontFamily: candidate.family, fontWeight: candidate.weight }}
          >
            <Title />
          </div>
        </section>
      ))}
      <h1 className="brand-section-title">品牌字样对照（1:1 像素）</h1>
      <section className="brand-grid">
        <div>
          <strong>参考图</strong>
          <div className="brand-source-crop">
            <img src="/qa/reference-light.png" alt="参考图品牌裁切" />
          </div>
        </div>
        {candidates.slice(0, 5).map((candidate) => (
          <div key={`brand-${candidate.name}`}>
            <strong>{candidate.name}</strong>
            <span
              className="brand-candidate"
              style={{ fontFamily: candidate.family, fontWeight: candidate.weight }}
            >
              镜界
            </span>
          </div>
        ))}
      </section>
    </main>
  );
}

createRoot(document.getElementById("font-test-root")).render(<FontTest />);
