#!/usr/bin/env node
/**
 * 静态构建：把 src/app/api 临时移走（静态导出不允许服务端接口），
 * 构建完成后自动还原。产物在 out/，可直接放到 EdgeOne / OSS / 任意静态托管。
 */
import { existsSync, renameSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";

const api = join(process.cwd(), "src", "app", "api");
const parked = join(process.cwd(), "src", "app", "_api_parked");
let moved = false;

try {
  if (existsSync(api)) { renameSync(api, parked); moved = true; }
  execSync(`"${process.execPath}" "${join(process.cwd(), "node_modules", "next", "dist", "bin", "next")}" build`, {
    stdio: "inherit",
    env: { ...process.env, PM_STATIC: "1" },
  });
} finally {
  if (moved && existsSync(parked)) renameSync(parked, api);
}
