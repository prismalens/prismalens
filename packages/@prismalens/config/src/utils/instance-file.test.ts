// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	mkdtempSync,
	readdirSync,
	readFileSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	DEFAULT_PORT,
	ensureInstanceFile,
	INSTANCE_FILE,
	LEGACY_PORT,
	readInstanceFile,
	resolvePort,
} from "./instance-file.js";

const workspace = () => mkdtempSync(join(tmpdir(), "pl-instance-"));

describe("instance file (#763)", () => {
	it("a new workspace gets a uuid and port 6473, written 0600 with no temp file left", () => {
		const dir = workspace();
		expect(readInstanceFile(dir)).toBeNull();
		const created = ensureInstanceFile(dir);
		expect(created.port).toBe(DEFAULT_PORT);
		expect(created.instanceId).toMatch(/^[0-9a-f-]{36}$/);
		const path = join(dir, INSTANCE_FILE);
		expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(created);
		if (process.platform !== "win32") {
			expect(statSync(path).mode & 0o777).toBe(0o600);
		}
		expect(readdirSync(dir)).toEqual([INSTANCE_FILE]);
		expect(ensureInstanceFile(dir)).toEqual(created);
	});

	it("a 0.5.0 workspace (prismalens.db already there) keeps 3001", () => {
		const dir = workspace();
		writeFileSync(join(dir, "prismalens.db"), "");
		expect(ensureInstanceFile(dir).port).toBe(LEGACY_PORT);
	});

	it("an invalid file is an error naming its path, never replaced", () => {
		for (const contents of [
			"{not json",
			JSON.stringify({ instanceId: "nope", port: 6473 }),
			JSON.stringify({ instanceId: "3f1c2a4b-5d6e-4f70-8a9b-0c1d2e3f4a5b", port: 0 }),
		]) {
			const dir = workspace();
			const path = join(dir, INSTANCE_FILE);
			writeFileSync(path, contents);
			expect(() => ensureInstanceFile(dir)).toThrow(path);
			expect(readFileSync(path, "utf8")).toBe(contents);
		}
	});
});

describe("resolvePort (#763)", () => {
	it("an explicit PRISMALENS_PORT wins for the run and is not saved", () => {
		const dir = workspace();
		expect(resolvePort({ PRISMALENS_PORT: "8080" }, dir)).toBe(8080);
		expect(ensureInstanceFile(dir).port).toBe(DEFAULT_PORT);
	});

	it("otherwise the workspace's port, including a legacy one", () => {
		const dir = workspace();
		writeFileSync(join(dir, "prismalens.db"), "");
		expect(resolvePort({}, dir)).toBe(LEGACY_PORT);
		expect(resolvePort({ PRISMALENS_PORT: "abc" }, dir)).toBe(LEGACY_PORT);
	});
});
