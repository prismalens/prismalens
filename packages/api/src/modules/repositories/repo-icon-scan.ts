// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * A project's own logo, found in its files with no network (#1024 E). Every
 * candidate is confined to the repository root: a folder is checked through
 * `realpath`, a mirror through git's own tree, where a symlink is never read.
 */

import { lstat, readFile, realpath } from "node:fs/promises";
import { extname, isAbsolute, join, posix, relative, sep } from "node:path";
import { gitEnv } from "../../core/harness/git-env.js";
import { spawnGit } from "../../core/harness/git-spawn.js";

export const ICON_MAX_BYTES = 256 * 1024;
const INDEX_MAX_BYTES = 256 * 1024;

const EXTS = ["svg", "png", "ico", "jpg", "webp"] as const;
type IconExt = (typeof EXTS)[number];

export const ICON_TYPES: Record<IconExt, string> = {
	svg: "image/svg+xml",
	png: "image/png",
	ico: "image/x-icon",
	jpg: "image/jpeg",
	webp: "image/webp",
};

/** The fixed places a repo keeps its icon, in the order they are tried. */
export const ICON_CANDIDATES: readonly string[] = [
	"favicon.svg",
	"favicon.ico",
	"favicon.png",
	"public/favicon.svg",
	"public/favicon.ico",
	"public/favicon.png",
	...EXTS.map((e) => `app/icon.${e}`),
	...EXTS.map((e) => `assets/logo.${e}`),
	".idea/icon.svg",
];

export interface FoundIcon {
	/** The repo-relative posix path. */
	path: string;
	bytes: Buffer;
	type: string;
}

function extOf(path: string): IconExt | null {
	const ext = extname(path).slice(1).toLowerCase();
	const norm = ext === "jpeg" ? "jpg" : ext;
	return (EXTS as readonly string[]).includes(norm) ? (norm as IconExt) : null;
}

