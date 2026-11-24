// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	type CanonicalEvent,
	type PrSubscriptionView,
	resolveSpec,
} from "@prismalens/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InboundRowView } from "@/components/investigation/transcript/InboundRow";
import { PrSubscriptionNode } from "@/components/investigation/transcript/PrSubscriptionNode";
import { TooltipProvider } from "@/components/ui/tooltip";
import { PrSubscriptions } from "./PrSubscriptions";

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const subState = vi.hoisted(() => ({
	subs: [] as PrSubscriptionView[],
	isPending: false,
	isError: false,
	cancel: vi.fn(async () => {}),
	retry: vi.fn(async () => {}),
	resume: vi.fn(async () => {}),
	start: vi.fn(async () => {}),
	poll: vi.fn(async () => {}),
	busy: false,
}));

vi.mock("@/lib/lazy", async () => {
	const React = await import("react");
	return {
		lazyPart: <P extends object>(
			load: () => Promise<
				React.ComponentType<P> | { [key: string]: React.ComponentType<P> }
			>,
		) => {
			let Comp: React.ComponentType<P> | null = null;
			const promise = load().then((m) => {
				if (typeof m === "function") Comp = m;
				else if (m && typeof m === "object") {
					const values = Object.values(m);
					Comp = (values[0] as React.ComponentType<P>) ?? null;
				}
			});
			return (props: P) => {
				const [C, setC] = React.useState<React.ComponentType<P> | null>(
					() => Comp,
				);
				React.useEffect(() => {
					if (!C) {
						promise.then(() => setC(() => Comp));
					}
				}, [C]);
				return C ? React.createElement(C, props) : null;
			};
		},
	};
});

vi.mock("@/components/shared/DestructiveConfirm", async () => {
	const { createElement: el } = await import("react");
	return {
		DestructiveConfirm: (p: {
			open: boolean;
			title: string;
			confirmLabel: string;
			onConfirm: () => unknown;
		}) =>
			p.open
				? el("div", { "data-testid": "destructive-confirm" }, [
						el("span", { key: "title" }, p.title),
						el(
							"button",
							{
								key: "btn",
								type: "button",
								"data-testid": "confirm-action",
								onClick: p.onConfirm,
							},
							p.confirmLabel,
						),
					])
				: null,
	};
});

vi.mock("@/lib/api/hooks/use-pr-subscriptions", () => ({
	usePrSubscriptions: () => ({
		data: { subscriptions: subState.subs },
		isPending: subState.isPending,
		isError: subState.isError,
		refetch: vi.fn(),
	}),
	usePrSubscriptionActions: () => ({
		start: subState.start,
		resume: subState.resume,
		cancel: subState.cancel,
		retry: subState.retry,
		poll: subState.poll,
		busy: subState.busy,
		polling: false,
		error: null,
	}),
}));

