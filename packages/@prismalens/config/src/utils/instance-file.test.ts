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
import { describe, expect, it, vi } from "vitest";

const race = vi.hoisted(() => ({ winner: null as string | null }));
vi.mock("node:fs", async (importOriginal) => {
	const fs = await importOriginal<typeof import("node:fs")>();
	return {
		...fs,
		linkSync: (from: string, to: string) => {
			if (race.winner) fs.writeFileSync(to, race.winner);
			race.winner = null;
			fs.linkSync(from, to);
		},
	};
});
import {
	DEFAULT_PORT,
	ensureInstanceFile,
	INSTANCE_FILE,
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

	it("a process that loses the creation race adopts the winner's id, not its own", () => {
		const dir = workspace();
		const winner = {
			instanceId: "11111111-2222-4333-8444-555555555555",
			port: 7000,
		};
		race.winner = JSON.stringify(winner);
		expect(ensureInstanceFile(dir)).toEqual(winner);
		expect(readInstanceFile(dir)).toEqual(winner);
		expect(readdirSync(dir)).toEqual([INSTANCE_FILE]);
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

	it("otherwise the workspace's port", () => {
		const dir = workspace();
		writeFileSync(join(dir, "prismalens.db"), "");
		expect(resolvePort({}, dir)).toBe(DEFAULT_PORT);
		expect(resolvePort({ PRISMALENS_PORT: "abc" }, dir)).toBe(DEFAULT_PORT);
	});
});
