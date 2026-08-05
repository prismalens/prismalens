// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Local checkout mapping (#331) — the shared implementation both `pl listen`
 * and the app worker resolve through (D11 no-new-divergence).
 *
 * These tests use REAL directories and a REAL `git init`: the whole point of
 * validation is that it agrees with the filesystem and with git, and a mocked
 * `execFile` would assert nothing about that.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	normalizeCheckoutPath,
	resolveInvestigationCwd,
	validateLocalCheckout,
} from "./repo.js";

let root: string;
let gitRepo: string;
let plainDir: string;
let nestedPackage: string;
let regularFile: string;

beforeAll(() => {
	root = mkdtempSync(join(tmpdir(), "pl-331-"));
	gitRepo = join(root, "checkout");
	plainDir = join(root, "not-a-repo");
	nestedPackage = join(gitRepo, "packages", "api");
	regularFile = join(root, "a-file.txt");

	mkdirSync(nestedPackage, { recursive: true });
	mkdirSync(plainDir, { recursive: true });
	writeFileSync(regularFile, "not a directory\n");

	execFileSync("git", ["init", "--quiet"], { cwd: gitRepo });
	execFileSync(
		"git",
		["remote", "add", "origin", "https://github.com/acme/checkout.git"],
		{ cwd: gitRepo },
	);
});

afterAll(() => {
	rmSync(root, { recursive: true, force: true });
});

describe("validateLocalCheckout — accepts a real checkout", () => {
	it("accepts a git work tree and reports its origin slug", async () => {
		const result = await validateLocalCheckout(gitRepo);
		expect(result.valid).toBe(true);
		expect(result.path).toBe(gitRepo);
		expect(result.repoSlug).toBe("acme/checkout");
		expect(result.isSubdirectory).toBe(false);
		expect(result.reason).toBeUndefined();
	});

	it("accepts a package INSIDE a work tree and reports the enclosing root", async () => {
		const result = await validateLocalCheckout(nestedPackage);
		expect(result.valid).toBe(true);
		expect(result.path).toBe(nestedPackage);
		expect(result.isSubdirectory).toBe(true);
		expect(result.repoRoot).toBe(gitRepo);
	});

	it("trims surrounding whitespace before validating", async () => {
		const result = await validateLocalCheckout(`  ${gitRepo}\n`);
		expect(result.valid).toBe(true);
		expect(result.path).toBe(gitRepo);
	});
});

describe("validateLocalCheckout — rejects at CONFIGURATION time", () => {
	it("rejects an empty path", async () => {
		const result = await validateLocalCheckout("   ");
		expect(result.valid).toBe(false);
		expect(result.reason).toBe("empty");
	});

	it("rejects a relative path", async () => {
		const result = await validateLocalCheckout("some/relative/path");
		expect(result.valid).toBe(false);
		expect(result.reason).toBe("not_absolute");
		expect(result.message).toContain("absolute");
	});

	it("rejects a path that does not exist", async () => {
		const missing = join(root, "definitely-not-here");
		const result = await validateLocalCheckout(missing);
		expect(result.valid).toBe(false);
		expect(result.reason).toBe("not_found");
		expect(result.message).toContain(missing);
	});

	it("rejects a file", async () => {
		const result = await validateLocalCheckout(regularFile);
		expect(result.valid).toBe(false);
		expect(result.reason).toBe("not_a_directory");
	});

	it("rejects a directory that is not a git checkout", async () => {
		const result = await validateLocalCheckout(plainDir);
		expect(result.valid).toBe(false);
		expect(result.reason).toBe("not_a_git_repo");
		expect(result.message).toContain("not a git checkout");
	});
});

describe("normalizeCheckoutPath", () => {
	it("expands a leading ~ to the home directory", () => {
		const expanded = normalizeCheckoutPath("~/code/thing");
		expect(expanded.startsWith("~")).toBe(false);
		expect(expanded.endsWith("/code/thing")).toBe(true);
	});

	it("collapses . and .. segments", () => {
		expect(normalizeCheckoutPath("/a/b/../c/./d")).toBe("/a/c/d");
	});

	it("returns the empty string for blank input", () => {
		expect(normalizeCheckoutPath("  ")).toBe("");
		expect(normalizeCheckoutPath(null)).toBe("");
		expect(normalizeCheckoutPath(undefined)).toBe("");
	});
});

describe("resolveInvestigationCwd — precedence", () => {
	it("the service mapping WINS over the env override", () => {
		const resolution = resolveInvestigationCwd({
			mappedPath: "/srv/mapped",
			serviceName: "checkout",
			envOverride: "/srv/env-override",
			fallbackCwd: "/srv/worker",
		});
		expect(resolution.cwd).toBe("/srv/mapped");
		expect(resolution.source).toBe("service-mapping");
		expect(resolution.mapped).toBe(true);
		expect(resolution.note).toContain("/srv/mapped");
		expect(resolution.note).toContain("checkout");
		expect(resolution.note).not.toContain("UNMAPPED");
	});

	it("falls back to the env override when unmapped, and SAYS it is unmapped", () => {
		const resolution = resolveInvestigationCwd({
			mappedPath: null,
			serviceName: "checkout",
			envOverride: "/srv/env-override",
			fallbackCwd: "/srv/worker",
		});
		expect(resolution.cwd).toBe("/srv/env-override");
		expect(resolution.source).toBe("env-override");
		expect(resolution.mapped).toBe(false);
		expect(resolution.note).toContain("UNMAPPED");
		expect(resolution.note).toContain("PRISMALENS_INVESTIGATION_CWD");
	});

	it("falls back to the worker cwd last, and SAYS it is unmapped", () => {
		const resolution = resolveInvestigationCwd({
			mappedPath: null,
			serviceName: "checkout",
			envOverride: "   ",
			fallbackCwd: "/srv/worker",
		});
		expect(resolution.cwd).toBe("/srv/worker");
		expect(resolution.source).toBe("worker-cwd");
		expect(resolution.mapped).toBe(false);
		expect(resolution.note).toContain("UNMAPPED");
		expect(resolution.note).toContain("/srv/worker");
	});

	it("normalises the mapped path (a stored ~ or .. must not reach the harness)", () => {
		const resolution = resolveInvestigationCwd({
			mappedPath: "/srv/checkouts/../mapped",
			fallbackCwd: "/srv/worker",
		});
		expect(resolution.cwd).toBe("/srv/mapped");
	});

	it("a whitespace-only mapping reads as unset, never as 'run in nowhere'", () => {
		const resolution = resolveInvestigationCwd({
			mappedPath: "   ",
			fallbackCwd: "/srv/worker",
		});
		expect(resolution.cwd).toBe("/srv/worker");
		expect(resolution.mapped).toBe(false);
	});
});
