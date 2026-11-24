// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// The tracking-issue body for a mutation run (#1154): survived mutants from the shards' HTML reports, shards
// whose Stryker step failed, and shards that never ran it to an end (runner lost, timed out) as infra.
// Usage: mutation-report.mjs <reports-dir> <jobs.json> <run-url> > batch.json
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export const TITLE = "Mutation testing: survivors or failed shards";
const MAX_LISTED = 40;
const SAFE = /[^A-Za-z0-9@/._ ():,-]/g;

export function classify(jobs) {
	const red = [];
	const infra = [];
	for (const job of jobs.filter((j) => j.name.startsWith("stryker ("))) {
		if (job.conclusion === "success" || job.conclusion === "skipped") continue;
		const step = (job.steps ?? []).find((s) => s.name === "Run Stryker");
		const entry = { name: job.name.replace(SAFE, "?"), url: job.html_url };
		(step?.conclusion === "failure" ? red : infra).push(entry);
	}
	return { red, infra };
}

/** Survived mutants out of one Stryker HTML report: the report JSON sits in a script as `.report = {...}`. */
export function survivors(html) {
	const start = html.indexOf(".report = ");
	if (start < 0) throw new Error("no embedded report in the mutation HTML");
	const end = html.indexOf(";</script>", start);
	const report = JSON.parse(
		html.slice(start + ".report = ".length, end < 0 ? undefined : end),
	);
	return Object.entries(report.files ?? {}).flatMap(([file, data]) =>
		(data.mutants ?? [])
			.filter((m) => m.status === "Survived")
			.map((m) => ({
				file: file.replace(SAFE, "?"),
				line: m.location?.start?.line ?? 0,
				mutator: String(m.mutatorName).replace(SAFE, "?"),
			})),
	);
}

function htmlReports(dir) {
	const found = [];
	for (const entry of readdirSync(dir, {
		withFileTypes: true,
		recursive: true,
	})) {
		if (entry.isFile() && entry.name === "index.html")
			found.push(join(entry.parentPath, entry.name));
	}
	return found;
}

export function buildBatch({ survived, red, infra, runUrl, lostReports }) {
	const ok =
		survived.length === 0 &&
		red.length === 0 &&
		infra.length === 0 &&
		lostReports === 0;
	const lines = [`Mutation run: ${runUrl}`, ""];
	if (red.length)
		lines.push(
			"Red shards (Stryker failed):",
			...red.map((j) => `- ${j.name} ${j.url}`),
			"",
		);
	if (infra.length)
		lines.push(
			"Infra, not a test finding (runner lost, cancelled or timed out before Stryker ended):",
			...infra.map((j) => `- ${j.name} ${j.url}`),
			"",
		);
	if (lostReports)
		lines.push(`${lostReports} shard(s) passed but uploaded no report.`, "");
	if (survived.length) {
		lines.push(
			`Survived mutants: ${survived.length}${survived.length > MAX_LISTED ? ` (first ${MAX_LISTED} listed)` : ""}`,
		);
		lines.push(
			...survived
				.slice(0, MAX_LISTED)
				.map((s) => `- \`${s.file}:${s.line}\` ${s.mutator}`),
			"",
		);
	}
	lines.push(
		"This issue closes itself on the next run with none of the above.",
	);
	return [{ title: TITLE, body: lines.join("\n"), labels: [], ok }];
}

export function main([reportsDir, jobsFile, runUrl]) {
	const parsed = JSON.parse(readFileSync(jobsFile, "utf8"));
	const jobs = Array.isArray(parsed) ? parsed : parsed.jobs;
	const { red, infra } = classify(jobs);
	const reports = htmlReports(reportsDir);
	const survived = reports.flatMap((file) =>
		survivors(readFileSync(file, "utf8")),
	);
	const passed = jobs.filter(
		(j) => j.name.startsWith("stryker (") && j.conclusion === "success",
	).length;
	const lostReports = Math.max(0, passed - reports.length);
	return buildBatch({ survived, red, infra, runUrl, lostReports });
}

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(process.argv[1]).href
) {
	process.stdout.write(JSON.stringify(main(process.argv.slice(2))));
}
