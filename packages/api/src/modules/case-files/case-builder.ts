// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Turns one capture's redacted artifacts into a case's nodes, edges and claim
 * revisions (spec §2.2, R8). Capture can only say observed, candidate, unknown
 * or inconclusive; a revision is appended only when the claim changed.
 */
import { Injectable } from "@nestjs/common";
import {
	type ArtifactPurpose,
	type BlockedReason,
	CaptureIdentitySchema,
	type ClaimCoverage,
	type ClaimStatus,
	type RetrievalReason,
} from "@prismalens/contracts";
import type {
	Capture,
	CaptureArtifact,
	ClaimRevision,
	Prisma,
} from "@prismalens/database";
import canonicalize from "canonicalize";
import { WINDOW_BEFORE_ALERT_MS } from "./capture/budget.js";
import {
	type ContainerImage,
	type K8sPod,
	type K8sReplicaSet,
	parseDeployments,
	parsePods,
	parseReplicaSets,
	parseWarningEvents,
} from "./capture/k8s-parse.js";
// biome-ignore lint/style/useImportType: Nest injects by the runtime class
import { ArtifactStore } from "./storage/artifact-store.js";

export type CaseNodeKind =
	| "alert"
	| "workload"
	| "revision"
	| "pod"
	| "k8s-event"
	| "gap";
export type CaseRelation =
	| "revision_of"
	| "runs"
	| "precedes_alert"
	| "no_new_replicaset_before_alert";
export type CaptureClaimStatus = Extract<
	ClaimStatus,
	"observed" | "candidate" | "unknown" | "inconclusive"
>;

/** The alert fields the builder reads; a Prisma `Alert` row fits. */
export interface CaseAlert {
	id: string;
	title: string;
	severity?: string | null;
	triggeredAt: Date;
	createdAt: Date;
}

export interface CaseBuildInput {
	incidentId: string;
	capture: Capture;
	artifacts: CaptureArtifact[];
	alerts: CaseAlert[];
	now?: Date;
}

export interface CaseBuildResult {
	nodes: number;
	edges: number;
	revisions: number;
}

export interface ClaimDraft {
	status: CaptureClaimStatus;
	statusReason: string | null;
	statement: string;
	attributes: Record<string, unknown> | null;
	sourceKind: "capture" | "alert";
	artifactId: string | null;
	population: Record<string, string> | null;
	coverage: ClaimCoverage | null;
	sourceTime: Date | null;
	validFrom: Date;
	collectedAt: Date;
}

export interface NodeDraft {
	kind: CaseNodeKind;
	key: string;
	label: string;
	claim: ClaimDraft | null;
}

export interface EdgeDraft {
	from: string;
	to: string;
	relation: CaseRelation;
	claim: ClaimDraft;
}

export interface CaseDraft {
	nodes: NodeDraft[];
	edges: EdgeDraft[];
}

/** One purpose's newest artifact; `json` is null when it is withheld, expired, missing or cut mid-document. */
export interface LoadedArtifact {
	row: CaptureArtifact;
	json: unknown | null;
}

export type LoadedArtifacts = Partial<Record<ArtifactPurpose, LoadedArtifact>>;

const MIN_MS = 60_000;
const NO_ROLLOUT_NOTE =
	"ReplicaSet history keeps revisionHistoryLimit revisions (default 10)";

const GAP_TEXT: Record<
	BlockedReason,
	(c: Capture, server: string) => { statement: string; hint: string }
> = {
	"no-kubectl": () => ({
		statement: "No pod state captured: kubectl isn't on PATH on this machine.",
		hint: "Install kubectl, then run pl doctor.",
	}),
	"context-missing": (c) => ({
		statement: `No pod state captured: context ${c.kubeContext} is not in this machine's kubeconfig.`,
		hint: "Re-bind the service in Services.",
	}),
	"identity-mismatch": (c, server) => ({
		statement: `Not captured: context ${c.kubeContext} now points at ${server}, not the bound ${c.cluster}.`,
		hint: "Check kubectl config, or re-bind.",
	}),
	unauthorised: (c) => ({
		statement: `Not captured: the bound identity can't list pods in ${c.namespace}.`,
		hint: "Grant get/list on pods, events, replicasets, deployments.",
	}),
	unreachable: () => ({
		statement: "Not captured: the cluster didn't answer.",
		hint: "Check the cluster is reachable from this machine.",
	}),
};

