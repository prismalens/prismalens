// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/** Verifies gate-side-checks skips all checks on win32 (#902). */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tempDir = mkdtempSync(join(tmpdir(), "gate-side-checks-test-"));
const preloadPath = join(tempDir, "preload-win32.mjs");
writeFileSync(
	preloadPath,
	'Object.defineProperty(process, "platform", { value: "win32" });\n',
);
const preloadUrl = pathToFileURL(preloadPath).href;

after(() => rmSync(tempDir, { recursive: true, force: true }));

const WIN32_SKIP =
	'POSIX-only (sh shims, systemd); CI job "Gate side checks (packed tarball)" is the record';

function runChecks(args) {
	return spawnSync(
		process.execPath,
		["--import", preloadUrl, "scripts/gate-side-checks.mjs", ...args],
		{ cwd: ROOT, encoding: "utf8" },
	);
}

test("win32 platform skips all six checks and exits 0", () => {
	const res = runChecks(["--tarball", "x"]);
	assert.equal(res.status, 0, res.stderr);
	const skipLines = res.stdout
		.split(/\r?\n/)
		.filter((line) => line.startsWith("SKIP "));
	assert.equal(skipLines.length, 6);
	const expected = ["telemetry", "update", "lock", "reset", "hosts", "upgrade"];
	for (const name of expected) {
		const line = skipLines.find((l) => l.includes(name));
		assert.ok(line, `missing SKIP line for ${name}`);
		assert.ok(line.includes(WIN32_SKIP));
	}
	assert.equal(res.stdout.includes("FAIL"), false);
});

test("--only lock,hosts on win32 gives exactly two SKIP lines and exits 0", () => {
	const res = runChecks(["--tarball", "x", "--only", "lock,hosts"]);
	assert.equal(res.status, 0, res.stderr);
	const skipLines = res.stdout
		.split(/\r?\n/)
		.filter((line) => line.startsWith("SKIP "));
	assert.equal(skipLines.length, 2);
	for (const name of ["lock", "hosts"]) {
		const line = skipLines.find((l) => l.includes(name));
		assert.ok(line, `missing SKIP line for ${name}`);
		assert.ok(line.includes(WIN32_SKIP));
	}
	assert.equal(res.stdout.includes("FAIL"), false);
});

test("--only bogus exits 1", () => {
	const res = runChecks(["--tarball", "x", "--only", "bogus"]);
	assert.equal(res.status, 1);
});
