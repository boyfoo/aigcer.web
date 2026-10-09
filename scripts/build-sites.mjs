import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import nextEnv from "@next/env";
import { prepareSitesBuild } from "./prepare-sites-build.mjs";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
// The parent also exports OSS bytes after Next.js exits, so both use the production configuration.
nextEnv.loadEnvConfig(projectRoot, false);
const nextCli = fileURLToPath(new URL("../node_modules/next/dist/bin/next", import.meta.url));
const child = spawn(process.execPath, [nextCli, "build"], {
  cwd: projectRoot,
  stdio: "inherit",
  env: { ...process.env, JINGJIE_BUILD_TARGET: "sites" },
});
child.on("error", (error) => { console.error(error.message); process.exitCode = 1; });
child.on("exit", async (code) => {
  if (code !== 0) { process.exitCode = code ?? 1; return; }
  try { await prepareSitesBuild(); }
  catch (error) { console.error(error); process.exitCode = 1; }
});
