// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// CI cost lens (plan §4). Counting only.
//   cost [N]   per workflow, the median over the last N (default 3) completed runs of the summed job
//              minutes, each job rounded up. The budget is the ratchet row measure/ci-minutes <workflow>.
//   fakes      CI uses fake agents only: provider secrets or real-agent keys in workflows and e2e.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { record, root, sh } from "./lib.mjs";

const gh = (args) => JSON.parse(sh("gh", args));
const repo = "prismalens/prismalens";

function cost(n) {
	const flows = gh([
		"api",
		`repos/${repo}/actions/workflows`,
		"--jq",
		'{w: [.workflows[] | select(.state=="active") | {id, path}]}',
	]).w;
	let over = 0;
	for (const w of flows) {
		const runs = gh([
			"api",
			`repos/${repo}/actions/workflows/${w.id}/runs?per_page=${n}&status=completed`,
			"--jq",
			"{r: [.workflow_runs[] | {id, event}]}",
		]).r;
		if (!runs.length) continue;
		const mins = runs
			.map((r) => {
				const jobs = gh([
					"api",
					`repos/${repo}/actions/runs/${r.id}/jobs?per_page=100`,
					"--jq",
					"{j: [.jobs[] | select(.started_at and .completed_at) | {s: .started_at, c: .completed_at}]}",
				]).j;
				return jobs.reduce(
					(a, j) => a + Math.ceil((Date.parse(j.c) - Date.parse(j.s)) / 60000),
					0,
				);
			})
			.sort((a, b) => a - b);
		const median = mins[Math.floor(mins.length / 2)];
		const name = w.path.replace(".github/workflows/", "");
		console.log(
			`ci.minutes ${name} median ${median} over ${mins.length} runs (${runs.map((r) => r.event).join(",")})`,
		);
		if (!record("ci-minutes", name, median)) over++;
	}
	console.log(`ci.minutes workflows over budget: ${over}`);
}

const NAMES =
	"(ANTHROPIC|OPENAI|GEMINI|GOOGLE_API|OPENROUTER|CLAUDE_CODE_OAUTH)w*";
// A secret handed to a workflow, or a value read from the process environment; fixtures that only name a key do not count.
const PROVIDER = new RegExp(
	String.raw`secrets\.${NAMES}|process\.env\.${NAMES}|^\s*${NAMES}:\s*\S`,
);
// The two review bots run Claude on purpose; they are not a CI case.
const BOTS = new Set(["claude.yml", "claude-code-review.yml"]);

function* walk(dir) {
	for (const e of readdirSync(dir, { withFileTypes: true })) {
		if (e.name === "node_modules" || e.name === "test-results") continue;
		const p = join(dir, e.name);
		if (e.isDirectory()) yield* walk(p);
		else if (/\.(ya?ml|[mc]?[jt]s)$/.test(e.name)) yield p;
	}
}

function fakes() {
	const hits = [];
	const scan = (file, label) => {
		readFileSync(file, "utf8")
			.split("\n")
			.forEach((l, i) => {
				if (PROVIDER.test(l))
					hits.push(`${label}:${i + 1}: ${l.trim().slice(0, 100)}`);
			});
	};
	for (const f of readdirSync(join(root, ".github/workflows")).filter(
		(f) => /\.ya?ml$/.test(f) && !BOTS.has(f),
	))
		scan(join(root, ".github/workflows", f), `.github/workflows/${f}`);
	for (const dir of ["packages/frontend/e2e"])
		for (const f of walk(join(root, dir)))
			scan(
				f,
				f
					.slice(root.length + 1)
					.split("\\")
					.join("/"),
			);
	scan(
		join(root, "packages/frontend/playwright.config.ts"),
		"packages/frontend/playwright.config.ts",
	);
	for (const h of hits) console.log(h);
	console.log(`ci.real-agent-refs ${hits.length}`);
	record("ci", "real-agent-refs", hits.length);
}

const [cmd, arg] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (cmd === "cost") cost(Number(arg) || 3);
else if (cmd === "fakes") fakes();
else {
	console.error(
		"usage: node scripts/measure/ci-cost.mjs cost [N]|fakes [--allow-raise]",
	);
	process.exit(2);
}