const PARTIAL_HINT = "Coverage is partial; absence here proves nothing.";

const iso = (d: Date | null | undefined): string | undefined =>
	d ? d.toISOString() : undefined;

const toDate = (s: string | null): Date | null => (s ? new Date(s) : null);

function canonical(value: unknown): string | null {
	return value === null || value === undefined
		? null
		: (canonicalize(value) ?? null);
}

function isBlockedReason(value: string | null): value is BlockedReason {
	return value !== null && value in GAP_TEXT;
}

function isRetrievalReason(value: string | null): value is RetrievalReason {
	return (
		value === "page-limit" ||
		value === "byte-cap" ||
		value === "timeout" ||
		value === "error"
	);
}

/** The alert this capture answers: the newest one raised by the time it started, else the earliest. */
export function anchorAlert(
	capture: Capture,
	alerts: CaseAlert[],
): CaseAlert | null {
	const by = (capture.startedAt ?? capture.dueAt).getTime();
	const sorted = [...alerts].sort(
		(a, b) => a.triggeredAt.getTime() - b.triggeredAt.getTime(),
	);
	const before = sorted.filter((a) => a.triggeredAt.getTime() <= by);
	return before.at(-1) ?? sorted[0] ?? null;
}

/** Minutes before the anchor when `at` falls in the window, else null. */
function minutesBefore(at: string | null, anchor: Date): number | null {
	if (at === null) return null;
	const delta = anchor.getTime() - Date.parse(at);
	return delta >= 0 && delta <= WINDOW_BEFORE_ALERT_MS
		? Math.round(delta / MIN_MS)
		: null;
}

