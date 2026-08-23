#!/usr/bin/env node

// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// Tests validate-changesets.mjs against isolated git fixture repositories.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const scriptPath = resolve(
	dirname(fileURLToPath(import.meta.url)),
	"validate-changesets.mjs",
);

function runGit(cwd, args) {
	return execFileSync("git", args, { cwd, encoding: "utf8", stdio: "ignore" });
}

function createRepoFixture() {
	const dir = mkdtempSync(join(tmpdir(), "pl-validate-changesets-"));
	runGit(dir, ["init", "-b", "main"]);
	runGit(dir, ["config", "user.name", "Test"]);
	runGit(dir, ["config", "user.email", "test@example.com"]);

	// Root config
	mkdirSync(join(dir, ".changeset"), { recursive: true });
	writeFileSync(
		join(dir, ".changeset", "config.json"),
		JSON.stringify({
			ignore: ["@prismalens/api", "@prismalens/engine"],
		}),
	);
	writeFileSync(join(dir, ".changeset", "README.md"), "# Changesets readme\n");

	// Packages
	mkdirSync(join(dir, "packages", "cli"), { recursive: true });
	writeFileSync(
		join(dir, "packages", "cli", "package.json"),
		JSON.stringify({ name: "prismalens", version: "0.1.0" }),
	);

	mkdirSync(join(dir, "packages", "api", "src"), { recursive: true });
	writeFileSync(
		join(dir, "packages", "api", "package.json"),
		JSON.stringify({
			name: "@prismalens/api",
			version: "0.1.0",
			private: true,
		}),
	);
	writeFileSync(
		join(dir, "packages", "api", "src", "index.ts"),
		"export const app = true;\n",
	);

	mkdirSync(join(dir, "scripts"), { recursive: true });
	writeFileSync(
		join(dir, "scripts", "validate-changesets.mjs"),
		execFileSync("cat", [scriptPath], { encoding: "utf8" }),
	);

	runGit(dir, ["add", "."]);
	runGit(dir, ["commit", "-m", "chore: initial commit"]);

	return {
		dir,
		cleanup: () => rmSync(dir, { recursive: true, force: true }),
	};
}

function runValidator(cwd, args = [], baseArgs = ["--base", "main"]) {
	try {
		const stdout = execFileSync(
			"node",
			["scripts/validate-changesets.mjs", ...baseArgs, ...args],
			{
				cwd,
				encoding: "utf8",
				stdio: ["ignore", "pipe", "pipe"],
			},
		);
		return { status: 0, stdout, stderr: "" };
	} catch (err) {
		return {
			status: err.status ?? 1,
			stdout: err.stdout?.toString() ?? "",
			stderr: err.stderr?.toString() ?? "",
		};
	}
}

test("fails when publishable code is modified without a changeset", () => {
	const { dir, cleanup } = createRepoFixture();
	try {
		runGit(dir, ["checkout", "-b", "feat/my-change"]);
		writeFileSync(
			join(dir, "packages", "api", "src", "index.ts"),
			"export const app = 'updated';\n",
		);
		runGit(dir, ["commit", "-am", "feat(api): update app"]);

		const res = runValidator(dir);
		assert.equal(res.status, 1, "expected non-zero exit code");
		assert.match(
			res.stderr,
			/No changeset found for changes to publishable packages\./,
		);
		assert.match(res.stderr, /packages\/api\/src\/index\.ts/);
		assert.match(res.stderr, /pnpm exec changeset --empty/);
	} finally {
		cleanup();
	}
});

test("passes for docs-only changes without a changeset", () => {
	const { dir, cleanup } = createRepoFixture();
	try {
		runGit(dir, ["checkout", "-b", "docs/update"]);
		writeFileSync(join(dir, "packages", "api", "README.md"), "# API Docs\n");
		writeFileSync(join(dir, "docs.md"), "# Root docs\n");
		runGit(dir, ["add", "."]);
		runGit(dir, ["commit", "-m", "docs: update docs"]);

		const res = runValidator(dir);
		assert.equal(res.status, 0, "expected exit 0");
		assert.match(res.stdout, /changesets OK/);
	} finally {
		cleanup();
	}
});

test("passes for test-only changes without a changeset", () => {
	const { dir, cleanup } = createRepoFixture();
	try {
		runGit(dir, ["checkout", "-b", "test/update"]);
		writeFileSync(
			join(dir, "packages", "api", "src", "index.test.ts"),
			"test('something', () => {});\n",
		);
		runGit(dir, ["add", "."]);
		runGit(dir, ["commit", "-m", "test: add test"]);

		const res = runValidator(dir);
		assert.equal(res.status, 0, "expected exit 0");
		assert.match(res.stdout, /changesets OK/);
	} finally {
		cleanup();
	}
});

