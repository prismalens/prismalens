// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { join, relative } from "node:path";
import { labelProblems } from "../label.ts";
import { ledgerDiff } from "../ledger.ts";
import { git as runGit } from "./git.ts";
import type { Config } from "./index.ts";

const git = (cwd: string, args: string[]) =>
	runGit(args, {
		cwd,
		maxBuffer: 64 * 1024 * 1024,
		stdio: ["ignore", "pipe", "ignore"],
	});

/** Diffs `base...head` and the ratchet at both ends, without checking the head out, then asks whether the PR needs the label. */
export function labelCheck(
	cfg: Config,
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
	const labelList = labels
		.split(",")
		.map((l) => l.trim())
		.filter(Boolean);
	const label = cfg.label ?? "registry-approved";
	const ledgerFile = cfg.ledger
		? relative(top, join(cfg.root, cfg.ledger.file)).split("\\").join("/")
		: "";
	const ledger =
		ledgerFile && !labelList.includes(label)
			? ledgerDiff(showAt(base, ledgerFile), showAt(head, ledgerFile)).map(
					(p) =>
						`${p}. Fix: undo it, or ask the operator to add the "${label}" label.`,
				)
			: [];
	return [
		...ledger,
		...labelProblems({
			changed: git(top, ["diff", "--name-only", `${base}...${head}`])
				.split("\n")
				.filter(Boolean),
			protectedPaths: cfg.protected ?? [],
			ratchet,
			baseTsv: show(base),
			headTsv: show(head),
			labels: labelList,
			label,
			budgets: (cfg.budgets ?? []).map((path) => ({
				path,
				base: showAt(base, path),
				head: showAt(head, path),
			})),
		}),
	];
}
