// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Pure parsers over `kubectl get <kind> -o json` lists (and `--timestamps` log
 * text). Input is untrusted JSON, so every field is narrowed and a malformed
 * item yields nulls, never a throw.
 */
import type { ArtifactPurpose } from "@prismalens/contracts";
import { MAX_LOG_CONTAINERS, MAX_WARNING_EVENTS } from "./budget.js";

type Json = Record<string, unknown>;

export interface ContainerImage {
	container: string;
	image: string;
	tag: string | null;
}

export interface K8sDeployment {
	namespace: string;
	name: string;
	uid: string | null;
	createdAt: string | null;
	replicas: number | null;
	readyReplicas: number;
	revisionHistoryLimit: number | null;
	images: ContainerImage[];
}

export interface K8sReplicaSet {
	namespace: string;
	name: string;
	uid: string | null;
	revision: number;
	/** The owning Deployment's name. */
	owner: string | null;
	podTemplateHash: string | null;
	createdAt: string | null;
	replicas: number;
	readyReplicas: number;
	images: ContainerImage[];
}

export interface K8sTermination {
	reason: string | null;
	exitCode: number | null;
	finishedAt: string | null;
}

export interface K8sPodContainer {
	name: string;
	image: string | null;
	imageID: string | null;
	/** The `sha256:…` suffix of imageID; null while the pod is pending. */
	digest: string | null;
	ready: boolean;
	restartCount: number;
	lastTermination: K8sTermination | null;
}

export interface K8sPod {
	namespace: string;
	name: string;
	uid: string | null;
	phase: string | null;
	startTime: string | null;
	podTemplateHash: string | null;
	/** The owning ReplicaSet's name. */
	owner: string | null;
	ownerUid: string | null;
	containers: K8sPodContainer[];
}

export interface K8sWarningEvent {
	namespace: string;
	name: string;
	uid: string | null;
	reason: string | null;
	message: string | null;
	count: number | null;
	involvedObject: { kind: string | null; name: string | null };
	/** lastTimestamp, else eventTime, else series.lastObservedTime, else firstTimestamp. */
	time: string | null;
}

export interface CrashedContainer {
	pod: string;
	container: string;
	reason: string | null;
	exitCode: number | null;
	finishedAt: string | null;
}

function obj(value: unknown): Json {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Json)
		: {};
}

function list(value: unknown): unknown[] {
	return Array.isArray(value) ? value : [];
}

function str(value: unknown): string | null {
	return typeof value === "string" && value.length > 0 ? value : null;
}

function int(value: unknown): number | null {
	return typeof value === "number" && Number.isInteger(value) ? value : null;
}

/** A Kubernetes timestamp, kept as the source wrote it; null when absent or unparseable. */
function time(value: unknown): string | null {
	const s = str(value);
	return s !== null && !Number.isNaN(Date.parse(s)) ? s : null;
}

function items(listJson: unknown): Json[] {
	return list(obj(listJson).items).map(obj);
}

function ownerRef(meta: Json, kind: string): Json | undefined {
	return list(meta.ownerReferences)
		.map(obj)
		.find((ref) => ref.kind === kind);
}

function controllerOwner(meta: Json, kind: string): string | null {
	return str(ownerRef(meta, kind)?.name);
}

/** `repo/name:tag@sha256:…` → `tag`; a registry port is not a tag. */
export function imageTag(image: string): string | null {
	const withoutDigest = image.split("@")[0];
	const colon = withoutDigest.lastIndexOf(":");
	if (colon === -1 || colon < withoutDigest.lastIndexOf("/")) return null;
	return withoutDigest.slice(colon + 1) || null;
}

export function imageDigest(imageID: string | null): string | null {
	const match = imageID?.match(/sha256:[0-9a-f]{64}/i);
	return match ? match[0].toLowerCase() : null;
}

