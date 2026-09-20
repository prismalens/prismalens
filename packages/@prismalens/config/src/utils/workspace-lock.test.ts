// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { spawnSync } from "node:child_process";
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	acquireWorkspaceLock,
	MALFORMED_GRACE_MS,
	readWorkspaceLock,
	readWorkspaceLockState,
	WORKSPACE_LOCK_FILE,
	WorkspaceLockedError,
} from "./workspace-lock.js";

const deadPid = (): number => {
	const child = spawnSync(process.execPath, ["-e", ""]);
	return child.pid as number;
};

const workspace = () => mkdtempSync(join(tmpdir(), "pl-lock-"));
const lockIn = (dir: string) => join(dir, WORKSPACE_LOCK_FILE);

/** Backdate a file so a grace period has elapsed. */
function age(path: string, ms: number): void {
	const when = new Date(Date.now() - ms);
	utimesSync(path, when, when);
}

describe("workspace lock (#605 edge 5)", () => {
	it("takes an unlocked workspace, records this pid, and releases it", () => {
		const dir = workspace();
		const release = acquireWorkspaceLock(dir);
		expect(JSON.parse(readFileSync(lockIn(dir), "utf8")).pid).toBe(process.pid);
		expect(readWorkspaceLock(dir)?.pid).toBe(process.pid);
		release();
		expect(existsSync(lockIn(dir))).toBe(false);
		expect(readWorkspaceLock(dir)).toBe(null);
	});

	it("refuses a workspace held by another live process", () => {
		const dir = workspace();
		// The parent of this test runner is alive and is not us.
		const owner = { pid: process.ppid, startedAt: "2026-09-19T00:00:00Z" };
		writeFileSync(lockIn(dir), JSON.stringify(owner));
		expect(() => acquireWorkspaceLock(dir)).toThrow(WorkspaceLockedError);
		expect(() => acquireWorkspaceLock(dir)).toThrow(`pid ${process.ppid}`);
	});

	it("takes over a stale lock whose pid is gone", () => {
		const dir = workspace();
		writeFileSync(
			lockIn(dir),
			JSON.stringify({ pid: deadPid(), startedAt: "then" }),
		);
		const release = acquireWorkspaceLock(dir);
		expect(readWorkspaceLock(dir)?.pid).toBe(process.pid);
		release();
	});

	// #662 review: `open("wx")` then `write` leaves the file empty for an instant.
	// Reading that as "stale" let a second process delete a LIVE lock, which is
	// the one thing this lock exists to prevent.
	it("refuses a lock that is unreadable but freshly created", () => {
		const dir = workspace();
		writeFileSync(lockIn(dir), "");
		expect(() => acquireWorkspaceLock(dir)).toThrow(/cannot be read yet/i);
		expect(readFileSync(lockIn(dir), "utf8")).toBe("");
	});

	it("takes over an unreadable lock only once the grace has passed", () => {
		const dir = workspace();
		writeFileSync(lockIn(dir), "not json");
		age(lockIn(dir), MALFORMED_GRACE_MS + 60_000);
		const release = acquireWorkspaceLock(dir);
		expect(readWorkspaceLock(dir)?.pid).toBe(process.pid);
		release();
	});

	it("never leaves the lock file empty, so no reader can mistake it for stale", () => {
		const dir = workspace();
		const release = acquireWorkspaceLock(dir);
		expect(readFileSync(lockIn(dir), "utf8").length).toBeGreaterThan(0);
		expect(readWorkspaceLockState(dir).kind).toBe("held");
		release();
	});

	it("does not reclaim while another process holds the steal lock", () => {
		const dir = workspace();
		writeFileSync(
			lockIn(dir),
			JSON.stringify({ pid: deadPid(), startedAt: "then" }),
		);
		// A concurrent reclaimer is inside its critical section.
		writeFileSync(`${lockIn(dir)}.steal`, "");

		expect(() => acquireWorkspaceLock(dir)).toThrow(/reclaiming/i);
	});

	it("classifies the states it acts on", () => {
		const dir = workspace();
		expect(readWorkspaceLockState(dir)).toEqual({ kind: "free" });

		writeFileSync(lockIn(dir), JSON.stringify({ pid: deadPid(), startedAt: "t" }));
		expect(readWorkspaceLockState(dir).kind).toBe("stale");

		writeFileSync(lockIn(dir), "{}");
		expect(readWorkspaceLockState(dir).kind).toBe("unreadable");
	});
});
