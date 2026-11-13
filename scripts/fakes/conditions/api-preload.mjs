// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// Loaded into the PrismaLens API with `--import` to simulate host conditions (#1101); inert
// unless PRISMALENS_CONDITIONS names one. Start the API with:
//   NODE_OPTIONS="--import file:///<repo>/scripts/fakes/conditions/api-preload.mjs" PRISMALENS_CONDITIONS=standby,low-disk
// standby: wall time jumps when standby.mjs asks while timers do not run, as after a laptop
//          sleeps. low-disk: statfs reports 20 MB free and `git worktree add` fails with ENOSPC.
import childProcess from "node:child_process";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import { promisify } from "node:util";
import FakeTimers from "@sinonjs/fake-timers";
import { stateDir } from "./lib.mjs";

const on = new Set(
	(process.env.PRISMALENS_CONDITIONS ?? "").split(",").filter(Boolean),
);
export const LOW_DISK_FREE_BYTES = 20 * 1024 * 1024;

if (on.has("standby")) {
	const dir = stateDir("standby");
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(join(dir, "api.pid"), String(process.pid));
	// Only Date: setTimeout and setInterval keep the monotonic clock, as Node's do across a sleep.
	const clock = FakeTimers.withGlobal(globalThis).install({
		toFake: ["Date"],
		shouldAdvanceTime: true,
		now: Date.now(),
	});
	let applied = 0;
	const control = join(dir, "skip.json");
	const poll = setInterval(() => {
		try {
			const { seq, ms } = JSON.parse(fs.readFileSync(control, "utf8"));
			if (seq <= applied) return;
			applied = seq;
			clock.setSystemTime(clock.now + ms);
			fs.writeFileSync(
				join(dir, "applied.json"),
				JSON.stringify({ seq, ms, now: new Date().toISOString() }),
			);
		} catch {}
	}, 200);
	poll.unref();
}

if (on.has("low-disk")) {
	/** @param {any} s */
	const low = (s) =>
		Object.assign(s, {
			bavail: Math.floor(LOW_DISK_FREE_BYTES / s.bsize),
			bfree: Math.floor(LOW_DISK_FREE_BYTES / s.bsize),
		});
	const statfs = fs.statfs;
	fs.statfs = /** @type {any} */ (path, opts, cb) => {
		const done = typeof opts === "function" ? opts : cb;
		statfs(path, typeof opts === "function" ? {} : opts, (err, s) =>
			done(err, err ? s : low(s)),
		);
	};
	const statfsSync = fs.statfsSync;
	fs.statfsSync = /** @type {any} */ (
		(path, opts) => low(statfsSync(path, opts))
	);
	const statfsP = fs.promises.statfs;
	fs.promises.statfs = /** @type {any} */ (
		async (path, opts) => low(await statfsP(path, opts))
	);

	/** @param {unknown} file @param {unknown} args */
	const worktreeAdd = (file, args) =>
		/(^|[\\/])git(\.exe)?$/i.test(String(file)) &&
		Array.isArray(args) &&
		args.includes("worktree") &&
		args.includes("add");
	const enospc = () =>
		Object.assign(new Error("Command failed: git worktree add"), {
			code: 128,
			stdout: "",
			stderr:
				"fatal: could not create leading directories: No space left on device\n",
		});
	const execFile = childProcess.execFile;
	/** @type {any} */
	const wrapped = (/** @type {any[]} */ ...a) => {
		if (!worktreeAdd(a[0], a[1])) return execFile(...a);
		const cb = a.findLast((x) => typeof x === "function");
		queueMicrotask(() => cb?.(enospc(), "", enospc().stderr));
		return childProcess.spawn(process.execPath, ["-e", ""]);
	};
	const custom = /** @type {any} */ (execFile)[promisify.custom];
	wrapped[promisify.custom] = (/** @type {any[]} */ ...a) =>
		worktreeAdd(a[0], a[1]) ? Promise.reject(enospc()) : custom(...a);
	childProcess.execFile = wrapped;
	syncBuiltinESMExports();
}