function podSpecImages(podSpec: Json): ContainerImage[] {
	return list(podSpec.containers)
		.map(obj)
		.flatMap((c) => {
			const container = str(c.name);
			const image = str(c.image);
			return container && image
				? [{ container, image, tag: imageTag(image) }]
				: [];
		});
}

export function parseDeployments(listJson: unknown): K8sDeployment[] {
	return items(listJson).flatMap((item) => {
		const meta = obj(item.metadata);
		const name = str(meta.name);
		if (name === null) return [];
		const spec = obj(item.spec);
		const status = obj(item.status);
		return [
			{
				namespace: str(meta.namespace) ?? "",
				name,
				uid: str(meta.uid),
				createdAt: time(meta.creationTimestamp),
				replicas: int(spec.replicas),
				readyReplicas: int(status.readyReplicas) ?? 0,
				revisionHistoryLimit: int(spec.revisionHistoryLimit),
				images: podSpecImages(obj(obj(spec.template).spec)),
			},
		];
	});
}

/** ReplicaSets with a `deployment.kubernetes.io/revision` annotation; others are ignored. */
export function parseReplicaSets(listJson: unknown): K8sReplicaSet[] {
	return items(listJson).flatMap((item) => {
		const meta = obj(item.metadata);
		const name = str(meta.name);
		const revision = Number(
			str(obj(meta.annotations)["deployment.kubernetes.io/revision"]),
		);
		if (name === null || !Number.isInteger(revision) || revision <= 0) {
			return [];
		}
		const spec = obj(item.spec);
		const status = obj(item.status);
		return [
			{
				namespace: str(meta.namespace) ?? "",
				name,
				uid: str(meta.uid),
				revision,
				owner: controllerOwner(meta, "Deployment"),
				podTemplateHash: str(obj(meta.labels)["pod-template-hash"]),
				createdAt: time(meta.creationTimestamp),
				replicas: int(status.replicas) ?? 0,
				readyReplicas: int(status.readyReplicas) ?? 0,
				images: podSpecImages(obj(obj(spec.template).spec)),
			},
		];
	});
}

function termination(state: unknown): K8sTermination | null {
	const terminated = obj(obj(state).terminated);
	if (Object.keys(terminated).length === 0) return null;
	return {
		reason: str(terminated.reason),
		exitCode: int(terminated.exitCode),
		finishedAt: time(terminated.finishedAt),
	};
}

export function parsePods(listJson: unknown): K8sPod[] {
	return items(listJson).flatMap((item) => {
		const meta = obj(item.metadata);
		const name = str(meta.name);
		if (name === null) return [];
		const status = obj(item.status);
		const specImages = new Map(
			podSpecImages(obj(item.spec)).map((c) => [c.container, c.image]),
		);
		const statuses = list(status.containerStatuses).map(obj);
		const containers: K8sPodContainer[] = statuses.flatMap((cs) => {
			const cname = str(cs.name);
			if (cname === null) return [];
			const imageID = str(cs.imageID);
			return [
				{
					name: cname,
					image: str(cs.image) ?? specImages.get(cname) ?? null,
					imageID,
					digest: imageDigest(imageID),
					ready: cs.ready === true,
					restartCount: int(cs.restartCount) ?? 0,
					lastTermination: termination(cs.lastState),
				},
			];
		});
		// A pending pod has no statuses yet; its spec still names the containers.
		for (const [cname, image] of specImages) {
			if (!containers.some((c) => c.name === cname)) {
				containers.push({
					name: cname,
					image,
					imageID: null,
					digest: null,
					ready: false,
					restartCount: 0,
					lastTermination: null,
				});
			}
		}
		return [
			{
				namespace: str(meta.namespace) ?? "",
				name,
				uid: str(meta.uid),
				phase: str(status.phase),
				startTime: time(status.startTime),
				podTemplateHash: str(obj(meta.labels)["pod-template-hash"]),
				owner: controllerOwner(meta, "ReplicaSet"),
				ownerUid: str(ownerRef(meta, "ReplicaSet")?.uid),
				containers,
			},
		];
	});
}

