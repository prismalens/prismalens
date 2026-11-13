// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	checkStampFile,
	type StampExpect,
	sha256,
	stampFile,
	stampProblems,
	writeStamp,
} from "./stamp.ts";

const profile = { rttMs: 400, downKbps: 1600, cpu: 4, drops: [{ atS: "mid", forS: 10 }] };
const want: StampExpect = {
	condition: "net.slow-link",
	walk: "attach",
	simulator: "net.throttle",
	profile,
	stamps: ["rttMs", "downKbps", "drops"],
	sha: "4113b0324abc",
	run: "cp4-1",
};
const good = {
	version: 1,
	condition: "net.slow-link",
	walk: "attach",
	simulator: "net.throttle",
	profile,
	observed: { rttMs: 420, downKbps: 1500, cpu: 4, drops: 1 },
	sha: "4113b0324",
	run: "cp4-1",
	at: "2026-11-13T10:00:00Z",
	artifacts: [{ path: "shot.png", sha256: sha256("png") }],
};
const read = (p: string) => (p === "shot.png" ? new TextEncoder().encode("png") : null);

describe("a stamp", () => {
	it("proves its cell when every field matches and observed values sit within tolerance", () => {
		expect(stampProblems(good, want, read)).toEqual([]);
	});

	it("names every mismatch: cell, profile, sha, run, observed fields, tolerance and artifacts", () => {
		const bad = {
			...good,
			condition: "huge.diff",
			walk: "find-pr",
			simulator: "seed.diff",
			profile: { ...profile, rttMs: 100 },
			observed: { rttMs: 900, downKbps: 1600 },
			sha: "deadbeef",
			run: "cp3",
			artifacts: [
				{ path: "shot.png", sha256: sha256("other") },
				{ path: "gone.har", sha256: sha256("x") },
			],
		};
		expect(stampProblems(bad, want, read)).toEqual([
			"condition is huge.diff, not net.slow-link",
			"walk is find-pr, not attach",
			"simulator is seed.diff, not net.throttle",
			"profile differs from the condition's",
			"sha is deadbeef, not 4113b0324abc",
			"run is cp3, not cp4-1",
			"observed has no drops",
			"observed rttMs 900 is outside 25% of 400",
			"artifact shot.png does not match its hash",
			"artifact gone.har is missing",
		]);
	});

	it("reports a malformed stamp by field", () => {
		expect(stampProblems({ ...good, version: 2, sha: "XYZ" }, want, read)).toEqual([
			"malformed: version must be 1",
			"malformed: sha must be a hex commit sha",
		]);
	});
});

describe("the stamp file", () => {
	let dir = "";
	afterEach(() => {
		if (dir) rmSync(dir, { recursive: true, force: true });
	});

	it("is written by the simulator with hashed artifacts, and then checks clean", () => {
		dir = mkdtempSync(join(tmpdir(), "stamp-"));
		writeFileSync(join(dir, "shot.png"), "png");
		const file = writeStamp(
			dir,
			{
				condition: "net.slow-link",
				walk: "attach",
				simulator: "net.throttle",
				profile,
				observed: { rttMs: 400, downKbps: 1600, drops: 1 },
				sha: "4113b0324",
				run: "cp4-1",
				at: "2026-11-13T10:00:00Z",
			},
			["shot.png"],
		);
		expect(file).toBe(join(dir, stampFile("attach", "net.slow-link")));
		expect(JSON.parse(readFileSync(file, "utf8")).artifacts).toEqual([
			{ path: "shot.png", sha256: sha256("png") },
		]);
		expect(checkStampFile(dir, want)).toEqual([]);
		writeFileSync(join(dir, "shot.png"), "edited");
		expect(checkStampFile(dir, want)).toEqual(["artifact shot.png does not match its hash"]);
	});

	it("says when a cell has no stamp", () => {
		dir = mkdtempSync(join(tmpdir(), "stamp-"));
		expect(checkStampFile(dir, want)).toEqual([`no stamp at ${join(dir, "attach__net.slow-link.json")}`]);
	});
});
