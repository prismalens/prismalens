// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, parse } from "node:path";
import { describe, expect, it } from "vitest";
import { refuseReason } from "./reset.js";

describe("refuseReason", () => {
	const base = mkdtempSync(join(tmpdir(), "pl-reset-"));

	it("allows a directory holding prismalens.db", () => {
		const ws = join(base, "ws");
		mkdirSync(ws);
		writeFileSync(join(ws, "prismalens.db"), "");
		expect(refuseReason(ws)).toBe(null);
	});

	it("refuses a directory without the database", () => {
		const other = join(base, "other");
		mkdirSync(other);
		expect(refuseReason(other)).toMatch(/not a PrismaLens workspace/);
	});

	it("refuses a missing directory", () => {
		expect(refuseReason(join(base, "gone"))).toMatch(/does not exist/);
	});

	it("refuses the home directory and the filesystem root, even with a database", () => {
		const home = join(base, "home");
		mkdirSync(home);
		writeFileSync(join(home, "prismalens.db"), "");
		expect(refuseReason(home, home)).toMatch(/not a workspace directory/);
		expect(refuseReason(parse(base).root, home)).toMatch(
			/not a workspace directory/,
		);
	});
});
