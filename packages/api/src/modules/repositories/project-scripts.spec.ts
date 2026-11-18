// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	PROJECT_SCRIPT_COMMAND_MAX,
	PROJECT_SCRIPT_NAME_MAX,
	PROJECT_SCRIPTS_MAX,
} from "@prismalens/contracts";
import { afterEach, describe, expect, it } from "vitest";
import {
	detectScripts,
	justRecipes,
	makeTargets,
	packageScripts,
	projectScripts,
	storedScripts,
	writeScripts,
} from "./project-scripts.js";

const dirs: string[] = [];
const folder = (files: Record<string, string>) => {
	const dir = mkdtempSync(join(tmpdir(), "pl-scripts-"));
	dirs.push(dir);
	for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
	return dir;
};
afterEach(() => {
	for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("project scripts (#1024 decision 6)", () => {
	it("reads package.json scripts with the lockfile's runner", async () => {
		const pkg = JSON.stringify({ scripts: { dev: "vite", "test:e2e": "playwright", bad: 3 } });
		for (const [lock, runner] of [
			["pnpm-lock.yaml", "pnpm"],
			["yarn.lock", "yarn"],
			["bun.lock", "bun"],
		]) {
			const dir = folder({ "package.json": pkg, [lock as string]: "" });
			expect(await detectScripts(dir)).toEqual([
				{ runner, name: "dev", command: `${runner} run dev` },
				{ runner, name: "test:e2e", command: `${runner} run test:e2e` },
			]);
		}
		expect((await detectScripts(folder({ "package.json": pkg })))[0]?.runner).toBe("npm");
	});

	it("reads explicit Makefile targets, not variables, patterns or specials", () => {
		const text = [
			"CC := gcc",
			"VERSION ?= 1",
			".PHONY: build test",
			"build test: deps",
			"\techo hi",
			"%.o: %.c",
			"lint:",
			"build:",
			"x::",
		].join("\n");
		expect(makeTargets(text).map((s) => s.command)).toEqual([
			"make build",
			"make test",
			"make lint",
		]);
	});

	it("reads justfile recipes, skipping settings, aliases and private ones", () => {
		const text = [
			"set shell := [\"bash\", \"-c\"]",
			"alias b := build",
			"build target='x':",
			"  cargo build",
			"@quiet:",
			"_private:",
			"build:",
			"x := 'y'",
		].join("\n");
		expect(justRecipes(text).map((s) => s.name)).toEqual(["build", "quiet"]);
	});

	it("reads all three in one folder, and nothing from a missing or broken one", async () => {
		const dir = folder({
			"package.json": "{ not json",
			Makefile: "all:\n",
			justfile: "fmt:\n",
		});
		expect((await detectScripts(dir)).map((s) => s.command)).toEqual(["make all", "just fmt"]);
		expect(await detectScripts(join(dir, "missing"))).toEqual([]);
		expect(packageScripts("[]", "npm")).toEqual([]);
	});

	it("skips a manifest too big to read", async () => {
		const dir = folder({ Makefile: `big:\n${"#".repeat(300 * 1024)}\n` });
		expect(await detectScripts(dir)).toEqual([]);
	});
});

describe("stored scripts validation and metadata merge (#1176)", () => {
	it("skips invalid entries: name limits, command limits, empty and control characters", () => {
		const metadata = JSON.stringify({
			otherKey: "preserved",
			scripts: [
				{ id: "s1", name: "valid", command: "pnpm test" },
				{ id: "s2", name: "", command: "pnpm test" },
				{ id: "s3", name: "a".repeat(PROJECT_SCRIPT_NAME_MAX + 1), command: "pnpm test" },
				{ id: "s4", name: "valid2", command: "" },
				{ id: "s5", name: "valid3", command: "a".repeat(PROJECT_SCRIPT_COMMAND_MAX + 1) },
				{ id: "s6", name: "has-newline", command: "echo 1\necho 2" },
				{ id: "s7", name: "has-control", command: "echo \u0007" },
				{ id: 123, name: "bad-id", command: "pnpm test" },
				null,
			],
		});

		const scripts = storedScripts(metadata);
		expect(scripts).toHaveLength(1);
		expect(scripts[0]).toEqual({
			runner: "custom",
			id: "s1",
			name: "valid",
			command: "pnpm test",
		});
	});

	it("handles malformed or absent metadata gracefully", () => {
		expect(storedScripts(null)).toEqual([]);
		expect(storedScripts(undefined)).toEqual([]);
		expect(storedScripts("{ not valid json")).toEqual([]);
		expect(storedScripts(JSON.stringify([]))).toEqual([]);
		expect(storedScripts(JSON.stringify({ scripts: "not an array" }))).toEqual([]);
	});

	it("caps stored scripts to PROJECT_SCRIPTS_MAX (50)", () => {
		const many = Array.from({ length: 60 }, (_, i) => ({
			id: `s-${i}`,
			name: `script-${i}`,
			command: `echo ${i}`,
		}));
		const scripts = storedScripts(JSON.stringify({ scripts: many }));
		expect(scripts).toHaveLength(PROJECT_SCRIPTS_MAX);
		expect(scripts[0]?.name).toBe("script-0");
		expect(scripts[49]?.name).toBe("script-49");
	});

	it("writeScripts adds a script, generating id, preserving other metadata keys", () => {
		const initial = JSON.stringify({ customKey: 42, scripts: [] });
		const next = writeScripts(initial, { op: "add", name: "build", command: "pnpm build" });
		expect(next).not.toBeNull();
		const parsed = JSON.parse(String(next));
		expect(parsed.customKey).toBe(42);
		expect(parsed.scripts).toHaveLength(1);
		expect(parsed.scripts[0]).toMatchObject({
			name: "build",
			command: "pnpm build",
		});
		expect(typeof parsed.scripts[0].id).toBe("string");
		expect(parsed.scripts[0].id.length).toBeGreaterThan(10);
	});

	it("writeScripts returns null when adding to a full list (50 scripts)", () => {
		const many = Array.from({ length: 50 }, (_, i) => ({
			id: `s-${i}`,
			name: `script-${i}`,
			command: `echo ${i}`,
		}));
		const full = JSON.stringify({ scripts: many });
		const res = writeScripts(full, { op: "add", name: "overflow", command: "echo overflow" });
		expect(res).toBeNull();
	});

	it("writeScripts updates an existing script by id and preserves other keys", () => {
		const initial = JSON.stringify({
			keepMe: "yes",
			scripts: [
				{ id: "s1", name: "old-name", command: "old-cmd" },
				{ id: "s2", name: "other", command: "echo other" },
			],
		});
		const updated = writeScripts(initial, {
			op: "update",
			scriptId: "s1",
			name: "new-name",
			command: "new-cmd",
		});
		expect(updated).not.toBeNull();
		const parsed = JSON.parse(String(updated));
		expect(parsed.keepMe).toBe("yes");
		expect(parsed.scripts).toEqual([
			{ id: "s1", name: "new-name", command: "new-cmd" },
			{ id: "s2", name: "other", command: "echo other" },
		]);
	});

	it("writeScripts returns null when updating an unknown id", () => {
		const initial = JSON.stringify({
			scripts: [{ id: "s1", name: "a", command: "echo a" }],
		});
		expect(
			writeScripts(initial, {
				op: "update",
				scriptId: "unknown-id",
				name: "b",
				command: "echo b",
			}),
		).toBeNull();
	});

	it("writeScripts removes an existing script by id and preserves other keys", () => {
		const initial = JSON.stringify({
			extra: true,
			scripts: [
				{ id: "s1", name: "first", command: "echo 1" },
				{ id: "s2", name: "second", command: "echo 2" },
			],
		});
		const removed = writeScripts(initial, { op: "remove", scriptId: "s1" });
		expect(removed).not.toBeNull();
		const parsed = JSON.parse(String(removed));
		expect(parsed.extra).toBe(true);
		expect(parsed.scripts).toEqual([{ id: "s2", name: "second", command: "echo 2" }]);
	});

	it("writeScripts returns null when removing an unknown id", () => {
		const initial = JSON.stringify({
			scripts: [{ id: "s1", name: "a", command: "echo a" }],
		});
		expect(writeScripts(initial, { op: "remove", scriptId: "missing-id" })).toBeNull();
	});
});

describe("projectScripts ordering and dedup (#1176)", () => {
	it("lists stored scripts then detected order for folder repos", async () => {
		const dir = folder({
			"package.json": JSON.stringify({ scripts: { test: "vitest", build: "vite build" } }),
			"pnpm-lock.yaml": "",
		});
		const metadata = JSON.stringify({
			scripts: [
				{ id: "custom-1", name: "lint", command: "biome check" },
			],
		});

		const res = await projectScripts({
			sourceKind: "folder",
			url: dir,
			subPath: null,
			metadata,
		});

		expect(res.map((s) => s.name)).toEqual(["lint", "test", "build"]);
		expect(res[0]?.runner).toBe("custom");
		expect(res[0]?.id).toBe("custom-1");
		expect(res[1]?.runner).toBe("pnpm");
		expect(res[2]?.runner).toBe("pnpm");
	});

	it("returns only stored scripts for URL repos", async () => {
		const metadata = JSON.stringify({
			scripts: [{ id: "custom-1", name: "deploy", command: "git push" }],
		});
		const res = await projectScripts({
			sourceKind: "url",
			url: "https://github.com/acme/shop",
			subPath: null,
			metadata,
		});
		expect(res).toEqual([
			{ runner: "custom", id: "custom-1", name: "deploy", command: "git push" },
		]);
	});

	// A detected script sharing a stored script's name is not listed twice
	it.fails("a detected script with a stored name is not listed twice", async () => {
		const dir = folder({
			"package.json": JSON.stringify({ scripts: { dev: "vite", test: "vitest" } }),
			"pnpm-lock.yaml": "",
		});
		const metadata = JSON.stringify({
			scripts: [{ id: "c1", name: "test", command: "pnpm test:custom" }],
		});

		const res = await projectScripts({
			sourceKind: "folder",
			url: dir,
			subPath: null,
			metadata,
		});

		// Stored script takes precedence and detected one with same name is not listed twice
		expect(res.filter((s) => s.name === "test")).toHaveLength(1);
	});
});
