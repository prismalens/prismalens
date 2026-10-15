// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/** Smoke: one capture's redacted artifacts become claims in a migrated SQLite database. */
import { randomBytes, randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import type { CaptureArtifact } from "@prismalens/database";
import { TokenVault } from "@prismalens/integrations";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { CredentialsService } from "../integrations/crypto/credentials.service.js";

const env = await vi.hoisted(async () => {
	const fs = await import("node:fs");
	const os = await import("node:os");
	const path = await import("node:path");
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "pl-case-builder-"));
	process.env.PRISMALENS_WORKSPACE_DIR = path.join(root, "data");
	return { root };
});

const { PrismaService } = await import("../../core/prisma/prisma.service.js");
const { ArtifactStore } = await import("./storage/artifact-store.js");
const { CaseBuilder } = await import("./case-builder.js");

const vault = new TokenVault(randomBytes(32));
const credentials = { getVault: () => vault } as unknown as CredentialsService;

const ALERT_AT = new Date("2026-10-15T10:00:00Z");
const COLLECTED = new Date("2026-10-15T10:00:30Z");
const d1 = `sha256:${"a".repeat(64)}`;
const d2 = `sha256:${"b".repeat(64)}`;
const meta = (name: string, extra: object = {}) => ({
	metadata: { name, namespace: "shop", uid: `${name}-uid`, ...extra },
});

const deployments = {
	items: [
		{
			...meta("checkout"),
			spec: {
				replicas: 2,
				template: { spec: { containers: [{ name: "app", image: "checkout:v2" }] } },
			},
			status: { readyReplicas: 1 },
		},
	],
};
const replicasets = {
	items: [
		{
			...meta("checkout-7d9f", {
				creationTimestamp: "2026-10-15T09:30:00Z",
				annotations: { "deployment.kubernetes.io/revision": "4" },
				labels: { "pod-template-hash": "7d9f" },
				ownerReferences: [{ kind: "Deployment", name: "checkout" }],
			}),
			spec: { template: { spec: { containers: [{ name: "app", image: "checkout:v2" }] } } },
			status: { replicas: 2, readyReplicas: 1 },
		},
	],
};
const pod = (name: string, digest: string, restartCount: number) => ({
	...meta(name, {
		labels: { "pod-template-hash": "7d9f" },
		ownerReferences: [{ kind: "ReplicaSet", name: "checkout-7d9f" }],
	}),
	spec: { containers: [{ name: "app", image: "checkout:v2" }] },
	status: {
		phase: "Running",
		startTime: "2026-10-15T09:31:00Z",
		containerStatuses: [
			{
				name: "app",
				imageID: `docker-pullable://checkout@${digest}`,
				restartCount,
				lastState: {
					terminated: { reason: "OOMKilled", exitCode: 137, finishedAt: "2026-10-15T09:52:00Z" },
				},
			},
		],
	},
});
const events = {
	items: [
		{
			...meta("checkout-7d9f-a.1"),
			type: "Warning",
			reason: "BackOff",
			message: "Back-off restarting failed container",
			involvedObject: { kind: "Pod", name: "checkout-7d9f-a" },
			lastTimestamp: "2026-10-15T09:55:00Z",
		},
	],
};

