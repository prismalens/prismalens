// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { execFileSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	FILE_LIST_TTL_MS,
	FileLister,
	readDirSafely,
	walk,
	withFolders,
} from "./file-list.js";

describe("the workspace file list (#1024)", () => {
	let dir: string;
	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "pl-files-"));
	});
	afterEach(() => rmSync(dir, { recursive: true, force: true }));

	it("a plain folder is walked, honouring its .gitignore, with folders listed", async () => {
		mkdirSync(join(dir, "src", "db"), { recursive: true });
		mkdirSync(join(dir, "node_modules", "x"), { recursive: true });
		mkdirSync(join(dir, "dist"));
		writeFileSync(join(dir, ".gitignore"), "dist/\n*.log\n");
		writeFileSync(join(dir, "src", "db", "pool.ts"), "");
		writeFileSync(join(dir, "app.log"), "");
		writeFileSync(join(dir, "dist", "out.js"), "");
		writeFileSync(join(dir, "node_modules", "x", "i.js"), "");
		const list = await new FileLister().list(dir);
		expect(list.paths).toEqual(
			expect.arrayContaining(["src/", "src/db/", "src/db/pool.ts", ".gitignore"]),
		);
		expect(list.paths.some((p) => p.startsWith("dist") || p.endsWith(".log"))).toBe(false);
		expect(list.paths.some((p) => p.startsWith("node_modules"))).toBe(false);
		expect(list.truncated).toBe(false);
	});

	it("stops at the cap and says the list was cut", () => {
		const files = Array.from({ length: 30 }, (_, i) => `f${i}.ts`);
		const list = withFolders(files, 10);
		expect(list.paths).toHaveLength(10);
		expect(list.truncated).toBe(true);
	});

	it("caches a root for 60 seconds", async () => {
		writeFileSync(join(dir, "a.ts"), "");
		let now = 0;
		const lister = new FileLister(50_000, () => now);
		expect((await lister.list(dir)).paths).toEqual(["a.ts"]);
		writeFileSync(join(dir, "b.ts"), "");
		expect((await lister.list(dir)).paths).toEqual(["a.ts"]);
		now = FILE_LIST_TTL_MS;
		expect((await lister.list(dir)).paths.sort()).toEqual(["a.ts", "b.ts"]);
	});

	it("walks a plain folder without blocking the event loop (#1024)", async () => {
		for (let i = 0; i < 200; i++) {
			mkdirSync(join(dir, `d${i}`, "x"), { recursive: true });
			writeFileSync(join(dir, `d${i}`, "x", "f.ts"), "");
		}
		let turns = 0;
		let done = false;
		const spin = () => {
			turns++;
			if (!done) setImmediate(spin);
		};
		setImmediate(spin);
		const { files } = await walk(dir, 50_000);
		done = true;
		expect(files).toContain("d0/x/f.ts");
		// Each folder is read asynchronously, so the loop turns while the walk runs.
		expect(turns).toBeGreaterThan(50);
	}, 30_000);

	it("stops a tree heavy with folders at the folder limit, and says the list was cut (#1024)", async () => {
		for (let i = 0; i < 300; i++) {
			mkdirSync(join(dir, `d${i}`, "empty"), { recursive: true });
			if (i % 50 === 0) writeFileSync(join(dir, `d${i}`, "f.ts"), "");
		}
		const walked = await walk(dir, 50_000, 100);
		expect(walked.truncated).toBe(true);
		expect(walked.dirs).toBeLessThanOrEqual(100);
		const whole = await walk(dir, 50_000, 10_000);
		expect(whole.truncated).toBe(false);
		expect(whole.files).toHaveLength(6);
		const list = await new FileLister(50_000, Date.now, 100).list(dir);
		expect(list.truncated).toBe(true);
	}, 30_000);

	it("refuses to open a folder that became a link, so a swap mid-walk cannot leave the root (#1024)", async () => {
		const outside = mkdtempSync(join(tmpdir(), "pl-outside-"));
		try {
			writeFileSync(join(outside, "secret.txt"), "");
			mkdirSync(join(dir, "real"));
			symlinkSync(outside, join(dir, "swapped"), "junction");
			expect(await readDirSafely(join(dir, "real"), dir)).toEqual([]);
			expect(await readDirSafely(join(dir, "swapped"), dir)).toBeNull();
			const { files } = await walk(dir, 50_000);
			expect(files.some((f) => f.includes("secret"))).toBe(false);
		} finally {
			rmSync(outside, { recursive: true, force: true });
		}
	});

	it("discards a folder swapped for a link between lstat and readdir (#1024)", async () => {
		mkdirSync(join(dir, "a"));
		const target = join(dir, "a");
		let read = false;
		// The folder is real until readdir runs, then resolves outside the root.
		const fs = {
			lstat: async () => ({ isSymbolicLink: () => false, isDirectory: () => true }),
			readdir: async () => {
				read = true;
				return [{ name: "secret.txt", isDirectory: () => false, isFile: () => true }];
			},
			realpath: async (p: string) =>
				p === target && read ? join(tmpdir(), "elsewhere") : p,
		};
		expect(await readDirSafely(target, dir, fs as never)).toBeNull();
		read = false;
		const steady = { ...fs, realpath: async (p: string) => p };
		expect(await readDirSafely(target, dir, steady as never)).toHaveLength(1);
	});

	it("a workspace root that is itself a link is still walked (#1024)", async () => {
		const real = mkdtempSync(join(tmpdir(), "pl-realroot-"));
		const linked = join(dir, "linked-root");
		try {
			mkdirSync(join(real, "src"));
			writeFileSync(join(real, "src", "pool.ts"), "");
			symlinkSync(real, linked, "junction");
			const { files } = await walk(linked, 50_000);
			expect(files).toEqual(["src/pool.ts"]);
		} finally {
			rmSync(linked, { recursive: true, force: true });
			rmSync(real, { recursive: true, force: true });
		}
	});

	it("walks a folder whose name starts with two dots, such as ..cache (#1024)", async () => {
		mkdirSync(join(dir, "..cache"));
		writeFileSync(join(dir, "..cache", "kept.txt"), "");
		const { files } = await walk(dir, 50_000);
		expect(files).toContain("..cache/kept.txt");
	});

	it("ignores core.fsmonitor on git calls and never executes it (#1066)", async () => {
		const repoDir = mkdtempSync(join(tmpdir(), "pl-fsmonitor-"));
		try {
			execFileSync("git", ["init", "-q"], { cwd: repoDir });
			const markerFile = join(repoDir, "marker.txt");
			const hookFile = join(repoDir, "hook.js");
			writeFileSync(
				hookFile,
				`const fs = typeof require === "function" ? require("node:fs") : (await import("node:fs")).default;\nfs.writeFileSync(${JSON.stringify(markerFile)}, "triggered");\n`,
			);
			const hookCmd = `node "${hookFile.replace(/\\/g, "/")}"`;
			execFileSync("git", ["config", "core.fsmonitor", hookCmd], { cwd: repoDir });

			await new FileLister().list(repoDir);
			expect(existsSync(markerFile)).toBe(false);
		} finally {
			rmSync(repoDir, { recursive: true, force: true });
		}
	});

	it("FileLister.list returns files with no timedOut on a repo or plain folder (#1066)", async () => {
		mkdirSync(join(dir, "src"), { recursive: true });
		writeFileSync(join(dir, "src", "plain.ts"), "");
		const plainList = await new FileLister().list(dir);
		expect(plainList.paths).toContain("src/plain.ts");
		expect(plainList.timedOut).toBeUndefined();

		const repoDir = mkdtempSync(join(tmpdir(), "pl-filelist-repo-"));
		try {
			execFileSync("git", ["init", "-q"], { cwd: repoDir });
			writeFileSync(join(repoDir, "tracked.ts"), "");
			execFileSync("git", ["add", "tracked.ts"], { cwd: repoDir });
			const repoList = await new FileLister().list(repoDir);
			expect(repoList.paths).toContain("tracked.ts");
			expect(repoList.timedOut).toBeUndefined();
		} finally {
			rmSync(repoDir, { recursive: true, force: true });
		}
	});
});

