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
import { scratchEnv, seedUser } from "../../../../scripts/fakes/markers/seed.mjs";
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

	/** A real config outside the temp folder, and the agent's folder in a scratch home this run made. */
	const planted = (harness = "claude-code", key = "CLAUDE_CONFIG_DIR") => {
		const real = mkdtempSync(join(ENGINE, ".iso-real-"));
		const src = mkdtempSync(join(tmpdir(), "pl-iso-src-"));
		const home = scratchEnv(harness, { [key]: src })[key] as string;
		dirs.push(real, src, dirname(home));
		writeFileSync(join(real, "settings.json"), '{"mine":true}');
		return { real, src, home };
	};
	const seedClaude = (home: string) => () => seedUser("claude-code", { CLAUDE_CONFIG_DIR: home }, home);
	const mine = (real: string) => readFileSync(join(real, "settings.json"), "utf8");

	it("seeds a copy of the given config folder in a scratch home it made, and leaves the source as it was", () => {
		const { src } = planted();
		writeFileSync(join(src, "settings.json"), '{"src":true}');
		const home = scratchEnv("claude-code", { CLAUDE_CONFIG_DIR: src }).CLAUDE_CONFIG_DIR as string;
		dirs.push(dirname(home));
		seedClaude(home)();
		expect([
			readdirSync(src),
			readFileSync(join(src, "settings.json"), "utf8"),
			JSON.parse(readFileSync(join(home, "settings.json"), "utf8")).src,
			Object.keys(JSON.parse(readFileSync(join(home, "settings.json"), "utf8")).hooks),
		]).toEqual([["settings.json"], '{"src":true}', true, ["SessionStart", "UserPromptSubmit"]]);
	});

	it("refuses an existing pl-* config folder this run did not make, and changes nothing in it", () => {
		const other = mkdtempSync(join(tmpdir(), "pl-other-"));
		dirs.push(other);
		writeFileSync(join(other, "settings.json"), '{"mine":true}');
		expect(seedClaude(other)).toThrow(
			"claude-code: CLAUDE_CONFIG_DIR is not a scratch home this run made; markers go only in a scratch home",
		);
		expect([readdirSync(other), mine(other)]).toEqual([["settings.json"], '{"mine":true}']);
	});

	it("refuses a config folder under a linked parent before making any folder, and creates nothing outside", () => {
		const { home } = planted();
		const outside = mkdtempSync(join(ENGINE, ".iso-real-dir-"));
		dirs.push(outside);
		// A junction needs no privilege on Windows; elsewhere it is a folder symlink.
		symlinkSync(outside, join(home, "link"), "junction");
		const under = join(home, "link", "claude");
		expect(seedClaude(under)).toThrow(`${join(home, "link")} is a link; markers go only in a scratch home`);
		expect(readdirSync(outside)).toEqual([]);
	});

	it("refuses to write through a hard-linked config file in the scratch home, and leaves its target as it was", () => {
		const { real, home } = planted();
		linkSync(join(real, "settings.json"), join(home, "settings.json"));
		expect(seedClaude(home)).toThrow(`${join(home, "settings.json")} is a link; markers go only in a scratch home`);
		expect(mine(real)).toBe('{"mine":true}');
	});

	it("refuses to write through a linked folder in the scratch home, and leaves the folder it points at empty", () => {
		const { real, home } = planted("codex", "CODEX_HOME");
		const outside = mkdtempSync(join(ENGINE, ".iso-real-dir-"));
		dirs.push(outside);
		symlinkSync(outside, join(home, "plugins"), "junction");
		const codex = () => seedUser("codex", { CODEX_HOME: home }, home);
		expect(codex).toThrow(`${join(home, "plugins")} is a link; markers go only in a scratch home`);
		expect([readdirSync(outside), mine(real)]).toEqual([[], '{"mine":true}']);
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
			expect(mine(real)).toBe('{"mine":true}');
		},
	);

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
