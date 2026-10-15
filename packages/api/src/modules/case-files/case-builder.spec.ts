// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { randomBytes, randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import type { BlockedReason, ClaimCoverage, RetrievalReason } from "@prismalens/contracts";
import type {
	Capture,
	CaptureArtifact,
	CaseNode,
	ClaimRevision,
	Prisma,
} from "@prismalens/database";
import { TokenVault } from "@prismalens/integrations";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { CredentialsService } from "../integrations/crypto/credentials.service.js";
import {
	ALERT_AT,
	COLLECTED,
	D1,
	D2,
	deploymentsWithoutReplicas,
	eventsWithVariousInvolved,
	meta,
	replicaSetsRollout30Min,
	replicaSetsRollout3Hours,
	sampleDeployments,
	sampleEvents,
	samplePod,
} from "./__fixtures__/k8s/index.js";

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
const { CaseBuilder, anchorAlert, claimChanged, deriveCase } = await import("./case-builder.js");

const vault = new TokenVault(randomBytes(32));
const credentials = { getVault: () => vault } as unknown as CredentialsService;

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

	async function createCapture(
		overrides: Partial<Parameters<typeof prisma.capture.create>[0]["data"]> = {},
	): Promise<Capture> {
		return prisma.capture.create({
			data: {
				checklistVersion: 1,
				canonicalQuery: "{}",
				queryDigest: randomUUID(),
				kubeContext: "kind-pl",
				cluster: "https://bound-cluster:6443",
				namespace: "shop",
				state: "complete",
				caseStartedAt: ALERT_AT,
				dueAt: ALERT_AT,
				startedAt: ALERT_AT,
				finishedAt: COLLECTED,
				...overrides,
			},
		});
	}

	async function writeArtifact(
		captureId: string,
		seq: number,
		purpose: string,
		json: unknown,
		overrides: Partial<Prisma.CaptureArtifactUncheckedCreateInput> = {},
	): Promise<CaptureArtifact> {
		const bytes = Buffer.from(JSON.stringify(json));
		const { storedBytes: _, ...digests } = await store.write(captureId, seq, bytes, bytes);
		return prisma.captureArtifact.create({
			data: {
				captureId,
				seq,
				purpose,
				command: "[]",
				retrieval: "complete",
				exitCode: 0,
				startedAt: ALERT_AT,
				endedAt: COLLECTED,
				redactions: "{}",
				...digests,
				...overrides,
			},
		});
	}

	it("writes candidate links, observed facts and host-executed provenance, then appends only changes", async () => {
		const incident = await prisma.incident.create({ data: { number: 1, title: "checkout down" } });
		const alert = await prisma.alert.create({
			data: { dedupKey: "k1", title: "High error rate", triggeredAt: ALERT_AT, incidentId: incident.id },
		});
		const capture = await createCapture();
		const lists: Record<string, unknown> = {
			events: sampleEvents,
			deployments: sampleDeployments,
			replicasets: replicaSetsRollout30Min,
			pods: { items: [samplePod("checkout-7d9f-a", D1, 3), samplePod("checkout-7d9f-b", D2, 0)] },
		};
		const artifacts: CaptureArtifact[] = [];
		for (const [seq, [purpose, json]] of Object.entries(lists).entries()) {
			artifacts.push(await writeArtifact(capture.id, seq, purpose, json));
		}

		const input = { incidentId: incident.id, capture, artifacts, alerts: [alert] };
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

		const secondCapture = await createCapture();
		const secondArtifacts: CaptureArtifact[] = [];
		const updatedLists: Record<string, unknown> = {
			...lists,
			pods: { items: [samplePod("checkout-7d9f-a", D1, 4), samplePod("checkout-7d9f-b", D2, 0)] },
		};
		for (const [seq, [purpose, json]] of Object.entries(updatedLists).entries()) {
			secondArtifacts.push(await writeArtifact(secondCapture.id, seq, purpose, json));
		}
		const r3 = await prisma.$transaction((tx) =>
			builder.build(tx, { incidentId: incident.id, capture: secondCapture, artifacts: secondArtifacts, alerts: [alert] }),
		);
		expect(r3.revisions).toBe(1);
		const runs = await prisma.claimRevision.findMany({
			where: { incidentId: incident.id, edge: { relation: "runs" }, statement: { contains: "checkout-7d9f-a" } },
			orderBy: { revision: "asc" },
		});
		expect(runs.map((r) => r.revision)).toEqual([1, 2]);
	});

	it("handles rollout 3 h before, partial replicasets artifact, missed interval and omitted artifact", async () => {
		const incident = await prisma.incident.create({ data: { number: 2, title: "rollout window cases" } });
		const alert = await prisma.alert.create({
			data: { dedupKey: "k2", title: "Latency spike", triggeredAt: ALERT_AT, incidentId: incident.id },
		});

		// Rollout 3 h before alert: no candidate precedes_alert edge, observed no_new_replicaset_before_alert.
		const c1 = await createCapture();
		const a1Deps = await writeArtifact(c1.id, 0, "deployments", sampleDeployments);
		const a1Rs = await writeArtifact(c1.id, 1, "replicasets", replicaSetsRollout3Hours);
		const a1Pods = await writeArtifact(c1.id, 2, "pods", { items: [samplePod("checkout-7d9f-a", D1, 0)] });

		await prisma.$transaction((tx) =>
			builder.build(tx, { incidentId: incident.id, capture: c1, artifacts: [a1Deps, a1Rs, a1Pods], alerts: [alert] }),
		);

		const claims1 = await prisma.claimRevision.findMany({
			where: { incidentId: incident.id },
			include: { edge: true },
		});
		const rsPrecedes = claims1.filter(
			(c) => c.edge?.relation === "precedes_alert" && c.statement.includes("Revision 4 of checkout"),
		);
		expect(rsPrecedes).toHaveLength(0);

		const noRollout1 = claims1.find((c) => c.edge?.relation === "no_new_replicaset_before_alert");
		expect(noRollout1).toMatchObject({
			status: "observed",
			statusReason: null,
			statement:
				"No retained ReplicaSet of checkout was created in the 2 h before the alert; a rollback to an older ReplicaSet would not show here.",
		});
		expect(JSON.parse(noRollout1?.coverage ?? "{}")).toMatchObject({
			retrieval: "complete",
			note: "ReplicaSet history keeps revisionHistoryLimit revisions (default 10)",
		});

		// Partial replicasets artifact: unknown(retrieval-partial).
		const incidentPartial = await prisma.incident.create({ data: { number: 3, title: "partial replicasets" } });
		const alertPartial = await prisma.alert.create({
			data: { dedupKey: "k3", title: "Error rate", triggeredAt: ALERT_AT, incidentId: incidentPartial.id },
		});
		const c2 = await createCapture({ state: "partial", stateReason: "byte-cap" });
		const a2Deps = await writeArtifact(c2.id, 0, "deployments", sampleDeployments);
		const a2Rs = await writeArtifact(c2.id, 1, "replicasets", replicaSetsRollout3Hours, {
			retrieval: "partial",
			retrievalReason: "byte-cap",
		});
		await prisma.$transaction((tx) =>
			builder.build(tx, {
				incidentId: incidentPartial.id,
				capture: c2,
				artifacts: [a2Deps, a2Rs],
				alerts: [alertPartial],
			}),
		);
		const claims2 = await prisma.claimRevision.findMany({
			where: { incidentId: incidentPartial.id },
			include: { edge: true },
		});
		const noRollout2 = claims2.find((c) => c.edge?.relation === "no_new_replicaset_before_alert");
		expect(noRollout2).toMatchObject({
			status: "unknown",
			statusReason: "retrieval-partial",
			statement: "Whether checkout rolled out in the 2 h before the alert is unknown (retrieval-partial).",
		});

		// missedFrom set: unknown(captured-late) plus the missed gap.
		const incidentLate = await prisma.incident.create({ data: { number: 4, title: "late capture" } });
		const alertLate = await prisma.alert.create({
			data: { dedupKey: "k4", title: "Late alert", triggeredAt: ALERT_AT, incidentId: incidentLate.id },
		});
		const missedFrom = new Date("2026-10-15T09:40:00Z");
		const missedTo = new Date("2026-10-15T10:10:00Z");
		const c3 = await createCapture({
			missedFrom,
			missedTo,
			startedAt: missedTo,
		});
		const a3Deps = await writeArtifact(c3.id, 0, "deployments", sampleDeployments);
		const a3Rs = await writeArtifact(c3.id, 1, "replicasets", replicaSetsRollout3Hours);
		await prisma.$transaction((tx) =>
			builder.build(tx, {
				incidentId: incidentLate.id,
				capture: c3,
				artifacts: [a3Deps, a3Rs],
				alerts: [alertLate],
			}),
		);
		const claims3 = await prisma.claimRevision.findMany({
			where: { incidentId: incidentLate.id },
			include: { edge: true, node: true },
		});
		const noRollout3 = claims3.find((c) => c.edge?.relation === "no_new_replicaset_before_alert");
		expect(noRollout3).toMatchObject({
			status: "unknown",
			statusReason: "captured-late",
			statement: "Whether checkout rolled out in the 2 h before the alert is unknown (captured-late).",
		});
		const missedGap = claims3.find((c) => c.node?.kind === "gap" && c.statusReason === "missed");
		expect(missedGap).toMatchObject({
			status: "unknown",
			statusReason: "missed",
			statement: expect.stringMatching(/Captured \d+ min after the alert/),
		});
		expect(JSON.parse(missedGap?.coverage ?? "{}")).toMatchObject({
			retrieval: "partial",
			missedFrom: missedFrom.toISOString(),
			missedTo: missedTo.toISOString(),
		});

		// Missed gap without anchor alert (anchor is null: calculates since from missedFrom).
		const incidentLateNoAlert = await prisma.incident.create({ data: { number: 6, title: "late capture without alert" } });
		await prisma.$transaction((tx) =>
			builder.build(tx, {
				incidentId: incidentLateNoAlert.id,
				capture: c3,
				artifacts: [a3Deps, a3Rs],
				alerts: [],
			}),
		);
		const missedGapNoAlert = await prisma.claimRevision.findFirst({
			where: { incidentId: incidentLateNoAlert.id, node: { kind: "gap" }, statusReason: "missed" },
		});
		expect(missedGapNoAlert).toBeDefined();

		// No replicasets artifact at all: drafted without artifact, partial coverage.
		const incidentNoRs = await prisma.incident.create({ data: { number: 5, title: "missing replicasets artifact" } });
		const alertNoRs = await prisma.alert.create({
			data: { dedupKey: "k5", title: "No rs alert", triggeredAt: ALERT_AT, incidentId: incidentNoRs.id },
		});
		const c4 = await createCapture();
		const a4Deps = await writeArtifact(c4.id, 0, "deployments", sampleDeployments);
		await prisma.$transaction((tx) =>
			builder.build(tx, {
				incidentId: incidentNoRs.id,
				capture: c4,
				artifacts: [a4Deps],
				alerts: [alertNoRs],
			}),
		);
		const claims4 = await prisma.claimRevision.findMany({
			where: { incidentId: incidentNoRs.id },
			include: { edge: true },
		});
		const noRollout4 = claims4.find((c) => c.edge?.relation === "no_new_replicaset_before_alert");
		expect(noRollout4).toMatchObject({
			status: "unknown",
			statusReason: "retrieval-partial",
			artifactId: null,
		});
	});

	it("writes exact statement and hint for all five blocked reasons and handles partial gaps", async () => {
		const blockedCases: Array<{
			reason: BlockedReason;
			expectedStatement: string;
			expectedHint: string;
			extra?: Partial<Capture>;
		}> = [
			{
				reason: "no-kubectl",
				expectedStatement: "No pod state captured: kubectl isn't on PATH on this machine.",
				expectedHint: "Install kubectl, then run pl doctor.",
			},
			{
				reason: "context-missing",
				expectedStatement: "No pod state captured: context custom-ctx is not in this machine's kubeconfig.",
				expectedHint: "Re-bind the service in Services.",
				extra: { kubeContext: "custom-ctx" },
			},
			{
				reason: "identity-mismatch",
				expectedStatement:
					"Not captured: context kind-pl now points at https://rogue-cluster:6443, not the bound https://bound-cluster:6443.",
				expectedHint: "Check kubectl config, or re-bind.",
				extra: {
					kubeContext: "kind-pl",
					cluster: "https://bound-cluster:6443",
					identity: JSON.stringify({
						kubeContext: "kind-pl",
						cluster: "https://rogue-cluster:6443",
						kubeUser: null,
						whoami: null,
						matchesBinding: false,
					}),
				},
			},
			{
				reason: "identity-mismatch",
				expectedStatement:
					"Not captured: context kind-pl now points at another server, not the bound https://bound-cluster:6443.",
				expectedHint: "Check kubectl config, or re-bind.",
				extra: {
					kubeContext: "kind-pl",
					cluster: "https://bound-cluster:6443",
					identity: "invalid-json",
				},
			},
			{
				reason: "unauthorised",
				expectedStatement: "Not captured: the bound identity can't list pods in shop.",
				expectedHint: "Grant get/list on pods, events, replicasets, deployments.",
				extra: { namespace: "shop" },
			},
			{
				reason: "unreachable",
				expectedStatement: "Not captured: the cluster didn't answer.",
				expectedHint: "Check the cluster is reachable from this machine.",
			},
		];

		let incNumber = 10;
		for (const bc of blockedCases) {
			incNumber++;
			const inc = await prisma.incident.create({ data: { number: incNumber, title: `blocked-${bc.reason}` } });
			const capture = await createCapture({
				state: "blocked",
				stateReason: bc.reason,
				...bc.extra,
			});
			await prisma.$transaction((tx) =>
				builder.build(tx, { incidentId: inc.id, capture, artifacts: [], alerts: [] }),
			);
			const gap = await prisma.claimRevision.findFirstOrThrow({
				where: { incidentId: inc.id, node: { kind: "gap" } },
			});
			expect(gap.status).toBe("inconclusive");
			expect(gap.statusReason).toBe(bc.reason);
			expect(gap.statement).toBe(bc.expectedStatement);
			expect(JSON.parse(gap.attributes ?? "{}")).toEqual({ hint: bc.expectedHint });
		}

		// Partial gaps: byte-cap, timeout, error single artifact and multi-artifact cut.
		const incPartial = await prisma.incident.create({ data: { number: 20, title: "partial gaps" } });
		const cPartial = await createCapture({ state: "partial", stateReason: "byte-cap" });
		const aByteCap = await writeArtifact(cPartial.id, 0, "pods", { items: [] }, {
			retrieval: "partial",
			retrievalReason: "byte-cap",
		});
		const aTimeout = await writeArtifact(cPartial.id, 1, "events", { items: [] }, {
			retrieval: "partial",
			retrievalReason: "timeout",
		});
		const aError = await writeArtifact(cPartial.id, 2, "deployments", { items: [] }, {
			retrieval: "partial",
			retrievalReason: "error",
		});

		await prisma.$transaction((tx) =>
			builder.build(tx, {
				incidentId: incPartial.id,
				capture: cPartial,
				artifacts: [aByteCap, aTimeout, aError],
				alerts: [],
			}),
		);

		const gaps = await prisma.claimRevision.findMany({
			where: { incidentId: incPartial.id, node: { kind: "gap" } },
		});
		const byteCapGap = gaps.find((g) => g.statusReason === "byte-cap");
		expect(byteCapGap).toMatchObject({
			status: "unknown",
			statement: "pods was cut: byte-cap.",
			artifactId: aByteCap.id,
		});
		expect(JSON.parse(byteCapGap?.attributes ?? "{}")).toEqual({
			hint: "Coverage is partial; absence here proves nothing.",
		});

		const timeoutGap = gaps.find((g) => g.statusReason === "timeout");
		expect(timeoutGap).toMatchObject({
			status: "unknown",
			statement: "events was cut: timeout.",
			artifactId: aTimeout.id,
		});

		const errorGap = gaps.find((g) => g.statusReason === "error");
		expect(errorGap).toMatchObject({
			status: "unknown",
			statement: "deployments was cut: error.",
			artifactId: aError.id,
		});

		// Multiple artifacts cut with the same reason.
		const incMulti = await prisma.incident.create({ data: { number: 21, title: "multi-artifact cut" } });
		const cMulti = await createCapture({ state: "partial", stateReason: "byte-cap" });
		const aMulti1 = await writeArtifact(cMulti.id, 0, "deployments", { items: [] }, {
			retrieval: "partial",
			retrievalReason: "byte-cap",
		});
		const aMulti2 = await writeArtifact(cMulti.id, 1, "pods", { items: [] }, {
			retrieval: "partial",
			retrievalReason: "byte-cap",
		});
		await prisma.$transaction((tx) =>
			builder.build(tx, {
				incidentId: incMulti.id,
				capture: cMulti,
				artifacts: [aMulti1, aMulti2],
				alerts: [],
			}),
		);
		const multiGap = await prisma.claimRevision.findFirstOrThrow({
			where: { incidentId: incMulti.id, node: { kind: "gap" } },
		});
		expect(multiGap.statement).toBe("deployments, pods were cut: byte-cap.");
		expect(multiGap.artifactId).toBeNull();

		// Capture state is partial without any artifact matching that reason.
		const incCaptureCut = await prisma.incident.create({ data: { number: 22, title: "capture-level cut" } });
		const cCaptureCut = await createCapture({ state: "partial", stateReason: "timeout" });
		await prisma.$transaction((tx) =>
			builder.build(tx, {
				incidentId: incCaptureCut.id,
				capture: cCaptureCut,
				artifacts: [],
				alerts: [],
			}),
		);
		const capGap = await prisma.claimRevision.findFirstOrThrow({
			where: { incidentId: incCaptureCut.id, node: { kind: "gap" } },
		});
		expect(capGap.statement).toBe("The capture was cut: timeout.");
	});

	it("names the logs as cut when only a previous-container log hit the byte cap", async () => {
		const incident = await prisma.incident.create({ data: { number: 23, title: "logs cut" } });
		const capture = await createCapture({ state: "partial", stateReason: "byte-cap" });
		const pods = await writeArtifact(capture.id, 1, "pods", { items: [] });
		const logs = await writeArtifact(capture.id, 2, "logs-previous", "OOM", {
			subject: "checkout-7d9f/app",
			retrieval: "partial",
			retrievalReason: "byte-cap",
		});
		await prisma.$transaction((tx) =>
			builder.build(tx, { incidentId: incident.id, capture, artifacts: [pods, logs], alerts: [] }),
		);
		const gap = await prisma.claimRevision.findFirstOrThrow({
			where: { incidentId: incident.id, node: { kind: "gap" }, statusReason: "byte-cap" },
		});
		expect(gap.statement).toBe("logs-previous was cut: byte-cap.");
		expect(gap.artifactId).toBe(logs.id);
	});

	it("records sourceTime per subject, builds event precedes_alert and maps event populations", async () => {
		const incident = await prisma.incident.create({ data: { number: 30, title: "sourceTime and events" } });
		const alert = await prisma.alert.create({
			data: { dedupKey: "k30", title: "Checkout failures", triggeredAt: ALERT_AT, incidentId: incident.id },
		});
		const capture = await createCapture();

		const aDeps = await writeArtifact(capture.id, 0, "deployments", sampleDeployments);
		const aRs = await writeArtifact(capture.id, 1, "replicasets", replicaSetsRollout30Min);
		const aPods = await writeArtifact(capture.id, 2, "pods", {
			items: [samplePod("checkout-7d9f-a", D1, 2)],
		});
		const aEvents = await writeArtifact(capture.id, 3, "events", {
			items: [
				...sampleEvents.items,
				...eventsWithVariousInvolved.items,
			],
		});

		await prisma.$transaction((tx) =>
			builder.build(tx, {
				incidentId: incident.id,
				capture,
				artifacts: [aDeps, aRs, aPods, aEvents],
				alerts: [alert],
			}),
		);

		const claims = await prisma.claimRevision.findMany({
			where: { incidentId: incident.id },
			include: { edge: { include: { from: true } }, node: true },
		});

		// Check sourceTime per subject.
		const alertClaim = claims.find((c) => c.node?.kind === "alert");
		expect(alertClaim?.sourceTime?.toISOString()).toBe(ALERT_AT.toISOString());

		const revOfClaim = claims.find((c) => c.edge?.relation === "revision_of");
		expect(revOfClaim?.sourceTime?.toISOString()).toBe("2026-10-15T09:30:00.000Z");

		const revPrecedes = claims.find((c) => c.edge?.relation === "precedes_alert" && c.edge?.from.kind === "revision");
		expect(revPrecedes?.sourceTime?.toISOString()).toBe("2026-10-15T09:30:00.000Z");

		const runsClaim = claims.find((c) => c.edge?.relation === "runs");
		expect(runsClaim?.sourceTime?.toISOString()).toBe("2026-10-15T09:31:00.000Z");

		const podPrecedes = claims.find((c) => c.edge?.relation === "precedes_alert" && c.edge?.from.kind === "pod");
		expect(podPrecedes?.sourceTime?.toISOString()).toBe("2026-10-15T09:52:00.000Z");

		const eventObserved = claims.find((c) => c.node?.kind === "k8s-event" && c.node?.label === "BackOff");
		expect(eventObserved?.sourceTime?.toISOString()).toBe("2026-10-15T09:55:00.000Z");

		const eventPrecedes = claims.find(
			(c) => c.edge?.relation === "precedes_alert" && c.edge?.from.kind === "k8s-event",
		);
		expect(eventPrecedes?.status).toBe("candidate");
		expect(eventPrecedes?.statement).toContain("5 min before the alert");
		expect(eventPrecedes?.sourceTime?.toISOString()).toBe("2026-10-15T09:55:00.000Z");

		const workloadNodeClaim = claims.find((c) => c.node?.kind === "workload");
		expect(workloadNodeClaim?.sourceTime).toBeNull();

		// Check event population mappings.
		const evPod = claims.find((c) => c.node?.key === "k8s-event:shop/checkout-7d9f-a.1-uid");
		expect(JSON.parse(evPod?.population ?? "{}")).toEqual({ namespace: "shop", workload: "checkout" });

		const evRs = claims.find((c) => c.node?.key === "k8s-event:shop/ev-rs-uid");
		expect(JSON.parse(evRs?.population ?? "{}")).toEqual({ namespace: "shop", workload: "checkout" });

		const evDep = claims.find((c) => c.node?.key === "k8s-event:shop/ev-dep-uid");
		expect(JSON.parse(evDep?.population ?? "{}")).toEqual({ namespace: "shop", workload: "checkout" });

		const evOrphan = claims.find((c) => c.node?.key === "k8s-event:shop/ev-orphan-pod-uid");
		expect(JSON.parse(evOrphan?.population ?? "{}")).toEqual({ namespace: "shop" });

		const evNode = claims.find((c) => c.node?.key === "k8s-event:shop/ev-node-uid");
		expect(JSON.parse(evNode?.population ?? "{}")).toEqual({ namespace: "shop" });
	});

	it("ignores withheld or expired artifacts and handles artifact sequence resolution", async () => {
		const incident = await prisma.incident.create({ data: { number: 40, title: "withheld artifacts" } });
		const alert = await prisma.alert.create({
			data: { dedupKey: "k40", title: "Withheld alert", triggeredAt: ALERT_AT, incidentId: incident.id },
		});
		const capture = await createCapture();

		// Withheld artifact with redactions error: should be ignored.
		const aWithheldEvents = await writeArtifact(capture.id, 0, "events", sampleEvents, {
			redactions: JSON.stringify({ error: "secretlint failed" }),
		});

		// Expired artifact: should be ignored.
		const aExpiredPods = await writeArtifact(
			capture.id,
			1,
			"pods",
			{ items: [samplePod("checkout-7d9f-a", D1, 1)] },
			{ expiredAt: new Date("2026-10-15T09:00:00Z") },
		);

		// Artifact for another capture: should be ignored.
		const otherCapture = await createCapture();
		const aOtherCapture = await writeArtifact(otherCapture.id, 0, "deployments", sampleDeployments);

		// Artifact for logs-previous: should be skipped by load.
		const aLogs = await writeArtifact(capture.id, 2, "logs-previous", { text: "logs" });

		// Two deployments artifacts: higher seq should win.
		const aDepOlder = await writeArtifact(capture.id, 3, "deployments", deploymentsWithoutReplicas);
		const aDepNewer = await writeArtifact(capture.id, 4, "deployments", sampleDeployments);

		// Artifact whose file is not on disk: readRedactedBytes returns null.
		const aMissingFile = await prisma.captureArtifact.create({
			data: {
				captureId: capture.id,
				seq: 10,
				purpose: "pods",
				command: "[]",
				retrieval: "complete",
				rawBytes: 0,
				rawSha256: "",
				redactedBytes: 0,
				redactedSha256: "",
				startedAt: ALERT_AT,
				endedAt: COLLECTED,
				redactions: "{}",
			},
		});

		await prisma.$transaction((tx) =>
			builder.build(tx, {
				incidentId: incident.id,
				capture,
				artifacts: [aWithheldEvents, aExpiredPods, aOtherCapture, aLogs, aDepNewer, aDepOlder, aMissingFile],
				alerts: [alert],
			}),
		);

		const nodes = await prisma.caseNode.findMany({ where: { incidentId: incident.id } });
		const kinds = nodes.map((n) => n.kind);
		expect(kinds).not.toContain("k8s-event");
		expect(kinds).not.toContain("pod");
		expect(kinds).toContain("workload");

		const depClaim = await prisma.claimRevision.findFirst({
			where: { incidentId: incident.id, node: { kind: "workload" } },
		});
		expect(depClaim?.statement).toContain("1/2 ready");
	});

	it("selects anchorAlert across trigger timings including shared captures after dueAt", async () => {
		const cStarted = {
			id: "c-started",
			startedAt: new Date("2026-10-15T10:00:00Z"),
			dueAt: new Date("2026-10-15T09:50:00Z"),
		} as Capture;

		const a1 = { id: "a1", title: "A1", triggeredAt: new Date("2026-10-15T09:30:00Z"), createdAt: ALERT_AT };
		const a2 = { id: "a2", title: "A2", triggeredAt: new Date("2026-10-15T09:45:00Z"), createdAt: ALERT_AT };
		const a3 = { id: "a3", title: "A3", triggeredAt: new Date("2026-10-15T10:15:00Z"), createdAt: ALERT_AT };

		// Picks newest alert triggered at or before startedAt.
		expect(anchorAlert(cStarted, [a1, a2, a3])?.id).toBe("a2");

		// When startedAt is null, falls back to dueAt.
		const cDue = {
			id: "c-due",
			startedAt: null,
			dueAt: new Date("2026-10-15T09:40:00Z"),
		} as Capture;
		expect(anchorAlert(cDue, [a1, a2, a3])?.id).toBe("a1");

		// Shared capture whose case alerts arrive after dueAt: returns sorted[0] (earliest alert).
		const cShared = {
			id: "c-shared",
			startedAt: null,
			dueAt: new Date("2026-10-15T09:00:00Z"),
		} as Capture;
		expect(anchorAlert(cShared, [a2, a1, a3])?.id).toBe("a1");

		// Empty alerts array returns null.
		expect(anchorAlert(cStarted, [])).toBeNull();

		// Real build with shared capture case alerts arriving after dueAt.
		const incident = await prisma.incident.create({ data: { number: 50, title: "shared capture after dueAt" } });
		const alertLate = await prisma.alert.create({
			data: { dedupKey: "k50", title: "Late firing alert", triggeredAt: new Date("2026-10-15T10:10:00Z"), incidentId: incident.id },
		});
		const sharedCapture = await createCapture({
			startedAt: null,
			dueAt: new Date("2026-10-15T10:00:00Z"),
		});
		const aDeps = await writeArtifact(sharedCapture.id, 0, "deployments", sampleDeployments);
		const aRs = await writeArtifact(sharedCapture.id, 1, "replicasets", {
			items: [
				{
					...meta("checkout-7d9f", {
						creationTimestamp: "2026-10-15T10:05:00Z",
						annotations: { "deployment.kubernetes.io/revision": "4" },
						labels: { "pod-template-hash": "7d9f" },
						ownerReferences: [{ kind: "Deployment", name: "checkout" }],
					}),
					spec: { template: { spec: { containers: [{ name: "app", image: "checkout:v2" }] } } },
					status: { replicas: 2, readyReplicas: 1 },
				},
			],
		});

		await prisma.$transaction((tx) =>
			builder.build(tx, {
				incidentId: incident.id,
				capture: sharedCapture,
				artifacts: [aDeps, aRs],
				alerts: [alertLate],
			}),
		);

		const precedesClaim = await prisma.claimRevision.findFirst({
			where: { incidentId: incident.id, edge: { relation: "precedes_alert" } },
		});
		expect(precedesClaim?.statement).toContain("5 min before the alert");
	});

	it("handles pod variations, deployment variations, and claimChanged branches", async () => {
		const incident = await prisma.incident.create({ data: { number: 60, title: "pod and deployment variations" } });
		const alert = await prisma.alert.create({
			data: { dedupKey: "k60", title: "Variations alert", triggeredAt: ALERT_AT, incidentId: incident.id },
		});
		const capture = await createCapture();

		// Pod with podTemplateHash only (no ownerReferences).
		const podByHash = {
			...meta("pod-hash-match", { labels: { "pod-template-hash": "7d9f" } }),
			spec: { containers: [{ name: "app", image: "checkout:v2" }] },
			status: { phase: "Running", startTime: "2026-10-15T09:30:00Z", containerStatuses: [] },
		};

		// Pod with no matching replicaSet: node claim on pod itself.
		const orphanPod = {
			...meta("orphan-pod"),
			spec: { containers: [{ name: "worker" }] },
			status: {
				phase: "Pending",
				startTime: null,
				containerStatuses: [
					{
						name: "worker",
						restartCount: 1,
						lastState: {
							terminated: { reason: null, exitCode: 1, finishedAt: "2026-10-15T09:50:00Z" },
						},
					},
				],
			},
		};

		// Pod with termination reason only (null exitCode), and finishedAt 5 h before alert.
		const oldCrashPod = {
			...meta("old-crash-pod"),
			spec: { containers: [{ name: "app" }] },
			status: {
				phase: null,
				containerStatuses: [
					{
						name: "app",
						restartCount: 0,
						lastState: {
							terminated: { reason: "Error", exitCode: null, finishedAt: "2026-10-15T05:00:00Z" },
						},
					},
				],
			},
		};

		// Pod with multiple containers having termination, picking the latest.
		const multiTermPod = {
			...meta("multi-term-pod", {
				ownerReferences: [{ kind: "ReplicaSet", name: "checkout-7d9f" }],
			}),
			spec: { containers: [{ name: "c1" }, { name: "c2" }] },
			status: {
				phase: "Running",
				containerStatuses: [
					{
						name: "c1",
						restartCount: 1,
						lastState: {
							terminated: { reason: "OOMKilled", exitCode: 137, finishedAt: "2026-10-15T09:40:00Z" },
						},
					},
					{
						name: "c2",
						restartCount: 1,
						lastState: {
							terminated: { reason: "Error", exitCode: 1, finishedAt: "2026-10-15T09:55:00Z" },
						},
					},
				],
			},
		};

		const aDeps = await writeArtifact(capture.id, 0, "deployments", deploymentsWithoutReplicas);
		const aRs = await writeArtifact(capture.id, 1, "replicasets", replicaSetsRollout30Min);
		const aPods = await writeArtifact(capture.id, 2, "pods", {
			items: [podByHash, orphanPod, oldCrashPod, multiTermPod],
		});

		const baseClaim = {
			status: "observed" as const,
			statusReason: null,
			statement: "Statement",
			attributes: { key: "val" },
			sourceKind: "capture" as const,
			artifactId: null,
			population: null,
			coverage: null,
			sourceTime: null,
			validFrom: ALERT_AT,
			collectedAt: COLLECTED,
		};
		const fixedNow = new Date("2026-10-15T12:00:00Z");
		await prisma.$transaction((tx) =>
			builder.build(tx, {
				incidentId: incident.id,
				capture,
				artifacts: [aDeps, aRs, aPods],
				alerts: [alert],
				now: fixedNow,
			}),
		);

		await prisma.$transaction(async (tx) => {
			const res = await (builder as unknown as {
				write: (tx: unknown, incId: string, draft: unknown, now?: Date) => Promise<{ edges: number }>;
			}).write(
				tx,
				incident.id,
				{
					nodes: [],
					edges: [{ from: "non-existent-a", to: "non-existent-b", relation: "runs", claim: baseClaim }],
				},
				fixedNow,
			);
			expect(res.edges).toBe(0);
		});

		const claims = await prisma.claimRevision.findMany({
			where: { incidentId: incident.id },
			include: { edge: true, node: true },
		});

		// Deployment without replicas and containers.
		const depClaim = claims.find((c) => c.node?.kind === "workload");
		expect(depClaim?.statement).toContain("0/? ready, no containers");

		// Pod matched by hash has runs edge.
		const hashRuns = claims.find(
			(c) => c.edge?.relation === "runs" && c.statement.includes("pod-hash-match"),
		);
		expect(hashRuns).toBeDefined();

		// Orphan pod has runs statement on its node directly.
		const orphanClaim = claims.find((c) => c.node?.kind === "pod" && c.node?.label === "orphan-pod");
		expect(orphanClaim?.statement).toContain("orphan-pod is Pending with 1 restarts");

		// Orphan pod precedes_alert edge has exit code without reason.
		const orphanPrecedes = claims.find(
			(c) => c.edge?.relation === "precedes_alert" && c.statement.includes("orphan-pod restarted (exit 1)"),
		);
		expect(orphanPrecedes).toBeDefined();

		// Old crash pod has no precedes_alert edge.
		const oldCrashPrecedes = claims.find(
			(c) => c.edge?.relation === "precedes_alert" && c.statement.includes("old-crash-pod"),
		);
		expect(oldCrashPrecedes).toBeUndefined();

		// Multi-term pod picked the newer termination at 09:55 (5 min before alert).
		const multiTermPrecedes = claims.find(
			(c) => c.edge?.relation === "precedes_alert" && c.statement.includes("multi-term-pod restarted (Error, exit 1) 5 min before the alert"),
		);
		expect(multiTermPrecedes).toBeDefined();

		// Direct tests for claimChanged.
		expect(claimChanged(null, baseClaim)).toBe(true);
		expect(
			claimChanged(
				{ status: "observed", statusReason: null, statement: "Statement", attributes: '{"key":"val"}' },
				{ ...baseClaim, status: "candidate" },
			),
		).toBe(true);
		expect(
			claimChanged(
				{ status: "observed", statusReason: null, statement: "Statement", attributes: '{"key":"val"}' },
				{ ...baseClaim, statusReason: "reason" },
			),
		).toBe(true);
		expect(
			claimChanged(
				{ status: "observed", statusReason: null, statement: "Statement", attributes: '{"key":"val"}' },
				{ ...baseClaim, statement: "Different statement" },
			),
		).toBe(true);
		expect(
			claimChanged(
				{ status: "observed", statusReason: null, statement: "Statement", attributes: '{"key":"val"}' },
				{ ...baseClaim, attributes: { key: "new-val" } },
			),
		).toBe(true);
		expect(
			claimChanged(
				{ status: "observed", statusReason: null, statement: "Statement", attributes: '{"key":"val"}' },
				baseClaim,
			),
		).toBe(false);
		expect(
			claimChanged(
				{ status: "observed", statusReason: null, statement: "Statement", attributes: null },
				{ ...baseClaim, attributes: { key: "new-val" } },
			),
		).toBe(true);
		expect(
			claimChanged(
				{ status: "observed", statusReason: null, statement: "Statement", attributes: null },
				{ ...baseClaim, attributes: null },
			),
		).toBe(false);
	});
});

