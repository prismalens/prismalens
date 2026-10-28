// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { randomBytes } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { CanonicalEvent, InvestigationContext } from "@prismalens/contracts/schemas";
import { runInvestigation } from "@prismalens/engine";
import { afterEach, describe, expect, it } from "vitest";
import { TelemetrySnapshotService } from "../../modules/integrations/telemetry-snapshot.service.js";
import { buildPreRunSnapshot, preRunContext, summaryOf, writeReadCopies } from "./pre-run-context.js";

const FAKE = join(
	dirname(fileURLToPath(import.meta.url)),
	"../../../../@prismalens/engine/src/run/__fixtures__/fake-acp-harness.mjs",
);
const RUN_ID = "22222222-2222-4222-8222-222222222222";

const cleanup: (() => void)[] = [];
afterEach(() => {
	for (const f of cleanup.splice(0)) f();
});

function tmp(name: string): string {
	const d = mkdtempSync(join(os.tmpdir(), `pl-${name}-`));
	cleanup.push(() => rmSync(d, { recursive: true, force: true }));
	return d;
}

function filesUnder(dir: string): string[] {
	return readdirSync(dir, { recursive: true, withFileTypes: true })
		.filter((e) => e.isFile())
		.map((e) => join(e.parentPath, e.name));
}

/** A Prometheus that echoes the request's Authorization header into every answer, the worst upstream there is. */
async function echoingPrometheus(seen: string[]): Promise<string> {
	const server: Server = createServer((req, res) => {
		const auth = req.headers.authorization ?? "";
		seen.push(auth);
		const body = req.url?.startsWith("/api/v1/alerts")
			? { data: { alerts: [{ labels: { alertname: "echo-marker-alert", auth }, annotations: { note: auth } }] } }
			: { data: { resultType: "vector", result: [{ metric: { job: "echo-marker-series", auth }, value: [1, auth] }] } };
		res.writeHead(200, { "content-type": "application/json" });
		res.end(JSON.stringify(body));
	});
	cleanup.push(() => {
		server.closeAllConnections();
		server.close();
	});
	await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
	return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

describe("a stored credential never reaches the agent's transcript or the run's files (#848)", () => {
	it("fetched with a stored bearer that the source echoes back, then read by the agent through a real run", async () => {
		const token = `pl-sentinel-${randomBytes(16).toString("hex")}`;
		const seen: string[] = [];
		const url = await echoingPrometheus(seen);
		const prisma = {
			connection: {
				findMany: async () => [{ id: "prom", label: "Prod Prometheus", integration: { templateId: "prometheus", label: "Prometheus" } }],
			},
		};
		const integrations = {
			connectionBaseUrl: async () => url,
			sourceCredential: async () => ({ ok: true, state: "set", credential: { kind: "bearer", token } }),
		};
		const window = { start: new Date(Date.now() - 3_600_000), end: new Date() };

		const telemetry = await new TelemetrySnapshotService(prisma as never, integrations as never).fetch(undefined, window);
		const snap = buildPreRunSnapshot({ window, telemetry: telemetry.sources, pastIncidents: [], runbooks: [], now: new Date() });
		const cwd = tmp("cred-clone");
		const runDir = tmp("cred-run");
		const copy = await writeReadCopies([{ dir: cwd }], RUN_ID, snap);
		const context: InvestigationContext = {
			alerts: [{ alertname: "HighLatency", severity: "critical", labels: { service: "checkout" }, annotations: {}, startsAt: null }],
			preRun: preRunContext(snap, { ok: true }, copy),
		};

		const events: CanonicalEvent[] = [];
		for await (const ev of runInvestigation({
			runId: RUN_ID,
			context,
			harness: "opencode",
			descriptor: {
				binary: process.execPath,
				acpArgs: () => [FAKE],
				acpEnv: () => ({}),
				configFiles: () => ({}),
			},
			cwd,
			runDir,
			env: { ...process.env, FAKE_ACP_MODE: "continue", FAKE_MODES: "build=Build", FAKE_READ_DIR: ".prismalens" },
			initTimeoutMs: 10_000,
			promptTimeoutMs: 10_000,
		}))
			events.push(ev);

		// The source got the credential and answered with it, and the agent read that answer.
		expect(seen).toContain(`Bearer ${token}`);
		expect(copy.state).toBe("written");
		const transcript = readFileSync(join(runDir, "transcript.jsonl"), "utf8");
		expect(transcript).toContain("echo-marker-series");
		expect(transcript).toContain('\\"kind\\":\\"read\\"');

		expect(transcript).not.toContain(token);
		for (const file of [...filesUnder(runDir), ...filesUnder(cwd)]) expect(readFileSync(file, "utf8"), file).not.toContain(token);
		expect(JSON.stringify(events)).not.toContain(token);
		expect(JSON.stringify(summaryOf(snap))).not.toContain(token);
	});
});
