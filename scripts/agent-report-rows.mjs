// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// Turns the probe's failing-row files into the batch .github/actions/report-failure files (#1154), one issue
// per agent and OS. Artifact fields are data: names and rows are allowlisted, and none reaches a shell.
// Usage: agent-report-rows.mjs <failures-dir> <probe-result> <run-url> > batch.json
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const NAME_OK = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const ROW_OK = /^[A-Za-z0-9@/._ (),-]{1,120}$/;
const PREFIX = "Agent probe failing: ";

export function rowsToBatch(files, runUrl) {
	const bodies = new Map();
	for (const [fileName, text] of files) {
		const os = fileName.replace(/^probe-failures-/, "").replace(/\.tsv$/, "");
		if (!NAME_OK.test(os))
			throw new Error("refusing OS name from the artifact");
		for (const line of text.split("\n").filter(Boolean)) {
			const [agent, what, detail = ""] = line.split("\t");
			if (!NAME_OK.test(agent) || !ROW_OK.test(what ?? ""))
				throw new Error("refusing a row from the artifact");
			const key = `${agent}@${os}`;
			if (!bodies.has(key))
				bodies.set(key, ["Failing rows in the last red run:", ""]);
			bodies
				.get(key)
				.push(`- ${what}: ${detail.replace(/[\r\n]/g, " ").slice(0, 500)}`);
		}
	}
	return [...bodies].map(([key, lines]) => ({
		title: `${PREFIX}${key.split("@")[0]} on ${key.split("@")[1]}`,
		body: [
			...lines,
			"",
			runUrl,
			"",
			"Posted by the agent-release-watch workflow.",
		].join("\n"),
		labels: [],
		ok: false,
	}));
}

export function openProbeTitles() {
	const out = execFileSync(
		"gh",
		[
			"issue",
			"list",
			"--state",
			"open",
			"--limit",
			"100",
			"--search",
			`"${PREFIX}" in:title`,
			"--json",
			"title",
		],
		{ encoding: "utf8" },
	);
	return JSON.parse(out)
		.map((issue) => issue.title)
		.filter((title) => title.startsWith(PREFIX));
}

/** A red leg with no row to file is an error, so a lost artifact is never a green report. */
export function buildBatch({ files, probeResult, runUrl, openTitles = [] }) {
	const reds = rowsToBatch(files, runUrl);
	if (probeResult !== "success" && reds.length === 0)
		throw new Error(
			`a probe leg was ${probeResult} but no failing row reached the report`,
		);
	if (probeResult !== "success") return reds;
	const current = new Set(reds.map((item) => item.title));
	const closing = openTitles
		.filter((title) => !current.has(title))
		.map((title) => ({ title, body: "", labels: [], ok: true }));
	return [...reds, ...closing];
}

export function main([dir, probeResult, runUrl], openTitles = openProbeTitles) {
	const names = readdirSync(dir).filter((name) =>
		/^probe-failures-.*\.tsv$/.test(name),
	);
	const files = names.map((name) => [
		name,
		readFileSync(join(dir, name), "utf8"),
	]);
	return buildBatch({
		files,
		probeResult,
		runUrl,
		openTitles: probeResult === "success" ? openTitles() : [],
	});
}

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(process.argv[1]).href
) {
	process.stdout.write(JSON.stringify(main(process.argv.slice(2))));
}
