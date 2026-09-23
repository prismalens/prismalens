#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Launch the unpacked app from `electron-builder --dir` on an empty workspace,
 * let it boot its backend, pair its window and render, and assert the capture
 * it writes (PRISMALENS_DESKTOP_SMOKE). The CI desktop job runs this on every
 * OS, under xvfb on Linux.
 *
 *   node scripts/smoke-desktop.mjs <out.png>
 */

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const release = resolve(here, "../release");
const out = resolve(process.argv[2] ?? "desktop-smoke.png");
const TIMEOUT_MS = 180_000;
const MIN_PNG_BYTES = 10_000;

/** The unpacked app's executable, whatever electron-builder named the directory. */
function executable() {
	for (const dir of readdirSync(release)) {
		const base = join(release, dir);
		if (!statSync(base).isDirectory()) continue;
		const candidates =
			process.platform === "darwin"
				? [join(base, "PrismaLens.app", "Contents", "MacOS", "PrismaLens")]
				: process.platform === "win32"
					? [join(base, "PrismaLens.exe")]
					: [join(base, "prismalens")];
		const found = candidates.find((p) => existsSync(p));
		if (found) return found;
	}
	throw new Error(`no unpacked app under ${release}`);
}

const bin = executable();
const workspace = mkdtempSync(join(tmpdir(), "pl-desktop-smoke-"));
// A CI runner's Chromium sandbox helper is not setuid; the smoke runs unsandboxed there.
const args = process.platform === "linux" ? ["--no-sandbox"] : [];
console.log(`launching ${bin} on ${workspace}`);
const child = spawn(bin, args, {
	env: {
		...process.env,
		PRISMALENS_WORKSPACE_DIR: workspace,
		PRISMALENS_DESKTOP_SMOKE: out,
	},
	stdio: "inherit",
});
const timer = setTimeout(() => {
	console.error(`no capture within ${TIMEOUT_MS / 1000}s; killing the app`);
	child.kill("SIGKILL");
}, TIMEOUT_MS);
child.on("exit", (code, signal) => {
	clearTimeout(timer);
	if (!existsSync(out)) {
		console.error(
			`app exited (code=${code} signal=${signal}) without writing ${out}`,
		);
		process.exit(1);
	}
	const bytes = statSync(out).size;
	if (bytes < MIN_PNG_BYTES) {
		console.error(`${out} is ${bytes} bytes: a blank window, not the app`);
		process.exit(1);
	}
	console.log(`ok: ${out} (${bytes} bytes), app exited with ${code}`);
});
