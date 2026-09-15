#!/usr/bin/env node
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { storageRoot, withRepository } from "../src/server/repository.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const index = path.join(dist, "client", "index.html");
const worker = path.join(root, "worker", "index.js");
const hosting = path.join(root, ".openai", "hosting.json");

export function prepareSitesBuild() {
  for (const file of [index, path.join(dist, "client", "404.html"), worker, hosting]) {
    if (!existsSync(file)) throw new Error("Missing Sites build input: " + file);
  }
  mkdirSync(path.join(dist, "server"), { recursive: true });
  mkdirSync(path.join(dist, ".openai"), { recursive: true });
  copyFileSync(worker, path.join(dist, "server", "index.js"));
  copyFileSync(hosting, path.join(dist, ".openai", "hosting.json"));
  // Export only assets used by a published snapshot, never draft files or the database.
  const published = withRepository((repository) => repository.listPublished());
  const urls = new Set(published.flatMap((item) => [item.image, item.video?.src, ...(item.video?.shots.flatMap((shot) => [shot.image, shot.endImage]) ?? []), ...(item.video?.cast?.map((person) => person.image) ?? [])]));
  for (const url of urls) {
    if (!url?.startsWith("/media/")) continue;
    const name = url.slice(7);
    if (!/^[a-f0-9-]+\.(png|jpg|gif|webp|mp4|webm)$/.test(name)) throw new Error("Invalid published media filename");
    mkdirSync(path.join(dist, "client", "media"), { recursive: true });
    copyFileSync(path.join(storageRoot(), "uploads", name), path.join(dist, "client", "media", name));
  }
  console.log("Prepared Sites build: dist/server/index.js and dist/.openai/hosting.json");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) prepareSitesBuild();
