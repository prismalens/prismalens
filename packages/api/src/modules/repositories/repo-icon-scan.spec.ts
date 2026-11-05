// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	folderReader,
	ICON_CANDIDATES,
	ICON_MAX_BYTES,
	iconLinkPath,
	magicMatches,
	mirrorReader,
	readFolderIcon,
	scanIcon,
} from "./repo-icon-scan.js";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const ICO = Buffer.from([0, 0, 1, 0, 1, 0]);
const SVG = Buffer.from('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
const BYTES: Record<string, Buffer> = {
	svg: SVG,
	png: PNG,
	ico: ICO,
	jpg: Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
	webp: Buffer.from("RIFF\0\0\0\0WEBPVP8 "),
};

let root: string;
let outside: string;
beforeEach(() => {
	const base = mkdtempSync(join(tmpdir(), "pl-icon-"));
	root = join(base, "repo");
	outside = join(base, "outside");
	mkdirSync(root);
	mkdirSync(outside);
	writeFileSync(join(outside, "secret.png"), PNG);
});
afterEach(() => rmSync(dirname(root), { recursive: true, force: true }));

function put(rel: string, bytes: Buffer | string) {
	const path = join(root, ...rel.split("/"));
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, bytes);
}

const scanFolder = () => {
	const r = folderReader(root);
	return scanIcon(r.read, r.index);
};

describe("scanIcon in a folder", () => {
	it.each(ICON_CANDIDATES)("finds %s", async (rel) => {
		put(rel, BYTES[rel.split(".").pop() as string]);
		expect((await scanFolder())?.path).toBe(rel);
	});

	it("takes the first candidate in order", async () => {
		put("assets/logo.png", PNG);
		put("public/favicon.ico", ICO);
		expect((await scanFolder())?.path).toBe("public/favicon.ico");
	});

	it("follows a root index.html's relative icon link", async () => {
		put("index.html", '<html><head><link rel="shortcut icon" href="/static/brand.png?v=2"></head></html>');
		put("static/brand.png", PNG);
		expect(await scanFolder()).toMatchObject({ path: "static/brand.png", type: "image/png" });
	});

	it("finds nothing in an empty repo", async () => {
		expect(await scanFolder()).toBeNull();
	});
});

describe("confinement and checks", () => {
	it("refuses a file over the cap", async () => {
		put("favicon.png", Buffer.concat([PNG, Buffer.alloc(ICON_MAX_BYTES)]));
		expect(await scanFolder()).toBeNull();
	});

	it("refuses bytes that don't match the extension", async () => {
		put("favicon.png", "<svg></svg>");
		put("favicon.svg", "<html><script>x</script></html>");
		expect(await scanFolder()).toBeNull();
		expect(magicMatches("svg", SVG)).toBe(true);
	});

	it("refuses ../ traversal and any non-icon path asked for directly", async () => {
		expect(await readFolderIcon(root, "../outside/secret.png")).toBeNull();
		put("package.json", "{}");
		expect(await readFolderIcon(root, "package.json")).toBeNull();
		put(".env", "TOKEN=x");
		expect(await readFolderIcon(root, ".env")).toBeNull();
		expect(await readFolderIcon(root, "a/./../favicon.png")).toBeNull();
	});

	it("refuses a symlink that leaves the repo", async (ctx) => {
		try {
			symlinkSync(join(outside, "secret.png"), join(root, "favicon.png"), "file");
		} catch {
			ctx.skip(); // Windows without symlink rights
		}
		expect(await scanFolder()).toBeNull();
	});

	it("refuses a directory junction that leaves the repo", async () => {
		// A junction on Windows, a directory symlink elsewhere; both resolve out of the root.
		symlinkSync(outside, join(root, "public"), "junction");
		writeFileSync(join(outside, "favicon.png"), PNG);
		expect(await scanFolder()).toBeNull();
	});

	it("keeps a symlink that stays inside the repo", async (ctx) => {
		put("brand/mark.png", PNG);
		try {
			symlinkSync(join(root, "brand", "mark.png"), join(root, "favicon.png"), "file");
		} catch {
			ctx.skip();
		}
		expect((await scanFolder())?.path).toBe("favicon.png");
	});
});

describe("iconLinkPath", () => {
	it.each([
		['<link rel="icon" href="https://cdn.example/x.png">', null],
		['<link rel="icon" href="http://cdn.example/x.png">', null],
		['<link rel="icon" href="//cdn.example/x.png">', null],
		['<link rel="icon" href="data:image/png;base64,AAAA">', null],
		['<link rel="icon" href="../../etc/x.png">', null],
		['<link rel="icon" href="a\\..\\..\\x.png">', null],
		['<link rel="icon" href="">', null],
		['<link rel="stylesheet" href="a.css">', null],
		['<link href="./img/i.svg" rel="icon">', "img/i.svg"],
		["<link rel=icon href=favicon.png>", "favicon.png"],
	])("%s → %s", (html, want) => {
		expect(iconLinkPath(html)).toBe(want);
	});
});

describe("a mirror at the default branch", () => {
	it("reads blobs through git and never a symlink entry", async () => {
		const work = join(dirname(root), "work");
		mkdirSync(work);
		const git = (...args: string[]) => execFileSync("git", args, { cwd: work, stdio: "pipe" });
		git("init", "-q", "-b", "main");
		git("config", "user.email", "t@example.com");
		git("config", "user.name", "t");
		writeFileSync(join(work, "favicon.png"), PNG);
		git("add", ".");
		git("commit", "-q", "-m", "icon");
		const bare = join(dirname(root), "mirror.git");
		execFileSync("git", ["clone", "-q", "--mirror", work, bare]);
		const r = mirrorReader(bare, "main");
		expect(await scanIcon(r.read, r.index)).toMatchObject({ path: "favicon.png", type: "image/png" });
		expect(await r.read("../favicon.png")).toBeNull();
	});
});