describe("CaseBuilder", () => {
	let prisma: InstanceType<typeof PrismaService>;
	let store: InstanceType<typeof ArtifactStore>;
	let builder: InstanceType<typeof CaseBuilder>;

	beforeAll(async () => {
		const { resolveMigrationsDir, runMigrations } = await import("@prismalens/database/migrator");
		await runMigrations({ migrationsDir: resolveMigrationsDir(), log: () => {} });
		prisma = new PrismaService();
		await prisma.$connect();
		store = new ArtifactStore(prisma, credentials);
		builder = new CaseBuilder(store);
	});

	afterAll(async () => {
		await prisma?.$disconnect();
		rmSync(env.root, { recursive: true, force: true });
	});

	async function captureOf(restartCount: number) {
		const capture = await prisma.capture.create({
			data: {
				checklistVersion: 1,
				canonicalQuery: "{}",
				queryDigest: randomUUID(),
				kubeContext: "kind-pl",
				cluster: "https://k",
				namespace: "shop",
				state: "complete",
				caseStartedAt: ALERT_AT,
				dueAt: ALERT_AT,
				startedAt: ALERT_AT,
				finishedAt: COLLECTED,
			},
		});
		const lists = {
			events,
			deployments,
			replicasets,
			pods: { items: [pod("checkout-7d9f-a", d1, restartCount), pod("checkout-7d9f-b", d2, 0)] },
		};
		const artifacts: CaptureArtifact[] = [];
		for (const [seq, [purpose, json]] of Object.entries(lists).entries()) {
			const bytes = Buffer.from(JSON.stringify(json));
			const { storedBytes: _, ...digests } = await store.write(capture.id, seq, bytes, bytes);
			artifacts.push(
				await prisma.captureArtifact.create({
					data: {
						captureId: capture.id,
						seq,
						purpose,
						command: "[]",
						retrieval: "complete",
						exitCode: 0,
						startedAt: ALERT_AT,
						endedAt: COLLECTED,
						redactions: "{}",
						...digests,
					},
				}),
			);
		}
		return { capture, artifacts };
	}

	it("writes candidate links, observed facts and host-executed provenance, then appends only changes", async () => {
		const incident = await prisma.incident.create({ data: { number: 1, title: "checkout down" } });
		const alert = await prisma.alert.create({
			data: { dedupKey: "k", title: "High error rate", triggeredAt: ALERT_AT, incidentId: incident.id },
		});
		const first = await captureOf(3);
		const input = { incidentId: incident.id, ...first, alerts: [alert] };

		const r1 = await prisma.$transaction((tx) => builder.build(tx, input));
		expect(r1.revisions).toBeGreaterThan(0);
		const claims = await prisma.claimRevision.findMany({
			where: { incidentId: incident.id },
			include: { edge: true, node: true },
		});
		const statements = claims.map((c) => c.statement);
		expect(statements).toContain("Revision 4 of checkout rolled out 30 min before the alert");
		expect(statements).toContain("checkout-7d9f-a restarted (OOMKilled, exit 137) 8 min before the alert");
		expect(statements.some((s) => s.includes("maps to 2 digests"))).toBe(true);
		const precedes = claims.filter((c) => c.edge?.relation === "precedes_alert");
		expect(new Set(precedes.map((c) => c.status))).toEqual(new Set(["candidate"]));
		expect(claims.find((c) => c.node?.kind === "alert")?.status).toBe("observed");
		for (const c of claims) {
			expect(c.provenance).toBe("host-executed");
			expect(["observed", "candidate", "unknown", "inconclusive"]).toContain(c.status);
			expect(c.collectedAt).not.toBeNull();
		}

		const again = await prisma.$transaction((tx) => builder.build(tx, input));
		expect(again.revisions).toBe(0);

		const second = await captureOf(4);
		const r3 = await prisma.$transaction((tx) =>
			builder.build(tx, { incidentId: incident.id, ...second, alerts: [alert] }),
		);
		expect(r3.revisions).toBe(1);
		const runs = await prisma.claimRevision.findMany({
			where: { incidentId: incident.id, edge: { relation: "runs" }, statement: { contains: "checkout-7d9f-a" } },
			orderBy: { revision: "asc" },
		});
		expect(runs.map((r) => r.revision)).toEqual([1, 2]);
	});

	it("writes an inconclusive gap for a blocked capture", async () => {
		const incident = await prisma.incident.create({ data: { number: 2, title: "blocked" } });
		const capture = await prisma.capture.create({
			data: {
				checklistVersion: 1,
				canonicalQuery: "{}",
				queryDigest: randomUUID(),
				kubeContext: "kind-pl",
				cluster: "https://k",
				namespace: "shop",
				state: "blocked",
				stateReason: "context-missing",
				caseStartedAt: ALERT_AT,
				dueAt: ALERT_AT,
				finishedAt: COLLECTED,
			},
		});
		await prisma.$transaction((tx) =>
			builder.build(tx, { incidentId: incident.id, capture, artifacts: [], alerts: [] }),
		);
		const gap = await prisma.claimRevision.findFirstOrThrow({ where: { incidentId: incident.id } });
		expect(gap).toMatchObject({
			status: "inconclusive",
			statusReason: "context-missing",
			statement: "No pod state captured: context kind-pl is not in this machine's kubeconfig.",
		});
		expect(JSON.parse(gap.attributes ?? "{}")).toEqual({ hint: "Re-bind the service in Services." });
	});
});
