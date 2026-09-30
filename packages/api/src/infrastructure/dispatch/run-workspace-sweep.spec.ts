// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sweepRunWorkspaces } from "./investigation-run.js";

describe("sweepRunWorkspaces (#743)", () => {
	let dir: string;
	const saved = process.env.PRISMALENS_WORKSPACE_DIR;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "pl-sweep-"));
		process.env.PRISMALENS_WORKSPACE_DIR = dir;
	});
	afterEach(() => {
		process.env.PRISMALENS_WORKSPACE_DIR = saved;
		rmSync(dir, { recursive: true, force: true });
	});

	it("removes the clone and harness home a crashed run left, and keeps its transcript", () => {
		const crashed = join(dir, "runs", "run-a");
		mkdirSync(join(crashed, "repo", "src"), { recursive: true });
		mkdirSync(join(crashed, "home"), { recursive: true });
		writeFileSync(join(crashed, "transcript.jsonl"), "{}\n");
		const clean = join(dir, "runs", "run-b");
		mkdirSync(clean, { recursive: true });
		writeFileSync(join(clean, "transcript.jsonl"), "{}\n");

		expect(sweepRunWorkspaces()).toBe(1);
		expect(existsSync(join(crashed, "repo"))).toBe(false);
		expect(existsSync(join(crashed, "home"))).toBe(false);
		expect(existsSync(join(crashed, "transcript.jsonl"))).toBe(true);
		expect(existsSync(join(clean, "transcript.jsonl"))).toBe(true);
	});

	it("does nothing before any run exists", () => {
		expect(sweepRunWorkspaces()).toBe(0);
	});
});