describe("deriveCase rollout coverage", () => {
	const artifactRow = (purpose: string): CaptureArtifact => ({
		id: `${purpose}-artifact`,
		captureId: "cap",
		seq: 0,
		purpose,
		subject: null,
		command: "[]",
		retrieval: "complete",
		retrievalReason: null,
		exitCode: 0,
		stderrTail: null,
		startedAt: ALERT_AT,
		endedAt: COLLECTED,
		sourceFrom: null,
		sourceTo: null,
		rawBytes: 0,
		rawSha256: "",
		redactedBytes: 0,
		redactedSha256: "",
		redactions: "{}",
		expiredAt: null,
		createdAt: COLLECTED,
	});
	const capture = {
		id: "cap",
		namespace: "shop",
		state: "complete",
		stateReason: null,
		missedFrom: null,
		missedTo: null,
		dueAt: ALERT_AT,
		startedAt: ALERT_AT,
		finishedAt: COLLECTED,
		identity: null,
	} as Capture;
	const alert = { id: "a1", title: "Latency", triggeredAt: ALERT_AT, createdAt: ALERT_AT };
	const rs = (name: string, revision: string, createdAt: string) => ({
		...meta(name, {
			creationTimestamp: createdAt,
			annotations: { "deployment.kubernetes.io/revision": revision },
			labels: { "pod-template-hash": name.split("-")[1] },
			ownerReferences: [{ kind: "Deployment", name: "checkout", controller: true }],
		}),
		spec: { template: { spec: { containers: [{ name: "app", image: "checkout:v1" }] } } },
		status: { replicas: 2, readyReplicas: 2 },
	});
	const workloadToAlert = (replicasets: unknown) => {
		const draft = deriveCase({
			capture,
			alerts: [alert],
			loaded: {
				deployments: { row: artifactRow("deployments"), json: sampleDeployments },
				replicasets: { row: artifactRow("replicasets"), json: replicasets },
			},
			now: COLLECTED,
		});
		const claims = draft.edges.filter((e) => e.from === "workload:shop/checkout" && e.to === "alert:a1");
		expect(claims).toHaveLength(1);
		return claims[0]?.claim;
	};

	it("does not report observed absence of a rollout after a rollback to a retained ReplicaSet", () => {
		// Five minutes before the alert, checkout rolled back from revision 4 to the older ReplicaSet:
		// the controller re-labels it revision 5 and keeps its creation time from yesterday.
		const claim = workloadToAlert({
			items: [
				rs("checkout-aaa", "5", "2026-10-14T09:00:00Z"),
				rs("checkout-bbb", "4", "2026-10-14T10:00:00Z"),
			],
		});
		expect(claim?.statement).not.toMatch(/no rollout/i);
		expect(claim).toMatchObject({
			status: "observed",
			statement:
				"No retained ReplicaSet of checkout was created in the 2 h before the alert; a rollback to an older ReplicaSet would not show here.",
		});
	});

	it("leaves the rollout unknown when the complete ReplicaSet list retains none for the workload", () => {
		const claim = workloadToAlert({ items: [] });
		expect(claim).toMatchObject({
			status: "unknown",
			statusReason: "no-retained-history",
			statement: "Whether checkout rolled out in the 2 h before the alert is unknown (no-retained-history).",
		});
	});
});