/** The pure part: which subjects a capture supports and what each claims. */
export function deriveCase(input: {
	capture: Capture;
	alerts: CaseAlert[];
	loaded: LoadedArtifacts;
	now: Date;
}): CaseDraft {
	const { capture, alerts, loaded, now } = input;
	const ns = capture.namespace;
	const nodes = new Map<string, NodeDraft>();
	const edges: EdgeDraft[] = [];
	const addNode = (n: NodeDraft): string => {
		const existing = nodes.get(n.key);
		if (!existing || (existing.claim === null && n.claim !== null))
			nodes.set(n.key, n);
		return n.key;
	};
	const missed =
		capture.missedFrom && capture.missedTo
			? { missedFrom: iso(capture.missedFrom), missedTo: iso(capture.missedTo) }
			: {};
	const fromArtifact = (
		a: LoadedArtifact,
		claim: Omit<
			ClaimDraft,
			"sourceKind" | "artifactId" | "coverage" | "validFrom" | "collectedAt"
		>,
	): ClaimDraft => ({
		...claim,
		sourceKind: "capture",
		artifactId: a.row.id,
		coverage: {
			retrieval: a.row.retrieval === "complete" ? "complete" : "partial",
			...(isRetrievalReason(a.row.retrievalReason)
				? { reason: a.row.retrievalReason }
				: {}),
			...missed,
		},
		validFrom: a.row.endedAt,
		collectedAt: a.row.endedAt,
	});

	const anchor = anchorAlert(capture, alerts);
	for (const alert of alerts) {
		addNode({
			kind: "alert",
			key: `alert:${alert.id}`,
			label: alert.title,
			claim: {
				status: "observed",
				statusReason: null,
				statement: `Alert "${alert.title}" fired at ${alert.triggeredAt.toISOString()}.`,
				attributes: { title: alert.title, severity: alert.severity ?? null },
				sourceKind: "alert",
				artifactId: null,
				population: { namespace: ns },
				coverage: null,
				sourceTime: alert.triggeredAt,
				validFrom: alert.triggeredAt,
				collectedAt: alert.createdAt,
			},
		});
	}
	const alertKey = anchor ? `alert:${anchor.id}` : null;

	const workloadKey = (dep: string) => `workload:${ns}/${dep}`;
	const deployments = loaded.deployments;
	const workloads = new Set<string>();
	if (deployments?.json != null) {
		for (const d of parseDeployments(deployments.json)) {
			workloads.add(d.name);
			addNode({
				kind: "workload",
				key: workloadKey(d.name),
				label: `${ns}/${d.name}`,
				claim: fromArtifact(deployments, {
					status: "observed",
					statusReason: null,
					statement: `Deployment ${d.name}: ${d.readyReplicas}/${d.replicas ?? "?"} ready, ${imagesText(d.images)}.`,
					attributes: {
						replicas: d.replicas,
						readyReplicas: d.readyReplicas,
						revisionHistoryLimit: d.revisionHistoryLimit,
						images: d.images.map(({ container, tag }) => ({ container, tag })),
					},
					population: { namespace: ns, workload: d.name },
					sourceTime: null,
				}),
			});
		}
	}

	const pods = loaded.pods?.json != null ? parsePods(loaded.pods.json) : [];
	const rsArtifact = loaded.replicasets;
	const replicaSets =
		rsArtifact?.json != null
			? parseReplicaSets(rsArtifact.json).filter((rs) => rs.owner !== null)
			: [];
	const revisionKey = (rs: K8sReplicaSet) =>
		`revision:${ns}/${rs.owner}#${rs.revision}`;
	const rolledOutInWindow = new Set<string>();
	const retained = new Map<string, number>();
	for (const rs of rsArtifact ? replicaSets : []) {
		if (!rsArtifact) continue;
		const dep = rs.owner as string;
		workloads.add(dep);
		retained.set(dep, (retained.get(dep) ?? 0) + 1);
		const wKey = addNode({
			kind: "workload",
			key: workloadKey(dep),
			label: `${ns}/${dep}`,
			claim: null,
		});
		const rKey = addNode({
			kind: "revision",
			key: revisionKey(rs),
			label: `${dep} #${rs.revision}`,
			claim: null,
		});
		const population = {
			namespace: ns,
			workload: dep,
			revision: String(rs.revision),
		};
		const images = rs.images.map((img) => ({
			container: img.container,
			tag: img.tag,
			digests: digestsFor(rs, img, pods),
		}));
		const forked = images.filter((i) => i.digests.length > 1);
		edges.push({
			from: rKey,
			to: wKey,
			relation: "revision_of",
			claim: fromArtifact(rsArtifact, {
				status: "observed",
				statusReason: null,
				statement:
					`Revision ${rs.revision} of ${dep}: ${imagesText(rs.images)}; ${rs.readyReplicas}/${rs.replicas} ready.` +
					forked
						.map(
							(i) =>
								` Tag ${i.tag ?? "(none)"} of ${i.container} maps to ${i.digests.length} digests: ${i.digests.join(", ")}.`,
						)
						.join(""),
				attributes: {
					revision: rs.revision,
					replicaSet: rs.name,
					createdAt: rs.createdAt,
					replicas: rs.replicas,
					ready: rs.readyReplicas,
					images,
				},
				population,
				sourceTime: toDate(rs.createdAt),
			}),
		});
		const m = anchor ? minutesBefore(rs.createdAt, anchor.triggeredAt) : null;
		if (m !== null && alertKey) {
			rolledOutInWindow.add(dep);
			edges.push({
				from: rKey,
				to: alertKey,
				relation: "precedes_alert",
				claim: fromArtifact(rsArtifact, {
					status: "candidate",
					statusReason: null,
					statement: `Revision ${rs.revision} of ${dep} rolled out ${m} min before the alert`,
					attributes: { minutesBefore: m, at: rs.createdAt },
					population,
					sourceTime: toDate(rs.createdAt),
				}),
			});
		}
	}

	const podArtifact = loaded.pods;
	const workloadOfPod = new Map<string, string>();
	for (const pod of podArtifact ? pods : []) {
		if (!podArtifact) continue;
		const rs = replicaSetOf(pod, replicaSets);
		const dep = rs?.owner ?? null;
		if (dep) workloadOfPod.set(pod.name, dep);
		const population: Record<string, string> = {
			namespace: ns,
			...(dep ? { workload: dep } : {}),
			...(rs ? { revision: String(rs.revision) } : {}),
			pod: pod.name,
		};
		const last = latestTermination(pod);
		const restartCount = pod.containers.reduce((n, c) => n + c.restartCount, 0);
		const attributes = {
			phase: pod.phase,
			startTime: pod.startTime,
			restartCount,
			imageIDs: pod.containers.flatMap((c) => (c.imageID ? [c.imageID] : [])),
			lastTermination: last
				? {
						reason: last.reason,
						exitCode: last.exitCode,
						finishedAt: last.finishedAt,
					}
				: null,
		};
		const runs = fromArtifact(podArtifact, {
			status: "observed",
			statusReason: null,
			statement: rs
				? `${pod.name} runs revision ${rs.revision} of ${dep} (${pod.phase ?? "unknown phase"}, ${restartCount} restarts).`
				: `${pod.name} is ${pod.phase ?? "in an unknown phase"} with ${restartCount} restarts.`,
			attributes,
			population,
			sourceTime: toDate(pod.startTime),
		});
		const pKey = addNode({
			kind: "pod",
			key: `pod:${ns}/${pod.name}/${pod.uid ?? "unknown"}`,
			label: pod.name,
			claim: rs ? null : runs,
		});
		if (rs) {
			edges.push({
				from: pKey,
				to: revisionKey(rs),
				relation: "runs",
				claim: runs,
			});
		}
		const m =
			anchor && last
				? minutesBefore(last.finishedAt, anchor.triggeredAt)
				: null;
		if (m !== null && alertKey && last) {
			const why = [
				last.reason,
				last.exitCode !== null ? `exit ${last.exitCode}` : null,
			].filter((s): s is string => s !== null);
			edges.push({
				from: pKey,
				to: alertKey,
				relation: "precedes_alert",
				claim: fromArtifact(podArtifact, {
					status: "candidate",
					statusReason: null,
					statement: `${pod.name} restarted${why.length ? ` (${why.join(", ")})` : ""} ${m} min before the alert`,
					attributes: {
						minutesBefore: m,
						container: last.container,
						reason: last.reason,
						exitCode: last.exitCode,
						finishedAt: last.finishedAt,
					},
					population,
					sourceTime: toDate(last.finishedAt),
				}),
			});
		}
	}

	const eventArtifact = loaded.events;
	if (eventArtifact?.json != null) {
		for (const ev of parseWarningEvents(eventArtifact.json)) {
			const involved = ev.involvedObject;
			const dep =
				involved.kind === "Deployment"
					? involved.name
					: involved.kind === "ReplicaSet"
						? (replicaSets.find((rs) => rs.name === involved.name)?.owner ??
							null)
						: involved.kind === "Pod" && involved.name
							? (workloadOfPod.get(involved.name) ?? null)
							: null;
			const population: Record<string, string> = {
				namespace: ns,
				...(dep ? { workload: dep } : {}),
			};
			const what = `${ev.reason ?? "Warning"}: ${ev.message ?? ""}`.trim();
			const eKey = addNode({
				kind: "k8s-event",
				key: `k8s-event:${ns}/${ev.uid ?? ev.name}`,
				label: ev.reason ?? ev.name,
				claim: fromArtifact(eventArtifact, {
					status: "observed",
					statusReason: null,
					statement: `${what} (${involved.kind ?? "object"}/${involved.name ?? "?"})`,
					attributes: {
						reason: ev.reason,
						message: ev.message,
						count: ev.count,
						involvedObject: involved,
					},
					population,
					sourceTime: toDate(ev.time),
				}),
			});
			const m = anchor ? minutesBefore(ev.time, anchor.triggeredAt) : null;
			if (m !== null && alertKey) {
				edges.push({
					from: eKey,
					to: alertKey,
					relation: "precedes_alert",
					claim: fromArtifact(eventArtifact, {
						status: "candidate",
						statusReason: null,
						statement: `${what}, ${m} min before the alert`,
						attributes: { minutesBefore: m, at: ev.time },
						population,
						sourceTime: toDate(ev.time),
					}),
				});
			}
		}
	}

	// R8: only a complete history captured on time is observed, and only as "no ReplicaSet was
	// created": a rollback re-labels an older ReplicaSet without a new creationTimestamp.
	if (alertKey) {
		const late = capture.missedFrom !== null;
		const complete =
			rsArtifact?.json != null && rsArtifact.row.retrieval === "complete";
		for (const dep of workloads) {
			if (rolledOutInWindow.has(dep)) continue;
			const reason = !complete
				? "retrieval-partial"
				: late
					? "captured-late"
					: !retained.has(dep)
						? "no-retained-history"
						: null;
			const claim: Parameters<typeof fromArtifact>[1] = {
				status: reason ? "unknown" : "observed",
				statusReason: reason,
				statement: reason
					? `Whether ${dep} rolled out in the 2 h before the alert is unknown (${reason}).`
					: `No retained ReplicaSet of ${dep} was created in the 2 h before the alert; a rollback to an older ReplicaSet would not show here.`,
				attributes: {
					windowMs: WINDOW_BEFORE_ALERT_MS,
					retainedReplicaSets: retained.get(dep) ?? 0,
				},
				population: { namespace: ns, workload: dep },
				sourceTime: null,
			};
			// No replicasets artifact at all (deadline): the claim rests on nothing captured.
			const drafted: ClaimDraft = rsArtifact
				? fromArtifact(rsArtifact, claim)
				: {
						...claim,
						sourceKind: "capture",
						artifactId: null,
						coverage: { retrieval: "partial", ...missed },
						validFrom: capture.finishedAt ?? now,
						collectedAt: capture.finishedAt ?? now,
					};
			edges.push({
				from: addNode({
					kind: "workload",
					key: workloadKey(dep),
					label: `${ns}/${dep}`,
					claim: null,
				}),
				to: alertKey,
				relation: "no_new_replicaset_before_alert",
				claim: {
					...drafted,
					coverage: {
						...(drafted.coverage ?? { retrieval: "partial" }),
						note: NO_ROLLOUT_NOTE,
					},
				},
			});
		}
	}

	for (const gap of gapClaims(capture, loaded, anchor, now)) addNode(gap);
	return { nodes: [...nodes.values()], edges };
}

