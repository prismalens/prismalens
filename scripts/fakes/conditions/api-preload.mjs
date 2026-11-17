// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// Loaded into the PrismaLens API with `--import` to simulate host conditions (#1101); inert
// unless PRISMALENS_CONDITIONS names one. Start the API with:
//   NODE_OPTIONS="--import file:///<repo>/scripts/fakes/conditions/api-preload.mjs" PRISMALENS_CONDITIONS=standby,low-disk
// standby: wall time jumps when standby.mjs asks while timers do not run, as after a laptop
//          sleeps. low-disk: statfs reports 20 MB free and `git worktree add` fails with ENOSPC.
// fake-code-host: api.github.com answers in-process; fake-code-host.mjs sets its reply mode.
//                 It also takes job re-runs and serves a PR's files (#1176), and the PRs
//                 fake-code-host.mjs `pr` scripts (#1179 §11.1).
import childProcess from "node:child_process";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import { promisify } from "node:util";
import FakeTimers from "@sinonjs/fake-timers";
import { loadPr, PRS_DIR, savePr, sha1 } from "./fake-pr-state.mjs";
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
	const control = join(dir, "skip.json");
	// A restart starts past every skip so far, so the clock never steps back (#1179 OBJ-031).
	let applied = 0;
	let total = 0;
	try {
		const prior = JSON.parse(fs.readFileSync(control, "utf8"));
		applied = Number(prior.seq) || 0;
		total = Number(prior.total ?? prior.ms ?? 0) || 0;
	} catch {}
	const clock = FakeTimers.withGlobal(globalThis).install({
		toFake: ["Date"],
		shouldAdvanceTime: true,
		now: Date.now() + total,
	});
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
			: url.hostname === "gitlab.com" && url.pathname.startsWith("/api/v4/")
				? fakeGitlab(url, init, dir)
				: real(input, init);
	};
}

/** GitLab's discussion note: the same modes, a note id in place of a comment URL. */
async function fakeGitlab(
	/** @type {URL} */ url,
	/** @type {RequestInit | undefined} */ init,
	/** @type {string} */ dir,
) {
	const json = (/** @type {unknown} */ body, status = 200) =>
		new Response(JSON.stringify(body), {
			status,
			headers: { "content-type": "application/json" },
		});
	const m = /\/discussions\/([^/]+)\/notes$/.exec(url.pathname);
	if (init?.method !== "POST" || !m)
		return json(
			{ message: "fake code host: reads come from the fixture" },
			503,
		);
	const mode = readMode(dir);
	await new Promise((r) => setTimeout(r, 1500));
	if (mode === "no-scope") return json({ error: "insufficient_scope" }, 403);
	if (mode === "locked")
		return json({ message: "403 Forbidden - this discussion is locked" }, 403);
	const text = JSON.parse(String(init.body ?? "{}")).body;
	const n = record(dir, { thread: decodeURIComponent(m[1] ?? ""), body: text });
	return json({ id: 7000 + n, body: text, author: { username: "you" } }, 201);
}

function readMode(/** @type {string} */ dir) {
	try {
		return fs.readFileSync(join(dir, "mode"), "utf8").trim() || "ok";
	} catch {
		return "ok";
	}
}

/** Appends one post and returns how many there are. */
function record(/** @type {string} */ dir, /** @type {object} */ post) {
	const file = join(dir, "posts.jsonl");
	fs.appendFileSync(
		file,
		`${JSON.stringify({ ...post, at: new Date().toISOString() })}\n`,
	);
	return fs.readFileSync(file, "utf8").split("\n").filter(Boolean).length;
}

/**
 * A job re-run and a PR's files (#1176): `rerun-drop` records the re-run, then drops the
 * connection as a host that took it but never answered; `files-fail` answers files with 503.
 */
