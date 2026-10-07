import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { storyboardItems } from "../src/data.js";
import { createInitialDocument } from "../src/server/repository.js";
import { createDataProvider } from "../src/server/storage/provider.js";

const runFile = promisify(execFile);
const script = fileURLToPath(new URL("../scripts/prepare-filter-examples.mjs", import.meta.url));
const layoutIds = Array.from({ length: 20 }, (_, index) => `masonry-demo-${String(index + 1).padStart(2, "0")}`);
const originalIds = new Set(storyboardItems.map(({ id }) => id));

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), "jingjie-filter-preparation-"));
  const directory = path.join(root, "data");
  const layouts = layoutIds.map((id, index) => ({
    id,
    kind: "分镜",
    title: `布局演示 ${String(index + 1).padStart(2, "0")}`,
    image: `/cover-${index + 1}.png`,
    description: "随机尺寸占位图：920 × 560，用于预览瀑布流布局。",
    analysis: "布局演示：此占位图尺寸为 920 × 560，用于查看不同画幅的瀑布流排布。",
  }));
  const provider = createDataProvider({
    name: "json",
    directory,
    initialize: () => createInitialDocument([...storyboardItems, ...layouts]),
  });
  t.after(async () => {
    await provider.close();
    assert.equal(path.dirname(path.resolve(root)), path.resolve(tmpdir()));
    assert.ok(path.basename(root).startsWith("jingjie-filter-preparation-"));
    await rm(root, { recursive: true, force: true });
  });
  await provider.update((document) => {
    document.tags.groups[0].label = "作者设置的主体";
    document.tags.revision += 1;
    document.media.push({
      name: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png",
      mime: "image/png",
      size: 123,
      originalName: "作者原素材.png",
    });
  });
  const apply = () => runFile(process.execPath, [script, "--apply"], {
    cwd: root,
    env: { ...process.env, JINGJIE_DATA_PROVIDER: "json", JINGJIE_DATA_DIR: directory },
    timeout: 10000,
  });
  return { root, provider, apply };
}

async function publishedEdit(provider, id, edit) {
  await provider.update((document) => {
    const row = document.content.find((entry) => entry.id === id);
    edit(row.published);
    row.draft = structuredClone(row.published);
    row.revision += 1;
    row.updatedAt = new Date().toISOString();
    row.publishedAt = row.updatedAt;
  });
}

async function rejectsWithoutChanging(provider, apply, id) {
  const before = await provider.read();
  await assert.rejects(apply, (error) => {
    assert.match(error.stderr, /已有自行编辑的资料或待发布修改/);
    assert.ok(error.stderr.includes(id));
    return true;
  });
  assert.deepEqual(await provider.read(), before);
}

test("preparing filter examples updates only layout demos, adds ten video fixtures and preserves the author data", async (t) => {
  const { root, provider, apply } = await fixture(t);
  const before = await provider.read();
  await apply();
  const after = await provider.read();
  assert.equal(after.content.length, before.content.length + 10);
  assert.deepEqual(after.content.filter(({ id }) => originalIds.has(id)), before.content.filter(({ id }) => originalIds.has(id)));
  assert.deepEqual(after.tags, before.tags);
  assert.deepEqual(after.media, before.media);
  for (const id of layoutIds) {
    const prior = before.content.find((row) => row.id === id);
    const current = after.content.find((row) => row.id === id);
    assert.equal(current.position, prior.position);
    assert.equal(current.revision, prior.revision + 1);
    assert.equal(current.status, "published");
    assert.equal(current.published.kind, "分镜");
    assert.equal(current.published.image, prior.published.image);
    assert.match(current.published.title, /^筛选示例 · /);
    assert.deepEqual(current.draft, current.published);
  }
  const added = after.content.filter(({ id }) => !before.content.some((row) => row.id === id));
  assert.equal(added.length, 10);
  assert.ok(added.every((row) => row.status === "published" && row.published.kind === "视频" && row.published.video.isMock));
  assert.ok(added.every((row) => row.position > Math.max(...before.content.map((entry) => entry.position))));
  const backups = await readdir(path.join(root, ".cache"));
  assert.equal(backups.length, 1);
  assert.deepEqual(JSON.parse(await readFile(path.join(root, ".cache", backups[0]), "utf8")), before);
});

test("a published prompt edit to a layout demo is preserved even when its title stays unchanged", async (t) => {
  const { provider, apply } = await fixture(t);
  const id = layoutIds[0];
  await publishedEdit(provider, id, (item) => { item.prompt = "作者补充的正式提示词"; });
  await rejectsWithoutChanging(provider, apply, id);
});

for (const [label, id, edit] of [
  ["tag", layoutIds[0], (item) => { item.tagValues.props = ["作者自行分类的道具"]; }],
  ["shot analysis", "filter-demo-video-01", (item) => { item.video.shots[0].analysis[0].text = "作者已发布的镜头分析内容"; }],
]) {
  test(`a published ${label} edit to a generated fixture is preserved even when its title stays unchanged`, async (t) => {
    const { provider, apply } = await fixture(t);
    await apply();
    await publishedEdit(provider, id, edit);
    await rejectsWithoutChanging(provider, apply, id);
  });
}
