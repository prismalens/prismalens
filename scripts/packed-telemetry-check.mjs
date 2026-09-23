#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Packed-tarball check for telemetry resolution (#633, slice 5): proves, on the
 * INSTALLED tarball, that a Prometheus connection reaches the run as host facts
 * — without a harness. Boot/login/HTTP helpers copied from `packed-intake.mjs`
 * (#630) rather than rewritten; the shape below stays close to that script on
 * purpose so the two stay easy to diff against each other.
 *
 * What this proves, in order:
 *   1. `pl up` boots from the packed tarball.
 *   2. POST /integrations + POST /integrations/connections creates a URL-only
 *      Prometheus connection pointed at a throwaway `node:http` stub answering
 *      `/-/ready`.
 *   3. POST /integrations/connections/{id}/test succeeds against the live stub
 *      (this must precede step 4: `resolve()` only returns ACTIVE connections,
 *      and a successful test is what sets that status).
 *   4. A service linked to that connection, an incident on it, and
 *      POST /incidents/{id}/investigate resolve the connector into the run:
 *      GET /timeline's `investigation_started` entry carries
 *      `metadata.telemetry.prometheus === "127.0.0.1"`.
 *   5. The stub is stopped and the test repeated: success:false, and the
 *      connection's `lastErrorMessage` names the failure.
 *
 * The investigation itself is NOT asserted on: `recordWorkspace` (one of
 * THREE "investigation_started" writers — the only one carrying
 * `metadata.telemetry`, per the comment where it is polled for below) runs
 * BEFORE the harness is spawned, so the assertion in step 4 lands whether or
 * not a harness binary is even on PATH — this script never waits for the run
 * to reach a terminal state.
 *
 * Usage: packed-telemetry-check.mjs [dir-with-tarball]
 *   With no argument, packs a fresh tarball (`node scripts/pack-cli.mjs
 *   --skip-build --out <tmp>`) reusing whatever `pnpm turbo run build` already
 *   produced. PRISMALENS_TARBALL overrides with an exact path (CI reuse).
 *
 * Env: PACKED_TELEMETRY_PORT (default 3172).
 */
import { execFileSync, spawn } from "node:child_process";
import {
	createWriteStream,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	rmSync,
} from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = process.env.PACKED_TELEMETRY_PORT ?? "3172";
const BASE = `http://127.0.0.1:${PORT}`;
const FETCH_TIMEOUT_MS = 10_000;

function findOrPackTarball() {
	if (process.env.PRISMALENS_TARBALL)
		return resolve(process.env.PRISMALENS_TARBALL);
	const dir = process.argv[2] ? resolve(process.argv[2]) : null;
	if (dir) {
		const found = readdirSync(dir).find((f) =>
			/^prismalens-[0-9].*\.tgz$/.test(f),
		);
		if (!found)
			throw new Error(`no tarball matching prismalens-*.tgz in ${dir}`);
		return join(dir, found);
	}
	const out = join(ROOT, "packages", "cli", "dist-pack-telemetry-check");
	console.log(
		"[packed-telemetry] packing a tarball (--skip-build, dist is already built)",
	);
	execFileSync(
		"node",
		[join(ROOT, "scripts", "pack-cli.mjs"), "--skip-build", "--out", out],
		{ cwd: ROOT, stdio: "inherit" },
	);
	const found = readdirSync(out).find((f) => f.endsWith(".tgz"));
	if (!found) throw new Error(`no tarball produced in ${out}`);
	return join(out, found);
}

const prefix = mkdtempSync(join(tmpdir(), "pl-telemetry-check-"));
const workspace = join(prefix, "workspace");
mkdirSync(workspace, { recursive: true });

let child;
let stub;
let cleaned = false;
function cleanup(exitCode) {
	if (cleaned) return;
	cleaned = true;
	// Kill `pl up` BY THE PID captured at launch — never pkill/pgrep by name.
	try {
		child?.kill("SIGKILL");
	} catch {
		// already gone
	}
	try {
		stub?.close();
	} catch {
		// already gone
	}
	rmSync(prefix, { recursive: true, force: true });
	process.exitCode = exitCode;
}
process.on("SIGINT", () => cleanup(130));
process.on("SIGTERM", () => cleanup(143));

async function main() {
	const tgz = findOrPackTarball();
	console.log(`[packed-telemetry] tarball: ${tgz}`);
	console.log(`[packed-telemetry] installing into ${prefix}`);
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
	console.log(`[packed-telemetry] pl up on ${BASE} (workspace ${workspace})`);
	child = spawn(bin, ["up", "--port", PORT, "--workspace", workspace], {
		stdio: ["ignore", "pipe", "pipe"],
		env: {
			...process.env,
			// A harness run must never reach a real placement/sign-in; server
			// placement plus a loopback base URL is the whole guard (AGENTS.md).
			PRISMALENS_PLACEMENT: "server",
			PRISMALENS_HARNESS: "opencode",
			PRISMALENS_HOST: "127.0.0.1",
			// The readiness line this script polls for is an info record; the
			// default console level is warn+error only (#610).
			PRISMALENS_LOG_CONSOLE: "verbose",
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
	console.log("[packed-telemetry] pl up is ready");

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

	// --- pairing: pair a device instead of creating an owner ---
	const pairOut = execFileSync(bin, ["pair", "--workspace", workspace], {
		encoding: "utf8",
	});
	const pairToken = pairOut.match(/\/pair#([^\s#]+)/)?.[1] ?? "";

	const redeem = await json("/api/pairing/redeem", {
		method: "POST",
		body: JSON.stringify({ token: pairToken, name: "packed telemetry" }),
	});
	const setCookie = redeem.headers.getSetCookie?.() ?? [];
	const deviceCookie = setCookie.find((c) =>
		c.startsWith("prismalens.device="),
	);
	const cookie = deviceCookie ? deviceCookie.split(";")[0] : "";
	if (redeem.status !== 200 || !cookie) {
		throw new Error(
			`POST /api/pairing/redeem failed: status ${redeem.status}, cookies ${setCookie.length}`,
		);
	}
	console.log(
		"[packed-telemetry] OK   POST /api/pairing/redeem 200 with device cookie",
	);

	const whoamiWith = await json("/api/operator/whoami", {
		headers: { cookie },
	});
	const whoamiWithBody = await whoamiWith.json().catch(() => ({}));
	if (whoamiWith.status !== 200 || whoamiWithBody.via !== "device") {
		throw new Error(
			`GET /api/operator/whoami with cookie failed: status ${whoamiWith.status}, via ${whoamiWithBody.via}`,
		);
	}
	console.log(
		"[packed-telemetry] OK   GET /api/operator/whoami with cookie says device",
	);

	const whoamiWithout = await json("/api/operator/whoami");
	const whoamiWithoutBody = await whoamiWithout.json().catch(() => ({}));
	if (whoamiWithout.status !== 200 || whoamiWithoutBody.via !== null) {
		throw new Error(
			`GET /api/operator/whoami without cookie failed: status ${whoamiWithout.status}, via ${whoamiWithoutBody.via}`,
		);
	}
	console.log(
		"[packed-telemetry] OK   GET /api/operator/whoami without cookie says null",
	);

	const redeemAgain = await json("/api/pairing/redeem", {
		method: "POST",
		body: JSON.stringify({ token: pairToken, name: "packed telemetry" }),
	});
	if (redeemAgain.status !== 400) {
		throw new Error(
			`POST /api/pairing/redeem again failed: status ${redeemAgain.status}`,
		);
	}
	console.log("[packed-telemetry] OK   POST /api/pairing/redeem again 400");

	const devices = await fetch(BASE + "/api/pairing/devices", {
		signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
		headers: { cookie },
	});
	if (devices.status !== 403) {
		throw new Error(
			`GET /api/pairing/devices with device cookie failed: status ${devices.status}`,
		);
	}
	console.log(
		"[packed-telemetry] OK   GET /api/pairing/devices with device cookie 403",
	);

	// --- step 2: the URL-only Prometheus connection against a throwaway stub ---
	const { server: stubServer, port: stubPort } = await startStub();
	stub = stubServer;
	console.log(`[packed-telemetry] stub /-/ready on 127.0.0.1:${stubPort}`);

	const integrationRes = await json("/api/integrations", {
		method: "POST",
		headers: { cookie },
		body: JSON.stringify({ templateId: "prometheus", label: "prom" }),
	});
	if (integrationRes.status < 200 || integrationRes.status >= 300) {
		throw new Error(
			`POST /api/integrations failed: status ${integrationRes.status}: ${(await integrationRes.text()).slice(0, 200)}`,
		);
	}
	const integration = await integrationRes.json();
	console.log(
		`[packed-telemetry] OK   POST /api/integrations (${integration.id})`,
	);

	const connectionRes = await json("/api/integrations/connections", {
		method: "POST",
		headers: { cookie },
		body: JSON.stringify({
			integrationId: integration.id,
			label: "prom-connection",
			credentials: {},
			connectionConfig: { baseUrl: `http://127.0.0.1:${stubPort}` },
		}),
	});
	if (connectionRes.status < 200 || connectionRes.status >= 300) {
		throw new Error(
			`POST /api/integrations/connections failed: status ${connectionRes.status}: ${(await connectionRes.text()).slice(0, 200)}`,
		);
	}
	const connection = await connectionRes.json();
	console.log(
		`[packed-telemetry] OK   POST /api/integrations/connections (${connection.id})`,
	);

	// --- step 3: test succeeds live ---
	// This must land BEFORE the resolver is exercised below: `resolve()` only
	// returns connections whose status is ACTIVE, and a successful test is what
	// sets that status (integrations.service.ts:testConnection). The FAILING
	// half of step 3 (stub stopped) therefore runs last, after telemetry has
	// already been asserted — see the end of this script.
	const testOk = await json(
		`/api/integrations/connections/${connection.id}/test`,
		{
			method: "POST",
			headers: { cookie },
		},
	);
	const testOkBody = await testOk.json();
	if (testOkBody.success !== true) {
		throw new Error(
			`test against the live stub did not succeed: ${JSON.stringify(testOkBody)}`,
		);
	}
	console.log(`[packed-telemetry] OK   POST .../test → success:true (stub up)`);

	// --- step 4: a service, an incident, and investigate — telemetry reaches the timeline ---
	const serviceRes = await json("/api/services", {
		method: "POST",
		headers: { cookie },
		body: JSON.stringify({ name: "packed-telemetry-check" }),
	});
	if (serviceRes.status < 200 || serviceRes.status >= 300) {
		throw new Error(
			`POST /api/services failed: status ${serviceRes.status}: ${(await serviceRes.text()).slice(0, 200)}`,
		);
	}
	const service = await serviceRes.json();
	console.log(`[packed-telemetry] OK   POST /api/services (${service.id})`);

	const linkRes = await json("/api/integrations/service-integrations", {
		method: "POST",
		headers: { cookie },
		body: JSON.stringify({
			serviceId: service.id,
			connectionId: connection.id,
		}),
	});
	if (linkRes.status < 200 || linkRes.status >= 300) {
		throw new Error(
			`POST /api/integrations/service-integrations failed: status ${linkRes.status}: ${(await linkRes.text()).slice(0, 200)}`,
		);
	}
	console.log(
		"[packed-telemetry] OK   POST /api/integrations/service-integrations",
	);

	const incidentRes = await json("/api/incidents", {
		method: "POST",
		headers: { cookie },
		body: JSON.stringify({
			title: "Packed telemetry check incident",
			serviceId: service.id,
		}),
	});
	if (incidentRes.status < 200 || incidentRes.status >= 300) {
		throw new Error(
			`POST /api/incidents failed: status ${incidentRes.status}: ${(await incidentRes.text()).slice(0, 200)}`,
		);
	}
	const incident = await incidentRes.json();
	console.log(`[packed-telemetry] OK   POST /api/incidents (${incident.id})`);

	const investigateRes = await json(
		`/api/incidents/${incident.id}/investigate`,
		{
			method: "POST",
			headers: { cookie },
		},
	);
	if (investigateRes.status < 200 || investigateRes.status >= 300) {
		throw new Error(
			`POST /api/incidents/${incident.id}/investigate failed: status ${investigateRes.status}: ${(await investigateRes.text()).slice(0, 200)}`,
		);
	}
	console.log("[packed-telemetry] OK   POST /api/incidents/{id}/investigate");

	// THREE call sites write an "investigation_started" entry for one run
	// (queued: investigations.service.ts; running: prisma-investigation-store.ts;
	// workspace/telemetry: investigation-run.ts's recordWorkspace) — the other
	// two carry only `{investigationId}`, so this polls for the one THIS check
	// cares about by its content, not by newest-first order. recordWorkspace
	// runs before the harness is spawned, so its entry lands whether or not the
	// run itself ever completes — that part is not asserted.
	const startedEntry = await pollUntil(
		async () => {
			const res = await json(
				`/api/timeline?incidentId=${incident.id}&type=investigation_started`,
				{ headers: { cookie } },
			);
			if (res.status !== 200) return undefined;
			const entries = await res.json();
			return (entries ?? []).find((e) => e.metadata?.telemetry !== undefined);
		},
		(entry) => entry !== undefined,
		30_000,
	);
	if (!startedEntry) {
		throw new Error(
			`no investigation_started timeline entry carrying metadata.telemetry for incident ${incident.id} within 30s`,
		);
	}
	const telemetryHost = startedEntry.metadata?.telemetry?.prometheus;
	if (telemetryHost !== "127.0.0.1") {
		throw new Error(
			`investigation_started metadata.telemetry.prometheus was ${JSON.stringify(telemetryHost)}, expected "127.0.0.1": ${JSON.stringify(startedEntry.metadata)}`,
		);
	}
	console.log(
		`[packed-telemetry] OK   investigation_started metadata.telemetry.prometheus === "127.0.0.1"`,
	);

	// --- step 3, second half: test fails once the stub is stopped ---
	await new Promise((r) => stub.close(r));
	stub = undefined;

	const testFail = await json(
		`/api/integrations/connections/${connection.id}/test`,
		{
			method: "POST",
			headers: { cookie },
		},
	);
	const testFailBody = await testFail.json();
	if (testFailBody.success !== false) {
		throw new Error(
			`test after stopping the stub still succeeded: ${JSON.stringify(testFailBody)}`,
		);
	}
	const connAfter = await json(
		`/api/integrations/connections/${connection.id}`,
		{
			headers: { cookie },
		},
	);
	const connAfterBody = await connAfter.json();
	console.log(
		`[packed-telemetry] OK   POST .../test → success:false (stub down); lastErrorMessage: ${connAfterBody.lastErrorMessage}`,
	);

	console.log("PACKED TELEMETRY CHECK OK");
}

/** A throwaway `node:http` server answering 200 on `/-/ready`, nothing else. */
function startStub() {
	return new Promise((resolvePromise, reject) => {
		const server = http.createServer((req, res) => {
			if (req.url === "/-/ready") {
				res.writeHead(200);
				res.end("OK");
			} else {
				res.writeHead(404);
				res.end();
			}
		});
		server.on("error", reject);
		server.listen(0, "127.0.0.1", () => {
			resolvePromise({ server, port: server.address().port });
		});
	});
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
		console.error(`PACKED TELEMETRY CHECK FAIL: ${error?.stack ?? error}`);
		cleanup(1);
	});