async function githubActions(
	/** @type {URL} */ url,
	/** @type {RequestInit | undefined} */ init,
	/** @type {string} */ dir,
	/** @type {(body: unknown, status?: number) => Response} */ json,
) {
	const mode = readMode(dir);
	const rerun = /^\/repos\/acme\/shop\/actions\/jobs\/(\d+)\/rerun$/.exec(
		url.pathname,
	);
	if (init?.method === "POST" && rerun) {
		if (mode === "no-scope")
			return json({ message: "Resource not accessible by integration" }, 403);
		fs.appendFileSync(
			join(dir, "reruns.jsonl"),
			`${JSON.stringify({ job: rerun[1], at: new Date().toISOString() })}\n`,
		);
		if (mode === "rerun-drop")
			throw new TypeError("fetch failed", {
				cause: Object.assign(new Error("socket hang up"), {
					code: "ECONNRESET",
				}),
			});
		return new Response(null, { status: 201 });
	}
	if (
		(init?.method ?? "GET") === "GET" &&
		/^\/repos\/acme\/shop\/pulls\/\d+\/files$/.test(url.pathname)
	) {
		if (mode === "files-fail")
			return json({ message: "fake code host: files are down" }, 503);
		if ((url.searchParams.get("page") ?? "1") !== "1") return json([]);
		return json([
			{
				filename: "packages/api/src/orders/query.ts",
				status: "modified",
				additions: 1,
				deletions: 1,
				patch:
					'@@ -31,1 +31,1 @@\n-\tconst rows = await db.order.findMany({ where: { customerId } });\n+\tconst rows = await db.order.findMany({ where: { customerId }, orderBy: { createdAt: "desc" } });',
			},
			{
				filename:
					"packages/api/prisma/migrations/0042_orders_index/migration.sql",
				status: "added",
				additions: 4200,
				deletions: 0,
			},
		]);
	}
	return null;
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
	const own = await githubActions(url, init, dir, json);
	if (own) return own;
	const scripted = await githubPr(url, init, dir);
	if (scripted) return scripted;
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

/** Appends one answered request to `requests.jsonl`. */
function logRequest(
	/** @type {string} */ dir,
	/** @type {string} */ method,
	/** @type {URL} */ url,
	/** @type {number} */ status,
) {
	fs.appendFileSync(
		join(dir, "requests.jsonl"),
		`${JSON.stringify({ method, path: `${url.pathname}${url.search}`, status, at: new Date().toISOString() })}\n`,
	);
}

/** Stamps the items the CLI wrote without a time, with the API's own clock, and saves them. */
function stamped(/** @type {string} */ file) {
	const pr = loadPr(file);
	if (!pr) return null;
	const now = new Date().toISOString();
	let touched = false;
	const stamp = (/** @type {any} */ o, /** @type {string[]} */ keys) => {
		for (const k of keys)
			if (k in o && o[k] === null) {
				o[k] = now;
				touched = true;
			}
	};
	for (const c of [...pr.comments, ...pr.reviewComments])
		stamp(c, ["created_at", "updated_at"]);
	for (const r of pr.reviews) stamp(r, ["submitted_at"]);
	for (const e of pr.events) stamp(e, ["created_at"]);
	if (pr.merged_at === "pending") {
		pr.merged_at = now;
		touched = true;
	}
	if (touched) savePr(file, pr);
	return pr;
}

/** The reset `fake-code-host.mjs mode rate-limit` set, when this request matches it. */
function limited(
	/** @type {string} */ dir,
	/** @type {URL} */ url,
	/** @type {boolean} */ graphql,
) {
	const file = join(dir, "limit.json");
	let l;
	try {
		l = JSON.parse(fs.readFileSync(file, "utf8"));
	} catch {
		return null;
	}
	if (l.until === null) {
		l.until = Date.now() + l.seconds * 1000;
		fs.writeFileSync(file, JSON.stringify(l));
	}
	if (Date.now() >= l.until) return null;
	if (graphql !== !!l.graphql) return null;
	if (!graphql && l.path && !new RegExp(l.path).test(url.pathname)) return null;
	return Math.ceil(l.until / 1000);
}

/** One page of `list` as GitHub pages it, with `Link`. */
function paged(
	/** @type {URL} */ url,
	/** @type {unknown[]} */ list,
	/** @type {(page: unknown[]) => unknown} */ wrap = (p) => p,
) {
	const per = Math.min(
		100,
		Number(url.searchParams.get("per_page") ?? 30) || 30,
	);
	const page = Math.max(1, Number(url.searchParams.get("page") ?? 1) || 1);
	const last = Math.max(1, Math.ceil(list.length / per));
	const at = (/** @type {number} */ n) => {
		const u = new URL(url);
		u.searchParams.set("page", String(n));
		return u.href;
	};
	const links = [];
	if (page < last)
		links.push(`<${at(page + 1)}>; rel="next"`, `<${at(last)}>; rel="last"`);
	if (page > 1)
		links.push(`<${at(1)}>; rel="first"`, `<${at(page - 1)}>; rel="prev"`);
	return {
		body: wrap(list.slice((page - 1) * per, page * per)),
		headers: links.length ? { link: links.join(", ") } : {},
	};
}

/** The scripted PRs of one repo, by file. */
function repoPrs(/** @type {string} */ owner, /** @type {string} */ name) {
	const files = fs.existsSync(PRS_DIR) ? fs.readdirSync(PRS_DIR) : [];
	return files
		.filter((f) => f.startsWith(`${owner}__${name}__`) && f.endsWith(".json"))
		.map((f) => loadPr(join(PRS_DIR, f)))
		.filter(Boolean);
}

/**
 * A scripted PR's reads (#1179 §11.1): the pull, its activity, events, checks, statuses,
 * head ref, compare, the viewer and the review-thread GraphQL read. Null leaves the
 * request to the fixture's answers.
 */
async function githubPr(
	/** @type {URL} */ url,
	/** @type {RequestInit | undefined} */ init,
	/** @type {string} */ dir,
) {
	const method = init?.method ?? "GET";
	const graphql = method === "POST" && url.pathname === "/graphql";
	const reqBody =
		graphql && typeof init?.body === "string" ? JSON.parse(init.body) : {};
	const threadsRead =
		graphql && String(reqBody.query ?? "").includes("reviewThreads");
	const at = /^\/repos\/([^/]+)\/([^/]+)\/(.*)$/.exec(url.pathname);
	const viewer = method === "GET" && url.pathname === "/user";
	const owner = at?.[1] ?? "";
	const name = at?.[2] ?? "";
	const rest = at?.[3] ?? "";
	if (!threadsRead && !viewer && !(method === "GET" && at)) return null;
	if (at && !repoPrs(owner, name).length) return null;
	const answer = (
		/** @type {unknown} */ body,
		status = 200,
		/** @type {Record<string, string>} */ headers = {},
	) => {
		const text = JSON.stringify(body);
		const etag = `"${sha1(text)}"`;
		const prior = new Headers(init?.headers).get("if-none-match");
		const code = status === 200 && prior === etag ? 304 : status;
		logRequest(dir, method, url, code);
		return new Response(code === 304 ? null : text, {
			status: code,
			headers: {
				"content-type": "application/json",
				etag,
				"x-ratelimit-limit": "5000",
				"x-ratelimit-remaining": "4999",
				"x-ratelimit-reset": String(Math.ceil(Date.now() / 1000) + 3600),
				...headers,
			},
		});
	};
	if (readMode(dir) === "down")
		return answer({ message: "fake code host: down" }, 503);
	const reset = limited(dir, url, graphql);
	if (reset !== null) {
		const spent = {
			"x-ratelimit-remaining": "0",
			"x-ratelimit-reset": String(reset),
		};
		return graphql
			? answer(
					{
						errors: [
							{ type: "RATE_LIMITED", message: "API rate limit exceeded" },
						],
					},
					200,
					spent,
				)
			: answer({ message: "API rate limit exceeded" }, 403, spent);
	}
	if (viewer) return answer({ login: "you" });
	if (threadsRead) {
		const v = reqBody.variables ?? {};
		const pr = stamped(
			join(PRS_DIR, `${v.owner}__${v.name}__${v.number}.json`),
		);
		if (!pr) return null;
		const start = v.after ? Number(String(v.after).slice(1)) : 0;
		const first = /reviewThreads\(first:(\d+)/.exec(reqBody.query)?.[1];
		const size = Number(first ?? 100);
		const nodes = pr.threads
			.slice(start, start + size)
			.map((/** @type {any} */ t) => {
				const c = { author: { login: "alice" }, body: "", url: t.url };
				return {
					id: t.id,
					isResolved: t.isResolved,
					isOutdated: false,
					path: t.path,
					line: t.line,
					originalLine: t.line,
					comments: { totalCount: 1, nodes: [c] },
					latest: { nodes: [c] },
				};
			});
		const more = start + size < pr.threads.length;
		return answer({
			data: {
				repository: {
					pullRequest: {
						reviewThreads: {
							pageInfo: {
								hasNextPage: more,
								endCursor: more ? `c${start + size}` : null,
							},
							nodes,
						},
					},
				},
			},
		});
	}
	const authored = (/** @type {any} */ o) => ({
		...o,
		user: { ...o.user, avatar_url: null },
	});
	const pullN = /^(pulls|issues)\/(\d+)(\/.*)?$/.exec(rest);
	if (pullN) {
		const pr = stamped(join(PRS_DIR, `${owner}__${name}__${pullN[2]}.json`));
		if (!pr) return null;
		const tail = pullN[3] ?? "";
		const since = url.searchParams.get("since");
		const after = (/** @type {any[]} */ list) =>
			since ? list.filter((c) => (c.updated_at ?? "") >= since) : list;
		const list = (/** @type {unknown[]} */ items) => {
			const p = paged(url, items);
			return answer(p.body, 200, p.headers);
		};
		if (tail === "" && pullN[1] === "pulls")
			return answer({
				number: pr.number,
				title: pr.title,
				state: pr.state,
				draft: pr.draft,
				merged: !!pr.merged_at,
				merged_at: pr.merged_at,
				mergeable: !pr.conflicts,
				mergeable_state: pr.conflicts ? "dirty" : "clean",
				head: {
					sha: pr.head.sha,
					ref: pr.head.ref,
					repo: { full_name: pr.repo },
				},
				base: { ref: pr.base },
				user: { login: "alice", avatar_url: null },
				requested_reviewers: [],
				requested_teams: [],
				html_url: `https://github.com/${pr.repo}/pull/${pr.number}`,
			});
		if (tail === "/comments" && pullN[1] === "issues")
			return list(after(pr.comments).map(authored));
		if (tail === "/comments")
			return list(after(pr.reviewComments).map(authored));
		if (tail === "/reviews") return list(pr.reviews.map(authored));
		if (tail === "/events") return list(pr.events);
		if (tail === "/files") return answer([]);
		return null;
	}
	const prs = repoPrs(owner, name);
	const ref = /^git\/ref\/heads\/(.+)$/.exec(rest);
	if (ref) {
		const branch = decodeURIComponent(ref[1] ?? "");
		const pr = prs.find((p) => p.head.ref === branch);
		return pr
			? answer({
					ref: `refs/heads/${branch}`,
					object: { sha: pr.head.sha },
				})
			: null;
	}
	const commit = /^commits\/([0-9a-f]+)\/(check-runs|status|statuses)$/.exec(
		rest,
	);
	if (commit) {
		const sha = commit[1];
		const pr = prs.find(
			(p) =>
				p.head.sha === sha ||
				p.checkRuns.some((/** @type {any} */ r) => r.head_sha === sha),
		);
		if (!pr) return null;
		const runs = pr.checkRuns.filter(
			(/** @type {any} */ r) => r.head_sha === sha,
		);
		const statuses = pr.statuses.filter(
			(/** @type {any} */ s) => s.sha === sha,
		);
		if (commit[2] === "status") return answer({ state: "success", statuses });
		const p =
			commit[2] === "check-runs"
				? paged(url, runs, (page) => ({
						total_count: runs.length,
						check_runs: page,
					}))
				: paged(url, statuses);
		return answer(p.body, 200, p.headers);
	}
	const compare = /^compare\/([0-9a-f]+)\.\.\.([0-9a-f]+)$/.exec(rest);
	if (compare) {
		for (const pr of prs) {
			const push = pr.pushes.find(
				(/** @type {any} */ p) => p.to === compare[2],
			);
			if (push)
				return answer({
					status:
						push.forced || push.from !== compare[1] ? "diverged" : "ahead",
					ahead_by: 1,
					behind_by: push.forced ? 1 : 0,
					commits: [],
				});
		}
	}
	return null;
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