vi.mock("@tanstack/react-router", () => ({
	useNavigate: () => vi.fn(),
	Link: ({
		children,
		to,
		search,
		className,
	}: {
		children: ReactNode;
		to?: string;
		search?: Record<string, unknown>;
		className?: string;
	}) => (
		<a href={`${to}?tab=${search?.tab ?? ""}`} className={className}>
			{children}
		</a>
	),
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
	subState.subs = [];
	subState.isPending = false;
	subState.isError = false;
	subState.busy = false;
	vi.clearAllMocks();
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
});

function renderWithClient(ui: ReactNode) {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	return (
		<QueryClientProvider client={queryClient}>
			<TooltipProvider>{ui}</TooltipProvider>
		</QueryClientProvider>
	);
}

async function show(ui: ReactNode) {
	await act(async () => {
		root.render(renderWithClient(ui));
	});
}

function baseSub(over: Partial<PrSubscriptionView> = {}): PrSubscriptionView {
	return {
		id: "sub-1",
		threadId: "thread-1",
		prId: "pr-1",
		pr: "acme/subs#7",
		url: "https://github.com/acme/subs/pull/7",
		host: "github",
		createdBy: "agent",
		spec: resolveSpec("agent", {
			events: ["checks"],
			delivery: "wake",
			once: false,
		}),
		summary: "Failing checks. Wakes the thread.",
		state: "active",
		paused: null,
		hostError: null,
		deliveryFailing: null,
		endReason: null,
		endNote: null,
		counts: {
			delivered: 2,
			waiting: 0,
			filtered: 0,
			withdrawn: 0,
			alreadySent: 0,
		},
		since: "2026-11-17T10:00:00.000Z",
		lastDeliveredAt: "2026-11-17T10:05:00.000Z",
		lastReadAt: "2026-11-17T10:05:00.000Z",
		endedAt: null,
		...over,
	};
}

describe("PrSubscriptions panel states (#1179 §7)", () => {
	it("renders active state", async () => {
		subState.subs = [baseSub({ state: "active" })];
		await show(<PrSubscriptions threadId="thread-1" prId="pr-1" />);
		const stateEl = container.querySelector('[data-testid="pr-sub-state"]');
		expect(stateEl?.textContent).toBe("Active");
	});

	it("renders waiting counts", async () => {
		subState.subs = [
			baseSub({
				state: "active",
				counts: {
					delivered: 3,
					waiting: 2,
					filtered: 0,
					withdrawn: 0,
					alreadySent: 0,
				},
			}),
		];
		await show(<PrSubscriptions threadId="thread-1" prId="pr-1" />);
		expect(container.textContent).toContain("3 delivered, 2 waiting");
	});

	it("renders paused states: ceiling, setting_off, settling and until", async () => {
		// 1. ceiling
		subState.subs = [
			baseSub({
				id: "sub-ceiling",
				paused: { reason: "ceiling", until: null },
			}),
		];
		await show(<PrSubscriptions threadId="thread-1" prId="pr-1" />);
		expect(
			container.querySelector('[data-testid="pr-sub-state"]')?.textContent,
		).toBe("Paused: daily ceiling");

		// 2. setting_off (with link to settings)
		subState.subs = [
			baseSub({
				id: "sub-setting",
				paused: { reason: "setting_off", until: null },
			}),
		];
		await show(<PrSubscriptions threadId="thread-1" prId="pr-1" />);
		const link = container.querySelector('[data-testid="pr-sub-state"] a');
		expect(link?.textContent).toBe("Paused: setting off");
		expect(link?.getAttribute("href")).toContain("/settings");

		// 3. settling
		subState.subs = [
			baseSub({
				id: "sub-settling",
				paused: { reason: "settling", until: null },
			}),
		];
		await show(<PrSubscriptions threadId="thread-1" prId="pr-1" />);
		expect(
			container.querySelector('[data-testid="pr-sub-state"]')?.textContent,
		).toBe("Paused: settling");

		// 4. until
		subState.subs = [
			baseSub({
				id: "sub-until",
				paused: {
					reason: "rate_limited",
					until: "2026-11-18T10:15:00.000Z",
				},
			}),
		];
		await show(<PrSubscriptions threadId="thread-1" prId="pr-1" />);
		expect(
			container.querySelector('[data-testid="pr-sub-state"]')?.textContent,
		).toMatch(/^Paused until/);
	});

	it("renders disconnected state", async () => {
		subState.subs = [
			baseSub({
				state: "disconnected",
				hostError: "GitHub API 401 Unauthorized",
			}),
		];
		await show(<PrSubscriptions threadId="thread-1" prId="pr-1" />);
		const stateEl = container.querySelector('[data-testid="pr-sub-state"]');
		expect(stateEl?.textContent).toBe("Disconnected");
	});

	it("renders delivery failing with Retry button", async () => {
		subState.subs = [
			baseSub({
				deliveryFailing: {
					parked: 1,
					lastError: "Internal server error 500",
					at: "2026-11-18T10:00:00.000Z",
				},
			}),
		];
		await show(<PrSubscriptions threadId="thread-1" prId="pr-1" />);
		const stateEl = container.querySelector('[data-testid="pr-sub-state"]');
		expect(stateEl?.textContent).toBe("Delivery failing");

		const retryBtn = container.querySelector(
			'[data-testid="pr-sub-retry"]',
		) as HTMLButtonElement | null;
		expect(retryBtn).not.toBeNull();
		expect(retryBtn?.textContent).toBe("Retry");

		await act(async () => {
			retryBtn?.click();
		});
		expect(subState.retry).toHaveBeenCalledTimes(1);
	});

	it("renders ended with its reason words", async () => {
		// <= 4 words: "Ended: merged", "Ended: closed", "Ended: cancelled by you"
		subState.subs = [
			baseSub({
				id: "sub-merged",
				state: "ended",
				endReason: "merged",
			}),
		];
		await show(<PrSubscriptions threadId="thread-1" prId="pr-1" />);
		expect(
			container.querySelector('[data-testid="pr-sub-state"]')?.textContent,
		).toBe("Ended: merged");

		subState.subs = [
			baseSub({
				id: "sub-user-cancel",
				state: "ended",
				endReason: "cancelled_by_user",
			}),
		];
		await show(<PrSubscriptions threadId="thread-1" prId="pr-1" />);
		expect(
			container.querySelector('[data-testid="pr-sub-state"]')?.textContent,
		).toBe("Ended: cancelled by you");

		// > 4 words: "loop_guard" -> "a check kept failing on 3 pushes" (7 words) -> "Ended"
		subState.subs = [
			baseSub({
				id: "sub-loop",
				state: "ended",
				endReason: "loop_guard",
			}),
		];
		await show(<PrSubscriptions threadId="thread-1" prId="pr-1" />);
		expect(
			container.querySelector('[data-testid="pr-sub-state"]')?.textContent,
		).toBe("Ended");
	});
});

describe("Cancel visibility (#1179 §7)", () => {
	it("shows Cancel for active subscription with 0 waiting events, calling cancel directly", async () => {
		subState.subs = [
			baseSub({
				id: "sub-active",
				state: "active",
				counts: {
					delivered: 1,
					waiting: 0,
					filtered: 0,
					withdrawn: 0,
					alreadySent: 0,
				},
			}),
		];
		await show(<PrSubscriptions threadId="thread-1" prId="pr-1" />);
		const cancelBtn = container.querySelector(
			'[data-testid="pr-sub-cancel"]',
		) as HTMLButtonElement | null;
		expect(cancelBtn).not.toBeNull();

		await act(async () => {
			cancelBtn?.click();
		});
		expect(subState.cancel).toHaveBeenCalledWith("sub-active");
	});

	it("shows confirmation dialog before cancelling when waiting events > 0", async () => {
		subState.subs = [
			baseSub({
				id: "sub-waiting",
				state: "active",
				counts: {
					delivered: 1,
					waiting: 3,
					filtered: 0,
					withdrawn: 0,
					alreadySent: 0,
				},
			}),
		];
		await show(<PrSubscriptions threadId="thread-1" prId="pr-1" />);
		const cancelBtn = container.querySelector(
			'[data-testid="pr-sub-cancel"]',
		) as HTMLButtonElement | null;
		expect(cancelBtn).not.toBeNull();

		await act(async () => {
			cancelBtn?.click();
		});
		// Destructive confirm opens with waiting count warning
		expect(document.body.textContent).toContain("Discard 3 waiting events?");
		expect(subState.cancel).not.toHaveBeenCalled();
	});

	it("does not show Cancel for ended subscription, showing Resume instead", async () => {
		subState.subs = [
			baseSub({
				id: "sub-ended",
				state: "ended",
				endReason: "merged",
			}),
		];
		await show(<PrSubscriptions threadId="thread-1" prId="pr-1" />);
		expect(container.querySelector('[data-testid="pr-sub-cancel"]')).toBeNull();
		const resumeBtn = container.querySelector(
			'[data-testid="pr-sub-resume"]',
		) as HTMLButtonElement | null;
		expect(resumeBtn).not.toBeNull();
		expect(resumeBtn?.textContent).toBe("Resume");
	});

	it("PrSubscriptionNode renders Cancel only when phase is started and subscription is live", async () => {
		subState.subs = [baseSub({ id: "sub-live", state: "active" })];
		const startedLive: CanonicalEvent = {
			kind: "pr_subscription",
			runId: "thread-1",
			branchId: "main",
			path: [],
			seq: 1,
			label: null,
			ts: "2026-11-18T10:00:00.000Z",
			subscriptionId: "sub-live",
			prId: "pr-1",
			pr: "acme/subs#7",
			url: "https://github.com/acme/subs/pull/7",
			host: "github",
			phase: "started",
			by: "agent",
			delivery: "wake",
			summary: "Failing checks",
		};
		await show(
			<PrSubscriptionNode
				event={startedLive}
				runId="thread-1"
				incidentId="inc-1"
			/>,
		);
		expect(
			container.querySelector('[data-testid="pr-subscription-cancel"]'),
		).not.toBeNull();

		// Ended subscription in list
		subState.subs = [baseSub({ id: "sub-dead", state: "ended" })];
		const startedDead: CanonicalEvent = {
			...startedLive,
			subscriptionId: "sub-dead",
		};
		await show(
			<PrSubscriptionNode
				event={startedDead}
				runId="thread-1"
				incidentId="inc-1"
			/>,
		);
		expect(
			container.querySelector('[data-testid="pr-subscription-cancel"]'),
		).toBeNull();

		// Ended phase event
		const endedEvent: CanonicalEvent = {
			kind: "pr_subscription",
			runId: "thread-1",
			branchId: "main",
			path: [],
			seq: 2,
			label: null,
			ts: "2026-11-18T10:00:00.000Z",
			subscriptionId: "sub-live",
			prId: "pr-1",
			pr: "acme/subs#7",
			url: "https://github.com/acme/subs/pull/7",
			host: "github",
			phase: "ended",
			by: "agent",
			delivery: "wake",
			reason: "merged",
			summary: "Merged",
		};
		await show(
			<PrSubscriptionNode
				event={endedEvent}
				runId="thread-1"
				incidentId="inc-1"
			/>,
		);
		expect(
			container.querySelector('[data-testid="pr-subscription-cancel"]'),
		).toBeNull();
	});
});

describe("InboundRow provenance (#1179 §7)", () => {
	it("renders provenance list with items, kinds, links and more, and quotes no host text", async () => {
		const prEvents = [
			{
				prId: "pr-1",
				pr: "acme/subs#7",
				url: "https://github.com/acme/subs/pull/7",
				subscriptionIds: ["sub-1"],
				delivery: "wake" as const,
				items: [
					{
						id: 1,
						kind: "comment" as const,
						author: "alice",
						association: "COLLABORATOR",
						link: "https://github.com/acme/subs/pull/7#issuecomment-1",
						at: "2026-11-18T10:00:00.000Z",
					},
					{
						id: 2,
						kind: "check" as const,
						agentPosted: true,
						at: "2026-11-18T10:00:00.000Z",
					},
				],
				more: [3, 4],
				superseded: 0,
			},
		];

		const row = {
			messageId: "msg-1",
			source: "pr" as const,
			state: "delivered" as const,
			arrivedAt: "2026-11-18T10:00:00.000Z",
			text: "3 new events on acme/subs#7",
			line: "Delivered",
			retries: [],
			prId: "pr-1",
			prEvents,
		};

		await show(<InboundRowView row={row} />);

		// Lazy provenance list loads
		const prov = container.querySelector('[data-testid="inbound-pr-events"]');
		expect(prov).not.toBeNull();
		expect(prov?.textContent).toContain("Woke the agent");
		expect(prov?.textContent).toContain("[d1]");
		expect(prov?.textContent).toContain("comment");
		expect(prov?.textContent).toContain("@alice");
		expect(prov?.textContent).toContain("collaborator");
		expect(prov?.textContent).toContain("[d2]");
		expect(prov?.textContent).toContain(", agent-posted");
		expect(prov?.textContent).toContain("and 2 more");

		// Quotes NO host text: clamp paragraph is absent because quoted is empty
		expect(container.querySelector('[data-testid="inbound-clamp"]')).toBeNull();
	});
});
