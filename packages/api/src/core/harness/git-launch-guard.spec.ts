// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const PACKAGES = resolve(__dirname, "../../../..");

/**
 * Launches whose env is passed in by their callers, each of which builds it with `gitEnv`
 * (agent-host `gitChildEnv` underneath). Anything else must build its env in the call.
 */
const ALLOWED: Record<string, string> = {
	"api/src/core/harness/git-spawn.ts":
		"spawnGit: callers pass gitEnv(...) or an env spread from it",
	"@prismalens/agent-host/src/workspace/git.ts":
		"git()/hasCommit(): workspace/index.ts passes gitEnv(...) only",
	"cli/src/cli/doctor.ts":
		"reads the user's credential.helper in their own shell; writes nothing",
};

/** A git child built by name: spawn/execFile family, a promisified runner, or a shell string. */
const LAUNCH =
	/\b(?:spawn|spawnSync|execFile|execFileSync|exec|execSync|run)\(\s*(?:"git"|'git'|`git[ `])/g;
/** The env the call builds, through the one shared filter. */
const FILTERED = /env:\s*(?:gitChildEnv|gitEnv)\(/;

function sources(dir: string, out: string[] = []): string[] {
	for (const name of readdirSync(dir)) {
		if (["node_modules", "dist", "e2e", "test", "__fixtures__"].includes(name))
			continue;
		const path = join(dir, name);
		if (statSync(path).isDirectory()) sources(path, out);
		else if (
			/\.(c|m)?ts$/.test(name) &&
			!/\.(spec|test)\.(c|m)?ts$/.test(name) &&
			!name.endsWith(".d.ts")
		)
			out.push(path);
	}
	return out;
}

describe("every git launch filters its env (#1020)", () => {
	it("no source launches git without the shared env filter, except the listed runners", () => {
		const roots = readdirSync(PACKAGES).flatMap((p) =>
			p.startsWith("@")
				? readdirSync(join(PACKAGES, p)).map((q) => join(PACKAGES, p, q, "src"))
				: [join(PACKAGES, p, "src")],
		);
		const bad: string[] = [];
		let seen = 0;
		for (const root of roots) {
			try {
				statSync(root);
			} catch {
				continue;
			}
			for (const file of sources(root)) {
				const text = readFileSync(file, "utf8");
				const rel = relative(PACKAGES, file).split("\\").join("/");
				for (const m of text.matchAll(LAUNCH)) {
					seen++;
					if (ALLOWED[rel]) continue;
					const call = text.slice(m.index, m.index + 600);
					if (!FILTERED.test(call)) bad.push(`${rel}:${text.slice(0, m.index).split("\n").length}`);
				}
			}
		}
		expect(seen).toBeGreaterThan(3);
		expect(bad).toEqual([]);
	});
});
