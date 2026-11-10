// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { chmodSync, existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ensureAppDataDir } from "./app-data.js";

describe("ensureAppDataDir (#1066)", () => {
	const prevWorkspaceDir = process.env.PRISMALENS_WORKSPACE_DIR;
	const createdDirs: string[] = [];

	afterEach(() => {
		if (prevWorkspaceDir === undefined) {
			delete process.env.PRISMALENS_WORKSPACE_DIR;
		} else {
			process.env.PRISMALENS_WORKSPACE_DIR = prevWorkspaceDir;
		}
		for (const dir of createdDirs) {
			rmSync(dir, { recursive: true, force: true });
		}
		createdDirs.length = 0;
	});

	it("creates a new directory with owner-only permissions", () => {
		const targetDir = join(
			tmpdir(),
			`pl-appdata-${Date.now()}-${Math.random().toString(36).slice(2)}`,
		);
		createdDirs.push(targetDir);
		process.env.PRISMALENS_WORKSPACE_DIR = targetDir;

		expect(existsSync(targetDir)).toBe(false);
		const created = ensureAppDataDir();
		expect(created).toBe(targetDir);
		expect(existsSync(targetDir)).toBe(true);

		if (process.platform === "win32") {
			expect(existsSync(targetDir)).toBe(true);
		} else {
			const stat = statSync(targetDir);
			expect(stat.mode & 0o777).toBe(0o700);
		}
	});

	it("tightens an existing 0755 directory to 0700", () => {
		const targetDir = mkdtempSync(join(tmpdir(), "pl-appdata-tighten-"));
		createdDirs.push(targetDir);
		if (process.platform !== "win32") {
			chmodSync(targetDir, 0o755);
			expect(statSync(targetDir).mode & 0o777).toBe(0o755);
		}

		process.env.PRISMALENS_WORKSPACE_DIR = targetDir;
		const created = ensureAppDataDir();
		expect(created).toBe(targetDir);
		expect(existsSync(targetDir)).toBe(true);

		if (process.platform === "win32") {
			expect(existsSync(targetDir)).toBe(true);
		} else {
			const stat = statSync(targetDir);
			expect(stat.mode & 0o777).toBe(0o700);
		}
	});
});
