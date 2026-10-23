// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { LIMIT, pathModels } from "./check-artifact.mjs";

const SCRIPT = fileURLToPath(new URL("./check-artifact.mjs", import.meta.url));
const MIGRATION =
	"node_modules/@prismalens/database/dist/prisma/sqlite/schema/20261007135949_investigation_kind_agent_mode/migration.sql";

test("the Scoop model of the standalone archive matches the CONTRIBUTING worked example", () => {
	const top = "prismalens-0.5.3-win32-x64";
	const models = pathModels({ kind: "standalone", version: "0.5.3", top }, [
		`${top}/app/${MIGRATION}`,
		`${top}/bin/pl.cmd`,
	]);
	const scoop = models.find((m) => m.model === "scoop");
	assert.equal(
		scoop.prefix,
		"C:\\Users\\uuuuuuuuuuuuuuuuuuuu\\scoop\\apps\\prismalens\\0.5.3\\_tmp\\",
	);
	assert.equal(scoop.prefix.length, 63);
	assert.equal(scoop.entry.length, 149);
	assert.equal(scoop.length, 212);
	const installer = models.find((m) => m.model === "installer");
	assert.equal(installer.entry, `app\\${MIGRATION.split("/").join("\\")}`);
	assert.equal(
		installer.length,
		installer.prefix.length + installer.entry.length,
	);
});

test("an npm tarball named prismalens is also measured as the archive it becomes", () => {
	const models = pathModels(
		{ kind: "npm", name: "prismalens", version: "0.5.3", top: "package" },
		[`package/${MIGRATION}`],
	);
	assert.deepEqual(
		models.map((m) => m.model),
		["npm-global", "installer", "scoop"],
	);
	assert.equal(models[2].length, 212);
	const other = pathModels(
		{
			kind: "npm",
			name: "@prismalens/agent-adapters",
			version: "0.1.0",
			top: "package",
		},
		["package/dist/index.js"],
	);
	assert.deepEqual(
		other.map((m) => m.model),
		["npm-global"],
	);
	assert.ok(
		other[0].prefix.endsWith("\\node_modules\\@prismalens\\agent-adapters\\"),
	);
});

function fixture({ deep = 10, licence = true } = {}) {
	const dir = mkdtempSync(join(tmpdir(), "check-artifact-"));
	const pkg = join(dir, "src", "package");
	const write = (rel, body) => {
		mkdirSync(dirname(join(pkg, rel)), { recursive: true });
		writeFileSync(join(pkg, rel), body);
	};
	write("package.json", JSON.stringify({ name: "fixture", version: "1.0.0" }));
	write(`${"d".repeat(deep)}/x.js`, "");
	write(
		"node_modules/dep/package.json",
		JSON.stringify({ name: "dep", version: "2.0.0" }),
	);
	if (licence) write("node_modules/dep/LICENSE", "MIT");
	execFileSync("tar", ["-czf", "../fixture-1.0.0.tgz", "package"], {
		cwd: join(dir, "src"),
	});
	return { tarball: join(dir, "fixture-1.0.0.tgz"), dir };
}

function run(tarball, budgets, dir) {
	const file = join(dir, "budgets.json");
	writeFileSync(file, JSON.stringify(budgets));
	return spawnSync(process.execPath, [SCRIPT, tarball, "--budgets", file], {
		encoding: "utf8",
	});
}

test("an artifact within its budget, its limit and its licences passes", () => {
	const { tarball, dir } = fixture();
	const r = run(tarball, { fixture: { bytes: 1e6, files: 10 } }, dir);
	assert.equal(r.status, 0, r.stdout + r.stderr);
	assert.match(r.stdout, /npm-global \d+\/220 /);
});

test("a missing budget key, a breach and a missing licence each fail", () => {
	const { tarball, dir } = fixture({ licence: false });
	let r = run(tarball, {}, dir);
	assert.equal(r.status, 1);
	assert.match(r.stdout, /::error::.*no budget for fixture/);
	assert.match(r.stdout, /::error::.*no licence text: dep@2\.0\.0/);
	r = run(tarball, { fixture: { bytes: 1, files: 1 } }, dir);
	assert.match(r.stdout, /bytes is over its budget of 1/);
	assert.match(r.stdout, /files is over its budget of 1/);
});

test("a path one char over the limit fails", () => {
	// npm-global prefix for "fixture" plus "<d...>/x.js".
	const prefix =
		"C:\\Users\\uuuuuuuuuuuuuuuuuuuu\\AppData\\Roaming\\npm\\node_modules\\fixture\\"
			.length;
	const atLimit = LIMIT - prefix - "/x.js".length;
	let { tarball, dir } = fixture({ deep: atLimit });
	assert.equal(
		run(tarball, { fixture: { bytes: 1e6, files: 10 } }, dir).status,
		0,
	);
	({ tarball, dir } = fixture({ deep: atLimit + 1 }));
	const r = run(tarball, { fixture: { bytes: 1e6, files: 10 } }, dir);
	assert.equal(r.status, 1);
	assert.match(r.stdout, /npm-global: 221 chars is over 220/);
});
