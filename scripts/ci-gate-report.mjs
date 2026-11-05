#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// Says what kind of red each `CI` job is and how long jobs waited for a runner (#1052), so nobody
// reads a log to learn that a job never started. `CI gate` runs it; ci-rerun-unstarted.yml reuses it.
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

/**
 * @typedef {{ name: string, conclusion: string | null, created_at?: string, started_at?: string | null,
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

/** Every red job except `CI gate` itself never started: a runner shortage, not a code failure. */
export function rerunnable(/** @type {Red[]} */ reds, gate = "CI gate") {
	const rest = reds.filter((r) => r.name !== gate);
	return rest.length > 0 && rest.every((r) => r.kind === "never started");
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
		"[.jobs[] | {name, conclusion, created_at, started_at, completed_at, html_url, steps: [.steps[]? | {name, conclusion}]}]",
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
		if (!rerunnable(reds))
			return console.log("not rerunning: not only never-started jobs");
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
