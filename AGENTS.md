## 沟通与适用范围

- 统一使用中文进行交流、说明和交付。

## 技术栈与代码位置

- 项目使用 Next.js 16 App Router、React 19 和 Ant Design 6。
- 应用代码放在 `src/`，路由放在 `src/app/`，静态资源放在 `public/`。
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

## 命令交互、超时与终止

- 执行前确定截止时间：普通查询默认 30 秒，构建和测试默认 60 秒，依赖安装等网络操作默认 180 秒。确实需要更长时间时，在启动前说明理由并设置明确上限，不在超时后反复延长等待。
- 可能长时间运行的命令应尽快返回可交互会话：调用 `exec_command` 时请求短等待（如 `yield_time_ms: 1000`，实际返回时间受平台最小等待限制），需要发送 Ctrl+C 时使用 `tty: true`，保存返回的 `session_id`，随后用 `write_stdin` 获取增量输出。
- `yield_time_ms` 只控制本次工具等待多久，不是命令的硬超时，也不会自动杀死进程。对长命令应设置独立于轮询的进程级超时监控，或使用执行器提供的真正超时参数。
- 每隔约 10 秒检查一次输出与状态；连续约 20 秒没有新输出时，检查是否等待输入、下载、权限或已经卡住。不要机械重复等待；有进展可继续到预设截止时间，没有进展则及时中断并诊断。单次阻塞等待不超过 30 秒，工作期间每 60 秒内向用户说明一次当前状态。
- 用户询问耗时时，先立即说明正在执行的具体命令、已等待时间和最近进展，再检查或终止；不要让用户的问题继续排在长时间等待之后。
- 到达截止时间后，先通过 `write_stdin` 向本次 PTY 会话发送 Ctrl+C（`chars: "\u0003"`），最多等待 5 秒确认退出。不能交互或未退出时，根据启动时记录的 PID 强制终止本次命令的进程树。
- Windows 强制终止使用 `taskkill.exe /PID <本次命令的PID> /T /F`；PID 必须来自本次启动记录，终止前确认进程仍属于该命令。禁止按进程名称批量结束 `node.exe`、npm 或 PowerShell，也不要终止其他项目的服务。
- 使用 PowerShell 自行管理超时进程时，以 `Start-Process -PassThru -WindowStyle Hidden` 启动并记录进程对象与 PID，将输出写入项目忽略的临时日志；循环采用约 1 秒的短等待检查截止时间，超时后终止该进程树。不得使用一次长时间的 `Wait-Process` 或无期限 `-Wait` 代替超时监控。
- 停止等待工具或取消外层工具调用，不代表底层进程已经结束；必须核对退出状态并清理本次启动的子进程。保存最后的错误输出、耗时和超时原因，再调整方法；没有新线索时不重复原样重试。
- 并行执行独立命令时，结果和会话 ID 一返回就记录、输出，不要等最慢的命令结束才统一展示全部结果。
- 开发服务器按常驻服务管理：启动就绪默认等待不超过 30 秒，记录会话和本次启动的进程，确认就绪后继续工作，不等待服务器自然退出；任务结束时按预览需要清理本次启动的实例。

## 常用命令与验证

在 `web/` 目录运行：

```bash
npm run dev
npm run build
npm run build:sites
npm run test:sites
```

- 修改前端代码后至少运行 `npm run build`。
- 涉及 Sites 构建、部署配置或 Worker 时，运行 `npm run build:sites` 和 `npm run test:sites`；内容与标签逻辑检查使用 `npm test`。
- 不得在源码中写入密钥、令牌、密码或其他敏感信息。

# Prototype Instructions

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

## Product-specific design decisions

