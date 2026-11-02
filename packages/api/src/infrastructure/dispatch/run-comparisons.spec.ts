// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/** Recording the panel's comparison never holds a run's start (#975 OBJ-014). */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RunWorkspace } from "@prismalens/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { comparisonsFor } from "./investigation-run.js";

const ID = ["-c", "user.email=t@t.local", "-c", "user.name=T"];
const git = (args: string[], cwd: string) =>
	execFileSync("git", [...ID, ...args], { cwd }).toString().trim();

let root: string;
let repos: RunWorkspace["repos"];

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "pl-compare-"));
	git(["init", "-q", "-b", "main", root], root);
	for (const n of ["a", "b"]) {
		writeFileSync(join(root, `${n}.txt`), n);
		git(["add", "--", `${n}.txt`], root);
		git(["commit", "-q", "-m", n], root);
	}
	repos = [
		{
			name: "repo",
			dir: "/gone",
			sourceKind: "folder",
			url: root,
			subPath: null,
			connectionId: null,
			head: git(["rev-parse", "HEAD"], root),
			branch: "main",
			services: ["checkout"],
		},
	];
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("comparisonsFor", () => {
	it("records the parent pair when no deployment is known", async () => {
		const pairs = await comparisonsFor(
			repos,
			{ deployments: async () => [] },
			new AbortController().signal,
		);
		expect(pairs).toHaveLength(1);
		expect(pairs[0]?.between).toBe(1);
	});

	it("pairs deployments recorded as a short or uppercase sha, keeping the full ids", async () => {
		const second = git(["rev-parse", "HEAD"], root);
		writeFileSync(join(root, "c.txt"), "c");
		git(["add", "--", "c.txt"], root);
		git(["commit", "-q", "-m", "c"], root);
		const third = git(["rev-parse", "HEAD"], root);
		const head = repos[0];
		if (!head) throw new Error("fixture");
		const pairs = await comparisonsFor(
			[{ ...head, head: third }],
			{
				deployments: async () => [
					{ sha: third.slice(0, 8).toUpperCase(), name: "v2" },
					{ sha: second.slice(0, 10), name: "v1" },
				],
			},
			new AbortController().signal,
		);
		expect(pairs[0]).toMatchObject({
			headKind: "deployment",
			head: third,
			headName: "v2",
			base: second,
			baseKind: "deployment",
			baseName: "v1",
		});
	});

	it("moves on when the deployment lookup never answers", async () => {
		const started = Date.now();
		const pairs = await comparisonsFor(
			repos,
			{ deployments: () => new Promise(() => {}) },
			new AbortController().signal,
			50,
		);
		expect(pairs).toEqual([]);
		expect(Date.now() - started).toBeLessThan(2000);
	});

	it("stops when the run is stopped", async () => {
		const stop = new AbortController();
		const pending = comparisonsFor(
			repos,
			{ deployments: () => new Promise(() => {}) },
			stop.signal,
		);
		stop.abort();
		await expect(pending).resolves.toEqual([]);
	});
});
