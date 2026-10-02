// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	awaitTrial,
	completePendingRestore,
	readOutcome,
	readTrial,
	restorePending,
	SNAPSHOT_DIR,
	settleTrial,
	switchInstallerRuntime,
	takeSnapshot,
} from "./upgrade-trial.js";

const trial = { from: "0.5.1", to: "0.5.2", channel: "installer", startedAt: "t" };
let ws: string;
const read = (name: string) => readFileSync(join(ws, name), "utf8");

beforeEach(() => {
	ws = mkdtempSync(join(tmpdir(), "pl-trial-"));
	writeFileSync(join(ws, "prismalens.db"), "old-db");
	writeFileSync(join(ws, "prismalens.db-wal"), "old-wal");
});

/** What a trial's migration leaves behind. */
function migrate() {
	writeFileSync(join(ws, "prismalens.db"), "new-db");
	writeFileSync(join(ws, "prismalens.db-wal"), "new-wal");
	writeFileSync(join(ws, "prismalens.db-shm"), "new-shm");
}

describe("settleTrial", () => {
	it("commits a healthy trial and drops the snapshot", async () => {
		takeSnapshot(ws, trial);
		migrate();
		const stop = vi.fn();
		const outcome = await settleTrial({
			workspace: ws,
			trial,
			check: async () => ({ ok: true }),
			stop,
			start: () => true,
			switchBack: () => null,
		});
		expect(outcome.result).toBe("committed");
		expect(stop).not.toHaveBeenCalled();
		expect(read("prismalens.db")).toBe("new-db");
		expect(existsSync(join(ws, SNAPSHOT_DIR))).toBe(false);
	});

	it("rolls a failed trial back: stop, restore, switch back, start", async () => {
		takeSnapshot(ws, trial);
		migrate();
		const calls: string[] = [];
		const outcome = await settleTrial({
			workspace: ws,
			trial,
			check: async () => ({ ok: false, reason: "timed out" }),
			stop: () => {
				calls.push("stop");
				return true;
			},
			switchBack: () => {
				calls.push(`switch:${read("prismalens.db")}`);
				return null;
			},
			start: () => {
				calls.push("start");
				return true;
			},
		});
		expect(calls).toEqual(["stop", "switch:old-db", "start"]);
		expect(outcome).toMatchObject({ result: "rolled-back", reason: "timed out" });
		expect(read("prismalens.db-wal")).toBe("old-wal");
		expect(existsSync(join(ws, "prismalens.db-shm"))).toBe(false);
		expect(readOutcome(ws)?.result).toBe("rolled-back");
		expect(existsSync(join(ws, SNAPSHOT_DIR))).toBe(false);
	});

	it("leaves the service stopped when the channel can't switch back", async () => {
		takeSnapshot(ws, trial);
		migrate();
		const start = vi.fn(() => true);
		const outcome = await settleTrial({
			workspace: ws,
			trial,
			check: async () => ({ ok: false, reason: "crashed" }),
			stop: () => true,
			start,
			switchBack: () => "homebrew can't reinstall 0.5.1",
		});
		expect(start).not.toHaveBeenCalled();
		expect(outcome.result).toBe("restored-only");
		expect(outcome.reason).toContain("homebrew can't reinstall 0.5.1");
		expect(read("prismalens.db")).toBe("old-db");
	});
});

describe("snapshot", () => {
	it("keeps the first snapshot of an unfinished upgrade", () => {
		takeSnapshot(ws, trial);
		migrate();
		expect(takeSnapshot(ws, { ...trial, to: "0.5.3" }).to).toBe("0.5.2");
		expect(readFileSync(join(ws, SNAPSHOT_DIR, "prismalens.db"), "utf8")).toBe("old-db");
	});

	it("finishes a restore cut short before anything boots", () => {
		takeSnapshot(ws, trial);
		migrate();
		// A crash after the marker and the first file: the rest is still the trial's.
		writeFileSync(join(ws, SNAPSHOT_DIR, "RESTORE"), "");
		writeFileSync(join(ws, "prismalens.db"), "old-db");
		expect(restorePending(ws)).toBe(true);
		expect(completePendingRestore(ws)).toBe(true);
		expect(read("prismalens.db-wal")).toBe("old-wal");
		expect(existsSync(join(ws, "prismalens.db-shm"))).toBe(false);
		expect(readTrial(ws)).toBe(null);
		expect(readOutcome(ws)?.result).toBe("restored-only");
		expect(completePendingRestore(ws)).toBe(false);
	});
});

