// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { join, relative } from "node:path";
import { labelProblems } from "../label.ts";
import { ledgerDiff } from "../ledger.ts";
import { git as runGit } from "./git.ts";
import { PACKAGES_FILE, packageGlobs } from "./guard.ts";
import type { Config } from "./index.ts";
import type { Workspace } from "./workspace.ts";

const git = (cwd: string, args: string[]) =>
	runGit(args, {
		cwd,
		maxBuffer: 64 * 1024 * 1024,
		stdio: ["ignore", "pipe", "ignore"],
	});

export type LabelHost = Pick<
	Config,
	"root" | "ratchet" | "protected" | "label" | "budgets" | "ledger"
>;

const labelList = (labels: string) =>
	labels
		.split(",")
		.map((l) => l.trim())
		.filter(Boolean);

/** The files `range` (from, to) renames, old to new, as paths under `prefix` (a host's repo-relative root). */
function renames(
	top: string,
	range: readonly [string, string],
	prefix: string,
): Map<string, string> {
	const parts = git(top, [
		"diff",
		"--name-status",
		"--find-renames",
		"-l0",
		"--diff-filter=R",
		"-z",
		...range,
	]).split("\0");
	const under = (p: string) =>
		prefix ? (p.startsWith(`${prefix}/`) ? p.slice(prefix.length + 1) : "") : p;
	const out = new Map<string, string>();
	for (let i = 0; i + 2 < parts.length; i += 3) {
		const from = under(parts[i + 1] ?? "");
		const to = under(parts[i + 2] ?? "");
		if (from && to) out.set(from, to);
	}
	return out;
}

/** Diffs `base...head` and the ratchet at both ends, without checking the head out, then asks whether the PR needs the label. */
export function labelCheck(
	cfg: LabelHost,
	base: string,
	head: string,
	labels: string,
): string[] {
	if (!base) return ["label-check needs --base <sha>"];
	const top = git(cfg.root, ["rev-parse", "--show-toplevel"]).trim();
	// A host may keep no ratchet; reading "" would `git show` the host's own folder.
	const ratchet = cfg.ratchet
		? relative(top, join(cfg.root, cfg.ratchet)).split("\\").join("/")
		: "";
	const showAt = (ref: string, path: string) => {
		try {
			return git(top, ["show", `${ref}:${path}`]);
		} catch {
			return "";
		}
	};
	const show = (ref: string) => (ratchet ? showAt(ref, ratchet) : "");
	// Every read compares against the fork point: what the base branch did since is not the PR's.
	const from = git(top, ["merge-base", base, head]).trim();
	const named = labelList(labels);
	const label = cfg.label ?? "registry-approved";
	const ledgerFile = cfg.ledger
		? relative(top, join(cfg.root, cfg.ledger.file)).split("\\").join("/")
		: "";
	const ledger =
		ledgerFile && !named.includes(label)
			? ledgerDiff(showAt(from, ledgerFile), showAt(head, ledgerFile)).map(
					(p) =>
						`${p}. Fix: undo it, or ask the operator to add the "${label}" label.`,
				)
			: [];
	return [
		...ledger,
		...labelProblems({
			// Without rename detection, a protected path renamed away is listed too.
			// `-z`: a quoted non-ASCII path would match no protected prefix.
			changed: git(top, [
				"diff",
				"--name-only",
				"--no-renames",
				"-z",
				from,
				head,
			])
				.split("\0")
				.filter(Boolean),
			protectedPaths: cfg.protected ?? [],
			ratchet,
			baseTsv: show(from),
			headTsv: show(head),
			labels: named,
			renames: renames(
				top,
				[from, head],
				relative(top, cfg.root).split("\\").join("/"),
			),
			label,
			budgets: (cfg.budgets ?? []).map((path) => ({
				path,
				base: showAt(from, path),
				head: showAt(head, path),
			})),
		}),
	];
}

/** The workspace guard's label check: its ratchet and protected paths, and the package list it scans. */
export function guardLabelCheck(
	ws: Workspace,
	base: string,
	head: string,
	labels: string,
): string[] {
	const guard = ws.guard;
	if (!guard) return [];
	const label = guard.label ?? "registry-approved";
	const out = labelCheck(
		{
			root: ws.root,
			ratchet: guard.ratchet,
			protected: guard.protected,
			label,
		},
		base,
		head,
		labels,
	);
	if (!base || labelList(labels).includes(label)) return out;
	const globs = (ref: string) => {
		try {
			return JSON.stringify(
				packageGlobs(git(ws.root, ["show", `${ref}:./${PACKAGES_FILE}`])),
			);
		} catch {
			return "";
		}
	};
	const from = git(ws.root, ["merge-base", base, head]).trim();
	if (globs(from) !== globs(head))
		out.push(
			`${PACKAGES_FILE} changes the packages the guard scans. Fix: undo it, or ask the operator to add the "${label}" label.`,
		);
	return out;
}
