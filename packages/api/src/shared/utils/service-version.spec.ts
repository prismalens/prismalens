// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	resolveServiceBuild,
	resolveServiceVersion,
} from "./service-version.js";

describe("service-version", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = mkdtempSync(join(tmpdir(), "pl-ver-"));
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	it("reads version and build sha from prismalens package.json", () => {
		const pkg = {
			name: "prismalens",
			version: "0.5.1",
			build: "ccf3624",
		};
		writeFileSync(join(tempDir, "package.json"), JSON.stringify(pkg));

		const subDir = join(tempDir, "nested", "sub");
		mkdirSync(subDir, { recursive: true });

		expect(resolveServiceVersion(subDir)).toBe("0.5.1");
		expect(resolveServiceBuild(subDir)).toBe("ccf3624");
	});

	it("returns null for build when build field is absent in package.json", () => {
		const pkg = {
			name: "prismalens",
			version: "0.5.0",
		};
		writeFileSync(join(tempDir, "package.json"), JSON.stringify(pkg));

		expect(resolveServiceVersion(tempDir)).toBe("0.5.0");
		expect(resolveServiceBuild(tempDir)).toBe(null);
	});
});