function eventTime(item: Json): string | null {
	return (
		time(item.lastTimestamp) ??
		time(item.eventTime) ??
		time(obj(item.series).lastObservedTime) ??
		time(item.firstTimestamp)
	);
}

function byTimeDesc(a: string | null, b: string | null): number {
	return (b ? Date.parse(b) : -Infinity) - (a ? Date.parse(a) : -Infinity) || 0;
}

/** `type=Warning` events, newest first, capped. */
export function parseWarningEvents(
	listJson: unknown,
	cap = MAX_WARNING_EVENTS,
): K8sWarningEvent[] {
	return items(listJson)
		.filter((item) => item.type === "Warning")
		.flatMap((item) => {
			const meta = obj(item.metadata);
			const involved = obj(item.involvedObject);
			const name = str(meta.name);
			if (name === null) return [];
			return [
				{
					namespace: str(meta.namespace) ?? "",
					name,
					uid: str(meta.uid),
					reason: str(item.reason),
					message: str(item.message) ?? str(item.note),
					count: int(item.count) ?? int(obj(item.series).count),
					involvedObject: {
						kind: str(involved.kind),
						name: str(involved.name),
					},
					time: eventTime(item),
				},
			];
		})
		.sort((a, b) => byTimeDesc(a.time, b.time))
		.slice(0, cap);
}

/** Containers with a previous terminated instance, newest finish first, capped. */
export function crashedContainers(
	pods: K8sPod[],
	cap = MAX_LOG_CONTAINERS,
): CrashedContainer[] {
	return pods
		.flatMap((pod) =>
			pod.containers.flatMap((c) =>
				c.lastTermination
					? [
							{
								pod: pod.name,
								container: c.name,
								reason: c.lastTermination.reason,
								exitCode: c.lastTermination.exitCode,
								finishedAt: c.lastTermination.finishedAt,
							},
						]
					: [],
			),
		)
		.sort((a, b) => byTimeDesc(a.finishedAt, b.finishedAt))
		.slice(0, cap);
}

function sourceTimes(purpose: ArtifactPurpose, data: unknown): unknown[] {
	if (purpose === "logs-previous") {
		const lines = typeof data === "string" ? data.split("\n") : [];
		return lines.map((line) => line.split(" ", 1)[0]);
	}
	if (purpose === "events") return items(data).map(eventTime).filter(isSet);
	return items(data).flatMap((item) => {
		const meta = obj(item.metadata);
		const status = obj(item.status);
		const times: unknown[] = [meta.creationTimestamp];
		if (purpose === "pods") {
			times.push(status.startTime);
			for (const cs of list(status.containerStatuses).map(obj)) {
				for (const state of [obj(cs.state), obj(cs.lastState)]) {
					for (const s of Object.values(state).map(obj)) {
						times.push(s.startedAt, s.finishedAt);
					}
				}
			}
		} else if (purpose === "deployments") {
			for (const cond of list(status.conditions).map(obj)) {
				times.push(cond.lastUpdateTime, cond.lastTransitionTime);
			}
		}
		return times;
	});
}

function isSet<T>(value: T | null): value is T {
	return value !== null;
}

/** Earliest and latest source timestamps in an artifact; logs pass their text, the rest their parsed JSON. */
export function sourceRange(
	purpose: ArtifactPurpose,
	data: unknown,
): { from: Date | null; to: Date | null } {
	let min = Infinity;
	let max = -Infinity;
	for (const raw of sourceTimes(purpose, data)) {
		const t = time(raw);
		if (t === null) continue;
		const ms = Date.parse(t);
		if (ms < min) min = ms;
		if (ms > max) max = ms;
	}
	return Number.isFinite(min)
		? { from: new Date(min), to: new Date(max) }
		: { from: null, to: null };
}
