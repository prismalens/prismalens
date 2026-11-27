// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Row } from "../../../../scripts/fakes/scripted-model.mjs";
import { describe, expect, it } from "vitest";
import { markerProblem, rowShared, runSharedSetRow } from "./acp-shared-set.js";

describe("the shared-set-reaches-agent row's marker verdict (#1180 §3.3)", () => {
	it("fails a new session whose recorded revision is not the one its system prompt held, even when that held the one sent", () => {
		expect([
			markerProblem("new session", ["PLREV-A"], "rev-b", "rev-a"),
			markerProblem("new session", ["PLREV-B"], "rev-b", "rev-a"),
			markerProblem("new session", ["PLREV-A"], "rev-a", "rev-a"),
			markerProblem("after the reopen", ["PLREV-A"], "rev-a"),
			markerProblem("after the reopen", [], "rev-b"),
		]).toEqual([
			"new session: the model saw PLREV-A, but PrismaLens recorded rev-b",
			"new session: the system prompt held PLREV-B, not the rev-a it was sent",
			null,
			null,
			"after the reopen: the model saw no marker, but PrismaLens recorded rev-b",
		]);
	});
});

describe("the shared-set-reaches-agent row's folders (#1180 §3.3)", () => {
	it("removes the folders it made when a later one cannot be made", async () => {
		const ours = () => readdirSync(tmpdir()).filter((d) => d.startsWith("pl-matrix-shared-")).sort();
		const before = ours();
		const missing = join(tmpdir(), "pl-no-such-workdir", "deeper");
		await expect(
			runSharedSetRow({ row: "shared-set-reaches-agent" } as unknown as Row, "claude-code", { PL_MATRIX_WORKDIR: missing }),
		).rejects.toThrow("ENOENT");
		expect(ours()).toEqual(before);
	});
});

describe("the shared-set-reaches-agent row's set (#1180 §3.3)", () => {
	it("goes in deepagents' run file, which is where it reads servers, and in no ACP mcpServers", async () => {
		const set = await rowShared("deepagents", "/markers");
		expect([set.servers, Object.keys(set.runFile?.servers ?? {})]).toEqual([[], ["pl-mk"]]);
		expect(set.runFile?.servers["pl-mk"]).toMatchObject({ command: process.execPath, env: {} });
	});

	it("goes in ACP mcpServers for an agent that reads them there, with no run file", async () => {
		const set = await rowShared("claude-code", "/markers");
		expect([set.servers.map((s) => s.name), set.runFile]).toEqual([["pl-mk"], undefined]);
	});
});
