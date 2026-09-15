import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import test from "node:test";
import worker from "../worker/index.js";
import { withRepository } from "../src/server/repository.js";

test("serves existing static assets without a fallback", async () => {
  const calls = [];
  const response = await worker.fetch(new Request("https://example.test/assets/app.js"), {
    ASSETS: {
      fetch: async (request) => {
        calls.push(new URL(request.url).pathname);
        return new Response("asset", { status: 200 });
      },
    },
  });

  assert.equal(response.status, 200);
  assert.deepEqual(calls, ["/assets/app.js"]);
});

test("serves each exported case HTML instead of the SPA shell", async () => {
  const calls = [];
  const response = await worker.fetch(
    new Request("https://example.test/cases/night-cinema?source=share", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async (request) => {
          const url = new URL(request.url);
          calls.push(url.pathname + url.search);
          return new Response(url.pathname === "/cases/night-cinema.html" ? "case content" : "missing", {
            status: url.pathname === "/cases/night-cinema.html" ? 200 : 404,
          });
        },
      },
    },
  );

  assert.equal(response.status, 200);
  assert.equal(await response.text(), "case content");
  assert.deepEqual(calls, ["/cases/night-cinema?source=share", "/cases/night-cinema.html"]);
});

test("unknown pages return the exported 404 with an actual 404 status", async () => {
  const calls = [];
  const response = await worker.fetch(new Request("https://example.test/cases/deleted", { headers: { accept: "text/html" } }), {
    ASSETS: { fetch: async (request) => {
      const path = new URL(request.url).pathname;
      calls.push(path);
      return new Response(path === "/404.html" ? "Page not found" : "missing", { status: path === "/404.html" ? 200 : 404 });
    } },
  });
  assert.equal(response.status, 404);
  assert.equal(await response.text(), "Page not found");
  assert.ok(!calls.includes("/index.html"));
});

test("does not turn missing API or write requests into the app shell", async () => {
  for (const request of [
    new Request("https://example.test/api/missing", { headers: { accept: "application/json" } }),
    new Request("https://example.test/api/missing", { headers: { accept: "text/html" } }),
    new Request("https://example.test/_next/missing.js", { headers: { accept: "text/html" } }),
    new Request("https://example.test/flow", { method: "POST", headers: { accept: "text/html" } }),
  ]) {
    let calls = 0;
    const response = await worker.fetch(request, {
      ASSETS: {
        fetch: async () => {
          calls += 1;
          return new Response("missing", { status: 404 });
        },
      },
    });

    assert.equal(response.status, 404);
    assert.equal(calls, 1);
  }
});

test("emits the files required by Sites packaging", async () => {
  await access(new URL("../dist/client/index.html", import.meta.url));
  await access(new URL("../dist/server/index.js", import.meta.url));
  await access(new URL("../dist/.openai/hosting.json", import.meta.url));
});

test("exported case pages contain full text without executing JavaScript", async () => {
  const withoutScripts = (html) => html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
  const home = withoutScripts(await readFile(new URL("../dist/client/index.html", import.meta.url), "utf8"));
  const escape = (text) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#x27;");
  for (const item of withRepository((repository) => repository.listPublished())) {
    assert.ok(home.includes(`href="/cases/${item.id}"`), `Missing home link: ${item.id}`);
    const html = withoutScripts(await readFile(new URL(`../dist/client/cases/${item.id}.html`, import.meta.url), "utf8"));
    assert.ok(html.includes(`<title>${escape(item.title)} · 镜界</title>`));
    assert.ok(html.includes(escape(item.description)));
    assert.ok(html.includes(escape(item.prompt)));
  }
  const settings = await readFile(new URL("../dist/client/settings.html", import.meta.url), "utf8");
  assert.match(settings, /name="robots" content="noindex, nofollow"/);
});

test("static handoff excludes the database and runtime API handlers", async () => {
  const files = await readdir(new URL("../dist/", import.meta.url), { recursive: true });
  assert.ok(!files.some((name) => /(?:sqlite|\.runtime\.js$)/.test(name)));
  assert.ok(!files.some((name) => /^client[\\/]api[\\/]/.test(name)));
  const published = withRepository((repository) => repository.listPublished());
  for (const item of published) {
    for (const url of [item.image, item.video?.src, ...(item.video?.shots.flatMap((shot) => [shot.image, shot.endImage]) ?? []), ...(item.video?.cast?.map((person) => person.image) ?? [])]) {
      if (url?.startsWith("/media/")) await access(new URL(`../dist/client${url}`, import.meta.url));
    }
  }
});
