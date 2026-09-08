## 沟通与适用范围

- 统一使用中文进行交流、说明和交付。

## 技术栈与代码位置

- 项目使用 React 19、Vite 6 和 Ant Design 6。
- 应用代码放在 `src/`，静态资源放在 `public/`。
- 优先复用现有组件、数据结构和主题变量，避免重复实现或无必要地新增依赖。

## Node.js 与 npm 版本选择

- 本机通过 nvm 管理多个 Node.js 版本。运行命令前先检查当前版本、项目版本约束和 nvm 已安装版本；当前版本偏旧或不兼容时，选择已安装且符合项目要求的较新版本，不盲目选择最高版本。
- 只调整当前 PowerShell 进程的 `PATH`，让当前终端及其后续启动的子进程使用所选版本。Node.js 与 npm 必须来自同一个版本目录。
- 不执行 `nvm use`，不修改 nvm 的共享版本链接、用户或系统级环境变量、全局默认版本或 PowerShell 启动配置，避免影响其他终端和项目。
- 每个独立启动的命令行进程都需要重新设置并验证；使用执行工具时，将临时切换与后续构建命令放在同一次调用中。不要假设上一次调用修改的 `PATH` 会自动保留。
- npm 不可用时，先检查所选 nvm 版本目录中的 `npm.cmd`，不要仅为运行项目脚本改用其他包管理器或生成另一种锁文件。

在 PowerShell 中先查看当前命令来源与可选版本：

```powershell
Get-Command node.exe, npm.cmd -All -ErrorAction SilentlyContinue | Select-Object Name, Source
if (Get-Command node.exe -ErrorAction SilentlyContinue) { node.exe --version }

$webNvmRoot = $env:NVM_HOME
if (-not $webNvmRoot) { throw '当前进程未设置 NVM_HOME，需先确认 nvm 安装目录' }
Get-ChildItem -LiteralPath $webNvmRoot -Directory |
  Where-Object Name -Match '^v\d+\.\d+\.\d+$' |
  Sort-Object { [version]$_.Name.Substring(1) } -Descending |
  Select-Object -ExpandProperty Name
```

将下面的 `vX.Y.Z` 替换为列表中已确认符合项目要求的完整版本目录名，然后在 `web/` 目录、同一个 PowerShell 进程中执行：

```powershell
$webNodeVersion = 'vX.Y.Z'
$webNodeDir = Join-Path $env:NVM_HOME $webNodeVersion
$webNodeExe = Join-Path $webNodeDir 'node.exe'
$webNpmCmd = Join-Path $webNodeDir 'npm.cmd'
if (-not (Test-Path -LiteralPath $webNodeExe) -or -not (Test-Path -LiteralPath $webNpmCmd)) {
  throw '所选版本目录缺少 node.exe 或 npm.cmd，请重新选择完整的已安装版本'
}

$webPreviousPath = $env:PATH
$env:PATH = "$webNodeDir;$webPreviousPath"
Get-Command node.exe, npm.cmd | Select-Object Name, Source
& $webNodeExe --version
& $webNpmCmd --version
& $webNpmCmd run build
```

后续命令继续使用 `& $webNpmCmd run dev`、`& $webNpmCmd run test:sites` 等，确保使用所选版本配套的 npm。关闭当前终端即可结束临时切换；如需在同一终端恢复，执行 `$env:PATH = $webPreviousPath`。

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
- 全站只维护一套固定主题，首页、设置页、弹窗、抽屉和字体对比页共用相同的设计变量与组件样式。
- 保留既有布局、精选文案和案例图片，统一使用深色背景与黄色强调色。
- For screenshot restoration, measure and compare at 1488 × 1058 before changing CSS; do not invent typography, spacing, imagery, or visible controls that are absent from the approved references.
- Preserve the selected reference's Chinese editorial character, serif display typography, left taxonomy, prominent search, and asymmetric featured-image composition.
- 选中态与交互强调色使用 `#FCD535`，黄色实心按钮搭配深色文字以保证对比度。
- Let the desktop shell, top bar, and page grid use the full viewport width; keep the internal search and storyboard maximum widths so imagery does not stretch on ultrawide screens.
- Keep vertical scrolling on the document root only; horizontal clipping on the app shell must use `overflow-x: clip` so it does not create a second vertical scroll container.
- Use a single thin, low-contrast document scrollbar with a hover state matching the accent.
- 桌面主标题以 48px 为上限，行高 1.2，标题下方间距为 28px；在窄屏继续缩小，保持搜索和镜头内容为页面重点。
- Do not treat the current Noto Serif SC rendering as the final typography choice: the user finds its Song-style character unsuitable. Use the real-font comparison page at `/font-test.html` and wait for a selected candidate before finalizing the hero and featured-card text families.
- Let prompt copy wrap naturally from the available width; do not insert manual line breaks to imitate one screenshot.

Build app UI in `src/`. Keep `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, and `tests/sites-worker.test.mjs` intact so the same local prototype can be handed to Sites. Before a Sites handoff, run `npm run build` and `npm run test:sites`; the build must leave `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.
