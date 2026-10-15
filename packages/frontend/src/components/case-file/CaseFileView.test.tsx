// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	type ArtifactText,
	type CaseView,
	CLAIM_STATUSES,
	type ClaimStatus,
	type ClaimView,
	type ManifestVerify,
	type Redactions,
} from "@prismalens/contracts";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ArtifactDrawer, redactionWords } from "./ArtifactDrawer";
import {
	CaseFileLink,
	CaseFileView,
	captureChips,
	captureLine,
	verifyWords,
} from "./CaseFileView";
import { missedWord, statusWord } from "./ClaimRow";

const h = vi.hoisted(() => ({
	caseFileEnabled: true,
	verifyMutate: vi.fn(),
	verifyPending: false,
	verifyData: undefined as ManifestVerify | undefined,
	artifactData: undefined as ArtifactText | undefined,
	artifactError: null as unknown,
	artifactLoading: false,
	artifactRefetch: vi.fn(),
}));

vi.mock("@tanstack/react-router", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("@tanstack/react-router")>();
	return {
		...actual,
		Link: ({ children, ...props }: { children: React.ReactNode }) =>
			createElement("a", props, children),
	};
});

vi.mock("@/lib/api/hooks/use-case-files-orpc", () => ({
	useCaseFileEnabled: () => h.caseFileEnabled,
	useVerifyCase: () => ({
		mutate: h.verifyMutate,
		isPending: h.verifyPending,
		data: h.verifyData,
		error: null,
	}),
	useCaseArtifact: () => ({
		data: h.artifactData,
		error: h.artifactError,
		isLoading: h.artifactLoading,
		refetch: h.artifactRefetch,
	}),
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
	h.verifyMutate.mockClear();
	h.verifyPending = false;
	h.verifyData = undefined;
	h.artifactData = undefined;
	h.artifactError = null;
	h.artifactLoading = false;
	h.artifactRefetch.mockClear();
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

describe("CaseFileView", () => {
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

	describe("missed(...) and skipped(...) chips", () => {
		it("renders missed and skipped chips from capture summary", async () => {
			const missedFrom = "2026-10-15T03:14:00.000Z";
			const missedTo = "2026-10-15T05:40:00.000Z";
			await render(
				view({
					captures: [
						{
							id: "cap-missed",
							state: "complete",
							stateReason: null,
							missed: { from: missedFrom, to: missedTo },
							shared: true,
							latencyMs: null,
							identity: null,
							identityMatches: true,
							startedAt: T,
							finishedAt: T,
							artifacts: [],
						},
						{
							id: "cap-skipped",
							state: "skipped",
							stateReason: "queue-full",
							missed: null,
							shared: false,
							latencyMs: null,
							identity: null,
							identityMatches: null,
							startedAt: null,
							finishedAt: null,
							artifacts: [],
						},
					],
				}),
			);
			const chips = byTestId("case-chip");
			expect(chips).toContain(missedWord(missedFrom, missedTo));
			expect(chips).toContain("skipped(queue-full)");
			expect(chips).toContain("shared with another incident");
		});

		it("captureChips helper computes all chip shapes", () => {
			const chips = captureChips({
				id: "cap1",
				state: "skipped",
				stateReason: "queue-full",
				missed: {
					from: "2026-10-15T03:14:00.000Z",
					to: "2026-10-15T05:40:00.000Z",
				},
				shared: true,
				latencyMs: 1000,
				identity: null,
				identityMatches: true,
				startedAt: T,
				finishedAt: T,
				artifacts: [
					{
						id: "a1",
						purpose: "pods",
						subject: null,
						command: ["kubectl", "get", "pods"],
						retrieval: "partial",
						retrievalReason: "timeout",
						bytes: 0,
						redactions: {},
						withheld: false,
						expired: false,
					},
				],
			});
			expect(chips).toContain("partial(timeout)");
			expect(chips).toContain("skipped(queue-full)");
			expect(chips).toContain("shared with another incident");
			expect(chips).toContain(
				missedWord("2026-10-15T03:14:00.000Z", "2026-10-15T05:40:00.000Z"),
			);
		});

		it("renders missed coverage chip on claim", async () => {
			const from = "2026-10-15T03:14:00.000Z";
			const to = "2026-10-15T05:40:00.000Z";
			await render(
				view({
					claims: [
						claim({
							id: "c-cov",
							coverage: {
								retrieval: "partial",
								reason: "byte-cap",
								missedFrom: from,
								missedTo: to,
							},
						}),
					],
				}),
			);
			const coverageWords = byTestId("claim-coverage");
			expect(coverageWords).toContain("partial(byte-cap)");
			expect(coverageWords).toContain(missedWord(from, to));
		});
	});

	describe("status chips for all 8 c01 words and statusReason", () => {
		it("formats statusWord with and without reason", () => {
			expect(
				statusWord({ status: "inconclusive", statusReason: "unreachable" }),
			).toBe("inconclusive(unreachable)");
			expect(statusWord({ status: "observed", statusReason: null })).toBe(
				"observed",
			);
		});

		it("renders status chips for all 8 c01 words", async () => {
			const reasons: Partial<Record<ClaimStatus, string>> = {
				inconclusive: "unreachable",
				unknown: "unbound",
				inferred: "agent-hypothesis",
			};
			const claims = CLAIM_STATUSES.map((status) =>
				claim({
					id: `claim-${status}`,
					status,
					statusReason: reasons[status] ?? null,
					statement: `Statement for ${status}`,
				}),
			);
			await render(view({ claims }));
			const renderedStatuses = byTestId("claim-status");
			expect(renderedStatuses).toEqual([
				"hint",
				"candidate",
				"observed",
				"inferred(agent-hypothesis)",
				"stated",
				"confirmed",
				"inconclusive(unreachable)",
				"unknown(unbound)",
			]);
		});
	});

	describe("Verify record results", () => {
		it("verifyWords returns 'Record intact (N entries)' when intact", () => {
			expect(verifyWords({ ok: true, entries: 14, expired: 0 })).toBe(
				"Record intact (14 entries)",
			);
		});

		it("verifyWords returns 'Broken at entry N: check' when broken", () => {
			expect(
				verifyWords({
					ok: false,
					entries: 8,
					expired: 0,
					brokenAt: { seq: 9, check: "metadata", detail: "mismatch" },
				}),
			).toBe("Broken at entry 9: metadata");
		});

		it("renders 'Record intact (N entries)' in UI when intact", async () => {
			h.verifyData = { ok: true, entries: 14, expired: 0 };
			await render(view({ manifest: { entries: 14, lastVerified: null } }));
			const result = byTestId("case-verify-result");
			expect(result).toContain("Record intact (14 entries)");
		});

		it("renders 'Broken at entry N: check' in UI when broken", async () => {
			h.verifyData = {
				ok: false,
				entries: 8,
				expired: 0,
				brokenAt: { seq: 9, check: "metadata", detail: "bad hash" },
			};
			await render(view({ manifest: { entries: 8, lastVerified: null } }));
			const result = byTestId("case-verify-result");
			expect(result).toContain("Broken at entry 9: metadata");
		});

		it("clicking verify calls verify.mutate and button disables on 0 entries", async () => {
			await render(view({ manifest: { entries: 5, lastVerified: null } }));
			const btn = container.querySelector<HTMLButtonElement>(
				'[data-testid="case-verify"]',
			);
			expect(btn?.disabled).toBe(false);
			await act(async () => btn?.click());
			expect(h.verifyMutate).toHaveBeenCalledWith({ incidentId: "i1" });
		});

		it("disables verify button when manifest entries is 0", async () => {
			await render(view({ manifest: { entries: 0, lastVerified: null } }));
			const btn = container.querySelector<HTMLButtonElement>(
				'[data-testid="case-verify"]',
			);
			expect(btn?.disabled).toBe(true);
		});
	});

	describe("ArtifactDrawer and redactionWords", () => {
		describe("redactionWords helper", () => {
			it("formats error text when redaction failed", () => {
				const res = redactionWords({ error: "parser crash" });
				expect(res).toBe(
					"Redaction failed, so the text is withheld: parser crash",
				);
			});

			it("formats empty counts as 'Nothing redacted'", () => {
				expect(redactionWords({})).toBe("Nothing redacted");
				expect(redactionWords({ "rule-1": 0 })).toBe("Nothing redacted");
			});

			it("formats positive counts", () => {
				const counts: Redactions = {
					"aws-access-key": 2,
					pattern: 1,
					other: 0,
				};
				expect(redactionWords(counts)).toBe(
					"Redacted: 2 aws-access-key, 1 pattern",
				);
			});
		});

		it("renders open ArtifactDrawer with text, note, and truncated note", async () => {
			h.artifactData = {
				artifact: {
					id: "art-1",
					purpose: "logs-previous",
					subject: "pod/shop-1",
					command: ["kubectl", "logs", "--previous"],
					retrieval: "complete",
					retrievalReason: null,
					bytes: 1048576,
					redactions: { pattern: 1 },
					withheld: false,
					expired: false,
				},
				text: "Line 1\nLine 2 with [REDACTED:pattern]",
				truncated: true,
			};
			await act(async () =>
				root.render(
					createElement(ArtifactDrawer, {
						artifactId: "art-1",
						onClose: vi.fn(),
					}),
				),
			);
			const drawer = document.body.querySelector(
				'[data-testid="artifact-drawer"]',
			);
			expect(drawer).not.toBeNull();
			expect(drawer?.textContent).toContain("logs-previous, pod/shop-1");
			expect(drawer?.textContent).toContain("kubectl logs --previous");
			expect(drawer?.textContent).toContain(
				"complete · Redacted: 1 pattern · Showing the first 1 MiB",
			);
			const pre = document.body.querySelector('[data-testid="artifact-text"]');
			expect(pre?.textContent).toContain(
				"Line 1\nLine 2 with [REDACTED:pattern]",
			);
		});

		it("renders 409 withheld or expired error text", async () => {
			h.artifactError = { status: 409 };
			await act(async () =>
				root.render(
					createElement(ArtifactDrawer, {
						artifactId: "art-409",
						onClose: vi.fn(),
					}),
				),
			);
			const drawer = document.body.querySelector(
				'[data-testid="artifact-drawer"]',
			);
			expect(drawer?.textContent).toContain(
				"This artifact is withheld or has expired, so there is no text to show.",
			);
		});

		it("renders generic error text for other failures", async () => {
			h.artifactError = { status: 500 };
			await act(async () =>
				root.render(
					createElement(ArtifactDrawer, {
						artifactId: "art-500",
						onClose: vi.fn(),
					}),
				),
			);
			const drawer = document.body.querySelector(
				'[data-testid="artifact-drawer"]',
			);
			expect(drawer?.textContent).toContain("The artifact did not load.");
		});

		it("disables command button when artifact is withheld or expired in CaseFileView", async () => {
			await render(
				view({
					captures: [
						{
							id: "c1",
							state: "complete",
							stateReason: null,
							missed: null,
							shared: false,
							latencyMs: null,
							identity: null,
							identityMatches: true,
							startedAt: T,
							finishedAt: T,
							artifacts: [
								{
									id: "a-withheld",
									purpose: "pods",
									subject: null,
									command: ["kubectl", "get", "pods"],
									retrieval: "complete",
									retrievalReason: null,
									bytes: 0,
									redactions: { error: "failed" },
									withheld: true,
									expired: false,
								},
								{
									id: "a-expired",
									purpose: "events",
									subject: null,
									command: ["kubectl", "get", "events"],
									retrieval: "complete",
									retrievalReason: null,
									bytes: 0,
									redactions: {},
									withheld: false,
									expired: true,
								},
							],
						},
					],
				}),
			);
			const btns = container.querySelectorAll<HTMLButtonElement>(
				'[data-testid="case-command"] button',
			);
			expect(btns[0].disabled).toBe(true);
			expect(btns[1].disabled).toBe(true);
		});
	});

	it("renders agent tool calls as 'The agent reported this'", async () => {
		await render(
			view({
				agentToolCalls: [
					{
						investigationId: "inv-1",
						toolCallId: "tc-1",
						name: "exec_command",
						source: "sh -c ls",
						at: T,
						provenance: "harness-reported",
					},
				],
			}),
		);
		const toolCalls = byTestId("case-tool-call");
		expect(toolCalls.length).toBe(1);
		expect(toolCalls[0]).toContain("exec_command");
		expect(toolCalls[0]).toContain("sh -c ls");
		expect(toolCalls[0]).toContain("The agent reported this");
	});

	it("groups observed claims by workload", async () => {
		await render(
			view({
				claims: [
					claim({
						id: "c-shop-1",
						statement: "shop deployment ready",
						population: { workload: "shop" },
					}),
					claim({
						id: "c-shop-2",
						statement: "shop pod healthy",
						population: { workload: "shop" },
					}),
					claim({
						id: "c-checkout",
						statement: "checkout crashlooping",
						population: { workload: "checkout" },
					}),
					claim({
						id: "c-auth",
						statement: "auth edge claim",
						subject: { kind: "edge", label: "runs", from: "auth-svc" },
					}),
				],
			}),
		);
		const workloads = byTestId("case-workload");
		expect(workloads.length).toBe(3);
		expect(workloads[0]).toContain("shop");
		expect(workloads[0]).toContain("shop deployment ready");
		expect(workloads[0]).toContain("shop pod healthy");
		expect(workloads[1]).toContain("checkout");
		expect(workloads[1]).toContain("checkout crashlooping");
		expect(workloads[2]).toContain("auth-svc");
		expect(workloads[2]).toContain("auth edge claim");
	});

	describe("captureLine helper", () => {
		const baseCapture = {
			id: "c1",
			state: "complete" as const,
			stateReason: null,
			missed: null,
			shared: false,
			latencyMs: 5000,
			identity: {
				kubeContext: "ctx",
				cluster: "cl",
				kubeUser: null,
				whoami: null,
				matchesBinding: true,
			},
			identityMatches: true,
			startedAt: T,
			finishedAt: T,
			artifacts: [],
		};

		it("formats queued, running, blocked, skipped states", () => {
			const binding = {
				kubeContext: "kind-pl",
				namespace: "shop",
				cluster: "kind",
				probeState: "ok" as const,
			};
			expect(captureLine({ ...baseCapture, state: "queued" }, binding)).toBe(
				"Capture of kind-pl/shop queued",
			);
			expect(captureLine({ ...baseCapture, state: "running" }, binding)).toBe(
				"Capturing kind-pl/shop…",
			);
			expect(
				captureLine(
					{ ...baseCapture, state: "blocked", stateReason: "no-kubectl" },
					binding,
				),
			).toBe("Capture of kind-pl/shop blocked: no-kubectl");
			expect(captureLine({ ...baseCapture, state: "skipped" }, binding)).toBe(
				"Capture of kind-pl/shop skipped",
			);
		});

		it("falls back to identity or default target when binding is null", () => {
			expect(
				captureLine({ ...baseCapture, state: "queued", identity: null }, null),
			).toBe("Capture of the bound target queued");
			expect(captureLine({ ...baseCapture, state: "queued" }, null)).toBe(
				"Capture of ctx queued",
			);
		});
	});

	describe("CaseFileLink", () => {
		it("renders link when case file is enabled", async () => {
			h.caseFileEnabled = true;
			await act(async () =>
				root.render(createElement(CaseFileLink, { incidentId: "i1" })),
			);
			const link = container.querySelector('[data-testid="header-case-file"]');
			expect(link).not.toBeNull();
			expect(link?.textContent).toBe("Case File");
		});

		it("renders nothing when case file is disabled", async () => {
			h.caseFileEnabled = false;
			await act(async () =>
				root.render(createElement(CaseFileLink, { incidentId: "i1" })),
			);
			expect(container.innerHTML).toBe("");
		});
	});

	describe("ArtifactDrawer interactive actions", () => {
		it("clicking retry button in drawer calls refetch on load failure", async () => {
			h.artifactError = { status: 500 };
			await act(async () =>
				root.render(
					createElement(ArtifactDrawer, {
						artifactId: "art-500",
						onClose: vi.fn(),
					}),
				),
			);
			const retryBtn = document.body.querySelector<HTMLButtonElement>(
				'[data-testid="state-problem"] button',
			);
			await act(async () => retryBtn?.click());
			expect(h.artifactRefetch).toHaveBeenCalled();
		});

		it("clicking command button in CaseFileView opens ArtifactDrawer", async () => {
			h.artifactData = {
				artifact: {
					id: "a-open",
					purpose: "events",
					subject: null,
					command: ["kubectl", "get", "events"],
					retrieval: "complete",
					retrievalReason: null,
					bytes: 10,
					redactions: {},
					withheld: false,
					expired: false,
				},
				text: "events output",
				truncated: false,
			};
			await render(
				view({
					captures: [
						{
							id: "c1",
							state: "complete",
							stateReason: null,
							missed: null,
							shared: false,
							latencyMs: null,
							identity: null,
							identityMatches: true,
							startedAt: T,
							finishedAt: T,
							artifacts: [h.artifactData.artifact],
						},
					],
				}),
			);
			const cmdBtn = container.querySelector<HTMLButtonElement>(
				'[data-testid="case-command"] button',
			);
			await act(async () => cmdBtn?.click());
			const drawer = document.body.querySelector(
				'[data-testid="artifact-drawer"]',
			);
			expect(drawer).not.toBeNull();
			expect(drawer?.textContent).toContain("events output");
		});

		it("clicking 'Open the artifact' in ClaimRow opens ArtifactDrawer", async () => {
			h.artifactData = {
				artifact: {
					id: "a-claim",
					purpose: "deployments",
					subject: null,
					command: ["kubectl", "get", "deployments"],
					retrieval: "complete",
					retrievalReason: null,
					bytes: 10,
					redactions: {},
					withheld: false,
					expired: false,
				},
				text: "deployment json",
				truncated: false,
			};
			await render(
				view({
					claims: [
						claim({
							id: "c-art",
							source: {
								kind: "capture",
								provenance: "host-executed",
								artifactId: "a-claim",
								investigationId: null,
							},
						}),
					],
				}),
			);
			const artBtn = container.querySelector<HTMLButtonElement>(
				'[data-testid="claim-artifact"]',
			);
			await act(async () => artBtn?.click());
			const drawer = document.body.querySelector(
				'[data-testid="artifact-drawer"]',
			);
			expect(drawer).not.toBeNull();
			expect(drawer?.textContent).toContain("deployment json");
		});
	});
});
