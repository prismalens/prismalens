#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// An npm install in CI that retries while the registry propagates a version published
// minutes ago: the packument lists it before its tarball serves, so E404 / ETARGET
// (svix 2.9.0 on 2026-10-23, #906). Bounded: 4 retries over about 4 minutes.
//
//   node scripts/lib/npm-install-retry.mjs npm install <args...>

import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const RETRYABLE = /\b(E404|ETARGET)\b/;
export const DELAYS_S = [15, 30, 60, 120];

const sleepSync = (seconds) =>
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, seconds * 1000);

/**
 * Runs `command args` like execFileSync, echoing its output, and retries a
 * propagation failure. `stdout: "ignore"` drops the command's stdout.
 */
export function installWithRetry(
	command,
	args,
	{
		stdout = "inherit",
		delays = DELAYS_S,
		run = spawnSync,
		sleep = sleepSync,
		log = (line) => console.error(line),
		...options
	} = {},
) {
	for (let attempt = 0; ; attempt++) {
		const r = run(command, args, {
			...options,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		});
		if (r.error) throw r.error;
		if (stdout === "inherit" && r.stdout) process.stdout.write(r.stdout);
		if (r.stderr) process.stderr.write(r.stderr);
		if (r.status === 0) return r.stdout;
		const hit = RETRYABLE.exec(`${r.stdout}\n${r.stderr}`);
		if (!hit || attempt >= delays.length)
			throw new Error(`${command} ${args.join(" ")} exited ${r.status}`);
		log(
			`::warning::npm hit ${hit[1]}, likely a version still propagating on the registry; retry ${attempt + 1}/${delays.length} in ${delays[attempt]}s`,
		);
		sleep(delays[attempt]);
	}
}

if (
	process.argv[1] &&
	resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	const [command, ...args] = process.argv.slice(2);
	if (!command) {
		console.error("usage: npm-install-retry.mjs npm install <args...>");
		process.exit(2);
	}
	try {
		// npm is a .cmd shim on Windows, which only a shell starts; a shell takes one string.
		if (process.platform === "win32")
			installWithRetry(
				[command, ...args].map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(" "),
				[],
				{ shell: true },
			);
		else installWithRetry(command, args);
	} catch (e) {
		console.error(e.message);
		process.exit(1);
	}
}