- 公开首页、案例详情与分类页由 Next.js 服务按请求读取已发布快照并渲染，正文、标题和描述必须存在于初始 HTML；案例和分类之间使用可抓取的真实链接，未知、草稿和已下架案例网址返回 404。Sites 导出为构建时的只读快照。
- 案例网址使用稳定 ID：`/cases/[slug]`；公开分类使用 `/collections/[slug]`。服务端内容通过 `src/server/repository.js` 读取，`src/data.js` 仅作为数据库首次初始化的示例数据。
- 生产域名通过构建环境的 `SITE_URL` 配置，用于 canonical、Open Graph 和 sitemap；未配置时按私有预览处理。设置页与字体对比页始终不参与搜索收录。
- 网站用于本人积累与回顾学习，也向访客公开分享。内容由本人维护；已确认当前阶段包括录入、设置在内均免登录开放，不自行增加账号或权限流程。
- 内容录入使用与标签设置一致的独立页面 `/content`，入口位于个人菜单；支持本地上传图片、视频、封面和逐镜头资料，保存后停留在当前页。图片单张上限 20 MB，视频单个上限 512 MB；视频自动读取时长，失败时允许手填。可先上传素材保存不完整草稿，再补充提示词与分析。
- 发布必须有素材，且至少填写提示词或分析中的任意一项（可填写在具体镜头中）。保存草稿和手动发布分开；编辑已发布内容时，保存不会改变公开快照，点击发布更新才生效。
- 内容状态为草稿、已发布、已下架。已发布内容可下架并保留资料，不退回草稿；允许重新上架，恢复上次公开版本，不能顺带公开待发布修改。只有从未发布的草稿可以删除。
- 内容、发布快照、标签设置及上传素材使用网站服务持久化。默认目录为 `storage/`（SQLite 与 `uploads/`），可由 `JINGJIE_DATA_DIR` 指向持久磁盘；不提交数据文件。运行需要 Node.js >=22.13。旧版浏览器内容和标签提供显式转存/载入入口，保留原始备份。
- `/case-preview?id=…` 仅用于草稿预览，公开阅读使用 `/cases/[slug]`。录入页、设置页和草稿预览始终不参与搜索收录。Sites 仅导出已发布快照及其素材，不打包数据库、未发布素材或写入接口，管理功能在普通 Next.js 服务中运行。
- 访客免登录浏览、收藏和整理项目参考集。收藏与参考集保存在当前浏览器，刷新可恢复，不提供账号或跨设备同步。
- 个人中心的“设置”提供一级、二级标签管理，一级标签对应页面菜单分组，二级标签对应筛选项；配置保存在网站，保存后同步全站菜单。每组标签允许多选，同组满足任意一个，不同组需同时满足；未选标签的分组不限制结果。
- 录入页“分类与标签”支持就地新增一级、二级标签，无需离开正在编辑的案例。新增一级标签时可一起添加首个二级标签；二级标签新增后自动选中并同步全站设置，保留当前案例的所有未保存输入及已有标签选择。
- 录入页“分镜拆解”一次最多展开一个镜头，打开其他镜头或新增镜头时自动收起原镜头；收起不清空已填写的资料。切换时保留所点击标题的屏幕位置，新增时在原按钮位置展示新镜头标题，不播放长表单的高度伸缩动画，避免收起上方内容导致视口跳动。
- 分类筛选只保留一套页面内菜单：桌面显示在左侧，窄屏直接排列在内容上方；不提供额外的“筛选”按钮或弹出筛选菜单。
- 设置使用独立页面（`/settings`），不使用侧边抽屉；页面提供返回入口，保存后停留在设置页。
- Keep the interface visually calm even when the filtering model is rich: one strong focal image, clear supporting imagery, generous whitespace, and no dashboard-style card clutter.
- 全站只维护一套固定主题，首页、设置页、弹窗、抽屉和字体对比页共用相同的设计变量与组件样式。
- 保留既有布局、精选文案和案例图片，统一使用深色背景与黄色强调色。
- For screenshot restoration, measure and compare at 1488 × 1058 before changing CSS; do not invent typography, spacing, imagery, or visible controls that are absent from the approved references.
- 保留既有左侧分类、突出搜索和非对称精选图片布局；字体采用下述已确认的无衬线方案。
- 选中态与交互强调色使用 `#FCD535`，黄色实心按钮搭配深色文字以保证对比度。
- Let the desktop shell, top bar, and page grid use the full viewport width; keep the internal search and storyboard maximum widths so imagery does not stretch on ultrawide screens.
- Keep vertical scrolling on the document root only; horizontal clipping on the app shell must use `overflow-x: clip` so it does not create a second vertical scroll container.
- 隐藏页面和组件的可见滚动条，保留滚轮、触摸与键盘滚动，不通过禁止滚动来隐藏滚动条。
- 全站不展示顶部宣传标语或大标题横幅；首页与分类页以搜索和镜头内容为重点，移除标语占位及其留白，字体对比页也不再重复该标语。案例名称、设置标题等内容与功能标题保留，首页和分类页使用不占视觉空间的语义标题供辅助技术识别。
- 分类页不展示搜索框上方的介绍文字，不保留其占位或间距；分类描述继续用于页面的 SEO 元数据。
- 已确认字体方案：参考 OpenAI 的排版比例，全站产品界面统一使用已有的 `Noto Sans SC Variable`（思源黑体），备用为 `PingFang SC`、`Microsoft YaHei` 和 `sans-serif`。正文 400、标题以 500 为主；中文正文字距为 0，标题仅轻微收紧；长文 16–17px、行高约 28–30px、阅读宽度上限 640px、段距 24px。保留深色背景与黄色强调色，不引入 OpenAI Sans 或恢复宋体界面。`/font-test.html` 保留其他字体作对比，思源黑体标记为当前方案。
- Let prompt copy wrap naturally from the available width; do not insert manual line breaks to imitate one screenshot.

Build app UI in `src/`. Preserve the packaging roles of `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, and `tests/sites-worker.test.mjs`. Before a Sites handoff, run `npm run build:sites` and `npm run test:sites`; the export must leave `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`. Normal `npm run build` writes the runnable Next.js server to `.next-app/`.
