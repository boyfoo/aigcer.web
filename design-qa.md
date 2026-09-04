# 镜界前端 Design QA

## 验收证据

- Source visual truth path: `D:\code\ai\aigcer\web\public\qa\reference-light-approved-v2.png`
- Implementation screenshot path: `D:\code\ai\aigcer\web\public\qa\implementation-final.png`
- Full-view comparison evidence: `D:\code\ai\aigcer\web\public\qa\compare-final.png`
- Focused hero comparison evidence: `D:\code\ai\aigcer\web\public\qa\focus-hero-final.png`
- Focused featured-card typography evidence: `D:\code\ai\aigcer\web\public\qa\focus-details-final.png`
- Viewport: 1488 × 1058 CSS px
- Source pixels: 1487 × 1058
- Implementation pixels: 1488 × 1058
- Device scale factor: 1
- Density normalization: 对照页将 1487px 宽参考图等比放入 1488 × 1058 参考框；实现以 1488 × 1058、DPR 1 原尺寸捕获，两侧使用相同显示比例。
- State: `celadon` 日间主题、默认筛选、竹影茶室为主镜头、搜索框为空。

## Findings

- 无仍需处理的 P0/P1/P2 差异。用户指出的主标题、搜索框和下方内容字体均已在同尺寸对照中通过。
- Fonts and typography: 主标题为 68px / 72px、500 字重，通过横向比例补偿匹配参考字面宽度；描述与操作使用宋体层级，标签和提示词正文使用黑体层级，分行与参考一致。
- Spacing and layout rhythm: 搜索框最终坐标为 x=300、y=237、1044 × 68px，按钮为 163 × 53px；卡片分隔线、提示词区和 61px 底部操作区与参考纵向节奏一致。
- Colors and visual tokens: 搜索按钮使用参考图的朱红色，第二个收藏操作恢复朱红强调；纸张、墨色、标签底色和描边均沿用现有日间主题令牌。
- Image quality and asset fidelity: 图片清晰、裁切与布局无新增退化。当前图像内容与参考图的具体画面差异为既有且本次明确保留的范围约束，不属于本轮三个修正项。
- Copy and content: 主标题、搜索占位文案、描述、标签、提示词和操作文案均与目标状态一致；茶室提示词加入展示换行以匹配参考的两行排版，语义内容未改动。

## Comparison History

### 第一轮

- Earlier finding [P1]: 标题使用 74px / 600，视觉高度与重量过强。
- Fix: 调整为 68px / 72px、500 字重，并以 `scaleX(1.1)` 补偿字体本身偏窄的问题。
- Post-fix evidence: `public/qa/focus-hero-final.png` 中标题视觉高度已降低，同时保留参考图的横向张力。
- Earlier finding [P1]: Ant Design Search 的内部结构带来默认描边、背景和间距漂移。
- Fix: 改为语义化搜索表单，明确图标、输入框和按钮的三列结构；固定外框、内边距、圆角与按钮尺寸。
- Post-fix evidence: 搜索框在焦点对照中左右边界、图标、占位文字和按钮均与参考对齐。
- Earlier finding [P2]: 卡片正文、标签、提示词与底部操作沿用组件默认字体，层级和分行不一致。
- Fix: 显式设置字体族、字号、字重、行高和字距；收藏操作恢复朱红强调。
- Post-fix evidence: `public/qa/focus-details-final.png` 中描述和提示词均按参考位置分为两行。

### 第二轮

- Earlier finding [P2]: 提示词分隔线与底部操作区仍有 3–6px 的纵向偏差。
- Fix: 调整标签区下间距、提示词标题间距与底部按钮高度。
- Post-fix evidence: 最终焦点对照中分隔线、提示词标题和底部操作线已对齐，无剩余 P2 偏差。

## 交互与工程检查

- 搜索输入“湖面”并提交后，结果正确切换到“湖上晨光”。
- 点击“镜界”可恢复默认竹影茶室状态。
- 夜间主题在相同桌面视口下复核，无标题、搜索框或画板布局回归。
- 浏览器 console error/warning: 0。
- 页面尺寸：`scrollWidth=1488`、`scrollHeight=1058`，无横向或额外纵向溢出。
- `npm run build` 通过。
- `npm run test:sites` 通过，4/4 测试成功。

## Open Questions

- 无。

## Implementation Checklist

- [x] 收紧主标题字号与字重。
- [x] 重建与设计稿一致的搜索框结构和视觉状态。
- [x] 校准描述、标签、提示词和操作按钮的字体属性。
- [x] 完成 1488 × 1058 同尺寸全图与焦点区域对照。
- [x] 验证搜索、重置、夜间主题和生产构建。

## Follow-up Polish

- [P3] 若后续拿到设计稿中的原始字体或单独图片素材，可继续消除字形与画面内容的非结构性差异。

final result: passed
