// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "../../../../..");
const SKIP = new Set(["node_modules", "dist", ".git", ".turbo", "coverage", "scripts"]);

function sources(dir: string, out: string[] = []): string[] {
	for (const name of readdirSync(dir)) {
		if (SKIP.has(name)) continue;
		const path = join(dir, name);
		if (statSync(path).isDirectory()) sources(path, out);
		else if (/\.(ts|tsx|mjs|js)$/.test(name)) out.push(path);
	}
	return out;
}

describe("Gemini folder trust (#1180 R5, ADR 0004 §2)", () => {
	it("no product source outside scripts/ sets GEMINI_CLI_TRUST_WORKSPACE to true", () => {
		const setsTrue = /GEMINI_CLI_TRUST_WORKSPACE["'`]?\s*[:=,]\s*["'`]true/;
		const files = sources(join(REPO, "packages"));
		expect(files).toContain(join(REPO, "packages/@prismalens/agent-host/src/registry/isolation.ts"));
		expect(setsTrue.test('{ GEMINI_CLI_TRUST_WORKSPACE: "true" }')).toBe(true);
		const offenders = files
			.filter((f) => !f.endsWith("isolation.test.ts"))
			.filter((f) => setsTrue.test(readFileSync(f, "utf8")))
			.map((f) => relative(REPO, f));
		expect(offenders).toEqual([]);
	});
});
