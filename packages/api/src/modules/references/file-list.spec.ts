// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FILE_LIST_TTL_MS, FileLister, walk, withFolders } from "./file-list.js";

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
		const files = await walk(dir, 50_000);
		done = true;
		expect(files).toContain("d0/x/f.ts");
		// Each folder is read asynchronously, so the loop turns while the walk runs.
		expect(turns).toBeGreaterThan(50);
	});
});

