// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// Loaded into the PrismaLens API with `--import` to simulate host conditions (#1101); inert
// unless PRISMALENS_CONDITIONS names one. Start the API with:
//   NODE_OPTIONS="--import file:///<repo>/scripts/fakes/conditions/api-preload.mjs" PRISMALENS_CONDITIONS=standby,low-disk
// standby: wall time jumps when standby.mjs asks while timers do not run, as after a laptop
//          sleeps. low-disk: statfs reports 20 MB free and `git worktree add` fails with ENOSPC.
// fake-code-host: api.github.com answers in-process; fake-code-host.mjs sets its reply mode.
import childProcess from "node:child_process";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import { promisify } from "node:util";
import FakeTimers from "@sinonjs/fake-timers";
import { stateDir } from "./lib.mjs";

// Only the server: `pl up`, or the API's own main. npm, the CLI's other commands and a
// run's children see NODE_OPTIONS too and must stay real.
const server =
	process.argv.slice(2).includes("up") ||
	/[\\/]dist[\\/]src[\\/]main(\.js)?$/.test(process.argv[1] ?? "");
const on = new Set(
	server
		? (process.env.PRISMALENS_CONDITIONS ?? "").split(",").filter(Boolean)
		: [],
);
/** low-disk touches only paths that contain this, so other conditions keep a real disk. */
const LOW_DISK_MATCH =
	process.env.PRISMALENS_LOW_DISK_MATCH ?? "git-fixture-disk";
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

if (on.has("fake-code-host")) {
	const dir = stateDir("fake-code-host");
	fs.mkdirSync(dir, { recursive: true });
	const real = globalThis.fetch;
	globalThis.fetch = async (input, init) => {
		const href =
			typeof input === "string"
				? input
				: input instanceof URL
					? input.href
					: input.url;
		const url = new URL(href);
		return url.hostname === "api.github.com"
			? fakeGithub(url, init, dir)
			: real(input, init);
	};
}

/** The review-reply write and nothing else: reads stay the fixture's recorded data. */
async function fakeGithub(
	/** @type {URL} */ url,
	/** @type {RequestInit | undefined} */ init,
	/** @type {string} */ dir,
) {
	const json = (/** @type {unknown} */ body, status = 200) =>
		new Response(JSON.stringify(body), {
			status,
			headers: { "content-type": "application/json" },
		});
	const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};
	if (
		init?.method !== "POST" ||
		url.pathname !== "/graphql" ||
		!String(body.query).includes("addPullRequestReviewThreadReply")
	)
		return json(
			{ message: "fake code host: reads come from the fixture" },
			503,
		);
	let mode = "ok";
	try {
		mode = fs.readFileSync(join(dir, "mode"), "utf8").trim() || "ok";
	} catch {}
	// Slow enough that a second press lands while the first is in flight.
	await new Promise((r) => setTimeout(r, 1500));
	if (mode === "no-scope")
		return json({
			errors: [
				{
					type: "INSUFFICIENT_SCOPES",
					message:
						"Your token has not been granted the required scopes to execute this query.",
				},
			],
		});
	if (mode === "locked")
		return json({
			errors: [
				{
					type: "UNPROCESSABLE",
					message:
						"Unable to create comment because the conversation is locked.",
				},
			],
		});
	const { thread, body: text } = body.variables ?? {};
	fs.appendFileSync(
		join(dir, "posts.jsonl"),
		`${JSON.stringify({ thread, body: text, at: new Date().toISOString() })}\n`,
	);
	const n = fs
		.readFileSync(join(dir, "posts.jsonl"), "utf8")
		.split("\n").length;
	return json({
		data: {
			addPullRequestReviewThreadReply: {
				comment: {
					author: { login: "you" },
					body: text,
					url: `https://github.com/acme/shop/pull/412#discussion_r${9000 + n}`,
				},
			},
		},
	});
}

if (on.has("low-disk")) {
	/** @param {any} s */
	const low = (s, /** @type {unknown} */ path) =>
		!String(path).includes(LOW_DISK_MATCH)
			? s
			: Object.assign(s, {
					bavail: Math.floor(LOW_DISK_FREE_BYTES / s.bsize),
					bfree: Math.floor(LOW_DISK_FREE_BYTES / s.bsize),
				});
	const statfs = fs.statfs;
	fs.statfs = /** @type {any} */ (path, opts, cb) => {
		const done = typeof opts === "function" ? opts : cb;
		statfs(path, typeof opts === "function" ? {} : opts, (err, s) =>
			done(err, err ? s : low(s, path)),
		);
	};
	const statfsSync = fs.statfsSync;
	fs.statfsSync = /** @type {any} */ (
		(path, opts) => low(statfsSync(path, opts), path)
	);
	const statfsP = fs.promises.statfs;
	fs.promises.statfs = /** @type {any} */ (
		async (path, opts) => low(await statfsP(path, opts), path)
	);

	/** The repo is the call's cwd, not an argument. @param {unknown} file @param {unknown} args @param {any} opts */
	const worktreeAdd = (file, args, opts) =>
		/(^|[\\/])git(\.exe)?$/i.test(String(file)) &&
		Array.isArray(args) &&
		args.includes("worktree") &&
		args.includes("add") &&
		[...args, opts?.cwd].some((x) => String(x).includes(LOW_DISK_MATCH));
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
		if (!worktreeAdd(a[0], a[1], a[2])) return execFile(...a);
		const cb = a.findLast((x) => typeof x === "function");
		queueMicrotask(() => cb?.(enospc(), "", enospc().stderr));
		return childProcess.spawn(process.execPath, ["-e", ""]);
	};
	const custom = /** @type {any} */ (execFile)[promisify.custom];
	wrapped[promisify.custom] = (/** @type {any[]} */ ...a) =>
		worktreeAdd(a[0], a[1], a[2]) ? Promise.reject(enospc()) : custom(...a);
	childProcess.execFile = wrapped;
	syncBuiltinESMExports();
}
