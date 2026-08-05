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
import {
	mkdirSync,
	mkdtempSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
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
let linkedRepo: string;

beforeAll(() => {
	// `realpathSync` the fixture root: on macOS `os.tmpdir()` is `/tmp`, a symlink
	// to `/private/tmp`. Without this the fixture paths and git's answers differ by
	// a symlink hop and every comparison below is testing the wrong thing.
	root = realpathSync(mkdtempSync(join(tmpdir(), "pl-331-")));
	gitRepo = join(root, "checkout");
	plainDir = join(root, "not-a-repo");
	nestedPackage = join(gitRepo, "packages", "api");
	regularFile = join(root, "a-file.txt");
	linkedRepo = join(root, "linked-checkout");

	mkdirSync(nestedPackage, { recursive: true });
	mkdirSync(plainDir, { recursive: true });
	writeFileSync(regularFile, "not a directory\n");
	// A symlink to the checkout — reproduces on Linux exactly what macOS's
	// `/tmp` → `/private/tmp` does, so this is not a CI-only concern.
	symlinkSync(gitRepo, linkedRepo);

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

/**
 * REGRESSION (#331): git's `rev-parse --show-toplevel` always answers with the
 * REAL path. Comparing it against an unresolved input made a repo ROOT reached
 * through a symlink report `isSubdirectory: true` with a `repoRoot` the operator
 * never typed — and stored an unresolved path that two different symlinks to one
 * tree would record as two different mappings.
 *
 * macOS CI hit this first (`/tmp` → `/private/tmp`), but an explicit symlink
 * reproduces it on Linux, which is why these run everywhere.
 */
describe("validateLocalCheckout — symlinked checkouts resolve to the real tree", () => {
	it("a symlink TO THE ROOT is the root, not a subdirectory of itself", async () => {
		const result = await validateLocalCheckout(linkedRepo);
		expect(result.valid).toBe(true);
		expect(result.isSubdirectory).toBe(false);
		expect(result.repoRoot).toBe(gitRepo);
	});

	it("stores the RESOLVED path, so the mapping names the directory the harness enters", async () => {
		const result = await validateLocalCheckout(linkedRepo);
		expect(result.path).toBe(gitRepo);
		expect(result.path).not.toBe(linkedRepo);
	});

	it("two symlinks onto one tree collapse to the SAME stored mapping", async () => {
		const second = join(root, "another-link");
		symlinkSync(gitRepo, second);
		const viaFirst = await validateLocalCheckout(linkedRepo);
		const viaSecond = await validateLocalCheckout(second);
		expect(viaSecond.path).toBe(viaFirst.path);
	});

	it("a package reached THROUGH a symlink still reports the real enclosing root", async () => {
		const result = await validateLocalCheckout(
			join(linkedRepo, "packages", "api"),
		);
		expect(result.valid).toBe(true);
		expect(result.isSubdirectory).toBe(true);
		expect(result.path).toBe(nestedPackage);
		expect(result.repoRoot).toBe(gitRepo);
	});

	it("the origin slug is still detected through the symlink", async () => {
		const result = await validateLocalCheckout(linkedRepo);
		expect(result.repoSlug).toBe("acme/checkout");
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
