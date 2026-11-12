// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The line that ends a turn (#1101 cat 9): ordinary work and PrismaLens actions counted
 * apart, and the files the turn edited with their added and removed lines.
 */
import { diffLines } from "diff";
import { plSummary } from "./pl-tools";

/** Lines a file edit added and removed, from the call's own arguments. */
export interface EditStat {
	path: string;
	add: number;
	del: number;
}

const lines = (s: string) => (s ? s.replace(/\n$/, "").split("\n").length : 0);

/**
 * What one edit call changed: a replace (`old_string`/`new_string`), a whole-file write
 * (`content`) or a patch (`patch`/`input`). Null when the call carries none of them.
 */
export function editStat(
	path: string | null | undefined,
	args: Record<string, unknown>,
): EditStat | null {
	const oldText = args.old_string ?? args.oldText ?? args.old_str;
	const newText = args.new_string ?? args.newText ?? args.new_str;
	if (path && typeof oldText === "string" && typeof newText === "string") {
		let add = 0;
		let del = 0;
		for (const part of diffLines(oldText, newText)) {
			if (part.added) add += part.count ?? 0;
			else if (part.removed) del += part.count ?? 0;
		}
		return { path, add, del };
	}
	if (path && typeof args.content === "string")
		return { path, add: lines(args.content), del: 0 };
	const patch = args.patch ?? args.input;
	if (typeof patch === "string" && /^(\*\*\* |@@|\+\+\+ |--- )/m.test(patch)) {
		let add = 0;
		let del = 0;
		for (const l of patch.split("\n")) {
			if (/^\+(?!\+\+ )/.test(l)) add++;
			else if (/^-(?!-- )/.test(l)) del++;
		}
		const named = patch.match(/^\*\*\* (?:Update|Add) File: (.+)$/m)?.[1];
		return { path: path ?? named ?? "patch", add, del };
	}
	return null;
}

/** The parts of a turn a summary counts. */
export interface TurnStep {
	node?: string;
	path?: string | null;
	pl?: { name: string };
	edit?: EditStat | null;
}

export interface TurnSummary {
	/** `Changed 12 files, ran 4 commands. PrismaLens: started 2 threads, watched 1 PR.` */
	text: string;
	/** The files the turn edited, merged per path; empty when it edited none. */
	files: EditStat[];
	add: number;
	del: number;
}

const count = (n: number, one: string, many: string) =>
	`${n} ${n === 1 ? one : many}`;

/**
 * One turn's summary; null for a turn that ran nothing. With a single tool group the
 * group's line already says the work, so the text keeps only the PrismaLens actions
 * outside it, and the files stay for their own line.
 */
export function turnSummary(
	steps: readonly TurnStep[],
	plCalls: readonly string[] = [],
	opts: { groups?: number } = {},
): TurnSummary | null {
	const echo = opts.groups === 1;
	const byPath = new Map<string, EditStat>();
	const read = new Set<string>();
	let commands = 0;
	let searches = 0;
	let tools = 0;
	const pl = [...plCalls];
	for (const s of steps) {
		if (s.pl) {
			if (!echo) pl.push(s.pl.name);
			continue;
		}
		if (s.edit) {
			const had = byPath.get(s.edit.path);
			byPath.set(s.edit.path, {
				path: s.edit.path,
				add: (had?.add ?? 0) + s.edit.add,
				del: (had?.del ?? 0) + s.edit.del,
			});
		} else if (s.node === "edit" && s.path)
			byPath.set(
				s.path,
				byPath.get(s.path) ?? { path: s.path, add: 0, del: 0 },
			);
		else if (s.node === "read") read.add(s.path ?? String(read.size));
		else if (s.node === "command" || s.node === "telemetry") commands++;
		else if (s.node === "search") searches++;
		else tools++;
	}
	// Changed files have their own line under the summary, so the text never counts them.
	const work: string[] = [];
	if (!echo && read.size)
		work.push(`read ${count(read.size, "file", "files")}`);
	if (!echo && searches)
		work.push(`searched ${count(searches, "time", "times")}`);
	if (!echo && commands)
		work.push(`ran ${count(commands, "command", "commands")}`);
	if (!echo && tools) work.push(`used ${count(tools, "tool", "tools")}`);
	const ours = plSummary(pl);
	if (!work.length && !ours && !byPath.size) return null;
	const head = work.join(", ");
	const text = [
		head ? `${head.charAt(0).toUpperCase()}${head.slice(1)}.` : "",
		ours ? `PrismaLens: ${ours}.` : "",
	]
		.filter(Boolean)
		.join(" ");
	const files = Array.from(byPath.values());
	return {
		text,
		files,
		add: files.reduce((n, f) => n + f.add, 0),
		del: files.reduce((n, f) => n + f.del, 0),
	};
}