function imagesText(images: ContainerImage[]): string {
	return images.length
		? images.map((i) => `${i.container} ${i.tag ?? i.image}`).join(", ")
		: "no containers";
}

function replicaSetOf(
	pod: K8sPod,
	replicaSets: K8sReplicaSet[],
): K8sReplicaSet | undefined {
	return (
		replicaSets.find((rs) => pod.owner !== null && rs.name === pod.owner) ??
		replicaSets.find(
			(rs) =>
				pod.podTemplateHash !== null &&
				rs.podTemplateHash === pod.podTemplateHash,
		)
	);
}

/** Digests pulled for one container of a revision, from pods with its pod-template-hash (s03). */
function digestsFor(
	rs: K8sReplicaSet,
	img: ContainerImage,
	pods: K8sPod[],
): string[] {
	const found = new Set<string>();
	for (const pod of pods) {
		if (
			rs.podTemplateHash === null ||
			pod.podTemplateHash !== rs.podTemplateHash
		)
			continue;
		for (const c of pod.containers) {
			if (c.name === img.container && c.digest) found.add(c.digest);
		}
	}
	return [...found].sort();
}

function latestTermination(pod: K8sPod) {
	let best: {
		container: string;
		reason: string | null;
		exitCode: number | null;
		finishedAt: string | null;
	} | null = null;
	for (const c of pod.containers) {
		const t = c.lastTermination;
		if (!t) continue;
		const at = t.finishedAt ? Date.parse(t.finishedAt) : -Infinity;
		const bestAt = best?.finishedAt ? Date.parse(best.finishedAt) : -Infinity;
		if (!best || at > bestAt) best = { container: c.name, ...t };
	}
	return best;
}

