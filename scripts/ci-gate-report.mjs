#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// Says what kind of red each `CI` job is and how long jobs waited for a runner (#1052), so nobody
// reads a log to learn that a job never started. `CI gate` runs it; ci-rerun-unstarted.yml reuses it.
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

/**
 * @typedef {{ id?: number, name: string, conclusion: string | null, created_at?: string, started_at?: string | null,
 *   completed_at?: string | null, html_url?: string, steps?: { name: string, conclusion: string | null }[] }} Job
 * @typedef {{ kind: "failed" | "timed out" | "never started" | "cancelled mid-run", name: string, step: string, url: string }} Red
 */

/** A job that ran no step and was cancelled never got a runner, or its run was cancelled first. */
export function classify(/** @type {Job[]} */ jobs) {
	/** @type {Red[]} */
	const reds = [];
	for (const job of jobs) {
		const steps = job.steps ?? [];
		const step =
			steps.find(
				(s) => s.conclusion === "failure" || s.conclusion === "cancelled",
			)?.name ?? "-";
		const url = job.html_url ?? "";
		const base = { name: job.name, step, url };
		if (job.conclusion === "failure") reds.push({ kind: "failed", ...base });
		else if (job.conclusion === "timed_out")
			reds.push({ kind: "timed out", ...base });
		else if (job.conclusion === "cancelled")
			reds.push({
				kind: steps.length === 0 ? "never started" : "cancelled mid-run",
				...base,
			});
	}
	return reds;
}

/** Only cancellations, no failed step: running the red jobs again is all it takes. */
export function onlyCancelled(/** @type {Red[]} */ reds) {
	return (
		reds.length > 0 &&
		reds.every(
			(r) => r.kind === "never started" || r.kind === "cancelled mid-run",
		)
	);
}

/** A network fault the runner hit, never a result of the code under test. */
const NETWORK_ERRORS = [
	/\bfetch failed\b/,
	/\b(ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|ECONNREFUSED)\b/,
	/\bsocket hang up\b/,
	/\b(502 Bad Gateway|503 Service Unavailable|504 Gateway Time-?out)\b/,
];
/** Anything that says a check itself failed: then the job is not retried. */
const CHECK_FAILED = [
	/AssertionError/,
	/SMOKE FAIL/,
	/^\s*(not ok|FAIL|×) /m,
	/Test Files .* failed/,
];

/**
 * A failed job whose last lines before its error name a network fault, and no failed check:
 * the download or upload broke, not the code. Read from the job's log.
 */
export function networkFailure(/** @type {string} */ log) {
	const lines = log.split("\n");
	const end = lines.findIndex((l) => l.includes("##[error]"));
	const tail = lines
		.slice(
			Math.max(0, (end < 0 ? lines.length : end) - 40),
			end < 0 ? undefined : end + 1,
		)
		.join("\n");
	return (
		NETWORK_ERRORS.some((re) => re.test(tail)) &&
		!CHECK_FAILED.some((re) => re.test(log))
	);
}

/**
 * Every red job except `CI gate` itself never started, or failed on a network fault: a runner
 * shortage or a broken download, not a code failure. `network` names the jobs whose log shows one.
 */
export function rerunnable(
	/** @type {Red[]} */ reds,
	gate = "CI gate",
	/** @type {Set<string>} */ network = new Set(),
) {
	const rest = reds.filter((r) => r.name !== gate);
	return (
		rest.length > 0 &&
		rest.every(
			(r) =>
				r.kind === "never started" ||
				(r.kind === "failed" && network.has(r.name)),
		)
	);
}

/**
 * Names of the failed jobs whose log shows a network fault. A log that cannot be read (not ready,
 * expired, no permission) is unknown, never a network fault: that job is simply not listed.
 */
