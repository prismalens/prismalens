// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GATEWAY_RUN_FILE } from "@prismalens/config/harness";
import { describe, expect, it } from "vitest";
import { prepareRunEnv } from "./investigate.js";

const gateway = {
	url: "http://127.0.0.1:3001/api/mcp/runs/r1",
	token: "run-bearer",
	serverName: "prismalens-abcdefgh23",
	promptLine: "",
	tools: [],
	connected: () => false,
	waitConnected: async () => false,
	onCall: () => () => {},
	calls: () => [],
};

function deepagentsRun() {
	const runDir = mkdtempSync(join(tmpdir(), "pl-run-env-"));
	prepareRunEnv({ harness: "deepagents", cwd: runDir, runDir, gateway });
	return join(runDir, "config", GATEWAY_RUN_FILE);
}

describe("the deepagents gateway run file (#848, OBJ-029)", () => {
	it("holds the run's bearer under the run's own server name", () => {
		const file = JSON.parse(readFileSync(deepagentsRun(), "utf8"));
		expect(Object.keys(file.mcpServers)).toEqual(["prismalens-abcdefgh23"]);
		expect(JSON.stringify(file)).toContain("Bearer run-bearer");
	});

	// Windows keeps no POSIX mode bits; Linux CI is where this check bites.
	it.skipIf(process.platform === "win32")("is readable by its owner only, under any umask", () => {
		const old = process.umask(0o022);
		try {
			const file = deepagentsRun();
			expect(statSync(file).mode & 0o077).toBe(0);
			expect(statSync(join(file, "..")).mode & 0o077).toBe(0);
		} finally {
			process.umask(old);
		}
	});
});