function gapClaims(
	capture: Capture,
	loaded: LoadedArtifacts,
	anchor: CaseAlert | null,
	now: Date,
): NodeDraft[] {
	const at = capture.finishedAt ?? capture.startedAt ?? now;
	const gap = (
		reason: string,
		status: CaptureClaimStatus,
		statement: string,
		hint: string | null,
		artifactId: string | null,
		coverage: ClaimCoverage | null,
	): NodeDraft => ({
		kind: "gap",
		key: `gap:${capture.id}:${reason}`,
		label: reason,
		claim: {
			status,
			statusReason: reason,
			statement,
			attributes: { hint },
			sourceKind: "capture",
			artifactId,
			population: { namespace: capture.namespace },
			coverage,
			sourceTime: null,
			validFrom: at,
			collectedAt: at,
		},
	});
	const out: NodeDraft[] = [];

	if (capture.state === "blocked" && isBlockedReason(capture.stateReason)) {
		const identity = CaptureIdentitySchema.safeParse(
			capture.identity ? safeJson(capture.identity) : null,
		);
		const server = identity.success ? identity.data.cluster : "another server";
		const text = GAP_TEXT[capture.stateReason](capture, server);
		out.push(
			gap(
				capture.stateReason,
				"inconclusive",
				text.statement,
				text.hint,
				null,
				null,
			),
		);
	}

	const cut = new Map<RetrievalReason, LoadedArtifact[]>();
	for (const a of Object.values(loaded)) {
		if (!a) continue;
		const reason = a.row.retrievalReason;
		if (a.row.retrieval === "partial" && isRetrievalReason(reason))
			cut.set(reason, [...(cut.get(reason) ?? []), a]);
	}
	if (
		capture.state === "partial" &&
		isRetrievalReason(capture.stateReason) &&
		!cut.has(capture.stateReason)
	)
		cut.set(capture.stateReason, []);
	for (const [reason, arts] of cut) {
		const purposes = arts.map((a) => a.row.purpose);
		const statement = purposes.length
			? `${purposes.join(", ")} ${purposes.length > 1 ? "were" : "was"} cut: ${reason}.`
			: `The capture was cut: ${reason}.`;
		out.push(
			gap(
				reason,
				"unknown",
				statement,
				PARTIAL_HINT,
				arts.length === 1 ? (arts[0]?.row.id ?? null) : null,
				{ retrieval: "partial", reason },
			),
		);
	}

	if (capture.missedFrom && capture.missedTo) {
		const started = capture.startedAt ?? capture.missedTo;
		const since = anchor ? anchor.triggeredAt : capture.missedFrom;
		const n = Math.max(
			0,
			Math.round((started.getTime() - since.getTime()) / MIN_MS),
		);
		out.push(
			gap(
				"missed",
				"unknown",
				`Captured ${n} min after the alert; events older than the cluster's event TTL (default 1 h) may be gone.`,
				null,
				null,
				{
					retrieval: "partial",
					missedFrom: capture.missedFrom.toISOString(),
					missedTo: capture.missedTo.toISOString(),
				},
			),
		);
	}
	return out;
}

