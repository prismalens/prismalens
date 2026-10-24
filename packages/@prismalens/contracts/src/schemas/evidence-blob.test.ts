// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import {
	CommitShaSchema,
	EvidenceBlobQuerySchema,
	isSafeRepoPath,
} from "./evidence-blob.js";

const SHA = "3f2a9c1d4e5b6a7980f1e2d3c4b5a69788796a5b";

describe("isSafeRepoPath", () => {
	it("keeps a path from the repository's top", () => {
		expect(isSafeRepoPath("src/db/pool.ts")).toBe(true);
		expect(isSafeRepoPath("README.md")).toBe(true);
		expect(isSafeRepoPath(".github/workflows/ci.yml")).toBe(true);
		expect(isSafeRepoPath("docs/a:b.txt")).toBe(true);
	});

	it("refuses traversal, absolute, drive, backslash, empty segments and control characters", () => {
		for (const bad of [
			"",
			"../etc/passwd",
			"src/../../etc/passwd",
			"src/./pool.ts",
			"..",
			"/etc/passwd",
			"C:/Windows/win.ini",
			"c:secret",
			"src\\..\\..\\x",
			"src//pool.ts",
			"src/",
			"src/pool.ts\u0000.png",
			"src/\npool.ts",
			"x".repeat(1025),
		])
			expect(isSafeRepoPath(bad), JSON.stringify(bad)).toBe(false);
	});
});

describe("CommitShaSchema", () => {
	it("takes only a full lowercase object id", () => {
		expect(CommitShaSchema.safeParse(SHA).success).toBe(true);
		expect(CommitShaSchema.safeParse("a".repeat(64)).success).toBe(true);
		for (const bad of [
			"3f2a9c1",
			SHA.toUpperCase(),
			"HEAD",
			"main",
			`${SHA}^{tree}`,
			`--output=/tmp/x`,
			`${SHA} --all`,
			`${SHA}:README.md`,
		])
			expect(CommitShaSchema.safeParse(bad).success, bad).toBe(false);
	});
});

describe("EvidenceBlobQuerySchema", () => {
	it("needs a run id, a sha and a safe path", () => {
		const id = "00000000-0000-4000-8000-000000000001";
		expect(
			EvidenceBlobQuerySchema.safeParse({ id, sha: SHA, path: "a.ts" }).success,
		).toBe(true);
		expect(
			EvidenceBlobQuerySchema.safeParse({ id: "x", sha: SHA, path: "a.ts" })
				.success,
		).toBe(false);
		expect(
			EvidenceBlobQuerySchema.safeParse({ id, sha: SHA, path: "../a.ts" })
				.success,
		).toBe(false);
	});
});
