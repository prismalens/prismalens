// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { listHarnessStatus, resolveHarnessSelection, resolveOnPath } from "./harness-selection.js";

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

	it("auto-selects the first verified harness on PATH", () => {
		const s = resolveHarnessSelection({ isOnPath: onPath(["gemini", "opencode"]) });
		expect(s).toMatchObject({ runnable: true, harness: "opencode", auto: true, verified: true });
	});

	it("never auto-selects an unverified harness, but names it in the refusal", () => {
		const s = resolveHarnessSelection({ isOnPath: onPath(["gemini"]) });
		expect(s.runnable).toBe(false);
		if (!s.runnable) expect(s.reason).toContain("PRISMALENS_HARNESS=<id>");
	});

	it("honours a pin to an unverified harness that is installed", () => {
		const s = resolveHarnessSelection({ envHarness: "gemini", isOnPath: onPath(["gemini"]) });
		expect(s).toMatchObject({ runnable: true, harness: "gemini", auto: false, verified: false });
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
			expect(fromSettings.reason).toContain("Settings → Harness");
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

	it("lists every registry row with installed and verified flags", () => {
		const rows = listHarnessStatus({ isOnPath: onPath(["opencode"]) });
		expect(rows.map((r) => r.id)).toEqual(["opencode", "claude-code", "codex", "gemini", "deepagents"]);
		expect(rows[0]).toMatchObject({ installed: true, verified: true, defaultModel: "opencode/muse-spark-1.3-contributor-free" });
		expect(rows[1]).toMatchObject({ installed: false, defaultModel: null });
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
});