function safeJson(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return null;
	}
}

/** Whether a draft says something the subject's latest revision does not (the §2.2 append rule). */
export function claimChanged(
	latest: Pick<
		ClaimRevision,
		"status" | "statusReason" | "statement" | "attributes"
	> | null,
	draft: ClaimDraft,
): boolean {
	if (!latest) return true;
	return (
		latest.status !== draft.status ||
		latest.statusReason !== draft.statusReason ||
		latest.statement !== draft.statement ||
		canonical(latest.attributes ? safeJson(latest.attributes) : null) !==
			canonical(draft.attributes)
	);
}

@Injectable()
export class CaseBuilder {
	constructor(private readonly store: ArtifactStore) {}

	async build(
		tx: Prisma.TransactionClient,
		input: CaseBuildInput,
	): Promise<CaseBuildResult> {
		const loaded = await this.load(input.capture.id, input.artifacts);
		const draft = deriveCase({
			capture: input.capture,
			alerts: input.alerts,
			loaded,
			now: input.now ?? new Date(),
		});
		return this.write(tx, input.incidentId, draft, input.now);
	}

	/** Newest artifact per purpose, parsed from its redacted copy only. */
	private async load(
		captureId: string,
		artifacts: CaptureArtifact[],
	): Promise<LoadedArtifacts> {
		const newest = new Map<ArtifactPurpose, CaptureArtifact>();
		for (const row of artifacts) {
			if (row.captureId !== captureId || row.purpose === "logs-previous")
				continue;
			const purpose = row.purpose as ArtifactPurpose;
			const seen = newest.get(purpose);
			if (!seen || row.seq > seen.seq) newest.set(purpose, row);
		}
		const loaded: LoadedArtifacts = {};
		for (const [purpose, row] of newest) {
			loaded[purpose] = { row, json: await this.parse(row) };
		}
		return loaded;
	}

