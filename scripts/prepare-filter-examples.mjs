import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { createFilterExamples } from "../src/filterExamples.js";
import { normalizeContentEntry } from "../src/lib/contentEntries.js";
import { createCreationReferences, filterCreationReferences } from "../src/lib/creationReferences.js";
import { createDataProvider } from "../src/server/storage/provider.js";

const args = process.argv.slice(2);
if (args.some((arg) => !["--apply", "--dry-run"].includes(arg)) || args.length > 1) {
  throw new Error("用法：npm run data:filter-examples -- [--dry-run | --apply]");
}
const apply = args.includes("--apply");
const provider = createDataProvider({
  initialize: () => { throw new Error("请先启动网站初始化数据；此工具只整理现有布局演示。"); },
});

try {
  const before = await provider.read();
  const demoIds = Array.from({ length: 20 }, (_, index) => `masonry-demo-${String(index + 1).padStart(2, "0")}`);
  const demoRows = demoIds.map((id) => before.content.find((row) => row.id === id));
  if (demoRows.some((row) => !row?.published?.image)) {
    throw new Error("需要已有的 20 条布局演示及其封面；未修改任何数据。");
  }
  const sampleVideo = before.content.find((row) => row.published?.video?.isMock)?.published.video;
  if (!sampleVideo?.src || !sampleVideo.durationSeconds) {
    throw new Error("缺少标明 isMock 的播放器测试视频；未修改任何数据。");
  }
  const examples = createFilterExamples(demoRows.map((row) => row.published.image), sampleVideo.src, sampleVideo.durationSeconds)
    .map((item) => normalizeContentEntry(item, { publish: true }));
  const targetIds = new Set(examples.map((item) => item.id));
  const expectedExamples = new Map(examples.map((item) => [item.id, item]));
  const previousTargets = new Map(before.content.filter((row) => targetIds.has(row.id)).map((row) => [row.id, JSON.stringify(row)]));
  for (const row of before.content.filter((row) => targetIds.has(row.id))) {
    const dimensions = row.published?.description.match(/^随机尺寸占位图：(\d+) × (\d+)，用于预览瀑布流布局。$/);
    const originalLayout = dimensions && normalizeContentEntry({
      id: row.id, kind: "分镜", title: `布局演示 ${row.id.slice(-2)}`, image: row.published.image,
      description: `随机尺寸占位图：${dimensions[1]} × ${dimensions[2]}，用于预览瀑布流布局。`,
      analysis: `布局演示：此占位图尺寸为 ${dimensions[1]} × ${dimensions[2]}，用于查看不同画幅的瀑布流排布。`,
    }, { publish: true });
    const uneditedExample = isDeepStrictEqual(row.published, expectedExamples.get(row.id));
    const uneditedLayout = demoIds.includes(row.id) && originalLayout && isDeepStrictEqual(row.published, originalLayout);
    if (row.status !== "published" || !isDeepStrictEqual(row.draft, row.published) || !(uneditedLayout || uneditedExample)) {
      throw new Error(`${row.id} 已有自行编辑的资料或待发布修改；未修改任何数据。`);
    }
  }

  const coverage = ["分镜", "视频"].map((kind) => {
    const references = createCreationReferences(examples.filter((item) => item.kind === kind));
    const missing = before.tags.groups.flatMap((group) => group.options.filter((option) =>
      !filterCreationReferences(references, { groups: before.tags.groups, filters: { [group.id]: [option.id] } }).length
    ).map((option) => `${group.label}：${option.label}`));
    if (missing.length) throw new Error(`${kind}缺少筛选样例：${missing.join("、")}；未修改任何数据。`);
    return { kind, cases: examples.filter((item) => item.kind === kind).length, references: references.length,
      coveredOptions: before.tags.groups.reduce((count, group) => count + group.options.length, 0) };
  });
  console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", coverage }, null, 2));
  if (apply) {
    const backupDirectory = path.resolve(".cache");
    await mkdir(backupDirectory, { recursive: true });
    const backupPath = path.join(backupDirectory, `filter-examples-before-${Date.now()}.json`);
    await provider.update(async (document) => {
      if (JSON.stringify(document.tags) !== JSON.stringify(before.tags)) throw new Error("分类已变化，请重新检查覆盖后执行。");
      for (const id of targetIds) {
        const current = document.content.find((row) => row.id === id);
        if ((current && JSON.stringify(current)) !== previousTargets.get(id)) throw new Error(`${id} 已变化，请重新检查后执行。`);
      }
      await writeFile(backupPath, JSON.stringify(document, null, 2) + "\n");
      let nextPosition = Math.max(-1, ...document.content.map((row) => row.position)) + 1;
      const now = new Date().toISOString();
      for (const example of examples) {
        let row = document.content.find((entry) => entry.id === example.id);
        if (!row) {
          row = { id: example.id, revision: 0, position: nextPosition++ };
          document.content.push(row);
        }
        Object.assign(row, { draft: example, published: structuredClone(example), status: "published",
          revision: row.revision + 1, updatedAt: now, publishedAt: now });
      }
    });
    console.log(`已整理 ${examples.length} 条筛选示例；原始案例和素材保持原样。备份：${backupPath}`);
  }
} finally {
  await provider.close();
}
