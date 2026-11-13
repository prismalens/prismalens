// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { join, relative } from "node:path";
import { labelProblems } from "../label.ts";
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
	const ratchet = relative(top, join(cfg.root, cfg.ratchet ?? ""))
		.split("\\")
		.join("/");
	const show = (ref: string) => {
		try {
			return git(top, ["show", `${ref}:${ratchet}`]);
		} catch {
			return "";
		}
	};
	return labelProblems({
		changed: git(top, ["diff", "--name-only", `${base}...${head}`])
			.split("\n")
			.filter(Boolean),
		protectedPaths: cfg.protected ?? [],
		ratchet,
		baseTsv: show(base),
		headTsv: show(head),
		labels: labels
			.split(",")
			.map((l) => l.trim())
			.filter(Boolean),
		label: cfg.label ?? "registry-approved",
	});
}
