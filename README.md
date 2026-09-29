# 镜界

基于 Next.js App Router、React 和 Ant Design 的 AI 视频与图片案例学习网站，用于本人积累、回顾和向访客分享。学习流程围绕观看结果、阅读分镜拆解、比较案例、收藏参考；不提供视频生成、跟练或作品提交。

## 本地运行

组件职责、状态管理与历史代码清理约定见 [Web 项目协作约定](AGENTS.md#前端开发规范)；视觉与交互细节见 [镜界设计系统](DESIGN_SYSTEM.md)。

需要满足 `package.json` 中 `engines` 要求的 Node.js。默认使用 JSON 文件保存数据，无需数据库服务。nvm 版本只在当前终端进程中选择，步骤见下文。

```bash
npm install
npm run dev
```

预览地址：http://127.0.0.1:5174/ 。普通生产构建保存在 `.next-app/`：

```bash
npm run build
npm run start
```

### PowerShell 临时选择 Node.js

在 `web/` 目录中先检查当前环境、项目要求和已安装版本：

```powershell
Get-Command node.exe, npm.cmd -All -ErrorAction SilentlyContinue | Select-Object Name, Source
node.exe --version
(Get-Content -LiteralPath package.json -Raw | ConvertFrom-Json).engines
Get-ChildItem -LiteralPath $env:NVM_HOME -Directory | Where-Object Name -Match '^v\d+\.\d+\.\d+$' | Select-Object -ExpandProperty Name
```

将下方的 `vX.Y.Z` 替换为已确认兼容且已安装的版本，再执行：

```powershell
$webNodeDir = Join-Path $env:NVM_HOME 'vX.Y.Z'
$webNodeExe = Join-Path $webNodeDir 'node.exe'
$webNpmCmd = Join-Path $webNodeDir 'npm.cmd'
if (-not (Test-Path -LiteralPath $webNodeExe) -or -not (Test-Path -LiteralPath $webNpmCmd)) { throw '所选版本缺少 Node.js 或 npm' }
$webPreviousPath = $env:PATH
$env:PATH = "$webNodeDir;$webPreviousPath"
Get-Command node.exe, npm.cmd | Select-Object Name, Source
& $webNodeExe --version
& $webNpmCmd --version
& $webNpmCmd run build
```

同一终端继续使用 `$webNpmCmd` 执行其他 npm 命令；关闭终端或执行 `$env:PATH = $webPreviousPath` 即结束临时切换。每次独立命令调用都需重新设置并验证，避免 Node.js 与 npm 来自不同目录。不要使用 `nvm use` 或修改全局默认版本。

## 录入与发布

从个人菜单进入独立的 `/content` 页面，新增案例、上传本地视频或图片，再逐步整理资料。图片支持 PNG、JPG、WebP、GIF，单张最大 20 MB；视频支持 MP4、WebM，单个最大 512 MB。视频自动读取时长，无法读取时可手动填写，上传后可以直接播放。

- **保存草稿**：允许资料不完整，内容保存在网站服务中；刷新或重启后继续编辑。
- **发布**：要求案例名称、对应素材以及提示词或分析中的至少一项。资料可以填写在案例整体或具体镜头中。已填写镜头的时间需有序、不重叠且不超过视频时长。
- **修改已发布案例**：保存只更新编辑稿，访客仍看上次发布的版本；点击“发布更新”才改变公开内容。
- **下架**：从公开列表、案例网址和网站地图移除，原资料保留。
- **重新上架**：恢复上次发布的版本，待发布修改不会自动生效。已发布过的内容不退回草稿或删除，只有未发布草稿可以删除。

当前已确认包括管理页面在内均免登录开放。草稿预览使用 `/case-preview?id=…`；公开网址使用稳定 ID `/cases/[slug]`。公开页面初始 HTML 包含正文，草稿、已下架或不存在的公开案例网址返回 404。公开数据读取不包含编辑稿。

`/settings` 提供全站一级、二级标签设置。录入页的“分类与标签”也可以直接新增一级、二级标签；新增一级标签时可一起创建首个二级标签，二级标签新增后自动选中，保留正在编辑的案例内容。新增标签立即同步全站设置，案例仍需按原流程保存或发布。录入和筛选均支持每组多选：同组满足任意一个，不同组需同时满足。保存有版本冲突时保留输入并提示重新载入，避免覆盖另一页面的更新。

## 数据保存

默认数据提供者为 `json`，数据目录是 `web/data/`，可使用环境变量 `JINGJIE_DATA_DIR` 指向持久磁盘中的绝对路径。每种数据独立存文件，每个案例的完整资料独立存于子目录：

```text
data/
├── content.json          # 案例列表：ID、名称、类型、状态、版本、时间、排序
├── tags.json             # 全站标签与标签版本
├── media.json            # 素材文件名、原名、类型与大小
├── content/
│   ├── night-cinema.json # 单个案例的编辑稿与独立公开快照
│   └── <案例ID>.json     # 视频参数、人物、镜头、提示词和分析均在所属案例中
└── uploads/              # 上传的图片与视频原文件
```

JSON 使用 UTF-8、两空格缩进。`content.json` 的文件格式版本为 2，`items` 只放列表摘要；`content/<id>.json` 包含 `id`、`draft` 和 `published`，详情文件不再与其他案例混存。标签、素材索引和详情文件的格式版本为 1。只更新发生变化的文件，修改单个案例不会重写其他案例，修改标签不会重写案例。提供者对业务层返回的 `DataDocument` 契约保持不变，拆分是 JSON 提供者内部实现。

全新数据目录首次读取时导入 `src/data.js` 的示例，已有文件不会重新初始化；索引、详情或标签等文件损坏、缺失、版本不支持时明确报错。旧版合并 `content.json` 在首次读取时直接拆分成上述结构，不生成备份文件。草稿、公开快照、版本和素材路径均保留，无需手工拆文件。

部署普通 Next.js 服务时必须保留该目录，并让运行进程有读写权限。JSON 提供者通过 `.content.lock` 目录锁协调同一磁盘上的跨进程读写，在锁内检查版本；每个文件用临时文件原子替换，多文件保存通过临时 `.content-transaction.json` 记录原值，失败则回滚，避免列表与详情只更新一半。锁等待最多 5 秒；异常退出遗留锁时，停止所有使用此数据目录的服务，确认无读写后删除 `.content.lock` 再启动，保留事务文件，由下次读取自动恢复。不要在服务运行时手工修改 JSON。此实现面向单机持久磁盘，不支持不同机器各自使用独立目录形成的多实例写入。上传但尚未引用的文件保留在磁盘，不自动回收。

### 提供者接口与切换

调用关系为页面/HTTP API → `src/server/repository.js`（校验、发布规则、版本冲突）→ `DataProvider`（实际持久化）。浏览器继续通过 `src/lib/contentClient.js` 使用 `/api/content`、`/api/public`、`/api/tags` 和 `/api/uploads`，请求与返回格式保持不变。

接口定义和集中工厂位于 `src/server/storage/provider.js`，默认实现位于 `src/server/storage/json.js`。所有方法均为异步：

| 方法 | 职责 |
| --- | --- |
| `read()` | 返回独立的数据快照，不允许返回共享可变引用 |
| `update(work)` | 在事务中读取最新快照，执行回调并原子提交；失败不提交，跨实例写入必须串行化 |
| `writeMedia(name, chunks)` | 流式写入素材；中断或失败时清理未完成文件 |
| `statMedia(name)` / `openMedia(name, range)` | 查询大小、读取完整或指定范围的素材流；返回的流在 `close()` 后仍可使用 |
| `removeMedia(name)` / `exportMedia(name, destination)` | 清理失败上传、将公开素材导出为静态文件 |
| `close()` | 释放提供者资源 |

以后新增数据库或远程存储时，实现这组接口，在工厂的 `providers` 中注册名称，再设置 `JINGJIE_DATA_PROVIDER=提供者名称` 并重启。页面、客户端、API、发布规则和 Sites 导出无需修改。当前只注册 `json`；未知名称会报错，不会静默回退。更换提供者前需迁移原数据，新实现也必须遵循 `storage/document.js` 的版本化数据契约及事务语义。测试可通过 `createRepository({ provider })` 注入独立实现。

### 从现有 SQLite 迁移

先停止原服务，再在 `web/` 执行一次：

```bash
npm run data:migrate
# 指定原数据目录和新的目标目录：
npm run data:migrate -- /absolute/old-storage /absolute/new-data
```

默认从 `web/storage/content.sqlite` 和 `web/storage/uploads/` 迁移至 `web/data/`，直接生成按类型与案例拆分的文件，完整保留编辑稿、公开快照、状态、时间、版本、标签和素材。目标目录必须尚不存在，脚本先在临时目录准备并校验后再一次性放置，拒绝覆盖已有数据。原 SQLite 与素材只读保留。若配置了 `JINGJIE_DATA_DIR`，迁移后将其改为新目录再启动；运行时不再读取或双写 SQLite。仅迁移脚本使用 Node.js 内置 SQLite。

“收藏案例”保存整条案例，“镜头收藏夹”（原项目参考集）整理具体镜头，两者属于访客个人数据，保存在当前浏览器的 localStorage，免登录且刷新恢复，不跨设备同步。参考集保留镜头备注与排序；原案例下架时标为暂不可用，重新上架后可继续查看。

## 页面与搜索收录

主要路由是 `/`、`/cases/[slug]`、`/collections/storyboards`、`/collections/videos`、`/collections/prompts`。管理与辅助路由为 `/content`、`/settings`、`/case-preview`、`/font-test.html`。

参照 `.env.example`，在构建与运行环境设置 `SITE_URL` 为实际公开域名，用于 canonical、Open Graph 和 sitemap。未配置时按私有预览处理：页面 noindex、robots 禁止抓取、网站地图为空。管理、预览与字体对比页始终 noindex。正式服务的公开列表、案例详情和 sitemap 随手动发布、下架而更新，无需重新构建。

首页优先浏览案例，卡片始终显示名称与看点；分类分组就地展开。视频拉片按“看成片 → 看镜头拆解”浏览，点击“从第 1 镜开始”或某个镜头直接读解释。“查找与排列镜头”内保留列表/网格、镜号与资料搜索、景别/运镜筛选和镜长排序。节奏带宽度对应真实镜长，未拆解时间保留空段。点击镜头进入“单镜头细读”，与总览共用播放器，返回时保留筛选和浏览位置；镜头参考链接直接进入细读。“播放与研究工具”内保留节奏带、标注与缩略图。“拆解跟随播放”开关及状态常显在拆解区顶部，默认关闭，打开后分析随播放镜头切换，收起左侧工具不会隐藏开关。画面参数与提示词位于解释正文之后，按需展开；手机可用“回看这镜”返回播放器。

拉片报告还提供整片镜长统计、四类时长分布、出场人物索引、15 项质量检查及 JSON / 离线 HTML 导出。人物、镜头类别、节奏和转场可在录入页维护，人物可以在编辑镜头时直接新增。总览支持按人物、类别与节奏筛选，也显示声音和叙事资料摘要。统计保留未拆解时段，不把缺失标签当作已知类型。质量检查区分自动结构校验和作者人工复核；没有证据的画面判断保持“待复核”，修改相关镜头资料会清除旧确认。

离线报告内嵌图片与分析，不依赖框架或网络，支持搜索、列表/网格、首尾帧放大、人物筛选、统计和质量报告。选择本地原视频后可同步播放；视频本身不嵌入报告。单图最多 20 MB、累计图片最多 128 MB，缺图会明确注明。上传视频时读取宽高与时长，帧率和音轨可手动补充；未知参数不猜测。

视频案例可逐镜头上传首帧/代表画面与可选尾帧，填写画面信息、分析、首帧与动态提示词，以及可选的声音与音乐、台词、画面文字和叙事作用。画面可放大，提示词可查看、复制，镜头可加入项目参考集。尾帧未填写时不占用访客页面的空框，也不使用首帧冒充；首帧使用案例封面兜底时明确标注。示例视频的模拟拆解保留标识，新增真实案例不附加示例标注。新增字段与既有内容一样保存在草稿与独立的公开快照中。

## 检查与 Sites 静态交付

```bash
npm test
npm run build
npm run test:publishing
npm run build:sites
npm run test:sites
```

`test:publishing` 运行已构建的 Next.js 服务，使用临时独立 JSON 数据目录与端口，检查上传、范围请求、发布状态、公开 HTML 和重启持久化；完成后清理自己的服务与测试数据。

Sites 构建通过当前提供者导出已发布内容的静态快照，复制这些快照引用的上传素材，保留 `dist/client/`、`dist/server/index.js` 与 `dist/.openai/hosting.json` 的既有打包方式。静态包不包含原始 JSON 数据文件、数据库、未发布内容和运行时写入接口。Sites 页面可以阅读、收藏和整理参考集；录入与标签保存需要普通 Next.js 服务。静态快照要更新内容需重新构建和部署。
