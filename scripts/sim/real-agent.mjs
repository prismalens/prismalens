// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// `pnpm sim real-agent` (#1101, checkpoint 5): one small task with an agent installed on this
// machine, not a fake. It boots its own sim with --real-agents, asks the server which agent
// answers, gives it the fixture repo's off-by-one bug, approves its asks as the user would,
// then checks the fix with `node --test` in the thread's worktree and shoots the thread.
// No agent answers: it prints why and skips (exit 0).
// `--case rewind` (#1193) then sends a second message, edits it, and fails unless claude-code
// opened the edit on its own fork and codex on a replay, with no folded prompt sent again.
//   pnpm sim real-agent [--agent claude-code|codex] [--case rewind] [--out <dir>] [--minutes 10]
import { execFileSync, execSync } from "node:child_process";
import {
	cpSync,
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { ACTIVE, connect, events, sleep } from "../fakes/conditions/lib.mjs";
import { ROOT } from "./lib.mjs";

const AGENTS = ["claude-code", "codex"];
const FIXTURE = join(ROOT, "scripts/fakes/real-agent-repo");
const TASK =
	"The test in test/sum.test.js fails. Fix src/sum.js so `node --test` passes, and change nothing else.";

const log = (/** @type {string} */ m) => console.log(`[real-agent] ${m}`);

/** The message the rewind folds, and its edit (#1193). */
const FOLDED =
	"Also add a comment above the loop in src/sum.js that says why it starts at 0.";
const EDITED = "Instead, add a one-line JSDoc to sum() in src/sum.js.";
/** How each agent must open the edited message: its own fork, or a replay handoff. */
const REWIND_OPENING = /** @type {Record<string, string>} */ ({
	"claude-code": "fork",
	codex: "handoff",
});

/** @param {string[]} argv @param {string} name */
const opt = (argv, name) => {
	const i = argv.indexOf(name);
	return i > -1 ? argv[i + 1] : undefined;
};

const git = (/** @type {string} */ cwd, /** @type {string[]} */ args) =>
	execFileSync("git", args, { cwd, encoding: "utf8", windowsHide: true });

/** The fixture as a fresh repo with one commit, as a user's project would be. */
function fixtureRepo(/** @type {string} */ dir) {
	rmSync(dir, { recursive: true, force: true });
	cpSync(FIXTURE, dir, { recursive: true });
	git(dir, ["init", "-q", "-b", "main"]);
	git(dir, [
		"-c",
		"user.email=sim@prismalens.local",
		"-c",
		"user.name=sim",
		"add",
		".",
	]);
	git(dir, [
		"-c",
		"user.email=sim@prismalens.local",
		"-c",
		"user.name=sim",
		"commit",
		"-q",
		"-m",
		"cart: sum the items",
	]);
	return dir;
}

/** `node --test` in a folder: whether it passed, and its last lines. */
function nodeTest(/** @type {string} */ cwd) {
	try {
		const out = execFileSync(process.execPath, ["--test"], {
			cwd,
			encoding: "utf8",
			windowsHide: true,
			stdio: ["ignore", "pipe", "pipe"],
		});
		return { pass: true, tail: out.trim().split("\n").slice(-4).join("\n") };
	} catch (e) {
		const err = /** @type {{ stdout?: string }} */ (e);
		return {
			pass: false,
			tail: (err.stdout ?? "").trim().split("\n").slice(-6).join("\n"),
		};
	}
}

/** @param {string[]} argv */
export async function main(argv) {
	const sim = join(ROOT, ".sim-real-agent");
	const out = resolve(opt(argv, "--out") ?? join(sim, "walk"));
	const minutes = Number(opt(argv, "--minutes") ?? 10);
	const wanted = opt(argv, "--agent");
	const kase = opt(argv, "--case");
	if (kase && kase !== "rewind") throw new Error(`no case ${kase}`);
	const candidates = wanted ? [wanted] : AGENTS;
	const built = existsSync(
		join(ROOT, "packages/frontend/dist/client/index.html"),
	);
	const env = {
		...process.env,
		PRISMALENS_SIM_DIR: sim,
		// A build already on disk is reused, as several sims share one dist.
		...(built ? { PRISMALENS_SIM_PREBUILT: "1" } : {}),
	};
	const simCmd = (/** @type {string[]} */ args) =>
		execFileSync(
			process.execPath,
			[join(ROOT, "scripts/sim/sim.mjs"), ...args],
			{
				cwd: ROOT,
				env,
				stdio: "inherit",
				windowsHide: true,
			},
		);
	log(`booting its own sim in ${sim}${built ? " on the existing build" : ""}`);
	simCmd(["up", "--profile", "bare", "--mode", "built", "--real-agents"]);
	const state = JSON.parse(readFileSync(join(sim, "state.json"), "utf8"));
	try {
		process.env.PRISMALENS_WORKSPACE_DIR = state.workspace;
		const { api } = await connect(state.url);
		/** @type {Record<string, string>} */
		const tried = {};
		let agent = null;
		for (const id of candidates) {
			const probe = await api("/settings/harness/check", {
				method: "POST",
				body: { id },
			});
			tried[id] =
				`${probe.outcome}${probe.version ? ` ${probe.version}` : ""}: ${probe.detail}`;
			if (probe.outcome === "answers-acp") {
				agent = { id, version: probe.version ?? null };
				break;
			}
		}
		mkdirSync(out, { recursive: true });
		if (!agent) {
			const why = Object.entries(tried)
				.map(([k, v]) => `${k}: ${v}`)
				.join("; ");
			log(`skipped: no installed agent answers (${why})`);
			writeFileSync(
				join(out, "report.json"),
				`${JSON.stringify({ skipped: true, tried }, null, 2)}\n`,
			);
			return 0;
		}
		log(`${agent.id} ${agent.version ?? ""} answers; starting the task`);
		await api("/settings/harness", {
			method: "PATCH",
			body: { harness: agent.id },
		});
		const repo = fixtureRepo(join(sim, "cart"));
		const project = await api("/repositories/source", {
			method: "POST",
			body: { source: repo },
		});
		const started = Date.now();
		const { investigationId: id } = await api("/threads", {
			method: "POST",
			body: {
				subject: { kind: "project", repositoryId: project.id },
				text: TASK,
				workIn: "worktree",
			},
		});
		let approved = 0;
		let run = null;
		const until = started + minutes * 60_000;
		const settle = async () => {
			while (Date.now() < until) {
				const { asks } = await api("/threads/asks");
				for (const { ask, ended } of asks)
					if (!ended && ask.threadId === id && ask.kind === "permission") {
						await api(`/investigations/${id}/asks/${ask.askId}`, {
							method: "POST",
							body: { askId: ask.askId, decision: "approve" },
							ok: [404, 409],
						});
						approved++;
					}
				run = await api(`/investigations/${id}`);
				if (!ACTIVE.includes(run.status)) return;
				await sleep(2000);
			}
		};
		await settle();
		/** @type {null | { pass: boolean, opening: string | null, forkFailed: string | null, refolded: boolean, why: string }} */
		let rewind = null;
		if (kase === "rewind") rewind = await rewindCase(api, id, agent.id, settle);
		const ms = Date.now() - started;
		const cwd = run?.workspace?.cwd ?? null;
		const test =
			cwd && existsSync(cwd)
				? nodeTest(cwd)
				: { pass: false, tail: "no worktree" };
		const changed = cwd
			? git(cwd, ["status", "--porcelain"]).trim().split("\n").filter(Boolean)
			: [];
		const { statuses } = await api("/threads/statuses", {
			method: "POST",
			body: { ids: [id] },
		});
		const report = {
			agent,
			thread: `${state.url}/threads/${id}`,
			runStatus: run?.status ?? "unknown",
			status: statuses?.[id]?.status ?? null,
			minutes: Math.round(ms / 600) / 100,
			approvedAsks: approved,
			events: (await events(api, id)).length,
			changed,
			testsPass: test.pass,
			testTail: test.tail,
			timedOut: Date.now() >= until,
			...(rewind ? { rewind } : {}),
		};

		const token = execSync(
			"pnpm --silent --filter prismalens dev pair --operator",
			{
				cwd: ROOT,
				windowsHide: true,
				encoding: "utf8",
				env: { ...process.env, PRISMALENS_WORKSPACE_DIR: state.workspace },
			},
		).match(/\/pair#([^\s#]+)/)?.[1];
		const { chromium } = createRequire(
			join(ROOT, "packages/frontend/package.json"),
		)("@playwright/test");
		const browser = await chromium.launch();
		try {
			const page = await browser.newPage({
				viewport: { width: 1440, height: 900 },
			});
			await page.goto(`${state.url}/pair#${token}`);
			await page.waitForURL(/\/(new|incidents|threads)/, { timeout: 60_000 });
			for (const [w, h] of [
				[1440, 900],
				[390, 844],
			]) {
				await page.setViewportSize({ width: w, height: h });
				await page.goto(report.thread);
				await page.waitForLoadState("load").catch(() => {});
				await page.waitForTimeout(1500);
				await page.screenshot({ path: join(out, `real-agent-${w}-dark.png`) });
			}
		} finally {
			await browser.close();
		}
		writeFileSync(
			join(out, "report.json"),
			`${JSON.stringify(report, null, 2)}\n`,
		);
		log(
			`${report.testsPass ? "passed" : "FAILED"}: ${agent.id} ran ${report.minutes} min, ${approved} ask(s) approved, changed ${changed.join(", ") || "nothing"}, status ${report.status}; ${out}`,
		);
		if (rewind)
			log(
				`rewind ${rewind.pass ? "passed" : "FAILED"}: opened ${rewind.opening ?? "nothing"}${rewind.forkFailed ? ` (${rewind.forkFailed})` : ""}; ${rewind.why}`,
			);
		return report.testsPass && (!rewind || rewind.pass) ? 0 : 1;
	} finally {
		simCmd(["down"]);
	}
}

/**
 * Sends FOLDED, edits it to EDITED and reads how the edited message opened: claude-code must
 * keep its fork, codex replay, and the edited prompt must not carry the folded one (#1193).
 * @param {(p: string, init?: { method?: string, body?: unknown, ok?: number[] }) => Promise<any>} api
 * @param {string} id @param {string} agentId @param {() => Promise<void>} settle
 */
async function rewindCase(api, id, agentId, settle) {
	await api(`/investigations/${id}/messages`, {
		method: "POST",
		body: { text: FOLDED },
	});
	await settle();
	const before = await events(api, id);
	const sent = before.find(
		(e) => e.kind === "operator_message" && e.text === FOLDED,
	);
	if (!sent)
		return {
			pass: false,
			opening: null,
			forkFailed: null,
			refolded: false,
			why: "the second message is not in the record",
		};
	const preview = await api(`/threads/${id}/rewind?seq=${sent.seq}`);
	const repos = Object.fromEntries(
		preview.repos
			.filter((/** @type {{ state: string }} */ r) => r.state === "ok")
			.map((/** @type {{ repo: string, head: string, tree: string }} */ r) => [
				r.repo,
				{ head: r.head, tree: r.tree },
			]),
	);
	const result = await api(`/threads/${id}/rewind`, {
		method: "POST",
		body: {
			id,
			seq: sent.seq,
			text: EDITED,
			expect: {
				messageOrdinal: preview.messageOrdinal,
				revision: preview.revision,
				repos,
			},
			include: [],
		},
	});
	if (result.state !== "done" || !result.sent)
		return {
			pass: false,
			opening: null,
			forkFailed: null,
			refolded: false,
			why: `the rewind answered ${result.state}${result.reason ? ` (${result.reason})` : ""}${result.why ? `: ${result.why}` : ""}`,
		};
	await settle();
	const after = await events(api, id);
	const marker = after.findIndex(
		(e) => e.kind === "thread_rewound" && e.rewindId === result.rewindId,
	);
	const tail = marker < 0 ? [] : after.slice(marker);
	const opened = tail.find((e) => e.kind === "session_opened");
	const input = tail.find((e) => e.kind === "turn_input");
	const body = input
		? await api(`/investigations/${id}/turn-inputs/${input.inputId}`, {
				ok: [404],
			})
		: null;
	const sentText = (body?.parts ?? [])
		.map((/** @type {{ text?: string }} */ p) => p.text ?? "")
		.join("\n");
	const refolded = sentText.includes(FOLDED);
	const want = REWIND_OPENING[agentId];
	const opening = opened?.how ?? null;
	const fails = [];
	if (opening !== want) fails.push(`opened ${opening}, not ${want}`);
	if (!input) fails.push("no prompt was recorded after the rewind");
	else if (!body) fails.push("the edited prompt's body was not stored");
	if (refolded) fails.push("the edited prompt carried the folded message");
	return {
		pass: fails.length === 0,
		opening,
		forkFailed: opened?.forkFailed ?? null,
		refolded,
		why: fails.length
			? fails.join("; ")
			: `opened ${opening} with no folded prompt`,
	};
}
