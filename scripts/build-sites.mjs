import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { prepareSitesBuild } from "./prepare-sites-build.mjs";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const nextCli = fileURLToPath(new URL("../node_modules/next/dist/bin/next", import.meta.url));
const child = spawn(process.execPath, [nextCli, "build"], {
  cwd: projectRoot,
  stdio: "inherit",
  env: { ...process.env, JINGJIE_BUILD_TARGET: "sites" },
});
child.on("error", (error) => { console.error(error.message); process.exitCode = 1; });
child.on("exit", (code) => {
  if (code !== 0) { process.exitCode = code ?? 1; return; }
  prepareSitesBuild();
});
