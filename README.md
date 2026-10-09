# 镜界

基于 Next.js App Router、React 和 Ant Design 的 AI 视频与图片案例学习网站，用于本人积累、回顾和向访客分享。学习流程围绕观看结果、阅读分镜拆解、比较案例、收藏参考，支持网页录入和通过远程 MCP 导入本地拉片资料。

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

`/settings` 提供全站一级、二级标签设置。录入页的案例分类与逐镜头创作条件都可以直接新增一级、二级标签；新增一级标签时可一起创建首个二级标签，二级标签新增后自动选中，保留正在编辑的内容。主体、动作、道具、变化、表现目标等条件在前，专业拍法按需展开；镜头的景别、运镜、构图和光影复用原有画面信息单选，不重复维护。新增标签立即同步全站设置，案例仍需按原流程保存或发布。多选筛选同组满足任意一个，不同组需同时满足，镜头参考的全部条件必须命中同一镜头。保存有版本冲突时保留输入并提示重新载入，避免覆盖另一页面的更新。

## 远程 MCP：本地拉片后提交到镜界

普通 Next.js 服务提供 Streamable HTTP MCP 地址：`https://你的域名/mcp`。AI 客户端添加此远程 URL 后，会从后端发现工具名称、说明、输入/输出结构和提交流程指南，无需在本地安装镜界 MCP 服务。支持 2025 协议的初始化流程和 2026 协议的服务发现。客户端需要具备读取本地文件和执行 HTTP 上传、读取的能力；只有远程 MCP 连接、不能访问本地文件的客户端无法直传本地素材。

工具标题、说明及服务指南使用网站名称“镜界”，明确对应“提交到镜界”“上传到镜界”“把拉片结果保存到镜界”等请求，并说明申请地址、直传素材、保存草稿及恢复上传的调用顺序。客户端连接后可重新获取工具列表查看这些说明；实际是否调用仍由客户端和模型根据对话判断。

在服务器按 `.env.example` 配置 `SITE_URL`、持久数据目录，以及 `JINGJIE_OSS_BUCKET`、`JINGJIE_OSS_REGION`（如 `cn-hangzhou`）、`JINGJIE_OSS_ACCESS_KEY_ID`、`JINGJIE_OSS_ACCESS_KEY_SECRET`。后台录入与 MCP 预上传共用同一 OSS Bucket 和目录前缀，图片、视频均由浏览器或 MCP 客户端直接 PUT 到私有 OSS；网站接口仅接收 JSON 元数据，负责签名、核验及登记；素材预览和播放由浏览器或 MCP 客户端直接 GET OSS。上传与私有素材访问必须配置 OSS，未配置时返回 503，只配置部分项会报配置错误。Bucket CORS 需允许站点来源的 PUT、GET、HEAD，以及 `Content-Type`、`x-oss-*` 请求头；开发来源与生产来源均须覆盖。可选 `JINGJIE_OSS_SECURITY_TOKEN` 适用于临时凭据，凭据到期前需更新服务端配置。密钥始终在服务端，浏览器与 MCP 客户端仅收到具有有限有效期和指定对象路径的上传 URL。

| MCP 工具 | 用途 |
| --- | --- |
| `jingjie_prepare_upload` | 传 `requestId` 和文件清单，返回 `submissionId`、各文件的 `assetId`、`objectKey`、真实 OSS `url`、临时 `uploadUrl`、`headers` 和 `expiresAt` |
| `jingjie_submit_case` | 传 `submissionId`、原始拉片 JSON `data` 和成功上传的 `assets`；核验后保存新草稿，返回编辑/预览链接、镜头数量与缺失项 |
| `jingjie_get_submission_status` | 查询同次提交的保存结果和逐文件状态；未保存时续签上传地址，已保存时返回原结果 |
| `jingjie_get_media_access` | 传 `{url: 已登记的真实 OSS 对象地址}`，返回 GET 签名 `url`、原 `mediaUrl` 和 `expiresAt`，默认 1 小时有效；客户端直接 GET OSS 读取 |

文件清单示例：

