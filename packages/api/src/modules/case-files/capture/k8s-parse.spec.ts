// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import {
	crashedContainers,
	imageDigest,
	imageTag,
	type K8sPod,
	parseDeployments,
	parsePods,
	parseReplicaSets,
	parseWarningEvents,
	sourceRange,
} from "./k8s-parse.js";

const d1 = `sha256:${"a".repeat(64)}`;
const d2 = `sha256:${"b".repeat(64)}`;
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

	it("handles one image tag mapping to two digests across pods", () => {
		const twoDigestPods = {
			items: [
				{
					...meta("checkout-a"),
					spec: { containers: [{ name: "app", image: "checkout:v2" }] },
					status: {
						phase: "Running",
						containerStatuses: [
							{ name: "app", imageID: `docker-pullable://checkout@${d1}` },
						],
					},
				},
				{
					...meta("checkout-b"),
					spec: { containers: [{ name: "app", image: "checkout:v2" }] },
					status: {
						phase: "Running",
						containerStatuses: [
							{ name: "app", imageID: `docker-pullable://checkout@${d2}` },
						],
					},
				},
			],
		};
		const parsed = parsePods(twoDigestPods);
		expect(parsed[0].containers[0].digest).toBe(d1);
		expect(parsed[1].containers[0].digest).toBe(d2);
		expect(imageTag(parsed[0].containers[0].image!)).toBe("v2");
		expect(imageTag(parsed[1].containers[0].image!)).toBe("v2");
	});

	it("orders crashedContainers newest finishedAt first with nulls last and caps at MAX_LOG_CONTAINERS", () => {
		const crashedPods: K8sPod[] = [
			{
				namespace: "shop",
				name: "pod-1",
				uid: "p1",
				phase: "Running",
				startTime: null,
				podTemplateHash: null,
				owner: null,
				ownerUid: null,
				containers: [
					{
						name: "c-old",
						image: null,
						imageID: null,
						digest: null,
						ready: false,
						restartCount: 1,
						lastTermination: { reason: "Error", exitCode: 1, finishedAt: "2026-10-15T01:00:00Z" },
					},
					{
						name: "c-newest",
						image: null,
						imageID: null,
						digest: null,
						ready: false,
						restartCount: 1,
						lastTermination: { reason: "OOM", exitCode: 137, finishedAt: "2026-10-15T05:00:00Z" },
					},
				],
			},
			{
				namespace: "shop",
				name: "pod-2",
				uid: "p2",
				phase: "Running",
				startTime: null,
				podTemplateHash: null,
				owner: null,
				ownerUid: null,
				containers: [
					{
						name: "c-mid1",
						image: null,
						imageID: null,
						digest: null,
						ready: false,
						restartCount: 1,
						lastTermination: { reason: "Error", exitCode: 1, finishedAt: "2026-10-15T04:00:00Z" },
					},
					{
						name: "c-mid2",
						image: null,
						imageID: null,
						digest: null,
						ready: false,
						restartCount: 1,
						lastTermination: { reason: "Error", exitCode: 1, finishedAt: "2026-10-15T03:00:00Z" },
					},
					{
						name: "c-mid3",
						image: null,
						imageID: null,
						digest: null,
						ready: false,
						restartCount: 1,
						lastTermination: { reason: "Error", exitCode: 1, finishedAt: "2026-10-15T02:00:00Z" },
					},
					{
						name: "c-null-time",
						image: null,
						imageID: null,
						digest: null,
						ready: false,
						restartCount: 1,
						lastTermination: { reason: "Unknown", exitCode: 2, finishedAt: null },
					},
					{
						name: "c-no-term",
						image: null,
						imageID: null,
						digest: null,
						ready: true,
						restartCount: 0,
						lastTermination: null,
					},
				],
			},
		];
		const crashed = crashedContainers(crashedPods);
		expect(crashed).toHaveLength(5);
		expect(crashed.map((c) => c.container)).toEqual([
			"c-newest",
			"c-mid1",
			"c-mid2",
			"c-mid3",
			"c-old",
		]);

		const allCrashed = crashedContainers(crashedPods, 10);
		expect(allCrashed).toHaveLength(6);
		expect(allCrashed[5]).toMatchObject({
			container: "c-null-time",
			finishedAt: null,
		});
	});

	it("caps warning events at MAX_WARNING_EVENTS and supports custom cap", () => {
		const items = Array.from({ length: 60 }, (_, i) => ({
			...meta(`warn-${i}`),
			type: "Warning",
			reason: "BackOff",
			lastTimestamp: new Date(Date.parse("2026-10-15T00:00:00Z") + i * 1000).toISOString(),
		}));
		const defaultCapped = parseWarningEvents({ items });
		expect(defaultCapped).toHaveLength(50);
		expect(defaultCapped[0].name).toBe("warn-59");

		const customCapped = parseWarningEvents({ items }, 3);
		expect(customCapped).toHaveLength(3);
		expect(customCapped.map((e) => e.name)).toEqual(["warn-59", "warn-58", "warn-57"]);
	});

	it("resolves event times using series.lastObservedTime and firstTimestamp fallback", () => {
		const events = {
			items: [
				{
					...meta("e-series"),
					type: "Warning",
					note: "from note",
					series: { lastObservedTime: "2026-10-15T08:00:00Z", count: 7 },
				},
				{
					...meta("e-first"),
					type: "Warning",
					message: "from message",
					firstTimestamp: "2026-10-15T06:00:00Z",
					count: 2,
				},
			],
		};
		const parsed = parseWarningEvents(events);
		expect(parsed).toEqual([
			{
				namespace: "shop",
				name: "e-series",
				uid: "e-series-uid",
				reason: null,
				message: "from note",
				count: 7,
				involvedObject: { kind: null, name: null },
				time: "2026-10-15T08:00:00Z",
			},
			{
				namespace: "shop",
				name: "e-first",
				uid: "e-first-uid",
				reason: null,
				message: "from message",
				count: 2,
				involvedObject: { kind: null, name: null },
				time: "2026-10-15T06:00:00Z",
			},
		]);
	});

	it("extracts sourceRange for deployments with conditions and for replicasets", () => {
		const depWithConditions = {
			items: [
				{
					...meta("web", { creationTimestamp: "2026-10-10T10:00:00Z" }),
					status: {
						conditions: [
							{
								lastUpdateTime: "2026-10-10T10:05:00Z",
								lastTransitionTime: "2026-10-10T10:04:00Z",
							},
							{
								lastUpdateTime: "2026-10-10T12:00:00Z",
								lastTransitionTime: "2026-10-10T11:00:00Z",
							},
						],
					},
				},
			],
		};
		expect(sourceRange("deployments", depWithConditions)).toEqual({
			from: new Date("2026-10-10T10:00:00Z"),
			to: new Date("2026-10-10T12:00:00Z"),
		});

		expect(sourceRange("replicasets", replicasets)).toEqual({
			from: new Date("2026-10-15T07:30:00Z"),
			to: new Date("2026-10-15T07:30:00Z"),
		});
	});

	it("handles malformed and non-object input without throwing", () => {
		for (const bad of [null, undefined, 42, "string", [], {}]) {
			expect(parseDeployments(bad)).toEqual([]);
			expect(parseReplicaSets(bad)).toEqual([]);
			expect(parsePods(bad)).toEqual([]);
			expect(parseWarningEvents(bad)).toEqual([]);
			expect(sourceRange("deployments", bad)).toEqual({ from: null, to: null });
			expect(sourceRange("pods", bad)).toEqual({ from: null, to: null });
			expect(sourceRange("events", bad)).toEqual({ from: null, to: null });
			expect(sourceRange("replicasets", bad)).toEqual({ from: null, to: null });
			expect(sourceRange("logs-previous", bad)).toEqual({ from: null, to: null });
		}

		expect(parseDeployments({ items: [{}, { metadata: {} }] })).toEqual([]);
		expect(parsePods({ items: [null, "foo", { metadata: {} }] })).toEqual([]);
		expect(
			parsePods({
				items: [
					{
						metadata: { name: "no-ns-pod" },
						status: { containerStatuses: [{ name: null }] },
					},
				],
			})[0].namespace,
		).toBe("");
		expect(parseWarningEvents({ items: [{ type: "Warning" }, { type: "Normal" }] })).toEqual([]);
		expect(
			parseWarningEvents({
				items: [
					{ type: "Warning", metadata: { name: "w1" }, lastTimestamp: "2026-10-15T00:00:00Z" },
					{ type: "Warning", metadata: { name: "w2" }, lastTimestamp: "2026-10-15T00:00:00Z" },
					{ type: "Warning", metadata: { name: "no-ns-warn" } },
				],
			}).find((e) => e.name === "no-ns-warn")?.namespace,
		).toBe("");

		expect(
			parseReplicaSets({
				items: [
					{ metadata: { name: "rs-no-rev" } },
					{ metadata: { name: "rs-neg", annotations: { "deployment.kubernetes.io/revision": "-1" } } },
					{ metadata: { name: "rs-zero", annotations: { "deployment.kubernetes.io/revision": "0" } } },
					{ metadata: { name: "rs-nan", annotations: { "deployment.kubernetes.io/revision": "abc" } } },
				],
			}),
		).toEqual([]);

		expect(imageTag("")).toBeNull();
		expect(imageTag("no-tag")).toBeNull();
		expect(imageTag("registry:5000/repo")).toBeNull();
		expect(imageTag("registry:5000/repo:")).toBeNull();
		expect(imageTag(":only-tag")).toBe("only-tag");

		expect(imageDigest(null)).toBeNull();
		expect(imageDigest("")).toBeNull();
		expect(imageDigest("sha256:short")).toBeNull();
		expect(imageDigest(`SHA256:${"A".repeat(64)}`)).toBe(`sha256:${"a".repeat(64)}`);
	});
});
