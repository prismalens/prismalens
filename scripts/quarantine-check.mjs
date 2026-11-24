// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// Caps the e2e quarantine (#1154): every `@quarantine` tag names an open issue under 14 days old on its
// own line, and at most 5 tags exist. A quarantine without an owner is a deleted test.
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";

export const MAX_TAGS = 5;
export const MAX_AGE_DAYS = 14;
const TAG = /@quarantine\b/;
const LEADING_BLOCK = /^\s*(?:\/\*.*?\*\/\s*)+/;
const SKIPPED_DIRS = new Set([
	"node_modules",
	"test-results",
	"playwright-report",
]);

export function findTags(root) {
	const tags = [];
	const walk = (dir) => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const path = join(dir, entry.name);
			if (entry.isDirectory()) {
				if (!SKIPPED_DIRS.has(entry.name)) walk(path);
			} else if (/\.(feature|ts|mts|js|mjs)$/.test(entry.name)) {
				const comment = entry.name.endsWith(".feature")
					? /^\s*#/
					: /^\s*(\/\/|\/\*|\*)/;
				readFileSync(path, "utf8")
					.split("\n")
					.forEach((text, index) => {
						// Prose about the tag is never a tag; code after a leading block comment still is.
						const code = text.replace(LEADING_BLOCK, "");
						if (TAG.test(code) && !comment.test(code))
							tags.push({
								file: relative(root, path).split("\\").join("/"),
								line: index + 1,
								text,
							});
					});
			}
		}
	};
	walk(root);
	return tags;
}

export function ghIssue(number, repo) {
	const args = ["issue", "view", String(number), "--json", "state,createdAt"];
	return JSON.parse(
		execFileSync("gh", repo ? [...args, "-R", repo] : args, {
			encoding: "utf8",
		}),
	);
}

/** Returns one message per offence; empty means the quarantine is within its limits. */
export function check(tags, { issue = ghIssue, now = Date.now(), repo } = {}) {
	const problems = [];
	if (tags.length > MAX_TAGS)
		problems.push(
			`${tags.length} @quarantine tags; at most ${MAX_TAGS} are allowed`,
		);
	for (const tag of tags) {
		const where = `${tag.file}:${tag.line}`;
		const number = /#(\d+)\b/.exec(tag.text)?.[1];
		if (!number) {
			problems.push(
				`${where}: names no issue; put its #number on the same line as @quarantine`,
			);
			continue;
		}
		let found;
		try {
			found = issue(Number(number), repo);
		} catch {
			problems.push(`${where}: #${number} could not be read`);
			continue;
		}
		if (found.state !== "OPEN")
			problems.push(
				`${where}: #${number} is ${found.state.toLowerCase()}; remove the tag or open a new issue`,
			);
		else {
			const days = Math.floor((now - Date.parse(found.createdAt)) / 86_400_000);
			if (days >= MAX_AGE_DAYS)
				problems.push(
					`${where}: #${number} is ${days} days old; the limit is ${MAX_AGE_DAYS - 1}. Fix the test or remove the tag`,
				);
		}
	}
	return problems;
}

export function main(root = "packages/frontend/e2e") {
	const tags = findTags(root);
	const problems = check(tags, { repo: process.env.GITHUB_REPOSITORY });
	for (const problem of problems) console.error(`quarantine: ${problem}`);
	console.log(
		`quarantine: ${tags.length} tag(s), ${problems.length} problem(s)`,
	);
	return problems.length === 0 ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
	process.exit(main(process.argv[2]));