```json
{
  "requestId": "local-analysis-20261007-001",
  "files": [
    { "localName": "video.mp4", "kind": "video", "mime": "video/mp4", "size": 123456 },
    { "localName": "frames/S01a.jpg", "kind": "image", "mime": "image/jpeg", "size": 23456 }
  ]
}
```

实际 `requestId` 使用 UUID 或 1–120 位字母、数字、下划线、短横线；`size` 必须是文件真实字节数。`localName` 使用输出目录内相对路径，后端用它关联原视频、人物图片和首尾帧。每次最多 252 个素材、1 条视频，图片 20 MiB、视频 512 MiB，文件类型与网页上传相同。

本地 AI 的执行顺序为：读取文件 → 申请地址 → 向 OSS **PUT 原始文件字节** → 调用提交工具。不要使用 FormData，也不要把本地路径或 URL 文本作为上传正文。返回的 `Content-Type`、`Content-Length` 和 `x-oss-*` 请求头必须按原值携带；预签名地址默认 30 分钟有效，可通过 `JINGJIE_OSS_UPLOAD_TTL_SECONDS` 设置 60–3600 秒。上传禁止覆盖，并使用私有对象权限；二进制文件不经过 MCP 或网站上传接口。

上传完成后，提交参数形如 `{submissionId, data: 原始shots.json对象, assets: [{assetId, url, objectKey}]}`；`url` 和 `objectKey` 可省略，提供时必须是后端返回的原值。稳定 `url` 是保存资料的真实 OSS 对象地址，读取时生成访问签名；临时 `uploadUrl` 仅用于 PUT 上传，不能用于预览。预览素材须先通过 `jingjie_submit_case` 完成核验和登记，再以真实 OSS 对象地址调用 `jingjie_get_media_access` 获取 GET 签名；素材字节直接从 OSS 读取，不通过 MCP 或网站后端。单张图片的 `data` 使用 `{kind:"image",title,image:"图片localName",description,analysis,prompt}`。

