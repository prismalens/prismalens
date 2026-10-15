// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	BINDING_PROBE_STATES,
	BLOCKED_REASONS,
	CAPTURE_STATES,
	CaseFileSettingsSchema,
	type CaseView,
	CaseViewSchema,
	CLAIM_STATUSES,
	COMMAND_PROVENANCE,
	RETRIEVAL_REASONS,
	VALID_KINDS,
} from "./case-file.js";
import { InvestigationContextSchema } from "./investigation.js";

describe("Case File vocabularies", () => {
	it("match the board's sets exactly, in order", () => {
		expect(CLAIM_STATUSES).toEqual([
			"hint",
			"candidate",
			"observed",
			"inferred",
			"stated",
			"confirmed",
			"inconclusive",
			"unknown",
		]);
		expect(COMMAND_PROVENANCE).toEqual([
			"host-executed",
			"shim-observed",
			"harness-relayed",
			"harness-reported",
		]);
		expect(RETRIEVAL_REASONS).toEqual([
			"page-limit",
			"byte-cap",
			"timeout",
			"error",
		]);
		expect(CAPTURE_STATES).toEqual([
			"queued",
			"running",
			"complete",
			"partial",
			"skipped",
			"blocked",
		]);
		expect(BLOCKED_REASONS).toEqual([
			"no-kubectl",
			"context-missing",
			"identity-mismatch",
			"unauthorised",
			"unreachable",
		]);
		expect(VALID_KINDS).toEqual(["instant", "interval", "unknown"]);
		expect(BINDING_PROBE_STATES).toEqual([
			"unchecked",
			"ok",
			"no-kubectl",
			"context-missing",
			"identity-mismatch",
			"unauthorised",
			"unreachable",
		]);
	});
});

describe("CaseFileSettingsSchema", () => {
	it("holds exactly one boolean", () => {
		expect(CaseFileSettingsSchema.parse({ enabled: false })).toEqual({
			enabled: false,
		});
		expect(CaseFileSettingsSchema.safeParse({ enabled: "yes" }).success).toBe(
			false,
		);
	});
});

const AT = "2026-10-15T08:00:00.000Z";

const fixture: CaseView = {
	enabled: true,
	asOf: AT,
	binding: {
		kubeContext: "kind-pl",
		namespace: "shop",
		cluster: "https://127.0.0.1:6443",
		probeState: "ok",
	},
	captures: [
		{
			id: "cap-1",
			kubeContext: "kind-pl",
			namespace: "shop",
			state: "partial",
			stateReason: "byte-cap",
			missed: { from: AT, to: "2026-10-15T08:06:00.000Z" },
			shared: true,
			latencyMs: 42_000,
			identity: {
				kubeContext: "kind-pl",
				cluster: "https://127.0.0.1:6443",
				kubeUser: "kind-pl",
				whoami: { username: "kubernetes-admin", groups: ["system:masters"] },
				matchesBinding: true,
			},
			identityMatches: true,
			startedAt: AT,
			finishedAt: "2026-10-15T08:07:00.000Z",
			artifacts: [
				{
					id: "art-1",
					purpose: "pods",
					subject: null,
					command: ["kubectl", "get", "pods", "-o", "json"],
					retrieval: "complete",
					retrievalReason: null,
					bytes: 2048,
					redactions: { "aws-access-key": 1 },
					withheld: false,
					expired: false,
				},
				{
					id: "art-2",
					purpose: "logs-previous",
					subject: "checkout-7d9f/app",
					command: ["kubectl", "logs", "checkout-7d9f", "--previous"],
					retrieval: "partial",
					retrievalReason: "byte-cap",
					bytes: 0,
					redactions: { error: "rule threw" },
					withheld: true,
					expired: false,
				},
			],
		},
	],
	claims: [
		{
			id: "rev-1",
			subject: {
				kind: "edge",
				label: "revision 4 precedes the alert",
				relation: "precedes_alert",
				from: "revision:shop/checkout#4",
				to: "alert:a-1",
			},
			status: "candidate",
			statusReason: null,
			statement: "Revision 4 of checkout rolled out 30 min before the alert",
			hint: null,
			attributes: { revision: 4 },
			revision: 1,
			revisions: 2,
			source: {
				kind: "capture",
				provenance: "host-executed",
				artifactId: "art-1",
				investigationId: null,
			},
			population: { namespace: "shop", workload: "checkout" },
			coverage: { retrieval: "complete" },
			sourceTime: "2026-10-15T07:30:00.000Z",
			valid: { kind: "instant", from: AT, to: null },
			collectedAt: AT,
			recordedAt: AT,
			projected: false,
		},
		{
			id: "proj-1",
			subject: { kind: "node", label: "checkout" },
			status: "inferred",
			statusReason: null,
			statement: "The memory limit is too low",
			hint: null,
			attributes: { agentStatus: "confirmed" },
			revision: 1,
			revisions: 1,
			source: {
				kind: "report",
				provenance: "harness-reported",
				artifactId: null,
				investigationId: "inv-1",
			},
			population: null,
			coverage: null,
			sourceTime: null,
			valid: { kind: "unknown", from: null, to: null },
			collectedAt: null,
			recordedAt: AT,
			projected: true,
		},
	],
	openQuestions: ["rev-1"],
	agentToolCalls: [
		{
			investigationId: "inv-1",
			toolCallId: "call-1",
			name: "bash",
			source: "kubectl get pods",
			at: AT,
			provenance: "harness-reported",
		},
	],
	manifest: { entries: 3, lastVerified: null },
};

