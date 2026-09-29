import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, readdir, rm, mkdir, stat, utimes, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { DatabaseSync } from "node:sqlite";
import { createRepository, createInitialDocument, withRepository } from "../src/server/repository.js";
import { createDataProvider, storageRoot } from "../src/server/storage/provider.js";
import { JsonDataProvider } from "../src/server/storage/json.js";
import { migrateSqlite } from "../scripts/migrate-sqlite-to-json.mjs";

const input = { kind: "分镜", title: "持久化测试", image: "/images/night-lounge.png", analysis: "公开分析" };
async function directory(t) {
  const result = await mkdtemp(path.join(tmpdir(), "jingjie-provider-"));
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(result)), path.resolve(tmpdir()));
    assert.ok(path.basename(result).startsWith("jingjie-provider-"));
    await rm(result, { recursive: true, force: true });
  });
  return result;
}

test("JSON is the default, unknown providers fail explicitly and reads do not reseed", async (t) => {
  const dir = await directory(t);
  const provider = createDataProvider({ directory: dir, initialize: () => createInitialDocument([]) });
  assert.ok(provider instanceof JsonDataProvider);
  assert.throws(() => createDataProvider({ name: "missing" }), (error) => error.status === 503);
  if (!process.env.JINGJIE_DATA_DIR) assert.equal(storageRoot(), path.resolve("data"));
  const repository = createRepository({ provider });
  let record = await repository.change({ action: "publish", draft: input });
  record = await repository.change({ action: "save", id: record.id, revision: record.revision, draft: { ...record.draft, title: "未公开标题" } });
  const index = JSON.parse(await readFile(path.join(dir, "content.json"), "utf8"));
  const detail = JSON.parse(await readFile(path.join(dir, "content", `${record.id}.json`), "utf8"));
  assert.equal(index.version, 2);
  assert.equal(index.items[0].title, "未公开标题");
  assert.equal(index.items[0].revision, 2);
  assert.equal(index.items[0].draft, undefined);
  assert.equal(index.tags, undefined);
  assert.equal(index.media, undefined);
  assert.equal(detail.draft.title, "未公开标题");
  assert.equal(detail.published.title, input.title);
  const reopened = createRepository({ directory: dir });
  assert.equal((await reopened.listRecords()).length, 1);
  record.draft.title = "外部引用不应写入文件";
  assert.equal((await reopened.getRecord(record.id)).draft.title, "未公开标题");
  assert.deepEqual((await readdir(dir)).sort(), ["content", "content.json", "media.json", "tags.json"]);
});

