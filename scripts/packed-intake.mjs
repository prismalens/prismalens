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
 * Usage: packed-intake.mjs <dir-with-tarball>
 *   The dir must hold the single published tarball from
 *   `node scripts/pack-cli.mjs` — the SAME artifact packed-smoke verifies.
 *   PRISMALENS_TARBALL overrides with an exact path (CI reuse).
 *
 * Env: PACKED_INTAKE_PORT (default 3102).
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
import { join, resolve } from "node:path";

const PORT = process.env.PACKED_INTAKE_PORT ?? "3102";
const BASE = `http://127.0.0.1:${PORT}`;
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
			NODE_ENV: "production",
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

	// --- the firing delivery ---------------------------------------------------
	const fingerprint = `packed-intake-${Date.now()}`;
	const nowIso = new Date().toISOString();
	const firing = {
		status: "firing",
		alerts: [
			{
				status: "firing",
				labels: { alertname: "PackedIntakeProbe", severity: "critical" },
				annotations: { summary: "Synthetic alert for the packed intake e2e" },
				startsAt: nowIso,
				fingerprint,
			},
		],
	};
	const firingRes = await fetch(BASE + "/api/webhooks/prometheus", {
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