	private async parse(row: CaptureArtifact): Promise<unknown | null> {
		const redactions = safeJson(row.redactions);
		if (
			row.expiredAt ||
			(typeof redactions === "object" &&
				redactions !== null &&
				"error" in redactions)
		)
			return null;
		const bytes = await this.store.readRedactedBytes(row);
		return bytes ? safeJson(bytes.toString("utf8")) : null;
	}

	private async write(
		tx: Prisma.TransactionClient,
		incidentId: string,
		draft: CaseDraft,
		now: Date | undefined,
	): Promise<CaseBuildResult> {
		const result: CaseBuildResult = { nodes: 0, edges: 0, revisions: 0 };
		const nodeIds = new Map<string, string>();
		for (const n of draft.nodes) {
			const row = await tx.caseNode.upsert({
				where: { incidentId_key: { incidentId, key: n.key } },
				create: { incidentId, kind: n.kind, key: n.key, label: n.label },
				update: {},
				select: { id: true },
			});
			nodeIds.set(n.key, row.id);
			result.nodes++;
			if (
				n.claim &&
				(await this.append(tx, incidentId, { nodeId: row.id }, n.claim, now))
			)
				result.revisions++;
		}
		for (const e of draft.edges) {
			const fromNodeId = nodeIds.get(e.from);
			const toNodeId = nodeIds.get(e.to);
			if (!fromNodeId || !toNodeId) continue;
			const row = await tx.caseEdge.upsert({
				where: {
					fromNodeId_toNodeId_relation: {
						fromNodeId,
						toNodeId,
						relation: e.relation,
					},
				},
				create: { incidentId, fromNodeId, toNodeId, relation: e.relation },
				update: {},
				select: { id: true },
			});
			result.edges++;
			if (await this.append(tx, incidentId, { edgeId: row.id }, e.claim, now))
				result.revisions++;
		}
		return result;
	}

	private async append(
		tx: Prisma.TransactionClient,
		incidentId: string,
		subject: { nodeId: string } | { edgeId: string },
		claim: ClaimDraft,
		now: Date | undefined,
	): Promise<boolean> {
		const latest = await tx.claimRevision.findFirst({
			where: subject,
			orderBy: { revision: "desc" },
			select: {
				revision: true,
				status: true,
				statusReason: true,
				statement: true,
				attributes: true,
			},
		});
		if (!claimChanged(latest, claim)) return false;
		await tx.claimRevision.create({
			data: {
				incidentId,
				...subject,
				revision: (latest?.revision ?? 0) + 1,
				status: claim.status,
				statusReason: claim.statusReason,
				statement: claim.statement,
				attributes: canonical(claim.attributes),
				sourceKind: claim.sourceKind,
				provenance: "host-executed",
				artifactId: claim.artifactId,
				population: canonical(claim.population),
				coverage: canonical(claim.coverage),
				sourceTime: claim.sourceTime,
				validKind: "instant",
				validFrom: claim.validFrom,
				collectedAt: claim.collectedAt,
				...(now ? { recordedAt: now } : {}),
			},
		});
		return true;
	}
}