describe("CaseViewSchema", () => {
	it("round-trips a fixture unchanged", () => {
		const parsed = CaseViewSchema.parse(JSON.parse(JSON.stringify(fixture)));
		expect(parsed).toEqual(fixture);
	});

	it("refuses a status outside the eight and an agent call not harness-reported", () => {
		const badStatus = structuredClone(fixture) as unknown as {
			claims: { status: string }[];
		};
		badStatus.claims[0].status = "likely";
		expect(CaseViewSchema.safeParse(badStatus).success).toBe(false);

		const badCall = structuredClone(fixture) as unknown as {
			agentToolCalls: { provenance: string }[];
		};
		badCall.agentToolCalls[0].provenance = "host-executed";
		expect(CaseViewSchema.safeParse(badCall).success).toBe(false);
	});
});

describe("InvestigationContextSchema.caseBundle", () => {
	const base = {
		alerts: [
			{
				alertname: "KubePodCrashLooping",
				severity: "critical",
				labels: {},
				annotations: {},
				startsAt: null,
			},
		],
	};
	const bundle = {
		path: ".prismalens/case",
		target: "kind-pl/shop",
		digest: ["capture running as of 08:00:00Z; identity matches"],
	};

	it("accepts a context without a bundle", () => {
		const parsed = InvestigationContextSchema.parse(base);
		expect(parsed.caseBundle).toBeUndefined();
	});

	it("accepts a context with a bundle", () => {
		const parsed = InvestigationContextSchema.parse({
			...base,
			caseBundle: bundle,
		});
		expect(parsed.caseBundle).toEqual(bundle);
	});

	it("refuses a digest over 12 lines or with a line over 160 characters", () => {
		const lines = Array.from({ length: 13 }, (_, i) => `pods: complete, ${i} bytes`);
		expect(
			InvestigationContextSchema.safeParse({
				...base,
				caseBundle: { ...bundle, digest: lines },
			}).success,
		).toBe(false);
		expect(
			InvestigationContextSchema.safeParse({
				...base,
				caseBundle: { ...bundle, digest: lines.slice(0, 12) },
			}).success,
		).toBe(true);
		expect(
			InvestigationContextSchema.safeParse({
				...base,
				caseBundle: { ...bundle, digest: ["x".repeat(161)] },
			}).success,
		).toBe(false);
	});
});
