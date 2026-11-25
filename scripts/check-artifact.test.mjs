// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { LIMIT, largest, pathModels, UPSTREAM } from "./check-artifact.mjs";

const SCRIPT = fileURLToPath(new URL("./check-artifact.mjs", import.meta.url));
const MIGRATION =
	"node_modules/@prismalens/database/dist/prisma/sqlite/schema/20261007135949_investigation_kind_agent_mode/migration.sql";

test("the Scoop model of the standalone archive puts the deepest migration 212 of 220 characters deep", () => {
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

test("a nightly archive is not measured under Scoop, which no nightly reaches, but still under the installer", () => {
	const version = "0.5.6-nightly.20261121.27";
	const top = `prismalens-${version}-linux-x64`;
	const deepest =
		"app/node_modules/@prismalens/database/dist/prisma/sqlite/schema/20261102044114_investigation_service_set_null/migration.sql";
	const models = pathModels({ kind: "standalone", version, top }, [
		`${top}/${deepest}`,
	]);
	assert.deepEqual(
		models.map((m) => m.model),
		["installer"],
	);
	assert.ok(models[0].length <= LIMIT, `installer ${models[0].length}`);
	// The same entry under Scoop with this version is what failed the 2026-11-21 nightly (253 > 220).
	const stable = pathModels(
		{ kind: "standalone", version: "0.5.6", top: "prismalens-0.5.6-linux-x64" },
		[`prismalens-0.5.6-linux-x64/${deepest}`],
	);
	assert.deepEqual(stable.map((m) => m.model).sort(), ["installer", "scoop"]);
	assert.ok(stable.find((m) => m.model === "scoop").length <= LIMIT);
});

test("a nightly archive's installer path over the limit still fails the gate", () => {
	const version = "0.5.6-nightly.20261121.27";
	const top = `prismalens-${version}-linux-x64`;
	const [installer] = pathModels({ kind: "standalone", version, top }, [
		`${top}/app/${"d/".repeat(75)}f.js`,
	]);
	assert.equal(installer.model, "installer");
	assert.ok(installer.length > LIMIT, `installer ${installer.length}`);
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

function fixture({
	deep = 10,
	licence = true,
	inlined = false,
	upstream = 0,
	own = 0,
	repeated = 0,
	blob = 0,
	packed = "",
} = {}) {
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
	if (inlined)
		write(
			"dist/adapters/bundled.json",
			JSON.stringify({ "a.mjs": { inlined: ["inl@1.0.0"] } }),
		);
	// Incompressible bytes, so growth shows in the archive's size.
	const noise = (n) => randomBytes(n);
	for (let i = 0; i < upstream; i++)
		write(`dist/adapters/up${i}.mjs`, noise(4000 + i));
	for (let i = 0; i < own; i++) write(`dist/own${i}.js`, noise(4000 + i));
	const payload = noise(4000);
	for (let i = 0; i < repeated; i++)
		write(`dist/adapters/same${i}.mjs`, payload);
	if (blob) write("dist/blob.js", noise(blob));
	if (packed) write("dist/adapters/words.mjs", packed);
	const src = join(dir, "src");
	const tarball = join(dir, "fixture-1.0.0.tgz");
	if (packed) {
		// As npm packs: gzip at level 9, tighter than the checker's own estimate.
		execFileSync("tar", ["-cf", "../fixture.tar", "package"], { cwd: src });
		const tar = readFileSync(join(dir, "fixture.tar"));
		writeFileSync(tarball, gzipSync(tar, { level: 9 }));
	} else
		execFileSync("tar", ["-czf", "../fixture-1.0.0.tgz", "package"], {
			cwd: src,
		});
	return { tarball, dir };
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

test("a package's own inlined dependency without a licence text fails", () => {
	const { tarball, dir } = fixture({ inlined: true });
	const r = run(tarball, { fixture: { bytes: 1e6, files: 10 } }, dir);
	assert.equal(r.status, 1, r.stdout + r.stderr);
	assert.match(r.stdout, /no licence text: inl@1.0.0/);
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

test("a budget breach names the largest unpacked files, biggest first", () => {
	const root = mkdtempSync(join(tmpdir(), "pl-largest-"));
	writeFileSync(join(root, "small.js"), "a");
	writeFileSync(join(root, "big.js"), "a".repeat(100));
	writeFileSync(join(root, "mid.js"), "a".repeat(10));
	assert.deepEqual(largest(root, ["small.js", "big.js", "mid.js"], 2), [
		{ entry: "big.js", size: 100 },
		{ entry: "mid.js", size: 10 },
	]);
});

test("upstream agent packages are reported and never budgeted; the same growth in our own files fails", () => {
	const base = fixture();
	const budget = {
		fixture: { bytes: statSync(base.tarball).size + 2000, files: 5 },
	};
	assert.equal(run(base.tarball, budget, base.dir).status, 0);
	const up = fixture({ upstream: 6 });
	let r = run(up.tarball, budget, up.dir);
	assert.equal(r.status, 0, r.stdout);
	assert.match(
		r.stdout,
		/upstream agent packages \d+ bytes, 6 files, not budgeted/,
	);
	const own = fixture({ own: 6 });
	r = run(own.tarball, budget, own.dir);
	assert.equal(r.status, 1);
	assert.match(r.stdout, /fixture: \d+ bytes is over its budget/);
	assert.match(r.stdout, /fixture: 10 files is over its budget of 5/);
});

test("repeated upstream payloads never hide our own growth past the byte budget", () => {
	const { tarball, dir } = fixture({ repeated: 10, blob: 20_000 });
	const r = run(tarball, { fixture: { bytes: 10_000, files: 10 } }, dir);
	assert.equal(r.status, 1, r.stdout);
	assert.match(r.stdout, /fixture: \d+ bytes is over its budget of 10000/);
	assert.doesNotMatch(r.stdout, /files is over its budget/);
});

test("our own bytes stay counted when the archive packs upstream tighter than the estimate", () => {
	// Two letters at random: level 9 packs them thousands of bytes tighter than level 6.
	const letters = [...randomBytes(400_000)].map((b) => "ab"[b & 1]).join("");
	const { tarball, dir } = fixture({ packed: letters });
	const r = run(tarball, { fixture: { bytes: 1, files: 10 } }, dir);
	assert.equal(r.status, 1, r.stdout);
	assert.match(r.stdout, /fixture: [1-9]\d* bytes is over its budget of 1/);
});

test("the licence texts packed for upstream packages are upstream; any other file is ours", () => {
	const upstream = [
		"package/THIRD_PARTY_LICENSES/zod/LICENSE",
		"package/node_modules/@prismalens/agent-adapters/THIRD_PARTY_LICENSES/@anthropic-ai/claude-agent-sdk/LICENSE.md",
		"prismalens-1.0.0-linux-x64/app/node_modules/@prismalens/agent-adapters/THIRD_PARTY_LICENSES/zod/LICENSE",
	];
	const ours = [
		"package/LICENSE",
		"package/dist/THIRD_PARTY_LICENSES/x.js",
		"package/node_modules/dep/THIRD_PARTY_LICENSES/x",
	];
	assert.deepEqual(
		[...upstream, ...ours].filter((e) => UPSTREAM.some((r) => r.test(e))),
		upstream,
	);
});
