// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkRef, fetchHead, hasCommit, liveBranch, pushUrls } from "./fix-git.js";

describe("fix-git", () => {
	let tempDir: string;
	let bareRepo: string;
	let clientRepo: string;
	let initialSha: string;

	beforeAll(() => {
		tempDir = mkdtempSync(join(tmpdir(), "pl-fix-git-test-"));
		bareRepo = join(tempDir, "bare.git");
		clientRepo = join(tempDir, "client");

		// Initialize a bare repository
		execFileSync("git", ["init", "--bare", bareRepo]);

		// Initialize client repo and create a commit
		execFileSync("git", ["init", clientRepo]);
		execFileSync("git", ["-C", clientRepo, "config", "user.name", "Test User"]);
		execFileSync("git", ["-C", clientRepo, "config", "user.email", "test@example.com"]);

		writeFileSync(join(clientRepo, "test.txt"), "hello world\n");
		execFileSync("git", ["-C", clientRepo, "add", "test.txt"]);
		execFileSync("git", ["-C", clientRepo, "commit", "-m", "initial commit"]);
		initialSha = execFileSync("git", ["-C", clientRepo, "rev-parse", "HEAD"]).toString().trim();

		// Push main to bare repo origin
		const bareUrl = bareRepo.replace(/\\/g, "/");
		execFileSync("git", ["-C", clientRepo, "remote", "add", "origin", bareUrl]);
		execFileSync("git", ["-C", clientRepo, "branch", "-M", "main"]);
		execFileSync("git", ["-C", clientRepo, "push", "-u", "origin", "main"]);

		// Create another branch in bare origin
		execFileSync("git", ["-C", clientRepo, "checkout", "-b", "feat/sample"]);
		writeFileSync(join(clientRepo, "feature.txt"), "feature content\n");
		execFileSync("git", ["-C", clientRepo, "add", "feature.txt"]);
		execFileSync("git", ["-C", clientRepo, "commit", "-m", "feature commit"]);
		execFileSync("git", ["-C", clientRepo, "push", "-u", "origin", "feat/sample"]);

		// Switch client back to main
		execFileSync("git", ["-C", clientRepo, "checkout", "main"]);
	});

	afterAll(() => {
		try {
			rmSync(tempDir, { recursive: true, force: true });
		} catch {
			// Best effort cleanup
		}
	});

	describe("fetchHead", () => {
		it("fetches an existing ref from bare repo origin successfully", async () => {
			// Create a separate workspace repo configured with bareRepo as origin
			const workRepo = join(tempDir, "work-fetch");
			execFileSync("git", ["init", workRepo]);
			const bareUrl = bareRepo.replace(/\\/g, "/");
			execFileSync("git", ["-C", workRepo, "remote", "add", "origin", bareUrl]);

			const res = await fetchHead(workRepo, "feat/sample");
			expect(res).toEqual({ ok: true });
		});

		it("fails with stderr when ref is missing in origin", async () => {
			const workRepo = join(tempDir, "work-missing");
			execFileSync("git", ["init", workRepo]);
			const bareUrl = bareRepo.replace(/\\/g, "/");
			execFileSync("git", ["-C", workRepo, "remote", "add", "origin", bareUrl]);

			const res = await fetchHead(workRepo, "non-existent-ref-12345");
			expect(res.ok).toBe(false);
			if (!res.ok) {
				expect(typeof res.stderr).toBe("string");
				expect(res.stderr.length).toBeGreaterThan(0);
				expect(res.stderr.length).toBeLessThanOrEqual(300);
			}
		});
	});

	describe("hasCommit", () => {
		it("returns true for existing commit and false for missing commit", async () => {
			expect(await hasCommit(clientRepo, initialSha)).toBe(true);
			expect(await hasCommit(clientRepo, "0000000000000000000000000000000000000000")).toBe(false);
		});
	});

	describe("pushUrls", () => {
		it("returns origin push URLs", async () => {
			const urls = await pushUrls(clientRepo);
			expect(urls.length).toBe(1);
			expect(urls[0]?.replace(/\\/g, "/")).toBe(bareRepo.replace(/\\/g, "/"));
		});

		it("returns empty array for folder without remotes", async () => {
			const emptyRepo = join(tempDir, "empty");
			execFileSync("git", ["init", emptyRepo]);
			expect(await pushUrls(emptyRepo)).toEqual([]);
		});
	});

	describe("checkRef", () => {
		it("accepts valid branch names and rejects invalid branch names", async () => {
			expect(await checkRef("main")).toBe(true);
			expect(await checkRef("feat/sample")).toBe(true);
			expect(await checkRef("-invalid")).toBe(false);
			expect(await checkRef("feat/..")).toBe(false);
		});
	});

	describe("liveBranch", () => {
		it("returns current branch name or null when detached", async () => {
			expect(await liveBranch(clientRepo)).toBe("main");

			execFileSync("git", ["-C", clientRepo, "checkout", initialSha, "--detach"]);
			expect(await liveBranch(clientRepo)).toBeNull();

			execFileSync("git", ["-C", clientRepo, "checkout", "main"]);
		});
	});
});
