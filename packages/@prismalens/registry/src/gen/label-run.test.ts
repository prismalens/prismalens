// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { git } from "./git.ts";
import type { Config } from "./index.ts";
import { labelCheck } from "./label-run.ts";

let repo = "";
const run = (...args: string[]) => git(args, { cwd: repo }).trim();
const commit = (rel: string, text: string) => {
	mkdirSync(join(repo, rel, ".."), { recursive: true });
	writeFileSync(join(repo, rel), text);
	run("add", "-A");
	run("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", rel);
	return run("rev-parse", "HEAD");
};

beforeEach(() => {
	repo = mkdtempSync(join(tmpdir(), "registry-label-"));
	run("init", "-q");
});
afterEach(() => rmSync(repo, { recursive: true, force: true }));

/** A host like the providers package: protected paths and no ratchet. */
const host = (): Config => ({
	root: join(repo, "pkg"),
	src: "src",
	kinds: "src/kinds",
	out: "src",
	protected: ["pkg/src/kinds/"],
});

describe("label-check", () => {
	it("passes a host with no ratchet when the PR touches nothing protected", () => {
		const base = commit("pkg/README.md", "one\n");
		const head = commit("pkg/src/a.ts", "export {};\n");
		const cfg = host();
		expect(labelCheck(cfg, base, head, "")).toEqual([]);
	});

	it("still asks for the label when such a host's PR touches a protected path", () => {
		const base = commit("pkg/README.md", "one\n");
		const head = commit("pkg/src/kinds/k.ts", "export {};\n");
		const cfg = host();
		expect(labelCheck(cfg, base, head, "")).toEqual([
			'pkg/src/kinds/k.ts is a registry guard path. Fix: undo it, or ask the operator to add the "registry-approved" label.',
		]);
	});
});
