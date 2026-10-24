// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	harnessLaunch,
	listHarnessStatus,
	resolveHarnessSelection,
	resolveOnPath,
	windowsInstallOnPath,
} from "./harness-selection.js";
import { HARNESS_REGISTRY } from "./providers/harness.js";

const onPath = (present: string[]) => (bin: string) => present.includes(bin);

describe("resolveHarnessSelection", () => {
	it("refuses with install hints when nothing is on PATH", () => {
		const s = resolveHarnessSelection({ isOnPath: onPath([]) });
		expect(s.runnable).toBe(false);
		if (!s.runnable) {
			expect(s.failure).toBe("no-harness");
			expect(s.reason).toContain("opencode");
		}
	});

	it("auto-selects the first harness on PATH in registry order", () => {
		const s = resolveHarnessSelection({ isOnPath: onPath(["gemini", "opencode"]) });
		expect(s).toMatchObject({ runnable: true, harness: "opencode", auto: true });
	});

	it("auto-selects a harness no compatibility run has tested", () => {
		const s = resolveHarnessSelection({ isOnPath: onPath(["gemini"]) });
		expect(s).toMatchObject({ runnable: true, harness: "gemini", auto: true });
	});

	it("honours a pin to an installed harness", () => {
		const s = resolveHarnessSelection({ envHarness: "gemini", isOnPath: onPath(["gemini"]) });
		expect(s).toMatchObject({ runnable: true, harness: "gemini", auto: false });
	});

	it("refuses a pin whose binary is missing, and an unknown pin", () => {
		expect(resolveHarnessSelection({ envHarness: "codex", isOnPath: onPath([]) })).toMatchObject({
			runnable: false,
			failure: "pinned-harness-missing",
			harness: "codex",
		});
		expect(resolveHarnessSelection({ envHarness: "cursor", isOnPath: onPath([]) })).toMatchObject({
			runnable: false,
			failure: "invalid-env-harness",
		});
	});

	it("names the Settings page, not PRISMALENS_HARNESS, when the pin came from there (#337 run e, G15)", () => {
		const fromSettings = resolveHarnessSelection({ envHarness: "codex", pinSource: "settings", isOnPath: onPath([]) });
		expect(fromSettings.runnable).toBe(false);
		if (!fromSettings.runnable) {
			expect(fromSettings.reason).toContain("Settings → Agent");
			expect(fromSettings.reason).not.toContain("PRISMALENS_HARNESS");
			expect(fromSettings.pinnedBy).toBe("settings");
		}
		const fromEnv = resolveHarnessSelection({ envHarness: "codex", isOnPath: onPath([]) });
		if (!fromEnv.runnable) {
			expect(fromEnv.reason).toContain('PRISMALENS_HARNESS="codex"');
			expect(fromEnv.pinnedBy).toBe("env");
		}
		const ok = resolveHarnessSelection({ envHarness: "opencode", pinSource: "settings", isOnPath: onPath(["opencode"]) });
		expect(ok).toMatchObject({ runnable: true, auto: false, pinnedBy: "settings" });
	});

	it("lists every registry row with installed and tested data", () => {
		const rows = listHarnessStatus({ isOnPath: onPath(["opencode"]) });
		expect(rows.map((r) => r.id)).toEqual(["opencode", "claude-code", "codex", "gemini", "deepagents", "local"]);
		expect(rows[0]).toMatchObject({
			installed: true,
			tested: { version: "1.18.30", date: "2026-09-20" },
			defaultModel: null,
		});
		expect(rows[1]).toMatchObject({
			installed: false,
			tested: { version: "0.81.1", date: "2026-10-11", companion: "2.1.296" },
			defaultModel: null,
		});
		expect(rows.map((r) => r.tested?.version ?? null)).toEqual(["1.18.30", "0.81.1", "2.2.2", null, "0.1.75", null]);
	});
});

