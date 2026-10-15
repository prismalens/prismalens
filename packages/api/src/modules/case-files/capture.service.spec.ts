// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/** The capture queue and runner over a migrated SQLite database and a fake kubectl on PATH. */
import { randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { EventEmitter2 } from "@nestjs/event-emitter";
import { TokenVault } from "@prismalens/integrations";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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
const { CaptureService, CASE_CAPTURE_UPDATED_EVENT } = await import("./capture.service.js");

const CONTEXT = "kind-pl";
const SERVER = "https://127.0.0.1:6443";
const binDir = join(env.root, "bin");
const argvLog = join(binDir, "kubectl.argv.log");

/** Answers the checklist from canned JSON and records every argv. */
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
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(argvLog)}, JSON.stringify(args) + "\\n");
const out = (v) => process.stdout.write(typeof v === "string" ? v : JSON.stringify(v));
if (args[0] === "config") out({ contexts: [{ name: ${JSON.stringify(CONTEXT)}, context: { cluster: "kind", user: "admin", namespace: "shop" } }], clusters: [{ name: "kind", cluster: { server: ${JSON.stringify(SERVER)} } }] });
else if (args[0] === "auth") { process.stderr.write("unknown command"); process.exit(1); }
else if (args[0] === "logs") out("2026-10-15T09:57:59Z OOM DB_PASSWORD=hunter2\\n");
else if (args[1] === "pods") out(${JSON.stringify(JSON.stringify(pods))});
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

	async function boundIncident(serviceName: string, severity = "critical") {
		const service = await prisma.service.upsert({
			where: { name: serviceName },
			update: {},
			create: { name: serviceName },
		});
		await prisma.serviceBinding.upsert({
			where: { serviceId: service.id },
			update: {},
			create: {
				serviceId: service.id,
				kubeContext: CONTEXT,
				cluster: SERVER,
				namespace: "shop",
				detected: "{}",
				confirmedAt: new Date(),
			},
		});
		incidentNumber += 1;
		const incident = await prisma.incident.create({
			data: { number: incidentNumber, title: "checkout down", severity, serviceId: service.id },
		});
		const alert = await prisma.alert.create({
			data: { title: "checkout down", source: "test", fingerprint: `fp-${incidentNumber}`, dedupKey: `fp-${incidentNumber}`, incidentId: incident.id },
		});
		return { incident, alert };
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
			new CaseBuilder(),
			{ emit } as unknown as EventEmitter2,
		);
	});

	beforeEach(async () => {
		await settings.set(false);
	});

	afterAll(async () => {
		await service?.onModuleDestroy();
		await prisma?.$disconnect();
		rmSync(env.root, { recursive: true, force: true });
	});

	it("adds no row while the setting is off, or for an alert joining an open incident", async () => {
		const { incident, alert } = await boundIncident("svc-off");
		await service.handleAlertCorrelated({ alertId: alert.id, incidentId: incident.id, isNewIncident: true });
		await settings.set(true);
		await service.handleAlertCorrelated({ alertId: alert.id, incidentId: incident.id, isNewIncident: false });
		expect(await prisma.caseCapture.count({ where: { incidentId: incident.id } })).toBe(0);
	});

	it("queues from the listener without running kubectl, shares a queued capture, then completes it", async () => {
		await settings.set(true);
		const tick = vi.spyOn(service, "tick").mockResolvedValue();
		const first = await boundIncident("svc-on");
		const second = await boundIncident("svc-on", "low");
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
});
