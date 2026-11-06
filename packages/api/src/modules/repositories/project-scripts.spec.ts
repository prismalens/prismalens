// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	detectScripts,
	justRecipes,
	makeTargets,
	packageScripts,
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
