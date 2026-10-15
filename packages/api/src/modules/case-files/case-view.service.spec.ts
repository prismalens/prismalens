// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/** The case view over a migrated SQLite database, a real capture and a fake kubectl on PATH. */
import { randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { EventEmitter2 } from "@nestjs/event-emitter";
import { ORPCError } from "@orpc/nest";
import { buildInvestigationPrompt } from "@prismalens/engine";
import { TokenVault } from "@prismalens/integrations";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { BindingsService } from "./bindings.service.js";
import type { CredentialsService } from "../integrations/crypto/credentials.service.js";
import {
	CANARIES,
	SECRET_ARGV,
	SECRET_EVENT_MESSAGE,
	SECRET_LOG,
	SECRET_STDERR,
	SECRETS,
	timestamped,
	UNNAMED_EVENT_MESSAGE,
} from "./__fixtures__/secrets.js";

const env = await vi.hoisted(async () => {
	const fs = await import("node:fs");
	const os = await import("node:os");
	const path = await import("node:path");
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "pl-case-view-"));
	process.env.PRISMALENS_WORKSPACE_DIR = path.join(root, "data");
	return { root };
});

const { PrismaService } = await import("../../core/prisma/prisma.service.js");
const { ArtifactStore, casesDir } = await import("./storage/artifact-store.js");
const { ManifestService } = await import("./storage/manifest.js");
const { CaseFileSettingsService } = await import("./case-file-settings.service.js");
const { CaseBuilder } = await import("./case-builder.js");
const { CaptureService } = await import("./capture.service.js");
const { CaseViewService } = await import("./case-view.service.js");
const { CaseBundleService, BUNDLE_DIR } = await import("./case-bundle.service.js");
const { CaseFilesController } = await import("./case-files.controller.js");
const { prisma: raw } = await import("@prismalens/database");

const CONTEXT = "kind-pl";
const SERVER = "https://127.0.0.1:6443";
const binDir = join(env.root, "bin");
const NEW_TABLES = [
	"service_bindings",
	"captures",
	"case_captures",
	"capture_artifacts",
	"manifest_entries",
	"case_nodes",
	"case_edges",
	"claim_revisions",
];

/** Answers the checklist with the secret corpus planted in every purpose's output. */
function installFakeKubectl(): void {
	mkdirSync(binDir, { recursive: true });
	const env = [
		{ name: "AWS_SECRET_ACCESS_KEY", value: SECRETS.awsSecret },
		{ name: "DB_PASSWORD", value: SECRETS.dbPassword },
		{ name: "SLACK_TOKEN", value: SECRETS.slack },
	];
	const out = {
		events: {
			items: [
				{
					type: "Warning",
					reason: "BackOff",
					metadata: { name: "checkout.1", namespace: "shop", uid: "e1" },
					involvedObject: { kind: "Pod", name: "checkout-7d9f" },
					lastTimestamp: "2026-10-15T09:58:30Z",
					message: `restarting: DB_PASSWORD=${SECRETS.dbPassword} Authorization: Bearer ${SECRETS.bearer} ${SECRETS.slack}`,
				},
				{
					type: "Warning",
					reason: "FailedAuth",
					metadata: { name: "checkout.2", namespace: "shop", uid: "e2" },
					involvedObject: { kind: "Pod", name: "checkout-7d9f" },
					lastTimestamp: "2026-10-15T09:58:40Z",
					message: SECRET_EVENT_MESSAGE,
				},
				{
					type: "Warning",
					reason: "KeyRotation",
					metadata: { name: "checkout.3", namespace: "shop", uid: "e3" },
					involvedObject: { kind: "Pod", name: "checkout-7d9f" },
					lastTimestamp: "2026-10-15T09:58:50Z",
					message: UNNAMED_EVENT_MESSAGE,
				},
			],
		},
		deployments: {
			items: [
				{
					metadata: { name: "checkout", namespace: "shop", uid: "d1" },
					spec: { template: { spec: { containers: [{ name: "app", image: "shop/checkout:1.4.2", env, ...SECRET_ARGV }] } } },
				},
			],
		},
		replicasets: { items: [] },
		pods: {
			items: [
				{
					metadata: {
						name: "checkout-7d9f",
						namespace: "shop",
						uid: "p1",
						annotations: { note: `pulled with ${SECRETS.github} from /x?api_key=${SECRETS.apiKey}` },
					},
					spec: { containers: [{ name: "app", env, ...SECRET_ARGV }] },
					status: {
						phase: "Running",
						startTime: "2026-10-15T09:00:00Z",
						containerStatuses: [
							{
								name: "app",
								restartCount: 3,
								lastState: { terminated: { reason: "OOMKilled", exitCode: 137, finishedAt: "2026-10-15T09:58:00Z" } },
							},
						],
					},
				},
			],
		},
	};
	for (const [purpose, body] of Object.entries(out)) writeFileSync(join(binDir, `${purpose}.json`), JSON.stringify(body));
	writeFileSync(join(binDir, "logs.txt"), `${SECRET_LOG}\n`);
	// What kubectl returns for `logs --timestamps`, which the checklist always passes (#842 OBJ-014).
	writeFileSync(join(binDir, "logs-ts.txt"), `${timestamped(SECRET_LOG)}\n`);
	const script = `#!${process.execPath}
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
const dir = ${JSON.stringify(binDir)};
const out = (v) => process.stdout.write(typeof v === "string" ? v : JSON.stringify(v));
if (args[0] === "config") out({ contexts: [{ name: ${JSON.stringify(CONTEXT)}, context: { cluster: "kind", user: "admin", namespace: "shop" } }], clusters: [{ name: "kind", cluster: { server: ${JSON.stringify(SERVER)} } }] });
else if (args[0] === "auth") { process.stderr.write("unknown command"); process.exit(1); }
else if (args[1] === "events") { process.stderr.write(${JSON.stringify(SECRET_STDERR)}); out(fs.readFileSync(path.join(dir, "events.json"), "utf8")); }
else if (args[0] === "logs") out(fs.readFileSync(path.join(dir, args.includes("--timestamps") ? "logs-ts.txt" : "logs.txt"), "utf8"));
else out(fs.readFileSync(path.join(dir, args[1] + ".json"), "utf8"));
`;
	writeFileSync(join(binDir, "kubectl"), script);
	chmodSync(join(binDir, "kubectl"), 0o755);
}

