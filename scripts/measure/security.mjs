// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// Security lens (conditions-and-lenses plan §4). Counting only; nothing here blocks.
//   attacks            simulated attacks, passing / total        (rows: measure/security attacks-failing)
//   audit              high+critical advisories from pnpm audit  (rows: measure/security audit-high)
//   stamp <cp> <n> <o> record the checkpoint's adversary review: n findings, o open cheap+serious+reachable
//   stale              commits touching security surfaces since the last stamp
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { record, root, sh } from "./lib.mjs";

const STAMPS = join(root, "scripts/measure/stamps");
const SURFACES = [
	"packages/api/src",
	"packages/@prismalens/auth",
	"packages/@prismalens/engine/src",
	"packages/@prismalens/agent-host/src",
];

// Each case runs the named tests and needs at least one to match and all to pass.
const CASES = [
	{
		id: "pairing.expired",
		pkg: "@prismalens/auth",
		file: "src/pairing.test.ts",
		name: "expired \\(now past expiresAt",
	},
	{
		id: "pairing.reused",
		pkg: "@prismalens/auth",
		file: "src/pairing.test.ts",
		name: "second redemption of the same link",
	},
	{
		id: "login.revoked",
		pkg: "@prismalens/auth",
		file: "src/pairing.test.ts",
		name: "authenticateDeviceToken returns reason revoked",
	},
	{
		id: "webhook.bad-signature",
		pkg: "@prismalens/api",
		file: "src/security-attacks.spec.ts",
		name: "attack: webhook",
	},
	{
		id: "browser.local-url",
		pkg: "@prismalens/api",
		file: "src/security-attacks.spec.ts",
		name: "attack: agent browser",
	},
	{
		id: "workspace.path-escape",
		pkg: "@prismalens/api",
		file: "src/security-attacks.spec.ts",
		name: "attack: agent asks",
	},
];

function runCase(c) {
	const out = join(tmpdir(), `pl-attack-${c.id}.json`);
	const dir = join(
		root,
		c.pkg === "@prismalens/api" ? "packages/api" : `packages/${c.pkg}`,
	);
	rmSync(out, { force: true });
	try {
		sh(
			process.execPath,
			[
				join(dir, "node_modules/vitest/vitest.mjs"),
				"run",
				c.file,
				"-t",
				c.name,
				"--reporter=json",
				`--outputFile=${out}`,
				"--maxWorkers=2",
			],
			{ cwd: dir, env: { ...process.env, PL_ATTACKS: "1" } },
		);
	} catch {
		// A failing test exits non-zero; the JSON below says which.
	}
	if (!existsSync(out)) return { ...c, total: 0, failed: 0 };
	const r = JSON.parse(readFileSync(out, "utf8"));
	return {
		...c,
		total: r.numPassedTests + r.numFailedTests,
		failed: r.numFailedTests,
	};
}

function attacks() {
	const results = CASES.map(runCase);
	for (const r of results)
		console.log(
			`${r.total > 0 && !r.failed ? "pass" : "FAIL"}  ${r.id}  (${r.total} matched, ${r.failed} failed)`,
		);
	const failing = results.filter((r) => r.total === 0 || r.failed).length;
	console.log(
		`security.attacks ${results.length - failing}/${results.length} (failing ${failing})`,
	);
	record("security", "attacks-failing", failing);
	return failing;
}

function audit() {
	let json;
	try {
		json = sh("pnpm", ["audit", "--audit-level=high", "--json"]);
	} catch (e) {
		json = e.stdout ?? "";
	}
	const start = json.indexOf("{");
	if (start < 0) {
		console.error(
			"security.audit unavailable: pnpm audit printed no JSON (offline?)",
		);
		return -1;
	}
	const v = JSON.parse(json.slice(start)).metadata?.vulnerabilities ?? {};
	const n = (v.high ?? 0) + (v.critical ?? 0);
	console.log(`security.audit ${n} high+critical (${JSON.stringify(v)})`);
	record("security", "audit-high", n);
	return n;
}

function stamp(cp, findings, open) {
	if (!cp || findings === undefined || open === undefined)
		throw new Error(
			"usage: stamp <checkpoint> <findings> <open-cheap-serious-reachable>",
		);
	mkdirSync(STAMPS, { recursive: true });
	const commit = sh("git", ["rev-parse", "HEAD"]).trim();
	writeFileSync(
		join(STAMPS, `security-${cp}.json`),
		`${JSON.stringify({ checkpoint: cp, commit, date: new Date().toISOString(), findings: Number(findings), openCheapSeriousReachable: Number(open) }, null, "\t")}\n`,
	);
	console.log(`security.stamp ${cp} at ${commit.slice(0, 9)}`);
	record("security", "review-open", Number(open));
}

function stale() {
	const files = existsSync(STAMPS)
		? readdirSync(STAMPS).filter((f) => f.startsWith("security-"))
		: [];
	const stamps = files
		.map((f) => JSON.parse(readFileSync(join(STAMPS, f), "utf8")))
		.sort((a, b) => a.date.localeCompare(b.date));
	const last = stamps.at(-1);
	const range = last ? `${last.commit}..HEAD` : "HEAD";
	const n = Number(
		sh("git", [
			"rev-list",
			"--count",
			"--no-merges",
			range,
			"--",
			...SURFACES,
		]).trim(),
	);
	console.log(
		`security.stale ${n} commits on security surfaces since ${last ? `${last.checkpoint} (${last.commit.slice(0, 9)})` : "the start (no stamp yet)"}`,
	);
	record("security", "review-stale-commits", n);
	return n;
}

const [cmd, ...rest] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const run = { attacks, audit, stamp: () => stamp(...rest), stale }[cmd];
if (!run) {
	console.error(
		"usage: node scripts/measure/security.mjs attacks|audit|stamp <cp> <findings> <open>|stale [--allow-raise]",
	);
	process.exit(2);
}
run();
