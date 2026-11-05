// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { execFile } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, relative, sep } from "node:path";
import { promisify } from "node:util";
import { gitEnv } from "../../core/harness/git-env.js";

// `ignore` ships CommonJS whose default export NodeNext types cannot call.
interface Ignore {
	add(patterns: string | string[]): Ignore;
	ignores(path: string): boolean;
}
const ignore = createRequire(import.meta.url)("ignore") as () => Ignore;

const run = promisify(execFile);

export const FILE_LIST_CAP = 50_000;
export const FILE_LIST_TTL_MS = 60_000;

export interface FileList {
	/** Workspace-relative paths with `/` separators; folders end with `/`. */
	paths: string[];
	truncated: boolean;
}

/** `git ls-files` (tracked and untracked, ignores honoured) in a repo; null outside one. */
async function gitFiles(root: string): Promise<string[] | null> {
	try {
		const { stdout } = await run(
			"git",
			["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
			{
				cwd: root,
				env: gitEnv({ source: "machine", coreSshCommand: null }),
				maxBuffer: 64 * 1024 * 1024,
				timeout: 10_000,
			},
		);
		return stdout.split("\0").filter(Boolean);
	} catch {
		return null;
	}
}

/** A plain folder: walked, honouring its root `.gitignore`, stopping at the cap. */
function walk(root: string, cap: number): string[] {
	const ig = ignore().add([".git", "node_modules"]);
	const gi = join(root, ".gitignore");
	if (existsSync(gi)) ig.add(readFileSync(gi, "utf8"));
	const out: string[] = [];
	const stack = [root];
	while (stack.length && out.length <= cap) {
		const dir = stack.pop() as string;
		let entries: import("node:fs").Dirent[];
		try {
			entries = readdirSync(dir, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const e of entries) {
			const abs = join(dir, e.name);
			const rel = relative(root, abs).split(sep).join("/");
			if (e.isDirectory()) {
				if (ig.ignores(`${rel}/`)) continue;
				stack.push(abs);
			} else if (e.isFile() && !ig.ignores(rel)) out.push(rel);
		}
	}
	return out;
}

/** Each file and the folders above it, capped. */
export function withFolders(files: string[], cap: number): FileList {
	const folders = new Set<string>();
	for (const f of files) {
		const parts = f.split("/");
		for (let i = 1; i < parts.length; i++)
			folders.add(`${parts.slice(0, i).join("/")}/`);
	}
	const all = [...folders, ...files];
	return { paths: all.slice(0, cap), truncated: all.length > cap };
}

/** The file list of one root, cached for FILE_LIST_TTL_MS (#1024). */
export class FileLister {
	private readonly cache = new Map<string, { at: number; list: FileList }>();

	constructor(
		private readonly cap = FILE_LIST_CAP,
		private readonly now: () => number = Date.now,
	) {}

	async list(root: string): Promise<FileList> {
		const hit = this.cache.get(root);
		if (hit && this.now() - hit.at < FILE_LIST_TTL_MS) return hit.list;
		const files = (await gitFiles(root)) ?? walk(root, this.cap);
		const list = withFolders(files, this.cap);
		this.cache.set(root, { at: this.now(), list });
		if (this.cache.size > 50) {
			const first = this.cache.keys().next().value;
			if (first) this.cache.delete(first);
		}
		return list;
	}
}