describe.skipIf(process.platform === "win32")("resolveOnPath", () => {
	it("returns the first executable match on PATH, or null", () => {
		const a = mkdtempSync(join(tmpdir(), "pl-path-a-"));
		const b = mkdtempSync(join(tmpdir(), "pl-path-b-"));
		try {
			for (const dir of [a, b]) {
				writeFileSync(join(dir, "fake-agent"), "#!/bin/sh\n");
				chmodSync(join(dir, "fake-agent"), 0o755);
			}
			expect(resolveOnPath("fake-agent", `${a}:${b}`)).toBe(join(a, "fake-agent"));
			expect(resolveOnPath("fake-agent", "/nonexistent")).toBeNull();
		} finally {
			rmSync(a, { recursive: true, force: true });
			rmSync(b, { recursive: true, force: true });
		}
	});

	it("skips a Windows install under WSL and keeps it outside WSL (#673 w8)", () => {
		const shim = "/mnt/c/Users/me/AppData/Roaming/npm/gemini";
		const path = "/mnt/c/Users/me/AppData/Roaming/npm:/usr/local/bin";
		const only = (...paths: string[]) => ({ isExecutable: (p: string) => paths.includes(p) });
		const wsl = { WSL_DISTRO_NAME: "Ubuntu" };

		expect(resolveOnPath("gemini", path, { env: wsl, ...only(shim) })).toBeNull();
		expect(windowsInstallOnPath("gemini", path, { env: wsl, ...only(shim) })).toBe(shim);
		// A copy in the distro wins and nothing is reported as Windows-only.
		const linux = "/usr/local/bin/gemini";
		expect(resolveOnPath("gemini", path, { env: wsl, ...only(shim, linux) })).toBe(linux);
		expect(windowsInstallOnPath("gemini", path, { env: wsl, ...only(shim, linux) })).toBeNull();

		expect(resolveOnPath("gemini", path, { env: {}, ...only(shim) })).toBe(shim);
		expect(windowsInstallOnPath("gemini", path, { env: {}, ...only(shim) })).toBeNull();
	});

	it("lists the Windows-only path on a row that is not installed", () => {
		const rows = listHarnessStatus({
			isOnPath: onPath([]),
			windowsInstall: (bin) => (bin === "gemini" ? "/mnt/c/npm/gemini" : null),
		});
		expect(rows.find((r) => r.binary === "gemini")).toMatchObject({
			installed: false,
			windowsOnlyPath: "/mnt/c/npm/gemini",
		});
		expect(listHarnessStatus({ isOnPath: onPath(["gemini"]) }).every((r) => r.windowsOnlyPath === null)).toBe(true);
	});
});

describe("harnessLaunch", () => {
	it("Given both binary and companion on PATH, When harnessLaunch is called, Then it returns the PATH binary", () => {
		const probe = {
			isOnPath: (bin: string) => bin === "claude-agent-acp" || bin === "claude",
			shippedAdapter: () => "/shipped/adapter.js",
		};
		expect(harnessLaunch(HARNESS_REGISTRY["claude-code"], probe)).toEqual({
			command: "claude-agent-acp",
			args: [],
			env: {},
			shipped: false,
		});
	});

	it("Given only the companion is on PATH, When harnessLaunch is called, Then it returns the shipped script with process.execPath", () => {
		const probe = {
			isOnPath: (bin: string) => bin === "claude",
			shippedAdapter: () => "/shipped/claude-adapter.js",
		};
		expect(harnessLaunch(HARNESS_REGISTRY["claude-code"], probe)).toEqual({
			command: process.execPath,
			args: ["/shipped/claude-adapter.js"],
			env: process.versions.electron ? { ELECTRON_RUN_AS_NODE: "1" } : {},
			shipped: true,
		});
	});

	it("Given the companion is missing from PATH, When harnessLaunch is called, Then it returns null", () => {
		const probe = {
			isOnPath: () => false,
			shippedAdapter: () => "/shipped/claude-adapter.js",
		};
		expect(harnessLaunch(HARNESS_REGISTRY["claude-code"], probe)).toBeNull();
	});

	it("Given a row without adapterPackage when its binary is missing, When harnessLaunch is called, Then it returns null", () => {
		const probe = {
			isOnPath: () => false,
			shippedAdapter: () => "/shipped/adapter.js",
		};
		expect(harnessLaunch(HARNESS_REGISTRY.opencode, probe)).toBeNull();
	});

	it("Given only claude on PATH and shippedAdapter injected, When listHarnessStatus is called, Then it marks claude-code installed", () => {
		const rows = listHarnessStatus({
			isOnPath: (bin: string) => bin === "claude",
			shippedAdapter: (pkg: string) =>
				pkg === "@agentclientprotocol/claude-agent-acp"
					? "/shipped/claude-adapter.js"
					: null,
		});
		const claudeCode = rows.find((r) => r.id === "claude-code");
		expect(claudeCode?.installed).toBe(true);
	});
});


