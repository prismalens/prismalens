#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// Decides what a `CI` run has to run (#1052, #1053), so a push that needs nothing starts no runner:
//   skip    "true": the PR head tree already passed `CI`, or the PR changes only docs. Only `CI gate` runs.
//   code    "false": only CI-only paths changed, so build, unit tests, the tarball and its smoke are skipped.
//   e2e     "false": nothing the browser suite boots changed.
//   intake  "false": nothing the packed tarball's intake and database-upgrade checks read changed.
//   full    "true": a release PR, or a path the release proofs read; `proofs.yml` runs its OS, service and upgrade-chain proofs.
//   agents  "true": the agent qualification legs run (`proofs.yml`).
//   defer   "true": a draft release PR; nothing runs and `CI gate` stays red until it is marked ready.
// A tier runs unless every changed path is on its safe list, so an unlisted path costs minutes, not a missed check.
// A renamed file counts under both its names. Anything that is not a pull request (main) runs the PR tiers.
// ci.yml's `CI gate` allows a skip only where the plan says `false` in so many words.
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

/** Root-level Markdown and issue templates: nothing a build, a test or the tarball reads. */
const DOCS = [
	/^[^/]+\.md$/,
	/^\.github\/ISSUE_TEMPLATE\//,
	/^\.github\/[^/]+\.md$/,
];

/** Repo metadata no job reads. */
const METADATA = [
	/\.md$/,
	/^docs\//,
	/^\.github\/(ISSUE_TEMPLATE\/|assets\/|CODEOWNERS$|dependabot\.yml$)/,
	/^(\.coderabbit\.yaml|\.worktreeinclude|biome\.json|\.editorconfig|\.gitignore|\.gitattributes|LICENSE)$/,
];

/** Paths whose tests run in `lint` and whose behaviour only the nightly or release proofs exercise. */
const CI_ONLY = [
	...METADATA,
	/^\.github\/workflows\/(?!ci\.yml$|e2e-browser\.yml$)/,
	/^scripts\/(ci-plan|ci-gate-report|agent-probe|agent-tested|agent-adapter-sdk|gate-side-checks|packed-upgrade-chain|admission-fake)(\.test)?\.mjs$/,
	/^scripts\/(workflow-pins\.test\.mjs|agent-pins\.json)$/,
];

/** What the browser suite boots, on top of the CI-only paths. The desktop shell is not part of it. */
const SAFE_FOR_E2E = [...CI_ONLY, /^packages\/desktop\//];

/** The intake and upgrade checks read the app, never the UI or the desktop shell. */
const SAFE_FOR_INTAKE = [
	...CI_ONLY,
	/^packages\/(frontend|desktop)\//,
	/^scripts\/(e2e-libs|playwright-summary)\./,
];

/** What the release proofs read: packaging, the gate scripts and the workflows that run them. */
const FULL_INPUTS = [
	/^scripts\/(pack-cli|check-artifact|gate-side-checks|packed-upgrade-chain|packed-upgrade-smoke|build-standalone|artifact-budgets)[.-]/,
	/^scripts\/(install|lib)\//,
	/^\.github\/workflows\/(ci|proofs|nightly)\.yml$/,
	/^\.release-please-manifest\.json$/,
];

/** Paths outside the agent qualification's inputs (the engine's workspace closure, the script, its fakes, the pins). */
const SAFE_FOR_AGENTS = [
	...METADATA,
	/\.(spec|test)\.[cm]?[jt]sx?$/,
	/^packages\/(frontend|desktop|api|cli)\//,
	/^packages\/@prismalens\/(auth|database|logger)\//,
	/^\.github\/workflows\/(?!ci\.yml$|proofs\.yml$|nightly\.yml$)/,
	/^scripts\/(ci-plan|ci-gate-report|gate-side-checks|packed-upgrade-chain|packed-upgrade-smoke|workflow-pins)(\.test)?\.mjs$/,
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
 *   readyOnPassedHead?: boolean,
 * }} input
 * @returns {{ skip: boolean, code: boolean, e2e: boolean, intake: boolean, full: boolean, agents: boolean, reason: string, defer?: boolean }}
 */
export function plan({
	event,
	files,
	labels = [],
	headRef = "",
	sameTreeAs = null,
	draft = false,
	readyOnPassedHead = false,
}) {
	const none = {
		skip: true,
		code: false,
		e2e: false,
		intake: false,
		full: false,
		agents: false,
	};
	if (event !== "pull_request")
		return {
			skip: false,
			code: true,
			e2e: true,
			intake: true,
			full: false,
			agents: false,
			reason: `${event}: the PR checks run; the release proofs run nightly`,
		};
	// release-please rebuilds this PR on every push to main; CI waits until it is marked ready.
	if (draft && headRef.startsWith("release-please--"))
		return {
			...none,
			defer: true,
			reason: "draft release PR: CI waits until it is marked ready for review",
		};
	// "Ready for review" starts a run; a head that already passed CI as a draft has nothing left to prove.
	if (readyOnPassedHead)
		return {
			...none,
			reason: "marked ready for review: this head already passed CI",
		};
	if (sameTreeAs)
		return {
			...none,
			reason: `tree identical to ${sameTreeAs}, which already passed CI: nothing re-run. A head made with "git merge -s ours" lacks main's other changes (CONTRIBUTING.md, Landing a stack)`,
		};
	if (files.length > 0 && files.every((f) => DOCS.some((p) => p.test(f))))
		return { ...none, reason: "docs only: nothing to build or test" };
	const release = headRef.startsWith("release-please--");
	const forced = labels.includes("full-ci");
	const code = needs(CI_ONLY, files);
	return {
		skip: false,
		code,
		e2e: code && needs(SAFE_FOR_E2E, files),
		intake: code && needs(SAFE_FOR_INTAKE, files),
		full: release || forced || files.some((f) => FULL_INPUTS.some((p) => p.test(f))),
		agents: release || forced || needs(SAFE_FOR_AGENTS, files),
		reason: release
			? "release PR: everything runs"
			: forced
				? "label full-ci: everything runs"
				: code
					? "path filters"
					: "CI-only paths: lint and its script tests",
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

/** Whether a `CI` run on exactly this head commit already succeeded. */
function headAlreadyPassed(/** @type {NodeJS.ProcessEnv} */ env) {
	const out = gh([
		"api",
		`repos/${env.REPO}/actions/workflows/ci.yml/runs?head_sha=${env.HEAD_SHA}&event=pull_request&status=success&per_page=1`,
		"--jq",
		".total_count",
	]);
	return Number(out.trim()) > 0;
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
			".[] | .filename, (.previous_filename // empty)",
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
	/** @type {boolean} */
	let readyOnPassedHead = false;
	if (event === "pull_request" && env.ACTION === "ready_for_review") {
		try {
			readyOnPassedHead = headAlreadyPassed(env);
		} catch (error) {
			console.log(`pass lookup failed, running everything: ${error}`);
		}
	}
	const result = plan({
		event,
		files,
		labels: JSON.parse(env.LABELS || "[]"),
		headRef: env.HEAD_REF || "",
		sameTreeAs,
		draft: env.DRAFT === "true",
		readyOnPassedHead,
	});
	const lines = [
		`skip=${result.skip}`,
		`code=${result.code}`,
		`e2e=${result.e2e}`,
		`intake=${result.intake}`,
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
			`**CI plan:** ${result.reason} (code=${result.code}, e2e=${result.e2e}, intake=${result.intake}, full=${result.full}, agents=${result.agents})\n`,
		);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href)
	main(process.env);
