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
	failureLine,
	readLastLogLines,
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

	it("rolls back immediately when service probe reports failed without waiting for timeout", async () => {
		takeSnapshot(ws, trial);
		migrate();
		const logDir = join(ws, "logs");
		mkdirSync(logDir, { recursive: true });
		writeFileSync(
			join(logDir, "service.log"),
			Array.from({ length: 30 }, (_, i) => `log line ${i + 1}`).join("\n"),
		);

		const start = Date.now();
		const outcome = await settleTrial({
			workspace: ws,
			trial,
			check: () =>
				awaitTrial({
					base: "http://127.0.0.1:9999",
					instanceId: "inst",
					version: "0.5.2",
					deadlineMs: 60_000,
					intervalMs: 100,
					logPath: join(logDir, "service.log"),
					serviceProbe: () => true,
				}),
			stop: () => true,
			start: () => true,
			switchBack: () => null,
		});

		const elapsed = Date.now() - start;
		expect(elapsed).toBeLessThan(5_000);
		expect(outcome.result).toBe("rolled-back");
		expect(outcome.reason).toContain("0.5.2 exited during the trial");
		expect(outcome.reason).toContain("log line 30");
		expect(outcome.reason).not.toContain("log line 29");
		expect(outcome.reason).toContain(
			`(full log: ${join(logDir, "service.log")})`,
		);
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

describe("trial failure reason (#673)", () => {
	const TOKEN = "pl_pair_Zq8xK2mN4vB7cT1yR9wE";
	const console = [
		"ℹ Open: http://localhost:6473/pair#" + TOKEN,
		"ℹ It works once, for 15 minutes; treat it as a password.",
		`{"level":50,"msg":"Nest can't resolve dependencies","token":"${TOKEN}"}`,
		"\u001b[31mError: listen EADDRINUSE: address already in use 127.0.0.1:6473\u001b[39m",
		`  at Server.listen (node:net:1) token=${TOKEN}`,
	];

	it("a token in the trial's console never reaches the reason", async () => {
		const dir = mkdtempSync(join(tmpdir(), "pl-trial-"));
		const log = join(dir, "service.log");
		writeFileSync(log, `${console.join("\n")}\n`);
		const outcome = await awaitTrial({
			base: "http://127.0.0.1:9",
			instanceId: "a",
			version: "0.5.2",
			deadlineMs: 0,
			logPath: log,
			serviceProbe: () => true,
		});
		const reason = outcome.ok ? "" : outcome.reason;
		expect(reason).not.toContain(TOKEN);
		expect(reason).toBe(
			`0.5.2 exited during the trial: Error: listen EADDRINUSE: address already in use 127.0.0.1:6473 (full log: ${log})`,
		);
		expect(failureLine([`listen failed token=${TOKEN}`])).toBe(
			"listen failed token=[redacted]",
		);
	});

	it("prefers the last error line and never the pairing link", () => {
		for (let n = 1; n <= console.length; n++) {
			expect(failureLine(console.slice(0, n)) ?? "").not.toContain(TOKEN);
		}
		expect(failureLine(console.slice(0, 4))).toBe(
			"Error: listen EADDRINUSE: address already in use 127.0.0.1:6473",
		);
		expect(failureLine(console.slice(0, 3))).toBe(
			"error: Nest can't resolve dependencies",
		);
		expect(failureLine(console.slice(0, 1))).toBe(
			"ℹ Open: http://localhost:6473/pair#[redacted]",
		);
		expect(failureLine([])).toBeNull();
	});
});

describe("readLastLogLines (#776 review)", () => {
	it("reads only the end of a large log", () => {
		const dir = mkdtempSync(join(tmpdir(), "pl-log-"));
		const log = join(dir, "service.log");
		const filler = `${"x".repeat(199)}\n`.repeat(5_000);
		writeFileSync(log, `${filler}second to last\nlast\n`);
		expect(statSync(log).size).toBeGreaterThan(64 * 1024);
		expect(readLastLogLines(log, 2)).toEqual(["second to last", "last"]);
		const tail = readLastLogLines(log, 10_000);
		expect(tail.length).toBeLessThan(400);
		expect(tail.every((line) => line === "x".repeat(199) || line.includes("last"))).toBe(true);
	});

	it("returns nothing for a missing log", () => {
		expect(readLastLogLines(join(tmpdir(), "pl-no-such.log"))).toEqual([]);
	});
});
