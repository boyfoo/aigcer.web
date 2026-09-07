## 沟通与适用范围

- 统一使用中文进行交流、说明和交付。

## 技术栈与代码位置

- 项目使用 React 19、Vite 6 和 Ant Design 6。
- 应用代码放在 `src/`，静态资源放在 `public/`。
- 优先复用现有组件、数据结构和主题变量，避免重复实现或无必要地新增依赖。

## 常用命令与验证

在 `web/` 目录运行：

```bash
npm run dev
npm run build
npm run test:sites
```

- 修改前端代码后至少运行 `npm run build`。
- 涉及 Sites 构建、部署配置或 Worker 时，同时运行 `npm run test:sites`。
- 不得在源码中写入密钥、令牌、密码或其他敏感信息。

# Prototype Instructions

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

## Product-specific design decisions

- 个人中心的“设置”提供一级、二级标签管理，一级标签对应左侧菜单分组，二级标签对应筛选项；当前使用 mock 初始数据，配置保存到当前浏览器，保存后同步桌面侧栏与移动端筛选菜单。
- 设置使用独立页面（`/settings`），不使用侧边抽屉；页面提供返回入口，保存后停留在设置页。
- Keep the interface visually calm even when the filtering model is rich: one strong focal image, clear supporting imagery, generous whitespace, and no dashboard-style card clutter.
- Ship one shared component/layout system with two themes: `celadon` for the light daytime experience and `midnight` for the dark nighttime experience.
- Treat the approved light and dark screenshots as two distinct source-of-truth states: they share the same layout system, but each theme has its own curated copy, active-label presentation, and complete image set.
- For screenshot restoration, measure and compare at 1488 × 1058 before changing CSS; do not invent typography, spacing, imagery, or visible controls that are absent from the approved references.
- Preserve the selected references' Chinese editorial character, serif display typography, warm vermilion accent in the light theme, left taxonomy, prominent search, and asymmetric featured-image composition.
- 夜晚模式的选中态与交互强调色使用 `#FCD535`，黄色实心按钮搭配深色文字以保证对比度；白天模式保留原有朱红色。
- The light-theme torn paper edge must remain visibly continuous from the top of the viewport to the bottom, protruding farther into the header before receding to the sidebar width.
- Light-theme text uses a deep green-black ink color rather than a washed-out gray-green.
- Let the desktop shell, top bar, and page grid use the full viewport width; keep the internal search and storyboard maximum widths so imagery does not stretch on ultrawide screens.
- Keep vertical scrolling on the document root only; horizontal clipping on the app shell must use `overflow-x: clip` so it does not create a second vertical scroll container.
- Derive the light-theme paper background from the approved reference image; keep the sidebar only subtly darker than the main page and do not invent a heavier paper treatment.
- Use one uniform, reference-derived seamless main-paper texture across the entire light-theme viewport at every width; never switch background assets at the 1488px reference boundary.
- Layer only a transparent left overlay containing the subtly darker sidebar paper, continuous torn edge, and selected storyboard-to-film decoration above that uniform base; the overlay remains about 420px wide and is transparent beyond the natural paper edge and decorative artwork.
- 白日模式侧栏使用用户选定的第三张“分镜到成片”设计替换竹叶：上方是窗边人物的铅笔分镜，中间保留细箭头与机位草图，下方是同构图的褪色胶片印样。图案略缩小、胶片适度淡化，保留原纸色、连续撕边与留白；不要将设计稿中的横线或播放按钮烘焙进装饰图。
- Keep the main paper near RGB `242, 240, 229`; avoid the yellower, heavier RGB `244, 240, 226` treatment and keep paper fibers low-contrast.
- Use a single thin, low-contrast document scrollbar with a hover state matching the current theme's accent.
- Match the approved light search control as one 1044×68px rounded outer shell with an inset 163×53px vermilion button and roughly 7px internal breathing room.
- Light-theme sidebar option text should remain legible at 14px; section headings use 19px serif type.
- 桌面主标题以 48px 为上限，行高 1.2，标题下方间距为 28px；在窄屏继续缩小，保持搜索和镜头内容为页面重点。
- Do not treat the current Noto Serif SC rendering as the final typography choice: the user finds its Song-style character unsuitable. Use the real-font comparison page at `/font-test.html` and wait for a selected candidate before finalizing the hero and featured-card text families.
- Let prompt copy wrap naturally from the available width; do not insert manual line breaks to imitate one screenshot.

Build app UI in `src/`. Keep `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, and `tests/sites-worker.test.mjs` intact so the same local prototype can be handed to Sites. Before a Sites handoff, run `npm run build` and `npm run test:sites`; the build must leave `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.
