import {spawnSync} from "node:child_process";
import path from "node:path";
import {fileURLToPath} from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

function pnpmCommand() {
  const execPath = process.env.npm_execpath;
  if (execPath && execPath.toLowerCase().includes("pnpm")) {
    return {command: process.execPath, prefix: [execPath]};
  }
  return {command: "pnpm", prefix: []};
}

function runPnpm(args, label) {
  const {command, prefix} = pnpmCommand();
  console.log(`\n> ${label}`);
  const result = spawnSync(command, [...prefix, ...args], {
    cwd: root,
    stdio: "inherit",
    env: process.env,
  });
  if (result.error) {
    console.error(`Failed to run '${label}': ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function runScript(name) {
  runPnpm(["run", name], `pnpm run ${name}`);
}

for (const script of ["typecheck", "build", "test:unit"]) runScript(script);
runPnpm(["exec", "playwright", "install", "chromium"], "pnpm exec playwright install chromium");
runScript("test:e2e");
