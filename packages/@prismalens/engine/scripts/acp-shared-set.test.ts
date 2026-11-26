// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { rowShared } from "./acp-shared-set.js";

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
