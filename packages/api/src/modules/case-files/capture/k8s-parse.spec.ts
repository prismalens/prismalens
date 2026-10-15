// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import {
	crashedContainers,
	imageTag,
	parseDeployments,
	parsePods,
	parseReplicaSets,
	parseWarningEvents,
	sourceRange,
} from "./k8s-parse.js";

const d1 = `sha256:${"a".repeat(64)}`;
const meta = (name: string, extra: object = {}) => ({
	metadata: { name, namespace: "shop", uid: `${name}-uid`, ...extra },
});

const deployments = {
	items: [
		{
			...meta("checkout", { creationTimestamp: "2026-10-01T00:00:00Z" }),
			spec: {
				replicas: 2,
				template: { spec: { containers: [{ name: "app", image: "reg:5000/checkout:v2" }] } },
			},
			status: { readyReplicas: 1 },
		},
	],
};

const replicasets = {
	items: [
		{
			...meta("checkout-7d9f", {
				creationTimestamp: "2026-10-15T07:30:00Z",
				annotations: { "deployment.kubernetes.io/revision": "4" },
				labels: { "pod-template-hash": "7d9f" },
				ownerReferences: [{ kind: "Deployment", name: "checkout" }],
			}),
			spec: { template: { spec: { containers: [{ name: "app", image: "checkout:v2" }] } } },
			status: { replicas: 2, readyReplicas: 1 },
		},
		meta("orphan"),
	],
};

const pods = {
	items: [
		{
			...meta("checkout-7d9f-a", { labels: { "pod-template-hash": "7d9f" } }),
			spec: { containers: [{ name: "app", image: "checkout:v2" }] },
			status: {
				phase: "Running",
				startTime: "2026-10-15T07:31:00Z",
				containerStatuses: [
					{
						name: "app",
						imageID: `docker-pullable://checkout@${d1}`,
						restartCount: 3,
						lastState: {
							terminated: { reason: "OOMKilled", exitCode: 137, finishedAt: "2026-10-15T07:55:00Z" },
						},
					},
				],
			},
		},
		{
			...meta("checkout-7d9f-b"),
			spec: { containers: [{ name: "app", image: "checkout:v2" }] },
			status: { phase: "Pending" },
		},
	],
};

describe("k8s-parse", () => {
	it("parses deployments and image tags", () => {
		expect(parseDeployments(deployments)[0]).toMatchObject({
			name: "checkout",
			replicas: 2,
			images: [{ container: "app", tag: "v2" }],
		});
		expect(imageTag("reg:5000/checkout")).toBeNull();
		expect(imageTag(`checkout:v1@${d1}`)).toBe("v1");
	});

	it("keeps annotated replicasets only", () => {
		const rs = parseReplicaSets(replicasets);
		expect(rs).toHaveLength(1);
		expect(rs[0]).toMatchObject({ revision: 4, owner: "checkout", podTemplateHash: "7d9f" });
	});

	it("parses pods, including a pending one with no imageID", () => {
		const [running, pending] = parsePods(pods);
		expect(running.containers[0]).toMatchObject({
			digest: d1,
			restartCount: 3,
			lastTermination: { reason: "OOMKilled", exitCode: 137 },
		});
		expect(pending.containers[0]).toMatchObject({ imageID: null, digest: null });
		expect(crashedContainers(parsePods(pods))).toEqual([
			{
				pod: "checkout-7d9f-a",
				container: "app",
				reason: "OOMKilled",
				exitCode: 137,
				finishedAt: "2026-10-15T07:55:00Z",
			},
		]);
	});

	it("keeps Warning events newest first, using eventTime when alone", () => {
		const events = {
			items: [
				{ ...meta("e1"), type: "Normal", lastTimestamp: "2026-10-15T07:00:00Z" },
				{ ...meta("e2"), type: "Warning", reason: "BackOff", lastTimestamp: "2026-10-15T07:10:00Z" },
				{ ...meta("e3"), type: "Warning", reason: "Failed", eventTime: "2026-10-15T07:20:00.000000Z" },
			],
		};
		expect(parseWarningEvents(events).map((e) => e.name)).toEqual(["e3", "e2"]);
		expect(sourceRange("events", events)).toEqual({
			from: new Date("2026-10-15T07:00:00Z"),
			to: new Date("2026-10-15T07:20:00Z"),
		});
	});

	it("reads source ranges from pods and log text", () => {
		expect(sourceRange("pods", pods).to).toEqual(new Date("2026-10-15T07:55:00Z"));
		const log = "2026-10-15T07:50:00.123456789Z start\n2026-10-15T07:54:59Z oom\n";
		expect(sourceRange("logs-previous", log)).toEqual({
			from: new Date("2026-10-15T07:50:00.123Z"),
			to: new Date("2026-10-15T07:54:59Z"),
		});
		expect(sourceRange("deployments", { items: [] })).toEqual({ from: null, to: null });
	});
});
