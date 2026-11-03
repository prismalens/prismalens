// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { Dir } from "node:fs";
import { lstat, opendir, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import {
	type BrowseFoldersResult,
	FOLDER_LIST_MAX,
	FOLDER_READ_MS,
	type FolderEntry,
} from "@prismalens/contracts";
import { sameAsDisk } from "../../infrastructure/dispatch/folder-lock.js";

class ReadTimeout extends Error {}
class Busy extends Error {}

/** File system operations still running, answered or not: a stalled drive holds a thread each. */
let outstanding = 0;
const MAX_READS = 2;

/** Every listing operation (read, stat, close) until it settles, for the cap (#1020). */
export const outstandingReads = () => outstanding;

function track<T>(op: Promise<T>): Promise<T> {
	outstanding++;
	// An op that loses the race may still fail later; that failure is nobody's to handle.
	op.catch(() => {}).finally(() => {
		outstanding--;
	});
	return op;
}

interface Budget {
	deadline: number;
	maxReads: number;
}

/** Starts `make` only inside the deadline and under the cap, then races it against the deadline. */
function timed<T>(make: () => Promise<T>, b: Budget): Promise<T> {
	const left = b.deadline - Date.now();
	if (left <= 0) return Promise.reject(new ReadTimeout());
	if (outstanding >= b.maxReads) return Promise.reject(new Busy());
	const op = track(make());
	let timer: NodeJS.Timeout | undefined;
	return Promise.race([
		op,
		new Promise<never>((_, reject) => {
			timer = setTimeout(() => reject(new ReadTimeout()), left);
		}),
	]).finally(() => clearTimeout(timer));
}

async function hasGit(dir: string, b: Budget): Promise<boolean> {
	try {
		const st = await timed(() => lstat(join(dir, ".git")), b);
		return st.isDirectory() || st.isFile();
	} catch (e) {
		if (e instanceof ReadTimeout || e instanceof Busy) throw e;
		return false;
	}
}

/** True when `dir` or a folder above it holds a `.git`, so a pick here adds as a Repo. */
async function inRepo(dir: string, b: Budget): Promise<boolean> {
	for (let at = dir, n = 0; n < 64; n++) {
		if (await hasGit(at, b)) return true;
		const up = dirname(at);
		if (up === at) return false;
		at = up;
	}
	return false;
}

function failed(path: string, e: unknown): BrowseFoldersResult {
	if (e instanceof ReadTimeout) return { ok: false, path, error: "timeout" };
	if (e instanceof Busy) return { ok: false, path, error: "busy" };
	const code = (e as NodeJS.ErrnoException).code;
	if (code === "EACCES" || code === "EPERM")
		return { ok: false, path, error: "denied" };
	if (code === "ENOENT" || code === "ENOTDIR")
		return { ok: false, path, error: "missing" };
	throw e;
}

export interface BrowseOptions {
	home?: string;
	max?: number;
	readMs?: number;
	/** Reads still running past which a listing answers busy rather than queue another. */
	maxReads?: number;
}

/**
 * The folders directly inside `raw` (null: home), for the host's Add project browser (#1020).
 * File names never leave here, links and junctions are neither listed nor followed, and the
 * whole read shares one deadline; a read still in flight then closes its handle when it ends.
 */
export async function browseFolders(
	raw: string | null,
	opts: BrowseOptions = {},
): Promise<BrowseFoldersResult> {
	const home = opts.home ?? homedir();
	const typed = raw ?? home;
	const expanded =
		typed === "~"
			? home
			: typed.startsWith("~/") || typed.startsWith("~\\")
				? join(home, typed.slice(2))
				: typed;
	// UNC and device paths would reach other machines or raw devices.
	if (!isAbsolute(expanded) || /^[\\/]{2}/.test(expanded))
		return { ok: false, path: typed, error: "not-absolute" };
	const path = resolve(expanded);
	if (outstanding >= (opts.maxReads ?? MAX_READS))
		return { ok: false, path, error: "busy" };
	const max = opts.max ?? FOLDER_LIST_MAX;
	const b: Budget = {
		deadline: Date.now() + (opts.readMs ?? FOLDER_READ_MS),
		maxReads: opts.maxReads ?? MAX_READS,
	};
	const entries: FolderEntry[] = [];
	let truncated = false;
	// Cut short by the deadline or the cap: nothing more is started for this listing.
	let cut = false;
	let dir: Dir | undefined;
	let pending: Promise<unknown> | undefined;
	try {
		const st = await timed(() => lstat(path), b);
		if (st.isSymbolicLink() || !st.isDirectory())
			return { ok: false, path, error: "not-folder" };
		// A linked parent would list somewhere else under this name (#1020).
		const real = await timed(() => realpath(path), b);
		if (!sameAsDisk(path, real)) return { ok: false, path, error: "link" };
		dir = await timed(() => {
			const opening = opendir(path);
			pending = opening;
			return opening;
		}, b);
		pending = undefined;
		for (;;) {
			const open = dir;
			const d = await timed(() => {
				const reading = open.read();
				pending = reading;
				return reading;
			}, b);
			pending = undefined;
			if (!d) break;
			// A Dirent is not followed: a link or junction is never a directory here.
			if (!d.isDirectory()) continue;
			if (entries.length >= max) {
				truncated = true;
				break;
			}
			entries.push({
				name: d.name,
				path: join(path, d.name),
				hidden: d.name.startsWith("."),
				git: false,
			});
		}
	} catch (e) {
		const short = e instanceof ReadTimeout || e instanceof Busy;
		if (!short || entries.length === 0) return failed(path, e);
		truncated = true;
		cut = true;
	} finally {
		const open = dir;
		const wait = pending ?? Promise.resolve();
		void wait
			.catch(() => {})
			.then(async () => {
				const late = open ?? ((await wait.catch(() => null)) as Dir | null);
				if (late) await track(late.close()).catch(() => {});
			});
	}
	let git = false;
	if (!cut)
		try {
			for (const e of entries) e.git = await hasGit(e.path, b);
			git = await inRepo(path, b);
		} catch {
			truncated = true;
		}
	entries.sort((a, b) => a.name.localeCompare(b.name));
	const parent = dirname(path);
	return {
		ok: true,
		path,
		parent: parent === path ? null : parent,
		git,
		entries,
		truncated,
	};
}