describe("binary paths and the local agent (#907)", () => {
	const canRun = (ok: string[]) => (p: string) => ok.includes(p);
	const opencode = HARNESS_REGISTRY.opencode;
	const claude = HARNESS_REGISTRY["claude-code"];
	const local = HARNESS_REGISTRY.local;

	it("runs a non-companion row's binary path as its command", () => {
		const launch = harnessLaunch(opencode, {
			isOnPath: onPath([]),
			binaryPath: "/opt/oc/opencode",
			isExecutable: canRun(["/opt/oc/opencode"]),
		});
		expect(launch).toEqual({ command: "/opt/oc/opencode", args: [], env: {}, shipped: false });
	});

	it("gives a companion row's binary path to the shipped adapter, else the adapter on PATH", () => {
		const probe = {
			isOnPath: onPath(["claude-agent-acp"]),
			binaryPath: "/opt/claude/bin/claude",
			isExecutable: canRun(["/opt/claude/bin/claude"]),
		};
		expect(harnessLaunch(claude, { ...probe, shippedAdapter: () => "/s/acp.js" })).toMatchObject({
			args: ["/s/acp.js"],
			shipped: true,
		});
		expect(harnessLaunch(claude, probe)).toMatchObject({ command: "claude-agent-acp", shipped: false });
		expect(harnessLaunch(claude, { ...probe, isOnPath: onPath([]) })).toBeNull();
	});

	it("reads a binary path that can't run as not installed, even with the agent on PATH", () => {
		expect(
			harnessLaunch(opencode, {
				isOnPath: onPath(["opencode"]),
				binaryPath: "/gone/opencode",
				isExecutable: canRun([]),
			}),
		).toBeNull();
	});

	it("starts the local agent as its command plus arguments, and not at all without one", () => {
		expect(
			harnessLaunch(local, {
				isOnPath: onPath([]),
				binaryPath: "/usr/bin/node",
				launchArgs: ["agent.mjs", "--acp"],
				isExecutable: canRun(["/usr/bin/node"]),
			}),
		).toEqual({ command: "/usr/bin/node", args: ["agent.mjs", "--acp"], env: {}, shipped: false });
		expect(harnessLaunch(local, { isOnPath: () => true })).toBeNull();
	});

	it("lists a binary path's row and the local agent as installed, with cliBinary and configDir", () => {
		const rows = listHarnessStatus({
			isOnPath: onPath([]),
			binaryPaths: { opencode: "/opt/oc/opencode" },
			localAgent: { command: "/usr/bin/node", args: [] },
			isExecutable: canRun(["/opt/oc/opencode", "/usr/bin/node"]),
		});
		const by = Object.fromEntries(rows.map((r) => [r.id, r]));
		expect(by.opencode?.installed).toBe(true);
		expect(by.local?.installed).toBe(true);
		expect(by.gemini?.installed).toBe(false);
		expect(by["claude-code"]).toMatchObject({
			cliBinary: "claude",
			configDir: { envKey: "CLAUDE_CONFIG_DIR", shownDefault: "~/.claude" },
		});
		expect(by.opencode?.configDir).toBeNull();
	});

	it("auto skips an agent whose check failed, and a pin still holds", () => {
		const input = {
			isOnPath: onPath(["opencode", "gemini"]),
			isRunnable: (id: string) => id !== "opencode",
		};
		expect(resolveHarnessSelection(input)).toMatchObject({ runnable: true, harness: "gemini", auto: true });
		expect(resolveHarnessSelection({ ...input, envHarness: "opencode" })).toMatchObject({
			runnable: true,
			harness: "opencode",
		});
	});

	it("comes last in auto order", () => {
		const s = resolveHarnessSelection({
			isOnPath: onPath(["dcode"]),
			localAgent: { command: "/usr/bin/node", args: [] },
			isExecutable: () => true,
		});
		expect(s).toMatchObject({ harness: "deepagents" });
	});
});
