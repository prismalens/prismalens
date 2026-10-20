// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GATEWAY_RUN_FILE } from "@prismalens/config/harness";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sweepRunWorkspaces } from "./investigation-run.js";

afterEach(() => vi.unstubAllEnvs());

describe("run workspace cleanup (#848, OBJ-029)", () => {
	it("removes the gateway run file holding the run's bearer, and keeps the rest of config", () => {
		const root = mkdtempSync(join(tmpdir(), "pl-sweep-"));
		vi.stubEnv("PRISMALENS_WORKSPACE_DIR", root);
		const config = join(root, "runs", "r1", "config");
		mkdirSync(config, { recursive: true });
		writeFileSync(join(config, GATEWAY_RUN_FILE), "{}");
		writeFileSync(join(config, "other.json"), "{}");
		expect(sweepRunWorkspaces()).toBe(1);
		expect(existsSync(join(config, GATEWAY_RUN_FILE))).toBe(false);
		expect(existsSync(join(config, "other.json"))).toBe(true);
	});
});
