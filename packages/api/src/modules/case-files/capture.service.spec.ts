// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/** The capture queue and runner over a migrated SQLite database and a fake kubectl on PATH. */
import { randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { EventEmitter2 } from "@nestjs/event-emitter";
import { TokenVault } from "@prismalens/integrations";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { CredentialsService } from "../integrations/crypto/credentials.service.js";

const env = await vi.hoisted(async () => {
	const fs = await import("node:fs");
	const os = await import("node:os");
	const path = await import("node:path");
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "pl-case-capture-"));
	process.env.PRISMALENS_WORKSPACE_DIR = path.join(root, "data");
	return { root };
});

const { PrismaService } = await import("../../core/prisma/prisma.service.js");
const { ArtifactStore } = await import("./storage/artifact-store.js");
const { ManifestService } = await import("./storage/manifest.js");
const { CaseFileSettingsService } = await import("./case-file-settings.service.js");
const { CaseBuilder } = await import("./case-builder.js");
const {
	CaptureService,
	CASE_CAPTURE_UPDATED_EVENT,
	priorityFor,
	ranksAbove,
	worstReason,
} = await import("./capture.service.js");

const CONTEXT = "kind-pl";
const SERVER = "https://127.0.0.1:6443";
const binDir = join(env.root, "bin");
const argvLog = join(binDir, "kubectl.argv.log");
const sleepFile = join(binDir, "sleep_ms");
const serverFile = join(binDir, "server_url");
const modeFile = join(binDir, "mode");
const releaseFile = join(binDir, "release");

/** Answers checklist commands from canned JSON and records all executed arguments. */
function installFakeKubectl(): void {
	mkdirSync(binDir, { recursive: true });
	const pods = {
		items: [
			{
				metadata: { name: "checkout-7d9f", namespace: "shop", uid: "p1" },
				status: {
					phase: "Running",
					containerStatuses: [
						{
							name: "app",
							restartCount: 3,
							lastState: {
								terminated: { reason: "OOMKilled", exitCode: 137, finishedAt: "2026-10-15T09:58:00Z" },
							},
						},
					],
				},
			},
		],
	};
	const script = `#!${process.execPath}
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(argvLog)}, JSON.stringify(args) + "\\n");

const sFile = ${JSON.stringify(sleepFile)};
if (fs.existsSync(sFile)) {
	const ms = parseInt(fs.readFileSync(sFile, "utf8").trim(), 10);
	if (ms > 0) {
		const end = Date.now() + ms;
		while (Date.now() < end) {}
	}
}

let serverUrl = ${JSON.stringify(SERVER)};
const srvFile = ${JSON.stringify(serverFile)};
if (fs.existsSync(srvFile)) {
	serverUrl = fs.readFileSync(srvFile, "utf8").trim();
}

let mode = "";
const mFile = ${JSON.stringify(modeFile)};
if (fs.existsSync(mFile)) {
	mode = fs.readFileSync(mFile, "utf8").trim();
}

const relFile = ${JSON.stringify(releaseFile)};
if ((mode === "hang-first" || mode === "hang-max" || mode === "hang-deadline") && args[0] === "get" && args[1] === "events") {
	const end = Date.now() + 5000;
	while (!fs.existsSync(relFile) && Date.now() < end) {}
}

if (mode === "sleep-listener" && args[0] === "config") {
	const end = Date.now() + 2000;
	while (Date.now() < end) {}
}

if (mode === "context-missing" && args[0] === "config") {
	process.stderr.write("error: context kind-pl does not exist\\n");
	process.exit(1);
}
if (mode === "unreachable" && args[0] === "get") {
	process.stderr.write("unable to connect to server: connection refused\\n");
	process.exit(1);
}
if (mode === "unclassified-error" && args[0] === "get") {
	process.stderr.write("something mysterious failed\\n");
	process.exit(1);
}
if (mode === "byte-cap" && args[0] === "logs") {
	fs.writeSync(1, "x".repeat(1024 * 1024));
	process.exit(0);
}
if (mode === "invalid-deployments-json" && args[0] === "get" && args[1] === "deployments") {
	process.stdout.write("not-json {{{");
	process.exit(0);
}
if (mode === "corrupt-pods" && args[0] === "get" && args[1] === "pods") {
	process.stdout.write("corrupt json {");
	process.exit(0);
}

let podsData = ${JSON.stringify(pods)};
if (mode === "invalid-pod-name") {
	podsData = {
		items: [
			{
				metadata: { name: "INVALID_POD_NAME", namespace: "shop", uid: "p1" },
				status: {
					phase: "Running",
					containerStatuses: [
						{
							name: "INVALID_CONTAINER",
							restartCount: 3,
							lastState: {
								terminated: { reason: "OOMKilled", exitCode: 137, finishedAt: "2026-10-15T09:58:00Z" },
							},
						},
					],
				},
			},
		],
	};
}

const out = (v) => process.stdout.write(typeof v === "string" ? v : JSON.stringify(v));
if (args[0] === "config") out({ contexts: [{ name: ${JSON.stringify(CONTEXT)}, context: { cluster: "kind", user: "admin", namespace: "shop" } }], clusters: [{ name: "kind", cluster: { server: serverUrl } }] });
else if (args[0] === "auth") { process.stderr.write("unknown command"); process.exit(1); }
else if (args[0] === "logs") out("2026-10-15T09:57:59Z OOM DB_PASSWORD=hunter2\\n");
else if (args[1] === "pods") out(JSON.stringify(podsData));
else out({ items: [] });
`;
	writeFileSync(join(binDir, "kubectl"), script);
	chmodSync(join(binDir, "kubectl"), 0o755);
}