test("passes when publishable code has a valid changeset naming prismalens", () => {
	const { dir, cleanup } = createRepoFixture();
	try {
		runGit(dir, ["checkout", "-b", "feat/with-changeset"]);
		writeFileSync(
			join(dir, "packages", "api", "src", "index.ts"),
			"export const app = 'updated';\n",
		);
		writeFileSync(
			join(dir, ".changeset", "my-change.md"),
			'---\n"prismalens": patch\n---\n\nFix a bug.\n',
		);
		runGit(dir, ["add", "."]);
		runGit(dir, ["commit", "-m", "feat(api): update app with changeset"]);

		const res = runValidator(dir);
		assert.equal(res.status, 0, "expected exit 0");
		assert.match(res.stdout, /changesets OK — 1 changeset\(s\) validated/);
	} finally {
		cleanup();
	}
});

test("passes when publishable code has an empty changeset escape hatch", () => {
	const { dir, cleanup } = createRepoFixture();
	try {
		runGit(dir, ["checkout", "-b", "refactor/internal"]);
		writeFileSync(
			join(dir, "packages", "api", "src", "index.ts"),
			"export const app = 'refactored';\n",
		);
		writeFileSync(
			join(dir, ".changeset", "empty-change.md"),
			"---\n---\n\nInternal refactor.\n",
		);
		runGit(dir, ["add", "."]);
		runGit(dir, ["commit", "-m", "refactor(api): internal refactor"]);

		const res = runValidator(dir);
		assert.equal(res.status, 0, "expected exit 0");
		assert.match(res.stdout, /changesets OK/);
	} finally {
		cleanup();
	}
});

test("fails when a changeset names a private @prismalens/* package", () => {
	const { dir, cleanup } = createRepoFixture();
	try {
		runGit(dir, ["checkout", "-b", "feat/bad-name"]);
		writeFileSync(
			join(dir, "packages", "api", "src", "index.ts"),
			"export const app = 'updated';\n",
		);
		writeFileSync(
			join(dir, ".changeset", "bad-name.md"),
			'---\n"@prismalens/api": patch\n---\n\nBad package name.\n',
		);
		runGit(dir, ["add", "."]);
		runGit(dir, ["commit", "-m", "feat(api): bad package name"]);

		const res = runValidator(dir);
		assert.equal(res.status, 1, "expected non-zero exit code");
		assert.match(res.stderr, /Invalid package name\(s\) in changeset\(s\)/);
		assert.match(res.stderr, /private — bundled into prismalens/);
	} finally {
		cleanup();
	}
});

test("fails when a changeset names an unknown non-workspace package", () => {
	const { dir, cleanup } = createRepoFixture();
	try {
		runGit(dir, ["checkout", "-b", "feat/unknown-name"]);
		writeFileSync(
			join(dir, ".changeset", "unknown-name.md"),
			'---\n"@prismalens/cli": patch\n---\n\nUnknown package name.\n',
		);
		runGit(dir, ["add", "."]);
		runGit(dir, ["commit", "-m", "feat(cli): unknown package name"]);

		const res = runValidator(dir);
		assert.equal(res.status, 1, "expected non-zero exit code");
		assert.match(res.stderr, /Invalid package name\(s\) in changeset\(s\)/);
		assert.match(res.stderr, /not a workspace package/);
	} finally {
		cleanup();
	}
});

// --- Release PR exemption + fail-closed diff probe (#328 review findings) ---

/** Simulates what `changesets/action` opens: consumed changesets deleted, the
 * published manifest's version field bumped, CHANGELOG appended. */
function makeReleasePr(dir, { alsoTouchSource = false } = {}) {
	writeFileSync(
		join(dir, ".changeset", "consumed.md"),
		'---\n"prismalens": patch\n---\n\nA real fix.\n',
	);
	runGit(dir, ["add", "."]);
	runGit(dir, ["commit", "-m", "feat: land a change with a changeset"]);

	runGit(dir, ["checkout", "-b", "changeset-release/main"]);
	rmSync(join(dir, ".changeset", "consumed.md"));
	writeFileSync(
		join(dir, "packages", "cli", "package.json"),
		JSON.stringify({ name: "prismalens", version: "0.1.1" }),
	);
	writeFileSync(
		join(dir, "packages", "cli", "CHANGELOG.md"),
		"# prismalens\n\n## 0.1.1\n\n### Patch Changes\n\n- A real fix.\n",
	);
	if (alsoTouchSource) {
		writeFileSync(
			join(dir, "packages", "api", "src", "index.ts"),
			"export const app = 'smuggled';\n",
		);
	}
	runGit(dir, ["add", "-A"]);
	runGit(dir, ["commit", "-m", "chore: version packages"]);
}

