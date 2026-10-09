#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Packed upgrade smoke (#673 w59, T14, #804 OBJ-030): does an INSTALLED
 * tarball upgrade a populated database that predates `investigation_turns`,
 * and claim each legacy pending job with the right intent?
 *
 * Installs the tarball, migrates a fresh workspace to every shipped migration
 * but `investigation_turns`, seeds four incidents each holding one pending job
 * of a legacy payload form (first investigation, chat, Ask with no kind,
 * continue), then boots `pl up` on it with the fake ACP agent on PATH. The
 * agent holds each turn until released, so the script reads every claimed
 * row's persisted `liveTurn`, sends a message whose kind disagrees (CONFLICT)
 * and one that agrees (steered), then releases them and reads the ends.
 *
 * Usage: packed-upgrade-smoke.mjs <dir-with-tarball>
 *   The dir holds the tarball from `node scripts/pack-cli.mjs`, the same
 *   artifact packed-smoke and packed-intake verify. PRISMALENS_TARBALL
 *   overrides with an exact path. Env: PACKED_UPGRADE_PORT (default 3103).
 */
import { execFileSync, spawn } from "node:child_process";
import {
	cpSync,
	createWriteStream,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { installFakeAgent, releaseRun } from "./fakes/fake-acp-agent.mjs";

const PORT = process.env.PACKED_UPGRADE_PORT ?? "3103";
const BASE = `http://127.0.0.1:${PORT}`;
const FETCH_TIMEOUT_MS = 10_000;
const TURNS = "_investigation_turns";

const prefix = mkdtempSync(join(tmpdir(), "pl-upgrade-"));
const workspace = join(prefix, "workspace");
const stateDir = join(prefix, "fake-state");
mkdirSync(workspace, { recursive: true });

let child;
let failed = 0;
const ok = (m) => console.log(`[packed-upgrade] OK   ${m}`);
const bad = (m) => {
	failed++;
	console.error(`[packed-upgrade] FAIL ${m}`);
};

function findTarball() {
	if (process.env.PRISMALENS_TARBALL)
		return resolve(process.env.PRISMALENS_TARBALL);
	const dir = process.argv[2];
	if (!dir)
		throw new Error(
			"usage: packed-upgrade-smoke.mjs <dir-with-tarball> (or set PRISMALENS_TARBALL)",
		);
	const found = readdirSync(resolve(dir)).find((f) =>
		/^prismalens-[0-9].*\.tgz$/.test(f),
	);
	if (!found) throw new Error(`no tarball matching prismalens-*.tgz in ${dir}`);
	return join(resolve(dir), found);
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(what, fn, ms = 60_000) {
	const end = Date.now() + ms;
	for (;;) {
		const v = await fn().catch(() => undefined);
		if (v) return v;
		if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
		await wait(500);
	}
}

/** A report the engine accepts: one verified finding from the `ls` the turn ran. */
const REPORT = {
	summary: "The queue drains one item per poll.",
	rootCause: null,
	rootCauseCategory: null,
	hypotheses: [
		{
			statement: "The consumer polls with batch=1",
			status: "supported",
			evidence: [
				{
					observation: "worker/ lists consumer.py",
					source: "ls",
					direction: "supports",
					status: "verified",
					toolCallId: "toolu_ls",
				},
			],
		},
	],
	ruledOut: [],
	coverage: { queried: ["ls"], notQueried: ["prometheus"] },
	nextSteps: [],
};
const LS = {
	tool: {
		id: "toolu_ls",
		title: "`ls`",
		rawInput: { command: "ls" },
		output: "worker\nREADME.md",
	},
};
/** Every turn, first or reopened, holds until its key is released. */
const SESSION = {
	agent: { name: "claude-agent-acp", version: "0.88.0-fake" },
	turns: [[LS, { waitForRelease: true }, { report: REPORT }]],
	followUp: [LS, { waitForRelease: true }, { report: REPORT }],
	retry: [{ report: REPORT }],
};

/** The four legacy forms, as a pre-upgrade build queued them. */
const FORMS = [
	{
		form: "initial",
		kind: "investigation",
		key: "UpgradeInitialProbe",
		turn: "report",
	},
	{
		form: "chat",
		kind: "investigation",
		key: "upgrade-chat-probe",
		turn: "answer",
	},
	{
		form: "ask",
		kind: "investigation",
		key: "upgrade-ask-probe",
		turn: "answer",
	},
	{
		form: "continue",
		kind: "investigation",
		key: "upgrade-continue-probe",
		turn: "report",
	},
];

async function seed(pkgRoot) {
	const dbPkg = join(pkgRoot, "node_modules", "@prismalens", "database");
	process.env.PRISMALENS_WORKSPACE_DIR = workspace;
	const migrator = await import(
		pathToFileURL(join(dbPkg, "dist", "src", "migrator", "index.js")).href
	);
	const shipped = migrator.resolveMigrationsDir();
	const before = mkdtempSync(join(prefix, "migrations-"));
	let skipped = 0;
	for (const name of readdirSync(shipped)) {
		if (!existsSync(join(shipped, name, "migration.sql"))) continue;
		if (name.endsWith(TURNS)) {
			skipped++;
			continue;
		}
		cpSync(join(shipped, name), join(before, name), { recursive: true });
	}
	if (skipped !== 1)
		throw new Error(`the tarball ships no ${TURNS} migration to upgrade to`);
	const databaseFile = join(workspace, "prismalens.db");
	await migrator.runMigrations({
		databaseFile,
		migrationsDir: before,
		log: () => {},
	});
	const Database = createRequire(join(dbPkg, "package.json"))("better-sqlite3");
	const db = new Database(databaseFile);
	const cols = db.prepare(`PRAGMA table_info("investigations")`).all();
	if (cols.some((c) => c.name === "liveTurn"))
		throw new Error("the seeded database already has liveTurn");
	const now = Date.now();
	const rows = [];
	for (const [i, f] of FORMS.entries()) {
		const n = i + 1;
		const incidentId = `00000000-0000-4000-8000-00000000000${n}`;
		const id = `10000000-0000-4000-8000-00000000000${n}`;
		db.prepare(
			`INSERT INTO "incidents" ("id","number","title","status","updatedAt") VALUES (?,?,?,?,?)`,
		).run(incidentId, n, `Upgrade ${f.form}`, "investigating", now);
		const followUp = f.form === "ask" || f.form === "continue";
		db.prepare(
			`INSERT INTO "investigations" ("id","incidentId","status","kind","harness","acpSessionId","workspace","report","summary","title","updatedAt") VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
		).run(
			id,
			incidentId,
			"pending",
			f.form === "chat" ? "chat" : "investigation",
			followUp ? "opencode" : null,
			followUp ? `fake-upgrade-${f.form}` : null,
			followUp
				? JSON.stringify({
						layout: "unmapped",
						cwd: join(workspace, "runs", id, "unmapped"),
						repos: [],
					})
				: null,
			f.form === "ask" ? JSON.stringify(REPORT) : null,
			f.form === "ask" ? REPORT.summary : null,
			f.form === "chat" ? f.key : null,
			now,
		);
		const restore =
			f.form === "ask"
				? {
						status: "completed",
						completedAt: new Date(now).toISOString(),
						error: null,
					}
				: {
						status: "cancelled",
						completedAt: new Date(now).toISOString(),
						error: "Investigation cancelled",
					};
		const payload = {
			incidentId,
			investigationId: id,
			...(f.form === "initial"
				? {
						alerts: [
							{
								alertname: f.key,
								severity: "critical",
								labels: { alertname: f.key },
								annotations: { summary: f.key },
								startsAt: new Date(now).toISOString(),
							},
						],
					}
				: {}),
			...(f.form === "chat" ? { kind: "chat", chat: { text: f.key } } : {}),
			// A pre-upgrade Ask carried no kind; a continue said so.
			...(f.form === "ask"
				? { resume: { text: f.key, mode: "queue", restore } }
				: {}),
			...(f.form === "continue"
				? { resume: { text: f.key, mode: "queue", kind: "continue", restore } }
				: {}),
		};
		db.prepare(
			`INSERT INTO "jobs" ("id","investigationId","incidentId","payload","status","updatedAt") VALUES (?,?,?,?,?,?)`,
		).run(
			`job-upgrade-${f.form}`,
			id,
			incidentId,
			JSON.stringify(payload),
			"pending",
			now,
		);
		rows.push({ ...f, id, incidentId });
	}
	db.close();
	delete process.env.PRISMALENS_WORKSPACE_DIR;
	ok(
		`seeded a ${readdirSync(before).length}-migration database with ${rows.length} legacy pending jobs`,
	);
	return rows;
}

async function main() {
	const tgz = findTarball();
	console.log(`[packed-upgrade] tarball: ${tgz}`);
	execFileSync(
		"npm",
		[
			"install",
			"--prefix",
			prefix,
			"--no-audit",
			"--no-fund",
			"--loglevel=error",
			tgz,
		],
		{ stdio: "inherit" },
	);
	const bin = join(prefix, "node_modules", ".bin", "pl");
	const pkgRoot = join(prefix, "node_modules", "prismalens");
	if (!existsSync(bin)) throw new Error(`pl bin not linked at ${bin}`);

	const rows = await seed(pkgRoot);

	const agentBin = join(prefix, "agent-bin");
	mkdirSync(agentBin);
	const sessionFile = join(prefix, "upgrade-session.json");
	writeFileSync(sessionFile, JSON.stringify(SESSION));
	installFakeAgent(agentBin, { session: sessionFile, stateDir });

	let bootLog = "";
	const log = createWriteStream(join(prefix, "up.log"));
	child = spawn(bin, ["up"], {
		stdio: ["ignore", "pipe", "pipe"],
		env: {
			...process.env,
			CI: process.env.CI ?? "true",
			PATH: `${agentBin}${delimiter}${process.env.PATH ?? ""}`,
			PRISMALENS_WORKSPACE_DIR: workspace,
			PRISMALENS_LOG_CONSOLE: "verbose",
			PRISMALENS_HOST: "127.0.0.1",
			PRISMALENS_PORT: PORT,
			PRISMALENS_HARNESS: "opencode",
			PRISMALENS_DISPATCH_CONCURRENCY: "4",
		},
	});
	for (const s of [child.stdout, child.stderr])
		s.on("data", (d) => {
			bootLog += d;
			log.write(d);
		});
	await until(
		"pl up to boot",
		async () => /PrismaLens API running/.test(bootLog),
		120_000,
	).catch((e) => {
		console.error(bootLog.slice(-4000));
		throw e;
	});
	ok("pl up booted on the pre-upgrade database and ran the upgrade");

	const pairOut = execFileSync(bin, ["pair", "--workspace", workspace], {
		encoding: "utf8",
	});
	const token = pairOut.match(/\/pair#([^\s#]+)/)?.[1] ?? "";
	const redeem = await fetch(`${BASE}/api/pairing/redeem`, {
		method: "POST",
		headers: { "content-type": "application/json", origin: BASE },
		body: JSON.stringify({ token, name: "packed upgrade" }),
		signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
	});
	const cookie =
		(redeem.headers.getSetCookie?.() ?? [])
			.find((c) => c.startsWith("prismalens.device."))
			?.split(";")[0] ?? "";
	if (!cookie) throw new Error(`pairing failed: ${redeem.status}`);
	const api = (path, init = {}) =>
		fetch(BASE + path, {
			...init,
			signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
			headers: {
				"content-type": "application/json",
				origin: BASE,
				cookie,
				...(init.headers ?? {}),
			},
		});
	const get = async (id) => (await api(`/api/investigations/${id}`)).json();

	// --- claims and intent ---------------------------------------------------
	for (const r of rows) {
		const run = await until(`${r.form}'s claim`, async () => {
			const x = await get(r.id);
			return x.status === "running" && x.liveTurn ? x : undefined;
		});
		run.liveTurn === r.turn
			? ok(`${r.form}: claimed, liveTurn=${run.liveTurn}`)
			: bad(`${r.form}: liveTurn=${run.liveTurn}, expected ${r.turn}`);
	}
	const incidents = await (await api("/api/incidents?limit=50")).json();
	const titles = JSON.stringify(incidents);
	FORMS.every((f) => titles.includes(`Upgrade ${f.form}`))
		? ok("every seeded incident survived the upgrade")
		: bad("a seeded incident is missing after the upgrade");

	// --- a message's kind must agree with the live turn ----------------------
	for (const r of rows) {
		const wrong = r.turn === "report" ? "chat" : "continue";
		const res = await api(`/api/investigations/${r.id}/messages`, {
			method: "POST",
			body: JSON.stringify({ text: "stale page", mode: "queue", kind: wrong }),
		});
		const body = await res.text();
		res.status === 409 &&
		/Run #\d+ is working (on an answer|toward a report); wait or stop it/.test(
			body,
		)
			? ok(`${r.form}: kind ${wrong} refused 409`)
			: bad(
					`${r.form}: kind ${wrong} answered ${res.status} ${body.slice(0, 160)}`,
				);
		const right = r.turn === "report" ? "continue" : "chat";
		const steer = await api(`/api/investigations/${r.id}/messages`, {
			method: "POST",
			body: JSON.stringify({
				text: `also ${r.key}`,
				mode: "queue",
				kind: right,
			}),
		});
		steer.ok
			? ok(`${r.form}: kind ${right} steers (${steer.status})`)
			: bad(
					`${r.form}: kind ${right} answered ${steer.status} ${(await steer.text()).slice(0, 160)}`,
				);
	}

	// --- each ends as its form ends ------------------------------------------
	for (const r of rows) releaseRun(r.key, stateDir);
	for (const r of rows) {
		const end = await until(
			`${r.form}'s end`,
			async () => {
				const x = await get(r.id);
				return ["completed", "failed", "cancelled"].includes(x.status)
					? x
					: undefined;
			},
			90_000,
		);
		const want =
			r.form === "chat"
				? end.status === "completed" && !end.report
				: r.form === "ask"
					? end.status === "completed" &&
						end.lastTurnOutcome === "answered" &&
						end.report
					: end.status === "completed" && end.report;
		want && end.liveTurn === null
			? ok(
					`${r.form}: ended ${end.status}${end.lastTurnOutcome ? `, last message ${end.lastTurnOutcome}` : ""}, liveTurn null`,
				)
			: bad(
					`${r.form}: ended ${end.status}, report ${!!end.report}, lastTurnOutcome ${end.lastTurnOutcome}, liveTurn ${end.liveTurn}, error ${end.error}`,
				);
	}
}

main()
	.catch((e) => bad(e?.stack ?? String(e)))
	.finally(() => {
		try {
			child?.kill("SIGKILL");
		} catch {
			// gone
		}
		if (failed === 0) rmSync(prefix, { recursive: true, force: true });
		else console.error(`[packed-upgrade] kept ${prefix} for the logs`);
		console.log(
			failed === 0
				? "[packed-upgrade] UPGRADE OK"
				: `[packed-upgrade] ${failed} failed`,
		);
		process.exit(failed === 0 ? 0 : 1);
	});
