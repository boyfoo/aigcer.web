# 镜界

基于 Next.js App Router、React 和 Ant Design 的 AI 视频案例学习网站。公开内容在构建时生成完整 HTML，搜索、筛选、收藏与标签设置保留浏览器交互。

## 本地运行

Node.js 使用 22.12 或更高版本。nvm 版本只在当前命令行进程中选择，具体步骤见 `AGENTS.md`。

```bash
npm install
npm run dev
```

默认预览地址为 `http://127.0.0.1:5174/`。

```bash
npm run build
npm run start
npm test
```

普通构建保存在 `.next-app/`，由 Next.js 服务运行，保留 Route Handlers、Server Actions 等后端扩展能力。

## 页面与内容

- `/`：首页和镜头搜索。
- `/cases/[slug]`：独立案例详情，包含描述、画面信息、完整提示词与相关案例链接。
- `/collections/storyboards`、`/collections/videos`、`/collections/prompts`：独立分类页。
- `/settings`：当前浏览器的标签设置，不参与搜索收录。
- `/font-test.html`：字体对比，不参与搜索收录。
- `/sitemap.xml`、`/robots.txt`：由 Next.js 生成。

现有案例数据仍在 `src/data.js`；页面通过 `src/lib/content.js` 读取，案例 ID 作为稳定网址的一部分。新增或删除数据后重新构建，会同步更新案例路由和网站地图；不存在的案例返回 404。

## 上线与搜索收录

参照 `.env.example`，在正式部署环境设置 `SITE_URL` 为实际公开域名（例如 `https://你的域名`），然后重新构建。它用于 canonical、Open Graph 和 sitemap 的绝对网址。未配置域名时视为本地或私有预览：页面使用 `noindex`，robots 禁止抓取，网站地图为空。

设置页和字体对比页始终为 `noindex`。公开内容无需登录，内容及页面信息直接出现在初始 HTML 中；正式上线后可向搜索引擎提交 `/sitemap.xml`。能被抓取不代表一定收录。

## Sites 静态交付

```bash
npm run build:sites
npm run test:sites
```

该命令使用 Next.js 静态导出，生成 `dist/client/`，再由 `scripts/prepare-sites-build.mjs` 保留既有 `dist/server/index.js` 和 `dist/.openai/hosting.json`。Worker 按网址寻找对应 HTML；未知页面返回真正的 404，不再统一返回首页。

静态导出与普通 Next.js 服务构建相互独立。Sites 这条静态交付路径不运行 Next.js 的动态后端；后续增加内容管理时，应部署普通 Next.js 服务，或单独验证支持其动态能力的 Cloudflare 适配方案。

## 视频与模拟拉片

视频案例详情页在桌面使用左侧播放器、右侧资料的双栏布局，手机纵向排列。点击横向胶片条中的镜头会从该节点开始连续播放；播放位置与正在研究的镜头分别保存，播放跨过节点时不会自动切走分析。构图、光影和运镜支持画面示意标注，离开对应镜头后隐藏标注。首帧图片和视频动态提示词按类别展示，支持分类片段与完整原文复制。

当前三个视频案例共用用户提供的示例视频（约 32 秒）。视频地址、镜头起止秒数、示例缩略图、分析和提示词位于 `src/mockVideo.js`，由 `src/data.js` 中的视频案例引用。模拟拆解与素材画面无对应关系，页面已标注；替换真实内容时，将各案例的 `video` 改为独立数据，并同步时长、镜头时间与缩略图。当前实现不包含内容管理后台。

镜头可加入项目参考集，支持项目与分组管理、拖动或按钮排序、参考备注和返回原镜头。参考集以 `jingjie.reference-projects.v1` 存在当前浏览器的 localStorage，刷新后恢复，目前没有账号同步。移除分组会保留镜头；同一项目不能重复添加同一个镜头。提示词分类和示意标注配置位于 `src/lib/shotPresentation.js`，真实内容应逐镜头配置。

## 后续内容管理

本次仅迁移框架和公开页面，未加入管理后台、数据库或写入接口。后续可在同一 Next.js 项目内增加管理页面、Route Handlers / Server Actions、数据库和管理员身份验证。接入数据库后配置缓存策略，写入成功时使相关案例、分类和网站地图缓存失效；普通服务支持按需生成新案例页面，Sites 静态导出仍需重新构建。

案例正文应保存在数据库，图片和视频保存在对象存储。浏览器的收藏状态、标签偏好不作为公开内容数据库。
