// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

export const ALERT_AT = new Date("2026-10-15T10:00:00Z");
export const COLLECTED = new Date("2026-10-15T10:00:30Z");
export const D1 = `sha256:${"a".repeat(64)}`;
export const D2 = `sha256:${"b".repeat(64)}`;

export const meta = (name: string, extra: Record<string, unknown> = {}) => ({
	metadata: { name, namespace: "shop", uid: `${name}-uid`, ...extra },
});

export const sampleDeployments = {
	items: [
		{
			...meta("checkout"),
			spec: {
				replicas: 2,
				template: {
					spec: { containers: [{ name: "app", image: "checkout:v2" }] },
				},
			},
			status: { readyReplicas: 1 },
		},
	],
};

export const deploymentsWithoutReplicas = {
	items: [
		{
			...meta("checkout"),
			spec: {
				template: { spec: { containers: [] } },
			},
			status: { readyReplicas: 0 },
		},
	],
};

// Rollout 30 min before alert (within 2 h window).
export const replicaSetsRollout30Min = {
	items: [
		{
			...meta("checkout-7d9f", {
				creationTimestamp: "2026-10-15T09:30:00Z",
				annotations: { "deployment.kubernetes.io/revision": "4" },
				labels: { "pod-template-hash": "7d9f" },
				ownerReferences: [{ kind: "Deployment", name: "checkout" }],
			}),
			spec: {
				template: {
					spec: { containers: [{ name: "app", image: "checkout:v2" }] },
				},
			},
			status: { replicas: 2, readyReplicas: 1 },
		},
	],
};

// Rollout 3 h before alert (outside 2 h window).
export const replicaSetsRollout3Hours = {
	items: [
		{
			...meta("checkout-7d9f", {
				creationTimestamp: "2026-10-15T07:00:00Z",
				annotations: { "deployment.kubernetes.io/revision": "4" },
				labels: { "pod-template-hash": "7d9f" },
				ownerReferences: [{ kind: "Deployment", name: "checkout" }],
			}),
			spec: {
				template: {
					spec: { containers: [{ name: "app", image: "checkout:v2" }] },
				},
			},
			status: { replicas: 2, readyReplicas: 2 },
		},
	],
};

export const samplePod = (
	name: string,
	digest: string,
	restartCount: number,
) => ({
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
					terminated: {
						reason: "OOMKilled",
						exitCode: 137,
						finishedAt: "2026-10-15T09:52:00Z",
					},
				},
			},
		],
	},
});

export const sampleEvents = {
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

export const eventsWithVariousInvolved = {
	items: [
		{
			...meta("ev-rs"),
			type: "Warning",
			reason: "FailedCreate",
			message: "Failed to create pod",
			involvedObject: { kind: "ReplicaSet", name: "checkout-7d9f" },
			lastTimestamp: "2026-10-15T09:54:00Z",
		},
		{
			...meta("ev-dep"),
			type: "Warning",
			reason: "ScalingReplicaSet",
			message: "Scaled up replica set checkout-7d9f",
			involvedObject: { kind: "Deployment", name: "checkout" },
			lastTimestamp: "2026-10-15T09:53:00Z",
		},
		{
			...meta("ev-node"),
			type: "Warning",
			reason: "NodeNotReady",
			message: "Node is not ready",
			involvedObject: { kind: "Node", name: "worker-1" },
			lastTimestamp: "2026-10-15T09:52:00Z",
		},
		{
			...meta("ev-orphan-pod"),
			type: "Warning",
			reason: "Unhealthy",
			message: "Liveness probe failed",
			involvedObject: { kind: "Pod", name: "unrelated-pod" },
			lastTimestamp: "2026-10-15T09:51:00Z",
		},
	],
};
