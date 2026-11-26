// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
	existsSync,
	linkSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	realpathSync,
	rmdirSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
	configVar,
	homeFs,
	rootKeys,
	scratchEnv,
	seedProject,
	seedUser,
} from "../../../../scripts/fakes/markers/seed.mjs";
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

	it("with every root unset, points each one into the run's own home, seeds only there, and leaves the real home's config as it was", () => {
		const real = [
			[".claude", "settings.json"],
			[".claude.json"],
			[".codex", "config.toml"],
			[".codex", "hooks.json"],
			[".gemini", "settings.json"],
			[".config", "opencode", "opencode.json"],
		].map((p) => join(homedir(), ...p));
		const snap = () =>
			real.map((p) => (existsSync(p) ? createHash("sha256").update(readFileSync(p)).digest("hex") : null));
		const was = snap();
		const agents = ["claude-code", "codex", "opencode", "gemini"];
		const seen = agents.map((h) => {
			const env = scratchEnv(h, {});
			const home = dirname(env[configVar(h) as string] as string);
			const ws = mkdtempSync(join(tmpdir(), "pl-iso-ws-"));
			dirs.push(home, ws);
			seedUser(h, env, ws);
			seedProject(h, ws, env, ws);
			const roots = rootKeys().map((k) => relative(home, env[k] as string));
			const dirsOnly = rootKeys().every((k) => statSync(env[k] as string).isDirectory());
			return [roots, dirsOnly, readdirSync(home).filter((d) => readdirSync(join(home, d)).length > 0)];
		});
		const lower = rootKeys().map((k) => k.toLowerCase());
		expect([seen, snap()]).toEqual([
			agents.map((h) => [lower, true, [(configVar(h) as string).toLowerCase()]]),
			was,
		]);
	});

	it("copies a config folder agents are still using: every root it returns is a folder, its files are copied, and a link that dangles or leaves is not followed", () => {
		const src = mkdtempSync(join(tmpdir(), "pl-iso-live-"));
		const gone = mkdtempSync(join(tmpdir(), "pl-iso-gone-"));
		const outside = mkdtempSync(join(ENGINE, ".iso-real-dir-"));
		dirs.push(src, outside);
		writeFileSync(join(src, "config.toml"), 'model = "scripted"');
		writeFileSync(join(outside, "secret.json"), "{}");
		mkdirSync(join(src, "tmp"));
		// What a codex killed mid-run leaves in its home: a per-process link whose target is gone.
		symlinkSync(gone, join(src, "tmp", "arg0"), "junction");
		rmSync(gone, { recursive: true });
		symlinkSync(outside, join(src, "out"), "junction");
		const env = scratchEnv("codex", { CODEX_HOME: src });
		const home = env.CODEX_HOME as string;
		dirs.push(dirname(home));
		expect([
			rootKeys().filter((k) => !statSync(env[k] as string).isDirectory()),
			readFileSync(join(home, "config.toml"), "utf8"),
			readdirSync(home).sort(),
			readdirSync(join(home, "tmp")),
		]).toEqual([[], 'model = "scripted"', ["config.toml", "tmp"], []]);
	});

	it("copies a config folder another process keeps writing, every time, as an earlier row's agent still does", async () => {
		const src = mkdtempSync(join(tmpdir(), "pl-iso-busy-"));
		writeFileSync(join(src, "config.toml"), "x");
		mkdirSync(join(src, "sessions"));
		const busy = join(src, "sessions");
		const churn = spawn(process.execPath, [
			"-e",
			`const fs=require("fs"),p=require("path");let i=0;for(;;){const f=p.join(${JSON.stringify(busy)},"s"+(i++%50));try{fs.writeFileSync(f,"x".repeat(4096));fs.rmSync(f,{force:true})}catch{}}`,
		]);
		const failures: string[] = [];
		try {
			await new Promise((r) => setTimeout(r, 300));
			for (let n = 0; n < 100; n++)
				try {
					dirs.push(dirname(scratchEnv("codex", { CODEX_HOME: src }).CODEX_HOME as string));
				} catch (err) {
					failures.push(err instanceof Error ? err.message : String(err));
				}
		} finally {
			churn.kill();
			await new Promise((r) => churn.once("exit", r));
			dirs.push(src);
		}
		expect(failures).toEqual([]);
	});

	it("refuses a config root that is relative, ~, drive-relative, UNC, extended-length, climbs out with .., or links out of the temp folder through a chain; accepts a trailing or mixed separator", () => {
		const src = mkdtempSync(join(tmpdir(), "pl-iso-src-"));
		const outside = mkdtempSync(join(ENGINE, ".iso-real-dir-"));
		const l2 = join(tmpdir(), `pl-iso-l2-${process.pid}`);
		const l1 = join(tmpdir(), `pl-iso-l1-${process.pid}`);
		symlinkSync(outside, l2, "junction");
		symlinkSync(l2, l1, "junction");
		dirs.push(l1, l2, src, outside);
		const cut = src.lastIndexOf(sep);
		const shapes = [
			"pl-iso-rel",
			"~",
			"~/pl-iso",
			`${src}${sep}..${sep}..`,
			"C:pl-iso",
			"\\\\host\\share\\pl-iso",
			`\\\\?\\${src}`,
			l1,
			`${src}${sep}`,
			`${src.slice(0, cut)}/${src.slice(cut + 1)}`,
		];
		const outcomes = shapes.map((dir) => {
			try {
				dirs.push(dirname(scratchEnv("claude-code", { CLAUDE_CONFIG_DIR: dir }).CLAUDE_CONFIG_DIR as string));
				return "accepted";
			} catch (err) {
				return err instanceof Error ? err.message : String(err);
			}
		});
		const no = "claude-code: CLAUDE_CONFIG_DIR is not under the temp folder; markers go only in a scratch home";
		expect([outcomes, readdirSync(outside)]).toEqual([[no, no, no, no, no, no, no, no, "accepted", "accepted"], []]);
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

	it("accepts a config folder written by the temp folder's real path when the temp folder is a link, as macOS's /var is", () => {
		const real = mkdtempSync(join(tmpdir(), "pl-iso-realtmp-"));
		const link = join(tmpdir(), `pl-iso-tmplink-${process.pid}`);
		symlinkSync(real, link, "junction");
		dirs.push(real, link);
		const saved = { TMPDIR: process.env.TMPDIR, TEMP: process.env.TEMP, TMP: process.env.TMP };
		Object.assign(process.env, { TMPDIR: link, TEMP: link, TMP: link });
		try {
			const dir = join(realpathSync.native(link), "pl-seed-x", "claude_config_dir");
			mkdirSync(dir, { recursive: true });
			homeFs(dir).mkdir(join(dir, "sub"));
			expect([tmpdir(), statSync(join(real, "pl-seed-x", "claude_config_dir", "sub")).isDirectory()]).toEqual([link, true]);
		} finally {
			for (const [k, v] of Object.entries(saved))
				if (v === undefined) delete process.env[k];
				else process.env[k] = v;
		}
	});

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

	it("refuses a chain of folder links in the home that leaves it, and a link to the home's parent, writing nothing outside", () => {
		const { home } = planted();
		const outside = mkdtempSync(join(ENGINE, ".iso-real-dir-"));
		dirs.push(outside);
		symlinkSync(outside, join(home, "b"), "junction");
		symlinkSync(join(home, "b"), join(home, "a"), "junction");
		symlinkSync(dirname(home), join(home, "up"), "junction");
		const f = homeFs(home);
		const tries = [join(home, "a", "x.json"), join(home, "up", "x.json")].map((p) => {
			try {
				f.write(p, "x");
				return "written";
			} catch (err) {
				return err instanceof Error ? err.message : String(err);
			}
		});
		expect([tries, readdirSync(outside), existsSync(join(dirname(home), "x.json"))]).toEqual([
			[
				`${join(home, "a")} is a link; markers go only in a scratch home`,
				`${join(home, "up")} is a link; markers go only in a scratch home`,
			],
			[],
			false,
		]);
	});

	it("removes a folder that a link swapped in between its check and its create put outside the home, and refuses", () => {
		const { home } = planted();
		const outside = mkdtempSync(join(ENGINE, ".iso-real-dir-"));
		dirs.push(outside);
		const target = join(home, "a", "b");
		const f = homeFs(home, {
			between: (abs) => {
				if (abs === target) {
					rmdirSync(join(home, "a"));
					symlinkSync(outside, join(home, "a"), "junction");
				}
			},
		});
		expect(() => f.mkdir(target)).toThrow(`${target} resolves outside ${home}; markers go only in a scratch home`);
		expect(readdirSync(outside)).toEqual([]);
	});

	it("replaces a link put at a file's name between its check and its write, and leaves the link's target as it was", () => {
		const { real, home } = planted();
		const target = join(home, "x.json");
		const f = homeFs(home, { between: () => linkSync(join(real, "settings.json"), target) });
		f.write(target, "new");
		expect([mine(real), readFileSync(target, "utf8")]).toEqual(['{"mine":true}', "new"]);
	});

	it("removes a file written through a folder swapped for a link between its check and its write, and refuses", () => {
		const { home } = planted();
		const outside = mkdtempSync(join(ENGINE, ".iso-real-dir-"));
		dirs.push(outside);
		const target = join(home, "d", "x.json");
		const f = homeFs(home, {
			between: (abs) => {
				if (abs === target) {
					rmdirSync(join(home, "d"));
					symlinkSync(outside, join(home, "d"), "junction");
				}
			},
		});
		expect(() => f.write(target, "x")).toThrow(
			`${join(home, "d", ".pl-seed-")}`,
		);
		expect(readdirSync(outside)).toEqual([]);
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
