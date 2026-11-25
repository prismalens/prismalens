// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// One issue per failing scheduled job, found by its exact title: red opens, reopens or rewrites it,
// green comments and closes it. Used by .github/actions/report-failure (#1154). All text is data:
// it reaches `gh` as an argument or a body file, never through a shell.
import { execFileSync } from "node:child_process";
import {
	appendFileSync,
	existsSync,
	mkdtempSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const MAX_BODY = 60_000;
const LABEL_OK = /^[A-Za-z0-9][A-Za-z0-9 ._:/-]{0,49}$/;

export function realGh(args) {
	return execFileSync("gh", args, {
		encoding: "utf8",
		maxBuffer: 64 * 1024 * 1024,
	});
}

export function parseLabels(raw) {
	const labels = String(raw ?? "")
		.split(",")
		.map((label) => label.trim())
		.filter(Boolean);
	for (const label of labels) {
		if (!LABEL_OK.test(label))
			throw new Error(`refusing label ${JSON.stringify(label)}`);
	}
	return labels;
}

function clip(text) {
	return text.length > MAX_BODY
		? `${text.slice(0, MAX_BODY)}\n\n(truncated)`
		: text;
}

/** Returns what it did: "created" | "updated" | "reopened" | "closed" | "none". */
export function reportFailure({
	title,
	body = "",
	labels = [],
	ok,
	runUrl,
	repo,
	gh = realGh,
	dryRun = false,
	say = console.log,
}) {
	if (!title || /[\r\n]/.test(title))
		throw new Error("title must be one non-empty line");
	const dir = mkdtempSync(join(tmpdir(), "report-failure-"));
	const bodyFile = join(dir, "body.md");
	writeFileSync(bodyFile, clip(body));
	const run = (args) => {
		if (dryRun) {
			say(`Dry run, would run: gh ${args.join(" ")}`);
			return "";
		}
		return gh(args);
	};
	const found = JSON.parse(
		gh([
			"issue",
			"list",
			"-R",
			repo,
			"--state",
			"all",
			"--limit",
			"100",
			"--search",
			`"${title}" in:title`,
			"--json",
			"number,title,state",
		]),
	).filter((issue) => issue.title === title);
	const open = found.find((issue) => issue.state === "OPEN");
	const closed = found.find((issue) => issue.state === "CLOSED");

	if (ok) {
		if (!open) return "none";
		run([
			"issue",
			"close",
			String(open.number),
			"-R",
			repo,
			"--comment",
			`green again: ${runUrl}`,
		]);
		return "closed";
	}
	if (dryRun) say(body);
	if (open) {
		run([
			"issue",
			"edit",
			String(open.number),
			"-R",
			repo,
			"--body-file",
			bodyFile,
		]);
		return "updated";
	}
	const known = new Set(
		JSON.parse(
			gh(["label", "list", "-R", repo, "--limit", "200", "--json", "name"]),
		).map((label) => label.name),
	);
	const addable = labels.filter((label) => known.has(label));
	if (closed) {
		run([
			"issue",
			"reopen",
			String(closed.number),
			"-R",
			repo,
			"--comment",
			`Red again: ${runUrl}`,
		]);
		run([
			"issue",
			"edit",
			String(closed.number),
			"-R",
			repo,
			"--body-file",
			bodyFile,
			...addable.flatMap((label) => ["--add-label", label]),
		]);
		return "reopened";
	}
	run([
		"issue",
		"create",
		"-R",
		repo,
		"--title",
		title,
		"--body-file",
		bodyFile,
		...addable.flatMap((label) => ["--label", label]),
	]);
	return "created";
}

const asBool = (value) => String(value).trim().toLowerCase() === "true";

export function main(env = process.env, gh = realGh) {
	const say = (line) => {
		console.log(line);
		if (env.GITHUB_STEP_SUMMARY)
			appendFileSync(
				env.GITHUB_STEP_SUMMARY,
				`${line}
`,
			);
	};
	const common = {
		repo: env.REPO,
		runUrl: env.RUN_URL,
		dryRun: asBool(env.DRY_RUN),
		gh,
		say,
	};
	const items = env.BATCH_FILE
		? JSON.parse(readFileSync(env.BATCH_FILE, "utf8"))
		: [
				{
					title: env.TITLE,
					body:
						env.BODY_FILE && existsSync(env.BODY_FILE)
							? readFileSync(env.BODY_FILE, "utf8")
							: env.BODY,
					labels: env.LABELS,
					ok: env.OK,
				},
			];
	for (const item of items) {
		const result = reportFailure({
			...common,
			title: item.title,
			body: item.body,
			labels: Array.isArray(item.labels)
				? item.labels.flatMap((l) => parseLabels(l))
				: parseLabels(item.labels),
			ok: typeof item.ok === "boolean" ? item.ok : asBool(item.ok),
		});
		console.log(`${result}: ${item.title}`);
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
	main();