describe("CaptureService", () => {
	let prisma: InstanceType<typeof PrismaService>;
	let settings: InstanceType<typeof CaseFileSettingsService>;
	let service: InstanceType<typeof CaptureService>;
	let store: InstanceType<typeof ArtifactStore>;
	let manifest: InstanceType<typeof ManifestService>;
	const emit = vi.fn();
	let incidentNumber = 0;

	async function boundIncident(serviceName: string, severity = "critical", namespace = serviceName) {
		const svc = await prisma.service.upsert({
			where: { name: serviceName },
			update: {},
			create: { name: serviceName },
		});
		const binding = await prisma.serviceBinding.upsert({
			where: { serviceId: svc.id },
			update: { namespace },
			create: {
				serviceId: svc.id,
				kubeContext: CONTEXT,
				cluster: SERVER,
				namespace,
				detected: "{}",
				confirmedAt: new Date(),
			},
		});
		incidentNumber += 1;
		const incident = await prisma.incident.create({
			data: { number: incidentNumber, title: "checkout down", severity, serviceId: svc.id },
		});
		const alert = await prisma.alert.create({
			data: { title: "checkout down", source: "test", fingerprint: `fp-${incidentNumber}`, dedupKey: `fp-${incidentNumber}`, incidentId: incident.id },
		});
		return { svc, binding, incident, alert };
	}

	beforeAll(async () => {
		installFakeKubectl();
		process.env.PATH = `${binDir}:${process.env.PATH ?? ""}`;
		const { resolveMigrationsDir, runMigrations } = await import("@prismalens/database/migrator");
		await runMigrations({ migrationsDir: resolveMigrationsDir(), log: () => {} });
		prisma = new PrismaService();
		await prisma.$connect();
		const vault = new TokenVault(randomBytes(32));
		store = new ArtifactStore(prisma, { getVault: () => vault } as unknown as CredentialsService);
		manifest = new ManifestService(prisma, store);
		settings = new CaseFileSettingsService(prisma);
		service = new CaptureService(
			prisma,
			settings,
			store,
			manifest,
			new CaseBuilder(store),
			{ emit } as unknown as EventEmitter2,
		);
	});

	beforeEach(async () => {
		(service as unknown as { stopping: boolean }).stopping = false;
		await settings.set(true);
		rmSync(sleepFile, { force: true });
		rmSync(serverFile, { force: true });
		rmSync(modeFile, { force: true });
		rmSync(releaseFile, { force: true });
	});

	afterEach(async () => {
		rmSync(sleepFile, { force: true });
		rmSync(serverFile, { force: true });
		rmSync(modeFile, { force: true });
		rmSync(releaseFile, { force: true });
		await service.settle();
		await prisma.claimRevision.deleteMany();
		await prisma.manifestEntry.deleteMany();
		await prisma.captureArtifact.deleteMany();
		await prisma.caseCapture.deleteMany();
		await prisma.capture.deleteMany();
	});

	afterAll(async () => {
		await service?.onModuleDestroy();
		await prisma?.$disconnect();
		rmSync(env.root, { recursive: true, force: true });
	});

	it("adds no row while the setting is off, or for an alert joining an open incident", async () => {
		await settings.set(false);
		const { incident, alert } = await boundIncident("svc-off", "critical", "ns-off");
		await service.handleAlertCorrelated({ alertId: alert.id, incidentId: incident.id, isNewIncident: true });
		await settings.set(true);
		await service.handleAlertCorrelated({ alertId: alert.id, incidentId: incident.id, isNewIncident: false });
		expect(await prisma.caseCapture.count({ where: { incidentId: incident.id } })).toBe(0);
	});

	it("queues from the listener without running kubectl, shares a queued capture, then completes it", async () => {
		const tick = vi.spyOn(service, "tick").mockResolvedValue();
		const first = await boundIncident("svc-on", "critical", "ns-on");
		const second = await boundIncident("svc-on-2", "low", "ns-on");
		rmSync(argvLog, { force: true });

		await service.handleAlertCorrelated({ alertId: first.alert.id, incidentId: first.incident.id, isNewIncident: true });
		await service.handleAlertCorrelated({ alertId: second.alert.id, incidentId: second.incident.id, isNewIncident: true });
		const links = await prisma.caseCapture.findMany({ orderBy: { createdAt: "asc" } , where: { incidentId: { in: [first.incident.id, second.incident.id] } } });
		expect(links.map((l) => l.shared)).toEqual([false, true]);
		expect(new Set(links.map((l) => l.captureId)).size).toBe(1);
		const captureId = links[0]?.captureId ?? "";
		expect(await prisma.capture.findUnique({ where: { id: captureId } })).toMatchObject({ state: "queued", priority: 1 });
		expect(() => readFileSync(argvLog)).toThrow();

		tick.mockRestore();
		await service.tick();
		await service.settle();

		const capture = await prisma.capture.findUniqueOrThrow({ where: { id: captureId }, include: { artifacts: { orderBy: { seq: "asc" } } } });
		expect(capture).toMatchObject({ state: "complete", stateReason: null, attempts: 1, identityMatches: true });
		expect(capture.artifacts.map((a) => a.purpose)).toEqual(["events", "deployments", "replicasets", "pods", "logs-previous"]);
		expect(capture.artifacts[4]).toMatchObject({ subject: "checkout-7d9f/app", retrieval: "complete" });
		expect(await manifest.verify([captureId])).toEqual({ ok: true, entries: 6, expired: 0 });
		const logs = await store.readRedacted(capture.artifacts[4] ?? { captureId, seq: 5, expiredAt: null }, 4096);
		expect(logs?.text).not.toContain("hunter2");
		expect(emit).toHaveBeenCalledWith(CASE_CAPTURE_UPDATED_EVENT, { captureId });
	});

	it("adds a capture when an existing incident is reopened", async () => {
		const { incident, alert } = await boundIncident("svc-reopen", "critical", "ns-reopen");
		await service.handleAlertCorrelated({
			alertId: alert.id,
			incidentId: incident.id,
			isNewIncident: false,
			reopened: true,
		});
		const links = await prisma.caseCapture.findMany({
			where: { incidentId: incident.id },
		});
		expect(links).toHaveLength(1);
	});

	it("adds no row for an unbound service", async () => {
		const svc = await prisma.service.create({ data: { name: "svc-unbound" } });
		incidentNumber += 1;
		const incident = await prisma.incident.create({
			data: { number: incidentNumber, title: "unbound down", severity: "high", serviceId: svc.id },
		});
		const alert = await prisma.alert.create({
			data: { title: "unbound down", source: "test", fingerprint: `fp-${incidentNumber}`, dedupKey: `fp-${incidentNumber}`, incidentId: incident.id },
		});
		await service.handleAlertCorrelated({
			alertId: alert.id,
			incidentId: incident.id,
			isNewIncident: true,
		});
		expect(await prisma.caseCapture.count({ where: { incidentId: incident.id } })).toBe(0);
		expect(await service.captureNow(incident.id)).toBeNull();
	});

	it("creates a second capture when an alert arrives while the first capture is running", async () => {
		const first = await boundIncident("svc-running-2", "critical", "ns-running-2");
		writeFileSync(modeFile, "hang-first");

		await service.handleAlertCorrelated({
			alertId: first.alert.id,
			incidentId: first.incident.id,
			isNewIncident: true,
		});
		for (let i = 0; i < 50; i++) {
			const running = await prisma.capture.count({ where: { state: "running" } });
			if (running > 0) break;
			await new Promise((r) => setTimeout(r, 20));
		}
		expect(await prisma.capture.count({ where: { state: "running" } })).toBe(1);

		incidentNumber += 1;
		const incident2 = await prisma.incident.create({
			data: { number: incidentNumber, title: "second down", severity: "critical", serviceId: first.svc.id },
		});
		const alert2 = await prisma.alert.create({
			data: { title: "second down", source: "test", fingerprint: `fp-${incidentNumber}`, dedupKey: `fp-${incidentNumber}`, incidentId: incident2.id },
		});
		await service.handleAlertCorrelated({
			alertId: alert2.id,
			incidentId: incident2.id,
			isNewIncident: true,
		});

		writeFileSync(releaseFile, "");
		await service.settle();

		await service.tick();
		await service.settle();

		const captures = await prisma.capture.findMany({
			where: { bindingId: first.binding.id },
		});
		expect(captures).toHaveLength(2);
	});

	it("handles queue overflow for both higher-priority and lower-priority newcomers", async () => {
		const tickSpy = vi.spyOn(service, "tick").mockResolvedValue();

		const baseDate = new Date("2026-10-15T10:00:00Z");
		for (let i = 0; i < 16; i++) {
			const svcName = `svc-q-${i}`;
			const svc = await prisma.service.create({ data: { name: svcName } });
			await prisma.serviceBinding.create({
				data: {
					serviceId: svc.id,
					kubeContext: CONTEXT,
					cluster: SERVER,
					namespace: `ns-q-${i}`,
					detected: "{}",
					confirmedAt: baseDate,
				},
			});
			incidentNumber += 1;
			const inc = await prisma.incident.create({
				data: {
					number: incidentNumber,
					title: `inc-${i}`,
					severity: "low",
					serviceId: svc.id,
					createdAt: new Date(baseDate.getTime() + i * 1000),
				},
			});
			const alt = await prisma.alert.create({
				data: {
					title: `alt-${i}`,
					source: "test",
					fingerprint: `fp-q-${incidentNumber}`,
					dedupKey: `fp-q-${incidentNumber}`,
					incidentId: inc.id,
				},
			});
			await service.handleAlertCorrelated({ alertId: alt.id, incidentId: inc.id, isNewIncident: true });
		}

		expect(await prisma.capture.count({ where: { state: "queued" } })).toBe(16);

		const svcA = await prisma.service.create({ data: { name: "svc-q-high" } });
		await prisma.serviceBinding.create({
			data: { serviceId: svcA.id, kubeContext: CONTEXT, cluster: SERVER, namespace: "ns-high", detected: "{}", confirmedAt: baseDate },
		});
		incidentNumber += 1;
		const incA = await prisma.incident.create({
			data: { number: incidentNumber, title: "inc-high", severity: "critical", serviceId: svcA.id, createdAt: baseDate },
		});
		const resA = await service.captureNow(incA.id);
		expect(resA?.state).toBe("queued");

		const skippedRows = await prisma.capture.findMany({ where: { state: "skipped", stateReason: "queue-full" } });
		expect(skippedRows).toHaveLength(1);

		const svcB = await prisma.service.create({ data: { name: "svc-q-low" } });
		await prisma.serviceBinding.create({
			data: { serviceId: svcB.id, kubeContext: CONTEXT, cluster: SERVER, namespace: "ns-low", detected: "{}", confirmedAt: baseDate },
		});
		incidentNumber += 1;
		const incB = await prisma.incident.create({
			data: { number: incidentNumber, title: "inc-low", severity: "low", serviceId: svcB.id, createdAt: new Date(baseDate.getTime() + 100000) },
		});
		const resB = await service.captureNow(incB.id);
		expect(resB?.state).toBe("skipped");

		tickSpy.mockRestore();
	});

	it("orders by priority and ties by caseStartedAt", () => {
		expect(priorityFor("critical")).toBe(1);
		expect(priorityFor("high")).toBe(2);
		expect(priorityFor("medium")).toBe(3);
		expect(priorityFor("low")).toBe(4);
		expect(priorityFor("info")).toBe(4);
		expect(priorityFor("unknown")).toBe(3);

		const d1 = new Date("2026-10-15T09:00:00Z");
		const d2 = new Date("2026-10-15T10:00:00Z");
		expect(ranksAbove({ priority: 1, caseStartedAt: d2 }, { priority: 2, caseStartedAt: d1 })).toBe(true);
		expect(ranksAbove({ priority: 3, caseStartedAt: d1 }, { priority: 2, caseStartedAt: d2 })).toBe(false);
		expect(ranksAbove({ priority: 2, caseStartedAt: d1 }, { priority: 2, caseStartedAt: d2 })).toBe(true);
		expect(ranksAbove({ priority: 2, caseStartedAt: d2 }, { priority: 2, caseStartedAt: d1 })).toBe(false);
	});

	it("respects MAX_RUNNING and prevents concurrent captures on the same target", async () => {
		const tickSpy = vi.spyOn(service, "tick").mockResolvedValue();

		const bDate = new Date();
		async function createTargetIncident(name: string, ns: string) {
			const svc = await prisma.service.create({ data: { name } });
			const binding = await prisma.serviceBinding.create({
				data: { serviceId: svc.id, kubeContext: CONTEXT, cluster: SERVER, namespace: ns, detected: "{}", confirmedAt: bDate },
			});
			incidentNumber += 1;
			await prisma.incident.create({
				data: { number: incidentNumber, title: name, severity: "critical", serviceId: svc.id },
			});
			return prisma.capture.create({
				data: {
					bindingId: binding.id,
					checklistVersion: 1,
					canonicalQuery: "{}",
					queryDigest: `d-${incidentNumber}`,
					kubeContext: CONTEXT,
					cluster: SERVER,
					namespace: ns,
					state: "queued",
					priority: 1,
					caseStartedAt: bDate,
					dueAt: bDate,
				},
			});
		}

		await createTargetIncident("t-1", "ns-shared");
		const c2 = await createTargetIncident("t-2", "ns-shared");
		await createTargetIncident("t-3", "ns-other");

		writeFileSync(modeFile, "hang-max");
		tickSpy.mockRestore();

		await service.tick();

		const running = await prisma.capture.findMany({ where: { state: "running" } });
		expect(running).toHaveLength(2);
		expect(running.map((c) => c.namespace).sort()).toEqual(["ns-other", "ns-shared"]);

		writeFileSync(releaseFile, "");
		await service.settle();

		await service.tick();
		await service.settle();

		expect(await prisma.capture.findUnique({ where: { id: c2.id } })).toMatchObject({ state: "complete" });
	});

	it("requeues a running row on boot (onModuleInit)", async () => {
		const capture = await prisma.capture.create({
			data: {
				checklistVersion: 1,
				canonicalQuery: "{}",
				queryDigest: "boot-test",
				kubeContext: CONTEXT,
				cluster: SERVER,
				namespace: "ns-boot",
				state: "running",
				priority: 1,
				caseStartedAt: new Date(),
				dueAt: new Date(),
			},
		});

		await service.onModuleInit();

		const requeued = await prisma.capture.findUniqueOrThrow({ where: { id: capture.id } });
		expect(requeued.state).toBe("queued");

		const s = service as unknown as { interval?: NodeJS.Timeout };
		if (s.interval) clearInterval(s.interval);

		await service.settle();
	});

	it("records missedFrom and missedTo when started well after dueAt", async () => {
		const pastDue = new Date(Date.now() - 600_000);
		const capture = await prisma.capture.create({
			data: {
				checklistVersion: 1,
				canonicalQuery: "{}",
				queryDigest: "missed-test",
				kubeContext: CONTEXT,
				cluster: SERVER,
				namespace: "ns-missed",
				state: "queued",
				priority: 1,
				caseStartedAt: pastDue,
				dueAt: pastDue,
			},
		});

		await service.tick();
		await service.settle();

		const completed = await prisma.capture.findUniqueOrThrow({ where: { id: capture.id } });
		expect(completed.state).toBe("complete");
		expect(completed.missedFrom?.toISOString()).toBe(pastDue.toISOString());
		expect(completed.missedTo).not.toBeNull();
	});

	it("retries when all commands fail, then marks blocked(unreachable) after maxAttempts", async () => {
		const { incident } = await boundIncident("svc-retry", "critical", "ns-retry");
		writeFileSync(modeFile, "unreachable");

		const res = await service.captureNow(incident.id);
		const captureId = res?.captureId ?? "";
		await service.tick();
		await service.settle();

		const afterAttempt1 = await prisma.capture.findUniqueOrThrow({ where: { id: captureId } });
		expect(afterAttempt1.state).toBe("queued");
		expect(afterAttempt1.attempts).toBe(1);

		await prisma.capture.update({
			where: { id: captureId },
			data: { dueAt: new Date(Date.now() - 1000) },
		});

		await service.tick();
		await service.settle();

		const afterAttempt2 = await prisma.capture.findUniqueOrThrow({ where: { id: captureId } });
		expect(afterAttempt2.state).toBe("blocked");
		expect(afterAttempt2.stateReason).toBe("unreachable");
		expect(afterAttempt2.attempts).toBe(2);
	});

	it("falls back to worstReason when all commands fail without classified failure on second attempt", async () => {
		const { incident } = await boundIncident("svc-unclass", "critical", "ns-unclass");
		writeFileSync(modeFile, "unclassified-error");

		const res = await service.captureNow(incident.id);
		const captureId = res?.captureId ?? "";
		await prisma.capture.update({
			where: { id: captureId },
			data: { maxAttempts: 1 },
		});
		await service.tick();
		await service.settle();

		const completed = await prisma.capture.findUniqueOrThrow({ where: { id: captureId } });
		expect(completed.state).toBe("partial");
		expect(completed.stateReason).toBe("error");
	});

	it("deadline gives partial(timeout) with notRun", async () => {
		const { incident } = await boundIncident("svc-deadline", "critical", "ns-deadline");
		writeFileSync(modeFile, "hang-deadline");

		const res = await service.captureNow(incident.id);
		const captureId = res?.captureId ?? "";
		void service.tick();

		for (let i = 0; i < 50; i++) {
			const c = await prisma.capture.findUnique({ where: { id: captureId } });
			if (c?.identity) break;
			await new Promise((r) => setTimeout(r, 20));
		}

		type RunningService = { running: Map<string, { controller: AbortController }> };
		(service as unknown as RunningService).running.get(captureId)?.controller.abort();
		writeFileSync(releaseFile, "");
		await service.settle();

		const capture = await prisma.capture.findFirstOrThrow({
			where: { id: captureId },
			include: { entries: true },
		});
		expect(capture.state).toBe("partial");
		expect(capture.stateReason).toBe("timeout");

		const endEntry = capture.entries.find((e) => e.artifactId === null);
		expect(endEntry).toBeDefined();
		const body = JSON.parse(endEntry?.body ?? "{}") as { notRun?: string[][] };
		expect(body.notRun).toBeDefined();
		expect(body.notRun?.length).toBeGreaterThan(0);
		const notRunPurposes = body.notRun?.map((cmd) => cmd[2]);
		expect(notRunPurposes).toContain("pods");
	});

	it("blocks on identity mismatch and executes no get commands", async () => {
		const { incident } = await boundIncident("svc-mismatch", "critical", "ns-mismatch");
		writeFileSync(serverFile, "https://different-cluster:6443");
		rmSync(argvLog, { force: true });

		await service.captureNow(incident.id);
		await service.tick();
		await service.settle();

		const capture = await prisma.capture.findFirstOrThrow({
			where: { binding: { service: { name: "svc-mismatch" } } },
		});
		expect(capture.state).toBe("blocked");
		expect(capture.stateReason).toBe("identity-mismatch");
		expect(capture.identityMatches).toBe(false);

		const log = readFileSync(argvLog, "utf8");
		expect(log).not.toContain('"get"');
	});

	it("listener resolves in under 200 ms against a fake kubectl that sleeps 2 s", async () => {
		const { incident, alert } = await boundIncident("svc-listener-fast", "critical", "ns-listener-fast");
		writeFileSync(modeFile, "sleep-listener");

		const start = Date.now();
		await service.handleAlertCorrelated({
			alertId: alert.id,
			incidentId: incident.id,
			isNewIncident: true,
		});
		const elapsed = Date.now() - start;
		expect(elapsed).toBeLessThan(200);

		rmSync(modeFile, { force: true });
		await service.settle();
	});

	it("supports manual captureNow, returning null when off or unbound", async () => {
		const { incident } = await boundIncident("svc-now", "critical", "ns-now");
		await settings.set(false);
		expect(await service.captureNow(incident.id)).toBeNull();

		await settings.set(true);
		const res = await service.captureNow(incident.id);
		expect(res).toMatchObject({ state: "queued", shared: false });
		await service.tick();
		await service.settle();

		const completed = await prisma.capture.findUniqueOrThrow({ where: { id: res?.captureId } });
		expect(completed.state).toBe("complete");
	});

	it("cuts logs at LOG_LIMIT_BYTES and marks retrieval byte-cap", async () => {
		const { incident } = await boundIncident("svc-bytecap", "critical", "ns-bytecap");
		writeFileSync(modeFile, "byte-cap");

		await service.captureNow(incident.id);
		await service.tick();
		await service.settle();

		const capture = await prisma.capture.findFirstOrThrow({
			where: { binding: { service: { name: "svc-bytecap" } } },
			include: { artifacts: true },
		});
		const logsArt = capture.artifacts.find((a) => a.purpose === "logs-previous");
		expect(logsArt).toMatchObject({
			retrieval: "partial",
			retrievalReason: "byte-cap",
		});
		expect(capture.state).toBe("partial");
		expect(capture.stateReason).toBe("byte-cap");
	});

	it("stores {error} redactions when redaction fails on malformed structural JSON", async () => {
		const { incident } = await boundIncident("svc-redact-err", "critical", "ns-redact-err");
		writeFileSync(modeFile, "invalid-deployments-json");

		await service.captureNow(incident.id);
		await service.tick();
		await service.settle();

		const capture = await prisma.capture.findFirstOrThrow({
			where: { binding: { service: { name: "svc-redact-err" } } },
			include: { artifacts: true },
		});
		const depArt = capture.artifacts.find((a) => a.purpose === "deployments");
		expect(depArt).toBeDefined();
		const redactions = JSON.parse(depArt?.redactions ?? "{}") as { error?: string };
		expect(redactions.error).toBeDefined();
		expect(depArt?.redactedBytes).toBe(0);
	});

	it("determines worstReason correctly", () => {
		expect(worstReason(["page-limit", "byte-cap", "timeout", "error"])).toBe("error");
		expect(worstReason(["page-limit", "byte-cap", "timeout"])).toBe("timeout");
		expect(worstReason(["page-limit", "byte-cap"])).toBe("byte-cap");
		expect(worstReason(["page-limit"])).toBe("page-limit");
		expect(worstReason([null, null])).toBeNull();
		expect(worstReason([])).toBeNull();
	});

	it("lowers caseStartedAt when a shared queued capture links an earlier incident", async () => {
		const tickSpy = vi.spyOn(service, "tick").mockResolvedValue();
		const later = await boundIncident("svc-share-early", "low", "ns-share");
		const earlier = await boundIncident("svc-share-early-2", "critical", "ns-share");
		const oldDate = new Date("2026-10-15T01:00:00Z");
		await prisma.incident.update({ where: { id: earlier.incident.id }, data: { createdAt: oldDate } });

		await service.handleAlertCorrelated({ alertId: later.alert.id, incidentId: later.incident.id, isNewIncident: true });
		await service.handleAlertCorrelated({ alertId: earlier.alert.id, incidentId: earlier.incident.id, isNewIncident: true });
		await service.handleAlertCorrelated({ alertId: earlier.alert.id, incidentId: earlier.incident.id, isNewIncident: true });

		const cap = await prisma.capture.findFirstOrThrow({ where: { namespace: "ns-share" } });
		expect(cap.caseStartedAt.toISOString()).toBe(oldDate.toISOString());
		expect(cap.priority).toBe(1);

		tickSpy.mockRestore();
	});

	it("blocks on no-kubectl when kubectl is not on PATH", async () => {
		const { incident } = await boundIncident("svc-no-kubectl", "critical", "ns-no-kubectl");
		const origPath = process.env.PATH ?? "";
		process.env.PATH = origPath
			.split(":")
			.filter((p) => !p.includes(binDir) && !p.includes("Rancher Desktop"))
			.join(":");
		try {
			await service.captureNow(incident.id);
			await service.tick();
			await service.settle();
			const cap = await prisma.capture.findFirstOrThrow({
				where: { binding: { service: { name: "svc-no-kubectl" } } },
			});
			expect(cap.state).toBe("blocked");
			expect(cap.stateReason).toBe("no-kubectl");
		} finally {
			process.env.PATH = origPath;
		}
	});

	it("blocks on context-missing when kubecontext is not found", async () => {
		const { incident } = await boundIncident("svc-ctx-missing", "critical", "ns-ctx-missing");
		writeFileSync(modeFile, "context-missing");
		try {
			await service.captureNow(incident.id);
			await service.tick();
			await service.settle();
			const cap = await prisma.capture.findFirstOrThrow({
				where: { binding: { service: { name: "svc-ctx-missing" } } },
			});
			expect(cap.state).toBe("blocked");
			expect(cap.stateReason).toBe("context-missing");
		} finally {
			rmSync(modeFile, { force: true });
		}
	});

	it("handles invalid json in pods and invalid pod names", async () => {
		const { incident: i1 } = await boundIncident("svc-corrupt-pods", "critical", "ns-corrupt-pods");
		writeFileSync(modeFile, "corrupt-pods");
		await service.captureNow(i1.id);
		await service.tick();
		await service.settle();
		const cap1 = await prisma.capture.findFirstOrThrow({
			where: { binding: { service: { name: "svc-corrupt-pods" } } },
		});
		expect(cap1.state).toBe("complete");

		rmSync(modeFile, { force: true });

		const { incident: i2 } = await boundIncident("svc-invalid-pod-name", "critical", "ns-invalid-pod-name");
		writeFileSync(modeFile, "invalid-pod-name");
		await service.captureNow(i2.id);
		await service.tick();
		await service.settle();
		const cap2 = await prisma.capture.findFirstOrThrow({
			where: { binding: { service: { name: "svc-invalid-pod-name" } } },
		});
		expect(cap2.state).toBe("complete");
		rmSync(modeFile, { force: true });
	});

	it("logs warnings on retention sweep or case builder failure", async () => {
		const { incident } = await boundIncident("svc-warn-fail", "critical", "ns-warn-fail");
		const sweepSpy = vi.spyOn(store, "sweep").mockRejectedValueOnce(new Error("sweep fail"));
		const buildSpy = vi.spyOn(CaseBuilder.prototype, "build").mockRejectedValueOnce(new Error("build fail"));

		await service.captureNow(incident.id);
		await service.tick();
		await service.settle();

		expect(sweepSpy).toHaveBeenCalled();
		expect(buildSpy).toHaveBeenCalled();
		sweepSpy.mockRestore();
		buildSpy.mockRestore();
	});

	it("catches and logs errors in tick and handleAlertCorrelated", async () => {
		const findSpy = vi.spyOn(prisma.capture, "findMany").mockRejectedValueOnce(new Error("db down"));
		await service.tick();
		expect(findSpy).toHaveBeenCalled();
		findSpy.mockRestore();

		const incSpy = vi.spyOn(prisma.incident, "findUnique").mockRejectedValueOnce(new Error("inc down"));
		await service.handleAlertCorrelated({ alertId: "a-fail", incidentId: "i-fail", isNewIncident: true });
		expect(incSpy).toHaveBeenCalled();
		incSpy.mockRestore();
	});

	it("handles tick re-entrancy and skipped startDue updates", async () => {
		let innerTicked = false;
		const origFindMany = prisma.capture.findMany.bind(prisma.capture);
		const spy = vi.spyOn(prisma.capture, "findMany").mockImplementation((args) => {
			if (!innerTicked) {
				innerTicked = true;
				void service.tick();
			}
			return origFindMany(args);
		});
		await service.tick();
		expect(innerTicked).toBe(true);
		spy.mockRestore();

		const { incident } = await boundIncident("svc-race", "critical", "ns-race");
		const cap = await prisma.capture.create({
			data: {
				checklistVersion: 1,
				canonicalQuery: "{}",
				queryDigest: "race-test",
				kubeContext: CONTEXT,
				cluster: SERVER,
				namespace: "ns-race-2",
				state: "queued",
				priority: 1,
				caseStartedAt: new Date(),
				dueAt: new Date(),
			},
		});
		const updateSpy = vi.spyOn(prisma.capture, "updateMany").mockResolvedValueOnce({ count: 0 });
		await service.tick();
		expect(updateSpy).toHaveBeenCalled();
		updateSpy.mockRestore();
		await prisma.capture.delete({ where: { id: cap.id } });
	});

	it("aborts running captures on onModuleDestroy", async () => {
		const { incident } = await boundIncident("svc-destroy", "critical", "ns-destroy");
		writeFileSync(modeFile, "hang-first");
		await service.captureNow(incident.id);
		await new Promise((r) => setTimeout(r, 60));
		await service.onModuleDestroy();
		writeFileSync(releaseFile, "");
	});

	it("handles unexpected error in runChecklist as partial(error)", async () => {
		const { incident } = await boundIncident("svc-chk-err", "critical", "ns-chk-err");
		const spy = vi.spyOn(service as unknown as { runChecklist: () => Promise<void> }, "runChecklist")
			.mockRejectedValueOnce(new Error("unexpected crash"));
		await service.captureNow(incident.id);
		await service.tick();
		await service.settle();
		const cap = await prisma.capture.findFirstOrThrow({
			where: { binding: { service: { name: "svc-chk-err" } } },
		});
		expect(cap.state).toBe("partial");
		expect(cap.stateReason).toBe("error");
		expect(cap.lastError).toBe("unexpected crash");
		spy.mockRestore();
	});

	it("handles findUniqueOrThrow error in runCapture and non-IdentityError in resolveIdentity", async () => {
		const { incident: i1 } = await boundIncident("svc-rc-fail", "critical", "ns-rc-fail");
		const spy1 = vi.spyOn(prisma.capture, "findUniqueOrThrow").mockRejectedValueOnce(new Error("find fail"));
		await service.captureNow(i1.id);
		await service.tick();
		await service.settle();
		spy1.mockRestore();

		const identityMod = await import("./capture/identity.js");
		const spy2 = vi.spyOn(identityMod, "resolveIdentity").mockRejectedValueOnce(new Error("network crash"));
		const { incident: i2 } = await boundIncident("svc-id-crash", "critical", "ns-id-crash");
		await service.captureNow(i2.id);
		await service.tick();
		await service.settle();
		const cap = await prisma.capture.findFirstOrThrow({
			where: { binding: { service: { name: "svc-id-crash" } } },
		});
		expect(cap.state).toBe("blocked");
		expect(cap.stateReason).toBe("unreachable");
		spy2.mockRestore();
	});
});
