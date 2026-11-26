// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	linkSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { seedUser } from "../../../../scripts/fakes/markers/seed.mjs";
import type { Row } from "../../../../scripts/fakes/scripted-model.mjs";
import { isolatedSession, runIsolationRow } from "./acp-isolation.js";

const ENGINE = join(dirname(fileURLToPath(import.meta.url)), "..");
const dirs: string[] = [];
afterEach(() => {
	for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const row = {
	row: "probe-runs-no-user-code",
	run: { isolation: "probe" },
	markers: { "claude-code": ["user-hook"] },
} as unknown as Row;

describe("the isolation rows (#1180 R1)", () => {
	it("refuses to seed markers into a config folder outside the temp folder, and writes nothing there", async () => {
		// Inside the package, so outside the OS temp folder on every platform.
		const real = mkdtempSync(join(ENGINE, ".iso-real-"));
		dirs.push(real);
		await expect(runIsolationRow(row, "claude-code", { CLAUDE_CONFIG_DIR: real })).rejects.toThrow(
			"claude-code: CLAUDE_CONFIG_DIR is not under the temp folder; markers go only in a scratch home",
		);
		expect(readdirSync(real)).toEqual([]);
	});

	it("refuses when the agent's config folder is not set at all", async () => {
		await expect(runIsolationRow(row, "claude-code", {})).rejects.toThrow(
			"claude-code: CLAUDE_CONFIG_DIR is not set; markers go only in a scratch home",
		);
	});

	/** A real config outside the temp folder, and a scratch home PrismaLens made beside a link to it. */
	const planted = () => {
		const real = mkdtempSync(join(ENGINE, ".iso-real-"));
		const home = mkdtempSync(join(tmpdir(), "pl-iso-home-"));
		dirs.push(real, home);
		writeFileSync(join(real, "settings.json"), '{"mine":true}');
		return { real, home };
	};
	const seedClaude = (home: string) => () => seedUser("claude-code", { CLAUDE_CONFIG_DIR: home }, home);

	it("refuses to write through a hard-linked config file in the scratch home, and leaves its target as it was", () => {
		const { real, home } = planted();
		linkSync(join(real, "settings.json"), join(home, "settings.json"));
		expect(seedClaude(home)).toThrow(`${join(home, "settings.json")} is a link; markers go only in a scratch home`);
		expect(readFileSync(join(real, "settings.json"), "utf8")).toBe('{"mine":true}');
	});

	it("refuses to write through a linked folder in the scratch home, and leaves the folder it points at empty", () => {
		const { real, home } = planted();
		const outside = mkdtempSync(join(ENGINE, ".iso-real-dir-"));
		dirs.push(outside);
		// A junction needs no privilege on Windows; elsewhere it is a folder symlink.
		symlinkSync(outside, join(home, "plugins"), "junction");
		const codex = () => seedUser("codex", { CODEX_HOME: home }, home);
		expect(codex).toThrow(/plugins.* resolves outside .*; markers go only in a scratch home$/);
		expect([readdirSync(outside), readFileSync(join(real, "settings.json"), "utf8")]).toEqual([[], '{"mine":true}']);
	});

	const canSymlinkFiles = (() => {
		const d = mkdtempSync(join(tmpdir(), "pl-iso-probe-"));
		try {
			writeFileSync(join(d, "t"), "");
			symlinkSync(join(d, "t"), join(d, "l"), "file");
			return true;
		} catch {
			return false;
		} finally {
			rmSync(d, { recursive: true, force: true });
		}
	})();
	it.runIf(canSymlinkFiles)(
		"refuses to write through a symlinked config file (skipped where file symlinks need a privilege this account lacks)",
		() => {
			const { real, home } = planted();
			symlinkSync(join(real, "settings.json"), join(home, "settings.json"), "file");
			expect(seedClaude(home)).toThrow(`${join(home, "settings.json")} is a link; markers go only in a scratch home`);
			expect(readFileSync(join(real, "settings.json"), "utf8")).toBe('{"mine":true}');
		},
	);

	it("refuses a scratch home PrismaLens did not make, even under the temp folder", () => {
		const other = mkdtempSync(join(tmpdir(), "someone-else-"));
		dirs.push(other);
		expect(() => seedUser("claude-code", { CLAUDE_CONFIG_DIR: other }, other)).toThrow(
			"claude-code: CLAUDE_CONFIG_DIR is not under the temp folder; markers go only in a scratch home",
		);
		expect(readdirSync(other)).toEqual([]);
	});

	it("reports a session that cannot start as a problem, not a pass", async () => {
		const empty = mkdtempSync(join(tmpdir(), "pl-iso-path-"));
		const cwd = mkdtempSync(join(tmpdir(), "pl-iso-ws-"));
		dirs.push(empty, cwd);
		const problem = await isolatedSession(
			"opencode",
			{ PATH: empty, XDG_CONFIG_HOME: join(empty, "config") },
			cwd,
			"own",
			false,
		);
		expect(problem).toMatch(/^the own session failed: /);
	});
});