describe("CaseViewService", () => {
	let prisma: InstanceType<typeof PrismaService>;
	let settings: InstanceType<typeof CaseFileSettingsService>;
	let captures: InstanceType<typeof CaptureService>;
	let store: InstanceType<typeof ArtifactStore>;
	let views: InstanceType<typeof CaseViewService>;
	let controller: InstanceType<typeof CaseFilesController>;
	let incidentNumber = 0;

	async function incidentFor(serviceName: string, bound: boolean) {
		const service = await prisma.service.upsert({ where: { name: serviceName }, update: {}, create: { name: serviceName } });
		if (bound)
			await prisma.serviceBinding.upsert({
				where: { serviceId: service.id },
				update: {},
				create: { serviceId: service.id, kubeContext: CONTEXT, cluster: SERVER, namespace: "shop", detected: "{}", confirmedAt: new Date() },
			});
		incidentNumber += 1;
		const incident = await prisma.incident.create({
			data: { number: incidentNumber, title: "checkout down", severity: "critical", serviceId: service.id },
		});
		await prisma.alert.create({
			data: {
				title: "checkout down",
				source: "test",
				fingerprint: `fp-${incidentNumber}`,
				dedupKey: `fp-${incidentNumber}`,
				incidentId: incident.id,
				triggeredAt: new Date("2026-10-15T10:00:00Z"),
			},
		});
		return incident;
	}

	async function captureToEnd(incidentId: string): Promise<string> {
		const summary = await views.capture(incidentId);
		const deadline = Date.now() + 20_000;
		for (;;) {
			await captures.tick();
			await captures.settle();
			const row = await prisma.capture.findUniqueOrThrow({ where: { id: summary.id } });
			if (row.state !== "queued" && row.state !== "running") return summary.id;
			if (Date.now() > deadline) throw new Error(`capture stuck in ${row.state}`);
			await new Promise((r) => setTimeout(r, 50));
		}
	}

	function handlers<T>(procedures: Record<string, unknown>) {
		return (key: string) =>
			(procedures[key] as { "~orpc": { handler: (args: { input: unknown }) => Promise<T> } })["~orpc"].handler;
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
		const manifest = new ManifestService(prisma, store);
		settings = new CaseFileSettingsService(prisma);
		captures = new CaptureService(prisma, settings, store, manifest, new CaseBuilder(store), {
			emit: vi.fn(),
		} as unknown as EventEmitter2);
		views = new CaseViewService(prisma, settings, store, manifest, captures);
		controller = new CaseFilesController({} as BindingsService, views, settings);
	});

	beforeEach(async () => {
		await settings.set(true);
	});

	afterAll(async () => {
		await captures?.onModuleDestroy();
		await prisma?.$disconnect();
		rmSync(env.root, { recursive: true, force: true });
	});

	it("leaks no corpus value into the view, the served artifacts, the new tables, the redacted files, the bundle or the prompt", async () => {
		const incident = await incidentFor("svc-leak", true);
		const captureId = await captureToEnd(incident.id);
		const view = await views.get(incident.id);
		expect(view.captures[0]?.artifacts.map((a) => a.purpose)).toEqual([
			"events",
			"deployments",
			"replicasets",
			"pods",
			"logs-previous",
		]);
		const logs = await prisma.captureArtifact.findFirstOrThrow({ where: { captureId, purpose: "logs-previous" } });
		// The corpus really went through capture: the encrypted raw copy holds it.
		expect((await store.readRaw(logs)).toString("utf8")).toContain(SECRETS.dbPassword);
		const timestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{9}Z /;
		expect((await store.readRaw(logs)).toString("utf8").split("\n")[0]).toMatch(timestamp);

		// The event message reaches the view as a claim statement, redacted.
		expect(JSON.stringify(view)).toMatch(/restarting: DB_PASSWORD=\[REDACTED:[a-z-]+\]/);
		// The colon form in a Warning event reaches a claim statement, redacted (#842 OBJ-011).
		expect(JSON.stringify(view)).toMatch(/FailedAuth: auth failed for app, password: \[REDACTED:pattern\]/);
		const haystacks: [string, string][] = [["view", JSON.stringify(view)]];
		for (const a of view.captures[0]?.artifacts ?? []) haystacks.push([`artifact ${a.purpose}`, (await views.artifact(a.id)).text]);
		for (const table of NEW_TABLES) {
			const rows = await raw.$queryRawUnsafe<unknown[]>(`SELECT * FROM "${table}"`);
			haystacks.push([table, JSON.stringify(rows, (_k, v: unknown) => (typeof v === "bigint" ? v.toString() : v))]);
		}
		for (const dir of readdirSync(casesDir()))
			for (const file of readdirSync(join(casesDir(), dir)))
				haystacks.push([`${dir}/${file}`, readFileSync(join(casesDir(), dir, file)).toString("latin1")]);
		expect(haystacks.filter(([name]) => name.endsWith(".redacted")).length).toBe(5);

		const cwd = join(env.root, "run-cwd");
		mkdirSync(cwd);
		const bundle = await new CaseBundleService(prisma, settings, store).attach(incident.id, cwd);
		if (!bundle) throw new Error("no bundle for a bound incident");
		const bundleFiles = readdirSync(join(cwd, BUNDLE_DIR));
		expect(bundleFiles).toHaveLength(6);
		for (const file of bundleFiles) haystacks.push([`bundle ${file}`, readFileSync(join(cwd, BUNDLE_DIR, file), "utf8")]);
		const prompt = buildInvestigationPrompt({
			alerts: [{ alertname: "CheckoutDown", severity: "critical", labels: {}, annotations: {}, startsAt: "2026-10-15T10:00:00Z" }],
			service: { name: "svc-leak" },
			caseBundle: bundle,
		});
		expect(prompt).toContain("<<<CASE_BUNDLE");
		haystacks.push(["prompt", prompt]);

		const leaks = haystacks.flatMap(([name, text]) =>
			CANARIES.filter(([, secret]) => text.includes(secret)).map(([key]) => `${key} in ${name}`),
		);
		expect(leaks).toEqual([]);
	});

	it("projects the report and tool calls, reads revisions as of a time, and serves the open questions", async () => {
		const incident = await incidentFor("svc-view", true);
		const captureId = await captureToEnd(incident.id);
		const link = await prisma.caseCapture.findFirstOrThrow({ where: { incidentId: incident.id }, include: { capture: true } });
		const pods = await prisma.captureArtifact.findFirstOrThrow({ where: { captureId, purpose: "pods" } });

		const completedAt = new Date(Date.now() + 1_000);
		const investigation = await prisma.investigation.create({
			data: {
				incidentId: incident.id,
				status: "completed",
				completedAt,
				report: JSON.stringify({
					hypotheses: [
						{
							statement: "checkout ran out of memory",
							status: "confirmed",
							evidence: [{ observation: "OOMKilled", source: `case:${pods.id}`, direction: "supports", status: "verified" }],
						},
					],
				}),
			},
		});
		await prisma.investigationEvent.create({
			data: {
				investigationId: investigation.id,
				seq: 1,
				branchId: "run",
				event: JSON.stringify({ kind: "tool_result", ts: "2026-10-15T10:01:00.000Z", result: { name: "Bash", toolCallId: "t1", source: "kubectl get pods", ok: true, preview: "" } }),
			},
		});

		const view = await views.get(incident.id, new Date(completedAt.getTime() + 1_000).toISOString());
		expect(view.captures[0]?.latencyMs).toBe((link.capture.startedAt?.getTime() ?? 0) - link.triggeredAt.getTime());
		const report = view.claims.filter((c) => c.source.kind === "report");
		expect(report).toEqual([
			expect.objectContaining({
				status: "inferred",
				projected: true,
				attributes: expect.objectContaining({ agentStatus: "confirmed" }),
				source: { kind: "report", provenance: "harness-reported", artifactId: pods.id, investigationId: investigation.id },
			}),
		]);
		expect(view.agentToolCalls).toEqual([
			expect.objectContaining({ investigationId: investigation.id, toolCallId: "t1", provenance: "harness-reported" }),
		]);
		const stored = view.claims.filter((c) => !c.projected);
		expect(stored.length).toBeGreaterThan(0);
		expect(new Set(stored.map((c) => c.source.provenance))).toEqual(new Set(["host-executed"]));
		expect(view.openQuestions).toEqual(
			view.claims.filter((c) => ["candidate", "unknown", "inconclusive", "hint"].includes(c.status)).map((c) => c.id),
		);

		// A revision 2 recorded later is invisible before its recordedAt.
		const first = await prisma.claimRevision.findFirstOrThrow({ where: { incidentId: incident.id, nodeId: { not: null } } });
		await prisma.claimRevision.create({
			data: {
				incidentId: incident.id,
				nodeId: first.nodeId,
				revision: 2,
				status: first.status,
				statement: `${first.statement} (again)`,
				sourceKind: first.sourceKind,
				provenance: first.provenance,
				validKind: first.validKind,
				recordedAt: new Date(completedAt.getTime() + 60_000),
			},
		});
		const before = await views.get(incident.id, new Date(completedAt.getTime() - 500).toISOString());
		expect(before.claims.find((c) => c.id === first.id)).toMatchObject({ revision: 1, revisions: 1 });
		expect(before.claims.some((c) => c.source.kind === "report")).toBe(false);
		const after = await views.get(incident.id, new Date(completedAt.getTime() + 120_000).toISOString());
		expect(after.claims.find((c) => c.statement === `${first.statement} (again)`)).toMatchObject({ revision: 2, revisions: 2 });
	});

	it("verifies through the route, reports a metadata edit, and refuses an expired artifact with 409", async () => {
		const incident = await incidentFor("svc-verify", true);
		const captureId = await captureToEnd(incident.id);
		const cases = handlers<unknown>(controller.cases() as unknown as Record<string, unknown>);
		expect(await cases("verify")({ input: { incidentId: incident.id } })).toMatchObject({ ok: true, entries: 6 });

		await raw.$executeRawUnsafe(`UPDATE capture_artifacts SET retrieval='partial' WHERE "captureId" = ? AND seq = 1`, captureId);
		expect(await cases("verify")({ input: { incidentId: incident.id } })).toMatchObject({
			ok: false,
			brokenAt: { check: "metadata" },
		});

		const artifact = await prisma.captureArtifact.findFirstOrThrow({ where: { captureId, seq: 2 } });
		await store.expire(captureId);
		const view = await views.get(incident.id);
		expect(view.captures[0]?.artifacts.every((a) => a.expired)).toBe(true);
		await expect(cases("artifact")({ input: { artifactId: artifact.id } })).rejects.toMatchObject({ code: "CONFLICT", status: 409 });
		await expect(cases("get")({ input: { incidentId: "00000000-0000-4000-8000-000000000000" } })).rejects.toBeInstanceOf(ORPCError);
	});

	it("projects one unknown gap with its hint for an unbound service, and nothing while the setting is off", async () => {
		const incident = await incidentFor("svc-unbound", false);
		const view = await views.get(incident.id);
		expect(view.binding).toBeNull();
		expect(view.claims).toEqual([
			expect.objectContaining({ status: "unknown", projected: true, hint: "Bind the service in Services." }),
		]);
		expect(view.openQuestions).toEqual([view.claims[0]?.id]);
		await expect(views.capture(incident.id)).rejects.toMatchObject({ reason: "unbound" });

		const settingsRoutes = handlers<{ enabled: boolean }>(controller.caseFileSettings() as unknown as Record<string, unknown>);
		expect(await settingsRoutes("update")({ input: { enabled: false } })).toEqual({ enabled: false });
		expect(await settingsRoutes("get")({ input: undefined })).toEqual({ enabled: false });
		expect(await views.get(incident.id)).toMatchObject({ enabled: false, claims: [], captures: [] });
	});
});