后端直接接收 [reelbench-skills](https://github.com/eternityspring/reelbench-skills) 产生的 `shots.json`，转换已知枚举和资料字段。`source` 对应视频 `localName`；首尾帧默认匹配 `frames/S01a.jpg`、`frames/S01b.jpg`，也可在镜头 `image`、`endImage` 指定路径，人物图片用 `cast.image` 指定。`frame` 转为概述、`size/camera` 转为景别/运镜、`rhythmNote` 转为叙事、`audio` 作为来源提供的台词。未知枚举和缺失素材留空并返回提示，不推测模型参数或提示词，来源机器复核不转成作者人工确认。原始 JSON 与标识映射保存在提交记录中，不随公开内容或 Sites 导出。

断网或地址过期时先查询状态，跳过 `uploaded` 文件，只重新上传 `awaiting_upload` 文件。`unavailable` 表示 OSS 暂时无法核验，保留标识后稍后查询；`invalid` 表示文件核验失败，按返回原因处理，错误格式文件不能用原地址覆盖，应修正后新建提交。申请与提交均可重试：沿用相同 `requestId`、`submissionId` 和原资料，不会重复创建案例；相同标识配不同清单或资料会返回冲突。草稿允许缺图或不完整资料，保存与手动发布分开。

浏览器来源默认限制为本站，原生 MCP 客户端没有 `Origin` 时可以连接；需要跨域浏览器客户端时，用 `JINGJIE_MCP_ALLOWED_ORIGINS` 配置逗号分隔的完整来源地址。此来源检查沿用当前免登录产品边界，不是账号认证。远程服务需要普通 Next.js 部署，Sites 静态站点不提供 `/mcp`。

## 数据保存

默认数据提供者为 `json`，数据目录是 `web/data/`，可使用环境变量 `JINGJIE_DATA_DIR` 指向持久磁盘中的绝对路径。每种数据独立存文件，每个案例的完整资料独立存于子目录：

```text
data/
├── content.json          # 案例列表：ID、名称、类型、状态、版本、时间、排序
├── tags.json             # 全站标签与标签版本
├── media.json            # 素材文件名、原名、类型与大小
├── submissions.json      # MCP 提交、文件清单、原始拉片资料与幂等结果
├── content/
│   ├── night-cinema.json # 单个案例的编辑稿与独立公开快照
│   └── <案例ID>.json     # 视频参数、人物、镜头、提示词和分析均在所属案例中
└── uploads/              # 内部迁移和静态交付工具的本地素材，不提供运行时读取入口
```

JSON 使用 UTF-8、两空格缩进。`content.json` 的文件格式版本为 3，`items` 只放列表摘要；`content/<id>.json` 包含 `id`、`draft` 和 `published`，详情文件不再与其他案例混存。标签、素材、提交索引和详情文件的格式版本为 1。提供者对业务层返回 `DataDocument` v2（新增 `submissions`）。只更新发生变化的文件，修改单个案例不会重写其他案例，修改标签不会重写案例。

网站素材保存在 OSS，并在 `media.json` 记录 `storage: {provider:"oss",bucket,key}`。草稿和公开快照保存真实 OSS 对象 URL，不持久保存有期限的签名。内容 API 与服务端页面读取资料时，为已登记的 OSS 素材生成新的 V4 签名地址，浏览器直接读取私有对象及范围播放。`POST /api/media/access` 接收 `{url}`，返回 `{url, mediaUrl, expiresAt}`，可根据已登记的真实或旧签名地址重新获取访问链接；不会为其他 Bucket、未知对象或外部网址签名。`/api/media/access` 只返回访问元信息，不传输图片或视频字节；普通 Next.js 运行时不提供 `/media/<文件名>` 素材读取入口。访问链接默认 1 小时有效，可通过 `JINGJIE_OSS_ACCESS_TTL_SECONDS=3600` 配置 60–86400 秒，与上传地址的有效期独立。访问查询响应使用 `Cache-Control: private, no-store`，每次查询重新签名；浏览器可复用未过期的签名，过期后重新查询。本地素材读写仅用于内部迁移与静态交付工具，不提供运行时代理。

网页与 MCP 的图片展示、视频播放，以及离线报告图片均通过有效签名地址直接读取 OSS；服务端只生成访问签名。离线报告读取 OSS 图片并嵌入 data URI，需要 Bucket CORS 允许站点来源的 GET/HEAD 读取及范围请求；读取失败会显示缺图提示，不通过网站后端代理图片字节。Sites 构建把已发布快照中的登记 OSS 引用映射为包内 `/media/<文件名>`，通过提供者下载对应实体素材，不携带有期限的签名地址；该静态交付不使用网站运行时素材代理。

后台上传分三步：向 `POST /api/uploads` 发送 JSON `{action:"prepare", kind, name, mime, size}`，获得 `{uploadToken, uploadUrl, headers, expiresAt, mediaUrl}`；浏览器携带返回的请求头向 `uploadUrl` PUT 原始 `File`；再向同一接口发送 JSON `{action:"complete", uploadToken}`。浏览器上传签名不绑定 `Content-Length`，无需手工设置浏览器禁止写入的该请求头；后端通过 OSS HEAD 严格核对大小，并读取最多 1024 字节核验真实格式和 ETag，再通过 OSS 内部复制到 `<前缀>/media/` 后登记素材。完成接口返回 `{url, mediaUrl, expiresAt, name, size, kind}`：`url` 是签名访问地址，`expiresAt` 是 ISO 格式的访问到期时间，`mediaUrl` 是不带签名的真实 OSS 对象 URL。录入预览直接使用 `url`，字段更新和保存使用 `mediaUrl`。

上传票据由服务端使用 HMAC 签发，绑定申请时的元数据并防止篡改，无需新增配置或持久化待上传会话。票据在 PUT 地址到期后再保留 10 分钟用于确认；核验、复制或登记失败时保留对象供确认重试，成功后清理临时对象。图片、视频原始文件不经过 `/api/uploads`，该接口只接受准备与完成两种 JSON 操作。

MCP 临时上传对象位于 `<前缀>/uploads/<submissionId>/`，核验后通过 OSS 内部复制到 `<前缀>/media/`，与上传地址隔离。默认前缀为 `jingjie`；变更 Bucket 或目录前缀前需迁移已有对象与记录。未提交及未引用素材暂不自动回收。

配置完整后，提供者在读取和保存边界将已登记 OSS 素材的 `/media/` 引用或旧签名地址规范为真实 OSS 对象 URL，覆盖封面、视频、镜头首尾帧和人物图片；本地素材、外部地址与正文保留。迁移不改变内容版本或发布状态，访问签名也不写回资料。

全新数据目录首次读取时导入 `src/data.js` 的示例，已有文件不会重新初始化；索引、详情、标签或提交文件损坏、缺失、版本不支持时明确报错。初始示例图片存于私有 OSS，首次初始化同时登记对应素材，读取图片需配置原 Bucket 的访问凭据，不重置已有资料。旧版合并 `content.json` 及 v2 拆分索引在首次读取时于提供者边界迁移成上述结构，并初始化空提交索引，不生成备份文件。草稿、公开快照、版本和素材关联均保留，无需手工拆文件。v3 索引缺少提交文件会报错，不静默补空。

本地的 20 条布局演示可整理为左侧分类的筛选测试资料：`npm run data:filter-examples` 只检查覆盖，`npm run data:filter-examples -- --apply` 通过 DataProvider 更新演示记录，并补充 10 条播放器测试案例。20 条分镜和 20 个测试镜头分别覆盖现有二级选项，支持检查同组多选和跨组组合。资料明确标为虚构筛选示例，封面为布局占位图，视频仅用于播放器测试。执行前备份当前数据到 `.cache/`；自行编辑过的演示记录会拒绝覆盖，原始案例、素材和浏览器收藏保留。此工具需使用前文说明的兼容 Node.js 与 npm。

部署普通 Next.js 服务时必须保留该目录，并让运行进程有读写权限。JSON 提供者通过 `.content.lock` 目录锁协调同一磁盘上的跨进程读写，在锁内检查版本；每个文件用临时文件原子替换，多文件保存通过临时 `.content-transaction.json` 记录原值，失败则回滚，避免列表与详情只更新一半。锁等待最多 5 秒；异常退出遗留锁时，停止所有使用此数据目录的服务，确认无读写后删除 `.content.lock` 再启动，保留事务文件，由下次读取自动恢复。不要在服务运行时手工修改 JSON。此实现面向单机持久磁盘，不支持不同机器各自使用独立目录形成的多实例写入。上传但尚未引用的文件保留在对应存储中，不自动回收。

### 提供者接口与切换

调用关系为页面/HTTP API → `src/server/repository.js`（校验、发布规则、版本冲突）→ `DataProvider`（实际持久化）。浏览器通过 `src/lib/contentClient.js` 使用 `/api/content`、`/api/public`、`/api/tags`、`/api/uploads`、`/api/media/access`，统一处理请求与返回值。

接口定义和集中工厂位于 `src/server/storage/provider.js`，默认实现位于 `src/server/storage/json.js`。所有方法均为异步：

| 方法 | 职责 |
| --- | --- |
| `read()` | 返回独立的数据快照，不允许返回共享可变引用 |
| `update(work)` | 在事务中读取最新快照，执行回调并原子提交；失败不提交，跨实例写入必须串行化 |
| `writeMedia(name, chunks)` | 仅内部迁移和静态交付工具流式写入本地素材；网站与 MCP 上传均使用 OSS 预签名直传 |
| `createMediaUrl(name, method, uploadedStorage?)` | 为 OSS 素材签发对应 GET/HEAD 方法的访问 URL，返回 `{url, expiresAt}`；登记前可传入写入返回的 `storage`，本地素材返回 `null` |
| `getMediaReference(name, uploadedStorage?)` / `getPlannedMediaReference(name)` | 返回真实 OSS 对象 URL；直传申请可按已配置目录生成正式对象地址 |
| `resolveMediaReference(url)` | 按已登记对象匹配真实或签名 OSS 地址，返回素材记录；未知对象返回 `null` |
| `canonicalizeMediaUrls(value, media?)` | 将已登记素材字段转为不带签名的真实 OSS URL，保留本地、外站地址及正文；事务内传入当前素材清单 |
| `resolveMediaAccess(value)` / `resolveStaticMedia(value)` | 为案例素材字段生成访问签名，或映射为 Sites 包内地址；保留持久资料原值 |
| `statMedia(name)` | 内部工具查询素材大小 |
| `openMedia(name, range)` | 仅内部迁移和静态交付工具读取本地素材流，拒绝读取 OSS 素材；流在 `close()` 后仍可使用 |
| `removeMedia(name, uploadedStorage?)` | 内部工具移除指定本地或 OSS 对象；上传登记失败不调用该方法，保留对象供重试 |
| `exportMedia(name, destination)` | 为 Sites 静态交付下载或复制已发布快照引用的实体素材 |
| `getDirectUploadConfig()` / `makeUploadKey(submissionId, name)` | 查询直传配置、生成本次提交的临时对象路径 |
| `createUploadUrl({key, mime, size})` | 签发指定类型、大小和路径的上传 URL |
| `createBrowserUpload(input)` | 为浏览器签发绑定素材元数据的上传票据、PUT 地址及请求头 |
| `verifyBrowserUpload(uploadToken)` | 验证上传票据签名和到期时间，返回票据绑定的元数据 |
| `removeUploadedObject(key)` | 清理本次直传的 OSS 临时对象 |
| `inspectUploadedObject({key, kind, size, mime})` | 核验 OSS 对象是否存在、大小、真实格式及 ETag |
| `promoteUploadedObject({sourceKey, name, etag})` | 按已核验 ETag 复制至正式素材目录，支持相同内容重试 |
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

首页与分类页按创作条件寻找镜头参考，将原分类组组织为“内容与环境、动作与变化、视角与拍摄、构图与光影、导演与剪辑、表达与类型”六个入口，默认全部收起，一次只展开一个入口，展开后原分类组选项可多选；有未归入六个入口的自定义分类时显示“其他分类”。原标签分组数据与录入页分类布局保持。顶部按全部、视频、分镜图片、提示词参考切换内容类别。视频直接显示具体镜头的画面、出处和时间段，可原地预览片段或进入对应拆解；分镜图片作为单画面参考，未拆解的视频明确标为整片，所有结果沿用瀑布流。关键词支持用空格组合多个条件，已选条件在右侧结果上方按原分类组汇总，组名显示一次，各选项可逐个清除，同组 OR、跨组 AND。镜头只按自己已录入的标签和画面信息匹配，不继承案例标签或推测未知内容。“查找与排列镜头”内保留列表/网格、镜号与资料搜索、景别/运镜筛选和镜长排序。节奏带宽度对应真实镜长，未拆解时间保留空段。点击镜头进入“单镜头细读”，与总览共用播放器，返回时保留筛选和浏览位置；镜头参考链接直接进入细读。“播放与研究工具”内保留节奏带、标注与缩略图。“拆解跟随播放”开关及状态常显在拆解区顶部，默认关闭，打开后分析随播放镜头切换，收起左侧工具不会隐藏开关。画面参数与提示词位于解释正文之后，按需展开；手机可用“回看这镜”返回播放器。

首页与分类页在宽度大于 900px 时为顶部导航保留占位，左侧分类栏与右侧结果区独立滚动，滚到各自边界不带动另一栏或页面；900px 及以下仍使用原生页面滚动，滚轮、触摸和键盘操作均保留。

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

`test:publishing` 运行已构建的 Next.js 服务，使用临时独立 JSON 数据目录与端口，检查 MCP 远程发现/调用、上传、范围请求、发布状态、公开 HTML 和重启持久化；完成后清理自己的服务与测试数据。`npm test` 包含 MCP 协议、提交转换、幂等事务和 OSS 签名/对象核验测试；OSS 网络操作使用替身，真实 Bucket 联通仍需部署配置后实测。

Sites 构建通过当前提供者导出已发布内容的静态快照，复制这些快照引用的上传素材，保留 `dist/client/`、`dist/server/index.js` 与 `dist/.openai/hosting.json` 的既有打包方式。静态包不包含原始 JSON 数据文件、数据库、未发布内容和运行时写入接口。Sites 页面可以阅读、收藏和整理参考集；录入与标签保存需要普通 Next.js 服务。静态快照要更新内容需重新构建和部署。
