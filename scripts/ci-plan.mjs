#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// Decides what a `CI` run has to run (#1052), so a push that needs nothing starts no runner:
//   skip    "true": the PR head tree already passed `CI`, or the PR changes only docs.
//   full    "true": the release-only proofs (the release side checks on all three OSes, the systemd service) run.
//   agents  "true": the five agent qualification legs run.
//   defer   "true": a draft release PR; nothing runs and `CI gate` stays red until it is marked ready.
// A tier runs unless every changed path is on its safe list, so an unlisted path costs minutes, not a missed check.
// Anything that is not a pull request (main, the nightly) plans everything.
// ci.yml's `CI gate` reads these three and lets exactly the matching jobs be skipped.
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

/** Root-level Markdown and issue templates: nothing a build, a test or the tarball reads. */
const DOCS = [
	/^[^/]+\.md$/,
	/^\.github\/ISSUE_TEMPLATE\//,
	/^\.github\/[^/]+\.md$/,
];

/** Paths that cannot change what the tarball does on another OS or under systemd. Any other path turns `full` on. */
const SAFE_FOR_FULL = [
	/\.md$/,
	/\.(spec|test)\.[cm]?[jt]sx?$/,
	/^docs\//,
	/^packages\/(frontend|desktop)\//,
	/^\.github\/(ISSUE_TEMPLATE\/|assets\/|CODEOWNERS$|dependabot\.yml$)/,
	/^(\.coderabbit\.yaml|\.worktreeinclude|biome\.json|\.editorconfig|\.gitignore|\.gitattributes|LICENSE)$/,
];

/** Paths outside the agent qualification's inputs (the engine's workspace closure, the script, its fakes, the pins). */
const SAFE_FOR_AGENTS = [
	...SAFE_FOR_FULL,
	/^packages\/(api|cli)\//,
	/^packages\/@prismalens\/(auth|database|logger)\//,
	/^\.github\/workflows\/(?!ci\.yml$)/,
];

/** An unlisted path counts as unsafe, so a new package runs the tier until someone lists it. */
const needs = (/** @type {RegExp[]} */ safe, /** @type {string[]} */ files) =>
	files.length === 0 || files.some((f) => !safe.some((p) => p.test(f)));

/**
 * @param {{
 *   event: string,
 *   files: string[],
 *   labels?: string[],
 *   headRef?: string,
 *   sameTreeAs?: string | null,
 *   draft?: boolean,
 * }} input
 * @returns {{ skip: boolean, full: boolean, agents: boolean, reason: string, defer?: boolean }}
 */
export function plan({
	event,
	files,
	labels = [],
	headRef = "",
	sameTreeAs = null,
	draft = false,
}) {
	if (event !== "pull_request")
		return {
			skip: false,
			full: true,
			agents: true,
			reason: `${event}: everything runs`,
		};
	// release-please rebuilds this PR on every push to main; CI runs once, when it is marked ready.
	if (draft && headRef.startsWith("release-please--"))
		return {
			skip: true,
			full: false,
			agents: false,
			defer: true,
			reason: "draft release PR: CI waits until it is marked ready for review",
		};
	if (sameTreeAs)
		return {
			skip: true,
			full: false,
			agents: false,
			reason: `tree identical to ${sameTreeAs}, which already passed CI: nothing re-run`,
		};
	if (files.length > 0 && files.every((f) => DOCS.some((p) => p.test(f))))
		return {
			skip: true,
			full: false,
			agents: false,
			reason: "docs only: nothing to build or test",
		};
	const release = headRef.startsWith("release-please--");
	const forced = labels.includes("full-ci");
	return {
		skip: false,
		full: release || forced || needs(SAFE_FOR_FULL, files),
		agents: release || forced || needs(SAFE_FOR_AGENTS, files),
		reason: release
			? "release PR: everything runs"
			: forced
				? "label full-ci: everything runs"
				: "path filters",
	};
}

/** @param {string[]} args */
const gh = (args) =>
	execFileSync("gh", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

/**
 * An earlier passing `CI` run on this PR branch whose head commit has the same tree, if any.
 * The run list carries each head commit's tree, as Git's own skip-if-redundant job reads it.
 */
function earlierPassWithSameTree(/** @type {NodeJS.ProcessEnv} */ env) {
	const { REPO, HEAD_SHA, HEAD_REF, HEAD_REPO } = env;
	const mine = gh([
		"api",
		`repos/${REPO}/git/commits/${HEAD_SHA}`,
		"--jq",
		".tree.sha",
	]).trim();
	const runs = JSON.parse(
		gh([
			"api",
			`repos/${REPO}/actions/workflows/ci.yml/runs?event=pull_request&status=success&per_page=50&branch=${encodeURIComponent(String(HEAD_REF))}`,
			"--jq",
			"[.workflow_runs[] | {sha: .head_sha, tree: .head_commit.tree_id, repo: .head_repository.full_name}]",
		]),
	);
	const hit = runs.find(
		(r) => r.repo === HEAD_REPO && r.sha !== HEAD_SHA && r.tree === mine,
	);
	return hit ? hit.sha : null;
}

function main(/** @type {NodeJS.ProcessEnv} */ env) {
	const event = String(env.EVENT_NAME);
	/** @type {string[]} */
	let files = [];
	/** @type {string | null} */
	let sameTreeAs = null;
	if (event === "pull_request") {
		files = gh([
			"api",
			"--paginate",
			`repos/${env.REPO}/pulls/${env.PR_NUMBER}/files`,
			"--jq",
			".[].filename",
		])
			.split("\n")
			.filter(Boolean);
		try {
			sameTreeAs = earlierPassWithSameTree(env);
		} catch (error) {
			// A failed lookup must cost a full run, never a skipped one.
			console.log(`tree lookup failed, running everything: ${error}`);
		}
	}
	const result = plan({
		event,
		files,
		labels: JSON.parse(env.LABELS || "[]"),
		headRef: env.HEAD_REF || "",
		sameTreeAs,
		draft: env.DRAFT === "true",
	});
	const lines = [
		`skip=${result.skip}`,
		`full=${result.full}`,
		`agents=${result.agents}`,
		`defer=${Boolean(result.defer)}`,
		`reason=${result.reason}`,
	];
	console.log(lines.join("\n"));
	if (env.GITHUB_OUTPUT)
		appendFileSync(env.GITHUB_OUTPUT, `${lines.join("\n")}\n`);
	if (env.GITHUB_STEP_SUMMARY)
		appendFileSync(
			env.GITHUB_STEP_SUMMARY,
			`**CI plan:** ${result.reason} (full=${result.full}, agents=${result.agents})\n`,
		);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href)
	main(process.env);
