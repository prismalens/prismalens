#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Packed intake e2e (#630, Unit F on the 2026-09-13 gap study on #337): does a
 * real alert source reach an incident end to end, on the INSTALLED tarball?
 * `packed-smoke.sh` proves the tarball boots; this proves the one thing it
 * does not — a webhook delivery becomes an open incident, and a resolution
 * closes it. No investigation run, no model call, no harness required.
 *
 * Boots `pl up` in a fresh workspace from the packed artifact, reads the
 * generated webhook token (`<workspace>/PRISMALENS_WEBHOOK_SECRET_FILE`,
 * #627), signs in as the owner, POSTs a Prometheus firing payload with a
 * bearer token, asserts an open incident carries that alert's fingerprint,
 * POSTs the resolved payload, asserts the incident resolves.
 *
 * With PACKED_INTAKE_REPO=<git checkout> and a harness on PATH it goes one step
 * further: the alert carries a `service` label naming a service mapped to that
 * checkout, and the script asserts the app started an investigation on its own
 * and completed it with a report whose cited paths exist. No human creates an
 * incident or presses Investigate (the unattended gate, prismalens#337).
 *
 * Usage: packed-intake.mjs <dir-with-tarball>
 *   The dir must hold the single published tarball from
 *   `node scripts/pack-cli.mjs` — the SAME artifact packed-smoke verifies.
 *   PRISMALENS_TARBALL overrides with an exact path (CI reuse).
 *
 * Env: PACKED_INTAKE_PORT (default 3102). PACKED_INTAKE_REPO (optional, see
 * above); PRISMALENS_HARNESS_MODEL (optional, the model id set on the harness).
 */
import { execFileSync, spawn } from "node:child_process";
import {
	createWriteStream,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";

const PORT = process.env.PACKED_INTAKE_PORT ?? "3102";
const BASE = `http://127.0.0.1:${PORT}`;
const FETCH_TIMEOUT_MS = 10_000;
const REPO = process.env.PACKED_INTAKE_REPO
	? resolve(process.env.PACKED_INTAKE_REPO)
	: null;
const SERVICE_NAME = "packed-intake";
const EMAIL = "intake@prismalens.test";
const PASSWORD = "packed-intake-12345";

function findTarball() {
	if (process.env.PRISMALENS_TARBALL)
		return resolve(process.env.PRISMALENS_TARBALL);
	const dir = process.argv[2];
	if (!dir) {
		throw new Error(
			"usage: packed-intake.mjs <dir-with-tarball> (or set PRISMALENS_TARBALL)",
		);
	}
	const tarballsDir = resolve(dir);
	const found = readdirSync(tarballsDir).find((f) =>
		/^prismalens-[0-9].*\.tgz$/.test(f),
	);
	if (!found)
		throw new Error(`no tarball matching prismalens-*.tgz in ${tarballsDir}`);
	return join(tarballsDir, found);
}

const prefix = mkdtempSync(join(tmpdir(), "pl-intake-"));
const workspace = join(prefix, "workspace");
mkdirSync(workspace, { recursive: true });

let child;
let cleaned = false;
function cleanup(exitCode) {
	if (cleaned) return;
	cleaned = true;
	try {
		child?.kill("SIGKILL");
	} catch {
		// already gone
	}
	rmSync(prefix, { recursive: true, force: true });
	process.exitCode = exitCode;
}
process.on("SIGINT", () => cleanup(130));
process.on("SIGTERM", () => cleanup(143));

async function main() {
	const tgz = findTarball();
	console.log(`[packed-intake] tarball: ${tgz}`);
	console.log(`[packed-intake] installing into ${prefix}`);
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
	if (!existsSync(bin)) throw new Error(`pl bin not linked at ${bin}`);

	const logPath = join(prefix, "up.log");
	const logStream = createWriteStream(logPath);
	let bootLog = "";
	console.log(`[packed-intake] pl up on ${BASE} (workspace ${workspace})`);
	child = spawn(bin, ["up"], {
		stdio: ["ignore", "pipe", "pipe"],
		env: {
			...process.env,
			PRISMALENS_WORKSPACE_DIR: workspace,
			// The default (quiet) console level sends info records to the log
			// file only (#610) — the readiness line this script polls for is
			// one of them, so without this the wait times out on a server that
			// already booted (see packed-smoke.sh's UP_LOG for the same fix).
			PRISMALENS_LOG_CONSOLE: "verbose",
			PRISMALENS_HOST: "127.0.0.1",
			PRISMALENS_PORT: PORT,
		},
	});
	child.stdout.on("data", (d) => {
		bootLog += d;
		logStream.write(d);
	});
	child.stderr.on("data", (d) => {
		bootLog += d;
		logStream.write(d);
	});

	const booted = await waitForLog(
		() => bootLog,
		/PrismaLens API running/,
		120_000,
	);
	if (!booted) {
		console.error("----- boot log -----");
		console.error(bootLog.slice(-4000));
		throw new Error("pl up did not report ready within 120s");
	}
	console.log("[packed-intake] pl up is ready");

	const tokenFile = join(workspace, "PRISMALENS_WEBHOOK_SECRET_FILE");
	if (!existsSync(tokenFile)) {
		throw new Error(`${tokenFile} does not exist after boot`);
	}
	const token = readFileSync(tokenFile, "utf8").trim();
	console.log(`[packed-intake] read webhook token from ${tokenFile}`);

	const json = (path, init) =>
		fetch(BASE + path, {
			signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
			...init,
			headers: {
				"content-type": "application/json",
				origin: BASE,
				...(init?.headers ?? {}),
			},
		});

	// --- first-run: create the owner, then sign in (same shape as packed-smoke.sh) ---
	const setup = await json("/api/setup", {
		method: "POST",
		body: JSON.stringify({
			email: EMAIL,
			password: PASSWORD,
			name: "Packed Intake",
		}),
	});
	if (setup.status < 200 || setup.status >= 300) {
		throw new Error(
			`POST /api/setup failed: status ${setup.status}: ${(await setup.text()).slice(0, 200)}`,
		);
	}
	console.log("[packed-intake] OK   POST /api/setup");

	const signIn = await json("/api/auth/sign-in/email", {
		method: "POST",
		body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
	});
	const setCookie = signIn.headers.getSetCookie?.() ?? [];
	if (signIn.status !== 200 || setCookie.length === 0) {
		throw new Error(
			`sign-in failed: status ${signIn.status}, cookies ${setCookie.length}`,
		);
	}
	const cookie = setCookie.map((c) => c.split(";")[0]).join("; ");
	console.log("[packed-intake] OK   POST /api/auth/sign-in/email");

	if (REPO) await mapRepository(json, cookie);

	// --- the firing delivery ---------------------------------------------------
	const fingerprint = `packed-intake-${Date.now()}`;
	const nowIso = new Date().toISOString();
	const firing = {
		status: "firing",
		alerts: [
			{
				status: "firing",
				labels: {
					alertname: "PackedIntakeProbe",
					severity: "critical",
					...(REPO ? { service: SERVICE_NAME } : {}),
				},
				annotations: {
					summary: "Synthetic alert for the packed intake e2e",
					...(REPO
						? {
								description:
									"POST /api/webhooks/prometheus answers 500 when the bearer token file under the workspace is empty. Find the cause.",
							}
						: {}),
				},
				startsAt: nowIso,
				fingerprint,
			},
		],
	};
	const firingRes = await fetch(BASE + "/api/webhooks/prometheus", {
		signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
		method: "POST",
		headers: {
			"content-type": "application/json",
			origin: BASE,
			authorization: `Bearer ${token}`,
		},
		body: JSON.stringify(firing),
	});
	if (firingRes.status < 200 || firingRes.status >= 300) {
		throw new Error(
			`POST /api/webhooks/prometheus (firing) failed: status ${firingRes.status}: ${(await firingRes.text()).slice(0, 200)}`,
		);
	}
	console.log("[packed-intake] OK   POST /api/webhooks/prometheus (firing)");

	const openIncident = await findIncidentByFingerprint(
		json,
		cookie,
		fingerprint,
		{
			requireOpen: true,
		},
	);
	if (!openIncident) {
		throw new Error(
			`no open incident with an alert fingerprint ${fingerprint} after the firing delivery`,
		);
	}
	console.log(
		`[packed-intake] OK   open incident #${openIncident.number} carries the alert`,
	);

	if (REPO) await assertUnattendedInvestigation(json, cookie, openIncident);

	// --- the resolved delivery --------------------------------------------------
	const resolved = {
		status: "resolved",
		alerts: [
			{
				status: "resolved",
				labels: { alertname: "PackedIntakeProbe", severity: "critical" },
				annotations: { summary: "Synthetic alert for the packed intake e2e" },
				startsAt: nowIso,
				endsAt: new Date().toISOString(),
				fingerprint,
			},
		],
	};
	const resolvedRes = await fetch(BASE + "/api/webhooks/prometheus", {
		signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
		method: "POST",
		headers: {
			"content-type": "application/json",
			origin: BASE,
			authorization: `Bearer ${token}`,
		},
		body: JSON.stringify(resolved),
	});
	if (resolvedRes.status < 200 || resolvedRes.status >= 300) {
		throw new Error(
			`POST /api/webhooks/prometheus (resolved) failed: status ${resolvedRes.status}: ${(await resolvedRes.text()).slice(0, 200)}`,
		);
	}
	console.log("[packed-intake] OK   POST /api/webhooks/prometheus (resolved)");

	const closedIncident = await pollUntil(
		() =>
			findIncidentByFingerprint(json, cookie, fingerprint, {
				requireOpen: false,
			}),
		(incident) =>
			incident?.status === "resolved" || incident?.status === "closed",
		15_000,
	);
	if (!closedIncident) {
		throw new Error(
			`incident with fingerprint ${fingerprint} did not resolve within 15s of the resolved delivery`,
		);
	}
	console.log(
		`[packed-intake] OK   incident #${closedIncident.number} resolved (status=${closedIncident.status})`,
	);

	console.log("PACKED INTAKE OK");
}

/** A service named by the alert's `service` label, pointed at REPO. */
async function mapRepository(json, cookie) {
	const model = process.env.PRISMALENS_HARNESS_MODEL;
	if (model) {
		const res = await json("/api/settings/harness", {
			method: "PATCH",
			headers: { cookie },
			body: JSON.stringify({ harness: "auto", model }),
		});
		if (res.status !== 200) {
			throw new Error(
				`PATCH /api/settings/harness failed: status ${res.status}: ${(await res.text()).slice(0, 200)}`,
			);
		}
		console.log(
			`[packed-intake] OK   PATCH /api/settings/harness model=${model}`,
		);
	}

	const serviceRes = await json("/api/services", {
		method: "POST",
		headers: { cookie },
		body: JSON.stringify({ name: SERVICE_NAME }),
	});
	if (serviceRes.status < 200 || serviceRes.status >= 300) {
		throw new Error(
			`POST /api/services failed: status ${serviceRes.status}: ${(await serviceRes.text()).slice(0, 200)}`,
		);
	}
	const service = await serviceRes.json();
	console.log(`[packed-intake] OK   POST /api/services (${service.id})`);

	const repoRes = await json("/api/repositories/source", {
		method: "POST",
		headers: { cookie },
		body: JSON.stringify({ serviceId: service.id, source: REPO }),
	});
	if (repoRes.status < 200 || repoRes.status >= 300) {
		throw new Error(
			`POST /api/repositories/source failed: status ${repoRes.status}: ${(await repoRes.text()).slice(0, 200)}`,
		);
	}
	console.log(`[packed-intake] OK   POST /api/repositories/source (${REPO})`);
}

/**
 * The app must start an investigation for the incident by itself and finish it
 * with a report. Every path the report cites must exist in REPO.
 */
async function assertUnattendedInvestigation(json, cookie, incident) {
	const investigation = await pollUntil(
		async () => {
			const res = await json("/api/investigations?limit=50", {
				headers: { cookie },
			});
			if (res.status !== 200) return undefined;
			const body = await res.json();
			return (body.data ?? []).find((inv) => inv.incidentId === incident.id);
		},
		(inv) => inv !== undefined,
		60_000,
	);
	if (!investigation) {
		throw new Error(
			`no investigation was started for incident #${incident.number} within 60s of the alert`,
		);
	}
	console.log(
		`[packed-intake] OK   investigation ${investigation.id} started on its own`,
	);

	const finished = await pollUntil(
		async () => {
			const res = await json(`/api/investigations/${investigation.id}`, {
				headers: { cookie },
			});
			if (res.status !== 200) return undefined;
			const body = await res.json();
			return body.investigation ?? body;
		},
		(inv) => inv !== undefined && !["pending", "running"].includes(inv.status),
		600_000,
	);
	if (!finished) {
		throw new Error(
			`investigation ${investigation.id} did not reach a terminal state within 10 minutes`,
		);
	}
	if (finished.status !== "completed" || !finished.report) {
		throw new Error(
			`investigation ${investigation.id} ended ${finished.status} without a report: ${finished.error ?? ""}`,
		);
	}
	const hypotheses = finished.report.hypotheses ?? [];
	if (hypotheses.length === 0) {
		throw new Error(
			`investigation ${investigation.id} completed with no hypothesis`,
		);
	}
	const cited = new Set();
	for (const h of hypotheses) {
		for (const e of h.evidence ?? []) {
			for (const p of citedPaths(e.source ?? "")) cited.add(p);
		}
	}
	if (cited.size === 0) {
		throw new Error(
			`report for investigation ${investigation.id} cites no file path in any evidence source`,
		);
	}
	// A path counts only inside REPO: an absolute path or a `..` escape is
	// "missing" however real the file it names.
	const root = resolve(REPO) + sep;
	const missing = [...cited].filter((p) => {
		const abs = resolve(REPO, p);
		return !abs.startsWith(root) || !existsSync(abs);
	});
	if (missing.length > 0) {
		throw new Error(
			`report cites paths that do not exist in ${REPO}: ${missing.join(", ")}`,
		);
	}
	console.log(
		`[packed-intake] OK   report: ${hypotheses.length} hypothesis(es), ${cited.size} cited path(s) all present`,
	);
}

/**
 * Repo-relative or absolute file paths inside an evidence source, which is a
 * command or origin string ("cat config/db.yaml", "promql/engine.go:4880-4890",
 * "git show 03b0db54 -- server/models/hotlink.js"). A path needs a directory
 * part and an extension; a bare "hotlink.js" or "e.g." is not one, and a URL
 * is skipped.
 */
function citedPaths(source) {
	const paths = [];
	for (const raw of source.split(/[\s"'`()[\]{},;]+/)) {
		if (!raw || raw.includes("://")) continue;
		const token = raw.replace(/^\.\//, "").replace(/[.:]+$/, "");
		const m =
			/^(\/?(?:[\w.-]+\/)+[\w.-]+\.[A-Za-z0-9]{1,8})(?::\d+(?:-\d+)?)?$/.exec(
				token,
			);
		if (m) paths.push(m[1]);
	}
	return paths;
}

/** Poll the incident list for the one whose alerts carry `fingerprint` (Alert.externalId, not the internal dedup Alert.fingerprint). */
async function findIncidentByFingerprint(
	json,
	cookie,
	fingerprint,
	{ requireOpen },
) {
	return pollUntil(
		async () => {
			const res = await json("/api/incidents?limit=50", {
				headers: { cookie },
			});
			if (res.status !== 200) return undefined;
			const body = await res.json();
			const incidents = body.data ?? [];
			return incidents.find((incident) =>
				(incident.alerts ?? []).some(
					(alert) => alert.externalId === fingerprint,
				),
			);
		},
		(incident) =>
			incident !== undefined &&
			(!requireOpen || !["resolved", "closed"].includes(incident.status)),
		15_000,
	);
}

async function pollUntil(read, satisfies, timeoutMs) {
	const start = Date.now();
	for (;;) {
		const value = await read();
		if (satisfies(value)) return value;
		if (Date.now() - start >= timeoutMs) return undefined;
		await new Promise((r) => setTimeout(r, 500));
	}
}

async function waitForLog(readLog, pattern, timeoutMs) {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		if (pattern.test(readLog())) return true;
		if (child?.exitCode !== null && child?.exitCode !== undefined) return false;
		await new Promise((r) => setTimeout(r, 300));
	}
	return false;
}

main()
	.then(() => cleanup(0))
	.catch((error) => {
		console.error(`INTAKE FAIL: ${error?.stack ?? error}`);
		cleanup(1);
	});
