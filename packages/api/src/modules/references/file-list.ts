// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { lstat, readdir, readFile } from "node:fs/promises";
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
/** The most folders a plain-folder walk opens. */
export const DIR_WALK_CAP = 20_000;

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

/**
 * A plain folder, walked asynchronously and honouring its root `.gitignore`. It stops at
 * `cap` files or `dirCap` folders, so a tree of empty folders cannot run on (#1024).
 */
export async function walk(
	root: string,
	cap: number,
	dirCap = DIR_WALK_CAP,
): Promise<{ files: string[]; dirs: number; truncated: boolean }> {
	const ig = ignore().add([".git", "node_modules"]);
	const gi = join(root, ".gitignore");
	if (existsSync(gi)) ig.add(await readFile(gi, "utf8"));
	const files: string[] = [];
	const stack = [root];
	let dirs = 0;
	while (stack.length && files.length <= cap && dirs < dirCap) {
		const dir = stack.pop() as string;
		dirs++;
		const entries = await readDirSafely(dir);
		if (!entries) continue;
		for (const e of entries) {
			const abs = join(dir, e.name);
			const rel = relative(root, abs).split(sep).join("/");
			if (e.isDirectory()) {
				if (ig.ignores(`${rel}/`)) continue;
				stack.push(abs);
			} else if (e.isFile() && !ig.ignores(rel)) files.push(rel);
		}
	}
	return { files, dirs, truncated: stack.length > 0 || files.length > cap };
}

/**
 * A folder's entries, or null when it is gone or is now a link: a folder swapped for a
 * link between listing and reading must not lead the walk out of its root (#1024).
 */
export async function readDirSafely(
	dir: string,
): Promise<import("node:fs").Dirent[] | null> {
	try {
		const st = await lstat(dir);
		if (st.isSymbolicLink() || !st.isDirectory()) return null;
		return await readdir(dir, { withFileTypes: true });
	} catch {
		return null;
	}
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
		private readonly dirCap = DIR_WALK_CAP,
	) {}

	async list(root: string): Promise<FileList> {
		const hit = this.cache.get(root);
		if (hit && this.now() - hit.at < FILE_LIST_TTL_MS) return hit.list;
		const tracked = await gitFiles(root);
		const walked = tracked ? null : await walk(root, this.cap, this.dirCap);
		const listed = withFolders(tracked ?? walked?.files ?? [], this.cap);
		const list = {
			...listed,
			truncated: listed.truncated || !!walked?.truncated,
		};
		this.cache.set(root, { at: this.now(), list });
		if (this.cache.size > 50) {
			const first = this.cache.keys().next().value;
			if (first) this.cache.delete(first);
		}
		return list;
	}
}
