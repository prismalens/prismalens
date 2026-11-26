// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ENGINE = join(dirname(fileURLToPath(import.meta.url)), "..");
const matrix = (...args: string[]) => {
	const r = spawnSync(process.execPath, ["--import", "tsx", "scripts/acp-matrix.ts", ...args], {
		cwd: ENGINE,
		encoding: "utf8",
		timeout: 120_000,
	});
	return { code: r.status, rows: r.stdout.split(/\r?\n/).filter((l) => l.startsWith("ROW ")) };
};

// Cursor is n/a on the isolation rows, so none of these starts an agent; each still
// spawns the script through tsx, which outlasts the 5 s default under a full `pnpm test`.
describe("acp-matrix --require (#1180 §0)", { timeout: 60_000 }, () => {
	it("fails a named row that is missing or n/a for the agent, and exits 1", () => {
		expect(matrix("cursor", "--only", "no-such-row,probe-runs-no-user-code", "--require")).toEqual({
			code: 1,
			rows: [
				"ROW no-such-row: fail (no such row, and --require names it)",
				"ROW probe-runs-no-user-code: fail (no documented switch: a background pass never starts it; --require names it)",
			],
		});
	});

	it("without it, skips the n/a row and a missing name, and exits 0", () => {
		expect(matrix("cursor", "--only", "no-such-row,probe-runs-no-user-code")).toEqual({
			code: 0,
			rows: [
				"ROW probe-runs-no-user-code: n/a (no documented switch: a background pass never starts it)",
			],
		});
	});
});
