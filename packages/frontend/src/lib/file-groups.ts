// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { defineClosed } from "@prismalens/registry";
import {
	BookText,
	Cog,
	FileCode2,
	FlaskConical,
	Lock,
	type LucideIcon,
} from "lucide-react";

/**
 * What kind of file a changed path is (#1101 category 16 item 7): the diff tree filters by it,
 * folded kinds wait behind a Load mark, and the turn review counts bulk from it. The first
 * kind in this order whose pattern matches wins; `source` takes the rest.
 */
export const FILE_GROUP_IDS = [
	"lock",
	"generated",
	"tests",
	"docs",
	"source",
] as const;
export type FileGroup = (typeof FILE_GROUP_IDS)[number];

export interface FileGroupView {
	/** The kind's word in a hint and its accessible label. */
	label: string;
	icon: LucideIcon;
	/** Paths of this kind; null for `source`, which takes what no other kind matched. */
	match: RegExp | null;
	/** Its patch waits behind a Load mark: nobody reads it line by line. */
	fold: boolean;
}

export const SNAPSHOT_PATH = /(^|\/)__snapshots__\/|\.snap$/;
const GENERATED_PATH =
	/(^|\/)(dist|generated|__generated__)\/|\.generated\.|\.gen\.[cm]?[jt]sx?$|\.g\.dart$|\.pb\.go$|_pb2\.py$|\.min\.(js|css)$/;

export const FILE_GROUPS = defineClosed("fileGroup", FILE_GROUP_IDS, {
	lock: {
		label: "Lockfiles",
		icon: Lock,
		match:
			/(^|\/)(pnpm-lock\.yaml|package-lock\.json|yarn\.lock|bun\.lockb?|Cargo\.lock|go\.sum|poetry\.lock|Gemfile\.lock|composer\.lock|uv\.lock)$/,
		fold: true,
	},
	generated: {
		label: "Generated",
		icon: Cog,
		match: new RegExp(`${GENERATED_PATH.source}|${SNAPSHOT_PATH.source}`),
		fold: true,
	},
	tests: {
		label: "Tests",
		icon: FlaskConical,
		match:
			/(^|\/)(__tests__|tests?|spec|e2e)\/|\.(test|spec)\.[cm]?[jt]sx?$|_test\.(go|py|rb)$|(^|\/)test_[^/]+\.py$|\.feature$/i,
		fold: false,
	},
	docs: {
		label: "Docs",
		icon: BookText,
		match: /\.(md|mdx|rst|adoc)$|(^|\/)docs?\//i,
		fold: false,
	},
	source: { label: "Code", icon: FileCode2, match: null, fold: false },
});

export function fileGroupOf(path: string): FileGroup {
	for (const id of FILE_GROUP_IDS)
		if (FILE_GROUPS.views[id].match?.test(path)) return id;
	return "source";
}

/** Past this many changed lines a file's patch waits behind a Load mark too. */
export const FOLD_LINES = 1000;

/** Whether a file's patch waits for a click: a folded kind, or too many lines to show unasked. */
export function foldsBehindLoad(f: {
	path: string;
	additions: number | null;
	deletions: number | null;
}): boolean {
	return (
		FILE_GROUPS.views[fileGroupOf(f.path)].fold ||
		(f.additions ?? 0) + (f.deletions ?? 0) > FOLD_LINES
	);
}