describe("awaitTrial", () => {
	const answering = (body: object) =>
		(async () => new Response(JSON.stringify(body))) as unknown as typeof fetch;

	it("waits for this instance on the new version", async () => {
		expect(
			await awaitTrial({
				base: "http://127.0.0.1:1",
				instanceId: "a",
				version: "0.5.2",
				deadlineMs: 0,
				fetchImpl: answering({ instanceId: "a", version: "0.5.2" }),
			}),
		).toEqual({ ok: true });
	});

	it("fails when the old version or another instance answers", async () => {
		const old = await awaitTrial({
			base: "http://x",
			instanceId: "a",
			version: "0.5.2",
			deadlineMs: 20,
			intervalMs: 5,
			fetchImpl: answering({ instanceId: "a", version: "0.5.1" }),
		});
		expect(old).toMatchObject({ ok: false });
		expect(!old.ok && old.reason).toContain("answers as 0.5.1");
		const other = await awaitTrial({
			base: "http://x",
			instanceId: "a",
			version: "0.5.2",
			deadlineMs: 0,
			fetchImpl: answering({ instanceId: "b", version: "0.5.2" }),
		});
		expect(!other.ok && other.reason).toContain("different instance");
	});
});

describe("switchInstallerRuntime", () => {
	it("points the wrappers and receipt at the kept runtime", () => {
		const data = join(ws, "data");
		const bin = join(ws, "bin");
		mkdirSync(join(data, "runtime", "0.5.1", "bin"), { recursive: true });
		writeFileSync(join(data, "runtime", "0.5.1", "bin", "pl"), "");
		mkdirSync(bin);
		for (const name of ["pl", "prismalens"]) {
			writeFileSync(
				join(bin, name),
				`#!/bin/sh\n# marker\nexec "${data}/runtime/0.5.2/bin/${name}" "$@"\n`,
			);
		}
		writeFileSync(join(data, "receipt"), "version=0.5.2\nchannel=installer\n");
		expect(switchInstallerRuntime({ dataDir: data, binDir: bin, version: "0.5.1" })).toBe(null);
		expect(readFileSync(join(bin, "prismalens"), "utf8")).toContain(
			`exec "${data}/runtime/0.5.1/bin/prismalens" "$@"`,
		);
		expect(statSync(join(bin, "pl")).mode & 0o777).toBe(0o755);
		expect(readFileSync(join(data, "receipt"), "utf8")).toContain("version=0.5.1\n");
	});

	it("says so when the previous runtime is gone", () => {
		expect(
			switchInstallerRuntime({ dataDir: ws, binDir: ws, version: "0.4.0" }),
		).toContain("no longer keeps 0.4.0");
	});

	it("restores nothing while the trial can't be stopped", async () => {
		takeSnapshot(ws, trial);
		migrate();
		const start = vi.fn(() => true);
		const switchBack = vi.fn(() => null);
		const outcome = await settleTrial({
			workspace: ws,
			trial,
			check: async () => ({ ok: false, reason: "crashed" }),
			stop: async () => false,
			start,
			switchBack,
		});
		expect(start).not.toHaveBeenCalled();
		expect(switchBack).not.toHaveBeenCalled();
		expect(outcome.reason).toContain("couldn't be stopped");
		expect(read("prismalens.db")).toBe("new-db");
		expect(existsSync(join(ws, SNAPSHOT_DIR))).toBe(true);
	});
});
