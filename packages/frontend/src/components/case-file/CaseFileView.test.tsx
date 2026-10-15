// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { CaseView, ClaimView } from "@prismalens/contracts";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CaseFileView } from "./CaseFileView";

vi.mock("@/lib/api/hooks/use-case-files-orpc", () => ({
	useCaseFileEnabled: () => true,
	useVerifyCase: () => ({ mutate: vi.fn(), isPending: false, error: null }),
	useCaseArtifact: () => ({ data: undefined, error: null, isLoading: false }),
}));

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const T = "2026-10-15T10:00:00.000Z";

const claim = (over: Partial<ClaimView>): ClaimView => ({
	id: "c1",
	subject: { kind: "node", label: "deployment/shop" },
	status: "observed",
	statusReason: null,
	statement: "shop has 0 of 3 replicas ready",
	hint: null,
	attributes: null,
	revision: 1,
	revisions: 1,
	source: {
		kind: "capture",
		provenance: "host-executed",
		artifactId: null,
		investigationId: null,
	},
	population: null,
	coverage: null,
	sourceTime: T,
	valid: { kind: "instant", from: T, to: null },
	collectedAt: T,
	recordedAt: T,
	projected: false,
	...over,
});

const view = (over: Partial<CaseView>): CaseView => ({
	enabled: true,
	asOf: T,
	binding: {
		kubeContext: "kind-pl",
		namespace: "shop",
		cluster: "kind",
		probeState: "ok",
	},
	captures: [],
	claims: [],
	openQuestions: [],
	agentToolCalls: [],
	manifest: { entries: 0, lastVerified: null },
	...over,
});

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});
afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
});

const render = (v: CaseView) =>
	act(async () =>
		root.render(createElement(CaseFileView, { incidentId: "i1", view: v })),
	);
const byTestId = (id: string) =>
	Array.from(container.querySelectorAll(`[data-testid="${id}"]`)).map(
		(n) => n.textContent ?? "",
	);

describe("CaseFileView (smoke)", () => {
	it("shows the gap and its hint when nothing was captured", async () => {
		const gap = claim({
			id: "gap",
			status: "unknown",
			statusReason: "unbound",
			statement: "No Kubernetes target is bound to this service.",
			hint: "Bind it on the service page.",
			projected: true,
			source: {
				kind: "host",
				provenance: "host-executed",
				artifactId: null,
				investigationId: null,
			},
		});
		await render(
			view({ binding: null, claims: [gap], openQuestions: ["gap"] }),
		);
		expect(byTestId("case-gap").join()).toContain(
			"Bind it on the service page.",
		);
	});

	it("renders the capture line, its chips and both provenance labels", async () => {
		await render(
			view({
				captures: [
					{
						id: "cap1",
						state: "partial",
						stateReason: null,
						missed: null,
						shared: false,
						latencyMs: 42_000,
						identity: null,
						identityMatches: true,
						startedAt: T,
						finishedAt: T,
						artifacts: [
							{
								id: "a1",
								purpose: "logs-previous",
								subject: "pod/shop-1",
								command: ["kubectl", "logs", "--previous"],
								retrieval: "partial",
								retrievalReason: "byte-cap",
								bytes: 10,
								redactions: {},
								withheld: false,
								expired: false,
							},
						],
					},
				],
				claims: [
					claim({ id: "obs" }),
					claim({
						id: "hyp",
						status: "inferred",
						statement: "A bad config rolled out",
						source: {
							kind: "report",
							provenance: "harness-reported",
							artifactId: null,
							investigationId: "inv1",
						},
					}),
				],
			}),
		);
		expect(byTestId("case-capture-line").join()).toContain(
			"Captured kind-pl/shop 42 s after the alert · partial · identity matches binding",
		);
		expect(byTestId("case-chip")).toContain("partial(byte-cap)");
		expect(byTestId("claim-source")).toEqual([
			"PrismaLens ran this",
			"The agent reported this",
		]);
		expect(byTestId("claim-status")).toEqual(["observed", "inferred"]);
	});
});