test("simultaneous instances serialize saves and reject only stale revisions", async (t) => {
  const dir = await directory(t);
  const a = createRepository({ directory: dir, seeds: [] });
  const b = createRepository({ directory: dir, seeds: [] });
  await Promise.all(Array.from({ length: 12 }, (_, i) => (i % 2 ? a : b).change({ action: "save", draft: { ...input, title: `案例 ${i}` } })));
  assert.equal((await a.listRecords()).length, 12);
  const record = (await a.listRecords())[0];
  const outcomes = await Promise.allSettled([a, b].map((repo) => repo.change({ action: "save", id: record.id, revision: record.revision, draft: record.draft })));
  assert.equal(outcomes.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(outcomes.find((result) => result.status === "rejected").reason.status, 409);
  const tags = await a.readTags();
  const tagOutcomes = await Promise.allSettled([a, b].map((repo) => repo.saveTags(tags.groups, tags.revision)));
  assert.equal(tagOutcomes.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(tagOutcomes.find((result) => result.status === "rejected").reason.status, 409);
});

test("independent processes cannot lose content or overwrite newer revisions", async (t) => {
  const dir = await directory(t);
  const module = new URL("../src/server/repository.js", import.meta.url).href;
  async function run(index) {
    const code = `import { createRepository } from ${JSON.stringify(module)}; const repo = createRepository({directory:${JSON.stringify(dir)}, seeds:[]}); for (let i=0;i<5;i++) await repo.change({action:'save',draft:{kind:'分镜',title:'process-${index}-'+i}});`;
    const child = spawn(process.execPath, ["--input-type=module", "-e", code], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"], timeout: 10000 });
    let output = "";
    child.stderr.on("data", (chunk) => { output += chunk; });
    await new Promise((resolve, reject) => {
      child.on("error", reject);
      child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(output)));
    });
  }
  await Promise.all([run(1), run(2), run(3)]);
  assert.equal((await createRepository({ directory: dir }).listRecords()).length, 15);
});

test("corrupt JSON and failed updates retain the original file and release the lock", async (t) => {
  const dir = await directory(t);
  const provider = new JsonDataProvider({ directory: dir, initialize: () => createInitialDocument([]) });
  await provider.read();
  const file = path.join(dir, "content.json");
  const before = await readFile(file, "utf8");
  await assert.rejects(provider.update((document) => { document.tags.revision++; throw new Error("rollback"); }), /rollback/);
  assert.equal(await readFile(file, "utf8"), before);
  for (const broken of ["{broken", "null", '{"version":2}', '{"version":1,"content":[],"tags":null,"media":[]}']) {
    await writeFile(file, broken);
    await assert.rejects(provider.read(), (error) => error.status === 503);
    await assert.rejects(provider.update(() => {}), (error) => error.status === 503);
    assert.equal(await readFile(file, "utf8"), broken);
  }
  assert.deepEqual((await readdir(dir)).sort(), ["content.json", "media.json", "tags.json"]);
});

test("the repository accepts a different async provider and closes it after work finishes", async () => {
  let document = createInitialDocument([]), closed = false;
  const provider = {
    async read() { await delay(2); assert.equal(closed, false); return structuredClone(document); },
    async update(work) { await delay(2); const next = structuredClone(document); const result = await work(next); document = next; return structuredClone(result); },
    async close() { closed = true; },
  };
  await withRepository(async (repository) => {
    const record = await repository.change({ action: "publish", draft: input });
    assert.equal((await repository.getPublished(record.id)).title, input.title);
    assert.equal(closed, false);
  }, { provider });
  assert.equal(closed, true);
  closed = false;
  await assert.rejects(withRepository(async () => { await delay(2); throw new Error("failed"); }, { provider }), /failed/);
  assert.equal(closed, true);
});

test("single-file data migrates without creating backups or losing snapshots", async (t) => {
  const dir = await directory(t);
  const document = createInitialDocument([{ ...input, id: "case-a" }, { ...input, id: "case-b", kind: "视频" }]);
  document.content[0].draft.title = "待发布版本";
  document.content[0].revision = 8;
  document.content[1].status = "offline";
  document.tags.revision = 4;
  const original = JSON.stringify(document, null, 2) + "\n";
  await writeFile(path.join(dir, "content.json"), original);
  const providers = [1, 2].map(() => new JsonDataProvider({ directory: dir, initialize: () => { throw new Error("must not reseed"); } }));
  const [first, second] = await Promise.all(providers.map((provider) => provider.read()));
  assert.deepEqual(first, document);
  assert.deepEqual(second, document);
  assert.deepEqual((await readdir(dir)).sort(), ["content", "content.json", "media.json", "tags.json"]);
  assert.deepEqual((await readdir(path.join(dir, "content"))).sort(), ["case-a.json", "case-b.json"]);
  assert.equal(JSON.parse(await readFile(path.join(dir, "tags.json"), "utf8")).revision, 4);
  await providers[0].update((value) => { value.tags.revision++; });
  assert.equal((await providers[1].read()).tags.revision, 5);
  assert.deepEqual((await readdir(dir)).sort(), ["content", "content.json", "media.json", "tags.json"]);
});

test("saving one case, tags or media only changes their own files and draft deletion removes its detail", async (t) => {
  const dir = await directory(t);
  const repo = createRepository({ directory: dir, seeds: [] });
  let a = await repo.change({ action: "save", draft: input });
  const b = await repo.change({ action: "save", draft: input });
  const untouched = ["tags.json", "media.json", `content/${b.id}.json`];
  const oldTime = new Date("2000-01-01T00:00:00Z");
  for (const name of untouched) await utimes(path.join(dir, name), oldTime, oldTime);
  a = await repo.change({ action: "save", id: a.id, revision: a.revision, draft: { ...a.draft, title: "仅修改这条" } });
  for (const name of untouched) assert.equal((await stat(path.join(dir, name))).mtimeMs, oldTime.getTime(), name);
  const indexFile = path.join(dir, "content.json"), detailFile = path.join(dir, "content", `${a.id}.json`);
  await utimes(indexFile, oldTime, oldTime);
  await utimes(detailFile, oldTime, oldTime);
  const tags = await repo.readTags();
  tags.groups[0].label = "单独保存标签";
  await repo.saveTags(tags.groups, tags.revision);
  await repo.addMedia({ name: "abc-123.png", mime: "image/png", size: 1, originalName: "图片.png" });
  assert.equal((await stat(indexFile)).mtimeMs, oldTime.getTime());
  assert.equal((await stat(detailFile)).mtimeMs, oldTime.getTime());
  await repo.change({ action: "delete", id: a.id, revision: a.revision });
  await assert.rejects(readFile(detailFile), { code: "ENOENT" });
  assert.deepEqual((await repo.listRecords()).map((row) => row.id), [b.id]);
});

test("a failed multi-file write rolls back the index and details, and restart recovers a pending journal", async (t) => {
  const dir = await directory(t);
  const provider = new JsonDataProvider({ directory: dir, initialize: () => createInitialDocument([]) });
  const repo = createRepository({ provider });
  const record = await repo.change({ action: "save", draft: input });
  const names = ["content.json", `content/${record.id}.json`];
  const files = await Promise.all(names.map(async (name) => ({ name, before: await readFile(path.join(dir, name), "utf8") })));
  const write = provider.atomicWrite.bind(provider);
  let failed = false;
  provider.atomicWrite = async (name, text) => {
    if (!failed && name === names[1]) { failed = true; throw new Error("simulated disk failure"); }
    await write(name, text);
  };
  await assert.rejects(repo.change({ action: "save", id: record.id, revision: record.revision, draft: { ...record.draft, title: "不能只写入索引" } }), /disk failure/);
  for (const { name, before } of files) assert.equal(await readFile(path.join(dir, name), "utf8"), before);
  await assert.rejects(stat(path.join(dir, ".content-transaction.json")), { code: "ENOENT" });
  await writeFile(path.join(dir, ".content-transaction.json"), JSON.stringify({ version: 1, files }));
  await writeFile(path.join(dir, names[0]), '{"version":2,"items":[]}');
  await writeFile(path.join(dir, names[1]), "incomplete detail");
  assert.equal((await createRepository({ directory: dir }).getRecord(record.id)).draft.title, input.title);
  for (const { name, before } of files) assert.equal(await readFile(path.join(dir, name), "utf8"), before);
});

test("missing type files, missing details and unsafe index IDs fail without reseeding", async (t) => {
  const dir = await directory(t);
  const repo = createRepository({ directory: dir, seeds: [] });
  const record = await repo.change({ action: "save", draft: input });
  for (const name of ["tags.json", "media.json", `content/${record.id}.json`, "content.json"]) {
    const file = path.join(dir, name), original = await readFile(file, "utf8");
    await unlink(file);
    await assert.rejects(repo.listRecords(), (error) => error.status === 503);
    await assert.rejects(repo.change({ action: "save", draft: input }), (error) => error.status === 503);
    await assert.rejects(stat(file), { code: "ENOENT" });
    await writeFile(file, original);
  }
  await writeFile(path.join(dir, "content.json"), JSON.stringify({ version: 2, items: [{ id: "../outside" }] }));
  await assert.rejects(repo.listRecords(), (error) => error.status === 503);
});

test("media bytes, ranges and exports use the provider and interrupted writes leave no file", async (t) => {
  const dir = await directory(t);
  const provider = new JsonDataProvider({ directory: dir, initialize: () => createInitialDocument([]) });
  const name = "abc-123.png", bytes = Buffer.from("sample-media");
  await provider.writeMedia(name, (async function* () { yield bytes; })());
  assert.equal((await provider.statMedia(name)).size, bytes.length);
  assert.deepEqual(Buffer.from(await new Response(await provider.openMedia(name, { start: 1, end: 4 })).arrayBuffer()), bytes.subarray(1, 5));
  const target = path.join(dir, "export.png");
  await provider.exportMedia(name, target);
  assert.deepEqual(await readFile(target), bytes);
  await assert.rejects(provider.writeMedia("abc-456.png", (async function* () { yield bytes; throw new Error("disconnected"); })()), /disconnected/);
  assert.deepEqual(await readdir(path.join(dir, "uploads")), [name]);
  await assert.rejects(provider.statMedia("../content.json"), /文件名/);
  await provider.removeMedia(name);
  assert.equal(await provider.statMedia(name), null);
});

test("SQLite migration preserves versions, tags and media, refusing to overwrite data", async (t) => {
  const dir = await directory(t), source = path.join(dir, "old"), destination = path.join(dir, "new");
  await mkdir(path.join(source, "uploads"), { recursive: true });
  const bytes = Buffer.from("media"), name = "abc-123.png";
  await writeFile(path.join(source, "uploads", name), bytes);
  const dbFile = path.join(source, "content.sqlite");
  const db = new DatabaseSync(dbFile);
  db.exec("CREATE TABLE content (id, draft, published, status, revision, updated_at, published_at, position); CREATE TABLE settings (key, value, revision); CREATE TABLE media (name, mime, size, original_name);");
  db.prepare("INSERT INTO content VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run("case-a", JSON.stringify({ id: "case-a", title: "待更新" }), JSON.stringify({ id: "case-a", title: "公开版本" }), "offline", 7, "2026-09-29", "2026-09-28", 3);
  db.prepare("INSERT INTO settings VALUES ('tags', ?, 4)").run(JSON.stringify(createInitialDocument([]).tags.groups));
  db.prepare("INSERT INTO media VALUES (?, 'image/png', ?, ?)").run(name, bytes.length, "原文件.png");
  db.close();
  const original = await readFile(dbFile);
  const result = await migrateSqlite(source, destination);
  assert.equal(result.content, 1);
  const repo = createRepository({ directory: destination });
  assert.equal((await repo.getRecord("case-a")).revision, 7);
  assert.equal((await repo.getRecord("case-a")).draft.title, "待更新");
  assert.equal(await repo.getPublished("case-a"), null);
  assert.equal((await repo.readTags()).revision, 4);
  assert.equal((await repo.getMedia(name)).originalName, "原文件.png");
  assert.deepEqual(await readFile(path.join(destination, "uploads", name)), bytes);
  assert.deepEqual(await readFile(dbFile), original);
  await assert.rejects(migrateSqlite(source, destination), /拒绝覆盖/);
  assert.equal((await stat(dbFile)).size, original.length);
  await assert.rejects(createRepository({ directory: source }).listRecords(), /迁移/);
});
