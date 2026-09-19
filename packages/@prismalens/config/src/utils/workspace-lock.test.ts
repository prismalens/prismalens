// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	acquireWorkspaceLock,
	readWorkspaceLock,
	WORKSPACE_LOCK_FILE,
	WorkspaceLockedError,
} from "./workspace-lock.js";

const deadPid = (): number => {
	const child = spawnSync(process.execPath, ["-e", ""]);
	return child.pid as number;
};

describe("workspace lock (#605 edge 5)", () => {
	it("takes an unlocked workspace, records this pid, and releases it", () => {
		const dir = mkdtempSync(join(tmpdir(), "pl-lock-"));
		const release = acquireWorkspaceLock(dir);
		const lock = join(dir, WORKSPACE_LOCK_FILE);
		expect(JSON.parse(readFileSync(lock, "utf8")).pid).toBe(process.pid);
		expect(readWorkspaceLock(dir)?.pid).toBe(process.pid);
		release();
		expect(existsSync(lock)).toBe(false);
		expect(readWorkspaceLock(dir)).toBe(null);
	});

	it("refuses a workspace held by another live process", () => {
		const dir = mkdtempSync(join(tmpdir(), "pl-lock-"));
		// The parent of this test runner is alive and is not us.
		const owner = { pid: process.ppid, startedAt: "2026-09-19T00:00:00Z" };
		writeFileSync(join(dir, WORKSPACE_LOCK_FILE), JSON.stringify(owner));
		expect(() => acquireWorkspaceLock(dir)).toThrow(WorkspaceLockedError);
		expect(() => acquireWorkspaceLock(dir)).toThrow(
			`pid ${process.ppid}`,
		);
	});

	it("takes over a stale lock whose pid is gone", () => {
		const dir = mkdtempSync(join(tmpdir(), "pl-lock-"));
		writeFileSync(
			join(dir, WORKSPACE_LOCK_FILE),
			JSON.stringify({ pid: deadPid(), startedAt: "then" }),
		);
		const release = acquireWorkspaceLock(dir);
		expect(readWorkspaceLock(dir)?.pid).toBe(process.pid);
		release();
	});

	it("takes over an unreadable lock file", () => {
		const dir = mkdtempSync(join(tmpdir(), "pl-lock-"));
		writeFileSync(join(dir, WORKSPACE_LOCK_FILE), "not json");
		const release = acquireWorkspaceLock(dir);
		expect(readWorkspaceLock(dir)?.pid).toBe(process.pid);
		release();
	});
});
