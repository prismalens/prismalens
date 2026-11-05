// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	type HandoffConfig,
	type HandoffDeps,
	readHandoffResult,
	restoreBackup,
	runHandoff,
	switchWrappers,
} from "./update-handoff.js";

let root: string;
let cfg: HandoffConfig;
beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "pl-handoff-"));
	const runtimeRoot = join(root, "data", "runtime");
	for (const v of ["0.5.1", "0.6.0", "0.5.10"]) mkdirSync(join(runtimeRoot, v, "bin"), { recursive: true });
	mkdirSync(join(root, "bin"));
	mkdirSync(join(root, "ws"));
	writeFileSync(join(root, "bin", "pl"), `#!/bin/sh\nexec "${join(runtimeRoot, "0.6.0", "bin", "pl")}" "$@"\n`);
	writeFileSync(join(root, "data", "receipt"), "version=0.6.0\nchannel=installer\n");
	writeFileSync(join(root, "ws", "prismalens.db"), "migrated by 0.6.0");
	cfg = {
		pid: 42,
		mode: "terminal",
		from: "0.5.1",
		to: "0.6.0",
		healthUrl: "http://127.0.0.1:3999/health",
		workspaceDir: join(root, "ws"),
		startedAt: 1_000,
		deadlineMs: 5_000,
		logPath: join(root, "ws", "update-restart.log"),
		binDir: join(root, "bin"),
		runtimeRoot,
		upArgs: ["up", "--no-open"],
		platform: "linux",
		uid: 501,
	};
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function deps(health: (n: number) => string | null, exits = false) {
	let clock = 0;
	let calls = 0;
	const launched: string[] = [];
	const ran: string[][] = [];
	const d: HandoffDeps = {
		alive: () => clock < 500,
		health: async () => health(calls++),
		sleep: async (ms) => {
			clock += ms;
		},
		now: () => clock,
		launch: (dir) => {
			launched.push(dir);
			return { exited: () => exits, kill: vi.fn() };
		},
		run: (argv) => {
			ran.push(argv);
			return true;
		},
	};
	return { d, launched, ran };
}

describe("runHandoff", () => {
	it("waits for the old pid, launches the new version and records done", async () => {
		const { d, launched } = deps((n) => (n < 2 ? null : "0.6.0"));
		const result = await runHandoff(cfg, d);
		expect(result.result).toBe("done");
		expect(launched).toEqual([join(cfg.runtimeRoot, "0.6.0")]);
		expect(readHandoffResult(cfg.workspaceDir)?.result).toBe("done");
	});

	it("rolls back wrappers and the database and starts the previous version when the new one never answers", async () => {
		writeFileSync(join(cfg.workspaceDir, "prismalens.db.bak-500"), "too old");
		writeFileSync(join(cfg.workspaceDir, "prismalens.db.bak-2000"), "before 0.6.0");
		const { d, launched } = deps(() => null);
		const result = await runHandoff(cfg, d);
		expect(result.result).toBe("failed");
		expect(result.reason).toContain("prismalens.db.bak-2000");
		expect(readFileSync(join(cfg.workspaceDir, "prismalens.db"), "utf8")).toBe("before 0.6.0");
		expect(readFileSync(join(cfg.binDir, "pl"), "utf8")).toContain(join(cfg.runtimeRoot, "0.5.1", "bin"));
		expect(readFileSync(join(root, "data", "receipt"), "utf8")).toContain("version=0.5.1");
		expect(launched).toEqual([join(cfg.runtimeRoot, "0.6.0"), join(cfg.runtimeRoot, "0.5.1")]);
	});

	it("gives up early when the new process exits", async () => {
		const { d } = deps(() => null, true);
		const result = await runHandoff(cfg, d);
		expect(result.reason).toContain("exited before it was ready");
	});

	it("under systemd it launches nothing and restarts the unit after a rollback", async () => {
		const { d, launched, ran } = deps(() => null);
		await runHandoff({ ...cfg, mode: "systemd" }, d);
		expect(launched).toEqual([]);
		expect(ran.map((a) => a.join(" "))).toEqual([
			"systemctl --user stop prismalens.service",
			"systemctl --user reset-failed prismalens.service",
			"systemctl --user start prismalens.service",
		]);
	});

	it("under launchd it kicks the agent", async () => {
		const { d, ran } = deps(() => null);
		await runHandoff({ ...cfg, mode: "launchd" }, d);
		expect(ran).toEqual([["launchctl", "kickstart", "-k", "gui/501/io.prismalens.server"]]);
	});
});

describe("switchWrappers", () => {
	it("never matches a version inside a longer one", () => {
		writeFileSync(join(cfg.binDir, "pl"), `exec "${join(cfg.runtimeRoot, "0.5.10", "bin", "pl")}"\n`);
		switchWrappers(cfg.binDir, cfg.runtimeRoot, "0.5.1", "0.6.0", join(root, "data"));
		expect(readFileSync(join(cfg.binDir, "pl"), "utf8")).toContain("0.5.10");
	});

	it("refuses a runtime that is gone", () => {
		expect(switchWrappers(cfg.binDir, cfg.runtimeRoot, "0.6.0", "0.4.0", root)).toContain("gone");
	});
});

describe("restoreBackup", () => {
	it("restores nothing when no backup is newer than the install", () => {
		expect(restoreBackup(cfg.workspaceDir, 1_000)).toBeNull();
	});
});