/** The bytes match what the extension says; an SVG must hold an `<svg` element. */
export function magicMatches(ext: IconExt, bytes: Buffer): boolean {
	switch (ext) {
		case "png":
			return bytes
				.subarray(0, 8)
				.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
		case "ico":
			return bytes.subarray(0, 4).equals(Buffer.from([0, 0, 1, 0]));
		case "jpg":
			return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
		case "webp":
			return (
				bytes.subarray(0, 4).toString("latin1") === "RIFF" &&
				bytes.subarray(8, 12).toString("latin1") === "WEBP"
			);
		case "svg": {
			const head = bytes.subarray(0, 4096).toString("utf8").replace(/^﻿/, "");
			return /^\s*(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*(?:<!DOCTYPE[^>]*>\s*)?<svg[\s>]/i.test(
				head,
			);
		}
	}
}

/**
 * A `<link rel="icon">` href made repo-relative, or null for anything that
 * leaves the repo: a scheme, `//`, `..`, a query-only or empty value.
 */
export function iconLinkPath(html: string): string | null {
	const tags = html.match(/<link\b[^>]*>/gi) ?? [];
	for (const tag of tags) {
		const rel =
			/\brel\s*=\s*["']?([^"'>]+)["']?/i.exec(tag)?.[1]?.toLowerCase() ?? "";
		if (!rel.split(/\s+/).includes("icon")) continue;
		const href =
			/\bhref\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1] ??
			/\bhref\s*=\s*([^\s>]+)/i.exec(tag)?.[1];
		if (!href) return null;
		const raw = href.split(/[?#]/)[0].trim();
		if (
			!raw ||
			/^[a-z][a-z0-9+.-]*:/i.test(raw) ||
			raw.startsWith("//") ||
			raw.includes("\\")
		)
			return null;
		const path = posix.normalize(raw.replace(/^\/+/, ""));
		if (path === "." || path.startsWith("..") || posix.isAbsolute(path))
			return null;
		return path;
	}
	return null;
}

/** True for a repo-relative path a scan would have tried; anything else is never served. */
export function isIconPathShape(path: string): boolean {
	const norm = posix.normalize(path);
	return (
		norm === path &&
		!norm.startsWith("..") &&
		!posix.isAbsolute(norm) &&
		extOf(norm) !== null
	);
}

function inside(root: string, target: string): boolean {
	const rel = relative(root, target);
	return (
		rel !== "" &&
		!rel.startsWith(`..${sep}`) &&
		rel !== ".." &&
		!isAbsolute(rel)
	);
}

/** One candidate in a folder, or null when it is missing, escapes, is too big or isn't the image it claims. */
export async function readFolderIcon(
	root: string,
	path: string,
): Promise<FoundIcon | null> {
	const ext = extOf(path);
	if (!ext || !isIconPathShape(path)) return null;
	try {
		const realRoot = await realpath(root);
		const real = await realpath(join(root, ...path.split("/")));
		// A symlink or junction anywhere on the way that leaves the root is refused.
		if (!inside(realRoot, real)) return null;
		const st = await lstat(real);
		if (!st.isFile() || st.size > ICON_MAX_BYTES) return null;
		const bytes = await readFile(real);
		return magicMatches(ext, bytes)
			? { path, bytes, type: ICON_TYPES[ext] }
			: null;
	} catch {
		return null;
	}
}

/** Reads blobs from a bare mirror at `ref`; symlinks (mode 120000) are not files. */
export async function readMirrorIcon(
	mirror: string,
	ref: string,
	path: string,
): Promise<FoundIcon | null> {
	const ext = extOf(path);
	if (!ext || !isIconPathShape(path)) return null;
	const blob = await mirrorBlob(mirror, ref, path, ICON_MAX_BYTES);
	if (!blob) return null;
	return magicMatches(ext, blob)
		? { path, bytes: blob, type: ICON_TYPES[ext] }
		: null;
}

async function mirrorBlob(
	mirror: string,
	ref: string,
	path: string,
	cap: number,
): Promise<Buffer | null> {
	const env = { ...gitEnv({ source: "none" }), GIT_LITERAL_PATHSPECS: "1" };
	try {
		const { stdout } = await spawnGit(
			["ls-tree", "-z", "-l", "--full-tree", ref, "--", path],
			{
				cwd: mirror,
				env,
				timeoutMs: 10_000,
			},
		);
		const m = /^(\d{6}) blob ([0-9a-f]+)\s+(\d+)\t([\s\S]*)$/.exec(
			stdout.split("\0")[0] ?? "",
		);
		if (!m || m[4] !== path || (m[1] !== "100644" && m[1] !== "100755"))
			return null;
		if (Number(m[3]) > cap) return null;
		const { bytes } = await spawnGit(["cat-file", "blob", m[2]], {
			cwd: mirror,
			env,
			timeoutMs: 10_000,
			raw: true,
		});
		return bytes ?? null;
	} catch {
		return null;
	}
}

export type IconReader = (path: string) => Promise<FoundIcon | null>;

/** The first icon a repo ships: the fixed places, then a root `index.html`'s `<link rel="icon">`. */
export async function scanIcon(
	read: IconReader,
	readIndex: () => Promise<string | null>,
): Promise<FoundIcon | null> {
	for (const path of ICON_CANDIDATES) {
		const found = await read(path);
		if (found) return found;
	}
	const html = await readIndex();
	const linked = html ? iconLinkPath(html) : null;
	return linked ? read(linked) : null;
}

export function folderReader(root: string): {
	read: IconReader;
	index: () => Promise<string | null>;
} {
	return {
		read: (path) => readFolderIcon(root, path),
		index: async () => {
			try {
				const realRoot = await realpath(root);
				const real = await realpath(join(root, "index.html"));
				if (!inside(realRoot, real)) return null;
				const st = await lstat(real);
				if (!st.isFile() || st.size > INDEX_MAX_BYTES) return null;
				return await readFile(real, "utf8");
			} catch {
				return null;
			}
		},
	};
}

export function mirrorReader(
	mirror: string,
	ref: string,
): { read: IconReader; index: () => Promise<string | null> } {
	return {
		read: (path) => readMirrorIcon(mirror, ref, path),
		index: async () =>
			(await mirrorBlob(mirror, ref, "index.html", INDEX_MAX_BYTES))?.toString(
				"utf8",
			) ?? null,
	};
}