export function networkFailedJobs(
	/** @type {Job[]} */ jobs,
	/** @type {(id: number) => string} */ readLog,
	/** @type {(message: string) => void} */ warn = () => {},
) {
	/** @type {Set<string>} */
	const names = new Set();
	for (const job of jobs) {
		if (job.conclusion !== "failure" || job.id === undefined) continue;
		let log;
		try {
			log = readLog(job.id);
		} catch (error) {
			warn(`log of "${job.name}" unavailable, so not rerunning it: ${error}`);
			continue;
		}
		if (networkFailure(log)) names.add(job.name);
	}
	return names;
}

/** Jobs that waited at least `minutes` between being queued and starting (or being cancelled). */
export function queueWaits(/** @type {Job[]} */ jobs, minutes = 10) {
	/** @type {{ name: string, minutes: number }[]} */
	const waits = [];
	for (const job of jobs) {
		const began = job.started_at ?? job.completed_at;
		if (!job.created_at || !began) continue;
		const waited = (Date.parse(began) - Date.parse(job.created_at)) / 60000;
		if (waited >= minutes)
			waits.push({ name: job.name, minutes: Math.floor(waited) });
	}
	return waits.sort((a, b) => b.minutes - a.minutes);
}

/** @param {string[]} args */
const gh = (args) =>
	execFileSync("gh", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

function listJobs(/** @type {NodeJS.ProcessEnv} */ env) {
	const out = gh([
		"api",
		"--paginate",
		`repos/${env.REPO}/actions/runs/${env.RUN_ID}/jobs?per_page=100`,
		"--jq",
		"[.jobs[] | {id, name, conclusion, created_at, started_at, completed_at, html_url, steps: [.steps[]? | {name, conclusion}]}]",
	]);
	/** @type {Job[]} */
	return out
		.split("\n")
		.filter(Boolean)
		.flatMap((line) => JSON.parse(line));
}

function main(/** @type {NodeJS.ProcessEnv} */ env) {
	const jobs = listJobs(env);
	const reds = classify(jobs);
	const waits = queueWaits(jobs);
	const lines = reds.map(
		(r) =>
			`  ${r.kind}: ${r.name}${
				r.kind === "never started"
					? " was cancelled before a runner took it (no runner free, or the run was cancelled), not a code failure"
					: ` / ${r.step}`
			} -> ${r.url}`,
	);
	for (const w of waits) lines.push(`  queued ${w.minutes} min: ${w.name}`);
	console.log(lines.join("\n"));
	if (waits.length > 0)
		console.log(
			"::notice::Jobs waited 10 min or more for a runner. The Free plan runs 20 jobs at once and 5 on macOS (#1052).",
		);
	if (reds.length > 0 && onlyCancelled(reds))
		console.log(
			`::notice::Only cancelled jobs, no failed step. Rerun just them: gh run rerun ${env.RUN_ID} --failed`,
		);
	if (env.GITHUB_STEP_SUMMARY && lines.length > 0)
		appendFileSync(
			env.GITHUB_STEP_SUMMARY,
			`### CI gate\n\n\`\`\`\n${lines.join("\n")}\n\`\`\`\n`,
		);
	if (env.RERUN === "1") {
		const network = networkFailedJobs(
			jobs,
			(id) =>
				// Logs carry colour codes, which `gh api` refuses to print without this flag.
				gh([
					"api",
					"--allow-escape-sequences",
					`repos/${env.REPO}/actions/jobs/${id}/logs`,
				]),
			(message) => console.log(`::warning::${message}`),
		);
		if (!rerunnable(reds, "CI gate", network))
			return console.log(
				"not rerunning: a red job failed for a reason other than a network fault",
			);
		if (env.DRY_RUN === "1")
			return console.log(
				`dry run: would rerun the failed jobs of run ${env.RUN_ID}`,
			);
		console.log(`rerunning the failed jobs of run ${env.RUN_ID} once`);
		gh([
			"run",
			"rerun",
			String(env.RUN_ID),
			"--failed",
			"-R",
			String(env.REPO),
		]);
	}
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href)
	main(process.env);