test("exempts a Version Packages release PR and says why", () => {
	const { dir, cleanup } = createRepoFixture();
	try {
		makeReleasePr(dir);
		const res = runValidator(dir);
		assert.equal(res.status, 0, `expected exit 0, stderr: ${res.stderr}`);
		assert.match(res.stdout, /release PR/i);
		assert.match(res.stdout, /\.changeset\/consumed\.md/);
		assert.match(res.stdout, /packages\/cli\/package\.json/);
		assert.doesNotMatch(res.stderr, /No changeset found/);
	} finally {
		cleanup();
	}
});

test("refuses a release-shaped PR that also edits real source", () => {
	const { dir, cleanup } = createRepoFixture();
	try {
		makeReleasePr(dir, { alsoTouchSource: true });
		const res = runValidator(dir);
		assert.equal(res.status, 1, "expected non-zero exit code");
		assert.match(
			res.stderr,
			/No changeset found for changes to publishable packages\./,
		);
		assert.match(res.stderr, /packages\/api\/src\/index\.ts/);
		assert.match(
			res.stderr,
			/release-PR exemption does not apply: 1 changed file\(s\)/,
		);
		assert.doesNotMatch(res.stdout, /release PR/i);
	} finally {
		cleanup();
	}
});

test("fails closed with a diagnostic when the base ref cannot be resolved", () => {
	const { dir, cleanup } = createRepoFixture();
	try {
		runGit(dir, ["checkout", "-b", "feat/whatever"]);
		writeFileSync(
			join(dir, "packages", "api", "src", "index.ts"),
			"export const app = 'updated';\n",
		);
		runGit(dir, ["commit", "-am", "feat(api): update app"]);

		const res = runValidator(dir, [], ["--base", "refs/heads/no-such-ref"]);
		assert.equal(res.status, 1, "expected non-zero exit code");
		assert.match(res.stderr, /Could not determine which files changed/);
		assert.match(res.stderr, /no-such-ref/);
		assert.match(res.stderr, /fetch-depth/);
		assert.doesNotMatch(res.stdout, /no publishable packages modified/);
	} finally {
		cleanup();
	}
});

test("fails closed when git itself cannot run in the directory", () => {
	const dir = mkdtempSync(join(tmpdir(), "pl-validate-changesets-nogit-"));
	try {
		mkdirSync(join(dir, ".changeset"), { recursive: true });
		writeFileSync(join(dir, ".changeset", "config.json"), JSON.stringify({}));
		mkdirSync(join(dir, "scripts"), { recursive: true });
		writeFileSync(
			join(dir, "scripts", "validate-changesets.mjs"),
			execFileSync("cat", [scriptPath], { encoding: "utf8" }),
		);
		const res = runValidator(dir, [], ["--base", "main"]);
		assert.equal(res.status, 1, "expected non-zero exit code");
		assert.match(res.stderr, /Could not determine which files changed/);
		assert.doesNotMatch(res.stdout, /no publishable packages modified/);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("names the empty-repository case instead of failing closed on it", () => {
	const dir = mkdtempSync(join(tmpdir(), "pl-validate-changesets-empty-"));
	try {
		runGit(dir, ["init", "-b", "main"]);
		mkdirSync(join(dir, ".changeset"), { recursive: true });
		writeFileSync(join(dir, ".changeset", "config.json"), JSON.stringify({}));
		writeFileSync(
			join(dir, ".changeset", "seed.md"),
			'---\n"prismalens": patch\n---\n\nSeed.\n',
		);
		mkdirSync(join(dir, "packages", "cli"), { recursive: true });
		writeFileSync(
			join(dir, "packages", "cli", "package.json"),
			JSON.stringify({ name: "prismalens", version: "0.1.0" }),
		);
		mkdirSync(join(dir, "scripts"), { recursive: true });
		writeFileSync(
			join(dir, "scripts", "validate-changesets.mjs"),
			execFileSync("cat", [scriptPath], { encoding: "utf8" }),
		);

		const res = runValidator(dir, [], ["--base", "main"]);
		assert.equal(res.status, 0, `expected exit 0, stderr: ${res.stderr}`);
		assert.match(res.stdout, /no commits yet/i);
		assert.doesNotMatch(res.stdout, /no publishable packages modified/);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
