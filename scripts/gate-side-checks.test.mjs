// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/** The side-check runner's argument handling and per-platform scope (#920). */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tempDir = mkdtempSync(join(tmpdir(), "gate-side-checks-test-"));
after(() => rmSync(tempDir, { recursive: true, force: true }));

/** A preload that makes the runner believe it is on `platform`. */
function asPlatform(platform) {
	const file = join(tempDir, `preload-${platform}.mjs`);
	writeFileSync(
		file,
		`Object.defineProperty(process, "platform", { value: "${platform}" });\n`,
	);
	return pathToFileURL(file).href;
}

function runChecks(args, platform) {
	return spawnSync(
		process.execPath,
		[
			...(platform ? ["--import", asPlatform(platform)] : []),
			"scripts/gate-side-checks.mjs",
			...args,
		],
		{ cwd: ROOT, encoding: "utf8" },
	);
}

test("--only rollback is N/A on Windows and macOS, and upgrade on Windows: no SKIP, no FAIL, exit 0", () => {
	for (const platform of ["win32", "darwin"]) {
		const res = runChecks(["--only", "rollback", "--no-skip"], platform);
		assert.equal(res.status, 0, res.stderr);
		assert.match(res.stdout, /^N\/A\s+rollback\s+N\/A: .*systemd-only/m);
		assert.equal(/^SKIP/m.test(res.stdout), false);
		assert.equal(res.stdout.includes("FAIL"), false);
	}
});

test("--only with a name it does not know exits 1 and names the known checks", () => {
	const res = runChecks(["--only", "bogus"]);
	assert.equal(res.status, 1);
	assert.match(
		res.stderr,
		/--only takes telemetry, update, lock, reset, hosts, upgrade, rollback/,
	);
});

test("--help lists every check and --no-skip", () => {
	const res = runChecks(["--help"]);
	assert.equal(res.status, 0);
	for (const word of ["telemetry", "rollback", "--no-skip"])
		assert.ok(res.stdout.includes(word), word);
});

test("--only upgrade is N/A on Windows and names the finding", () => {
	const res = runChecks(["--only", "upgrade", "--no-skip"], "win32");
	assert.equal(res.status, 0, res.stderr);
	assert.match(res.stdout, /^N\/A\s+upgrade\s+N\/A on Windows: .*#921/m);
	assert.equal(/^SKIP|FAIL/m.test(res.stdout), false);
});
