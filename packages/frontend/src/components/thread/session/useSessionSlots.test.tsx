// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { ThreadSession } from "@prismalens/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SlotContext } from "@/components/thread/slots/types";
import {
	envelopeOf,
	type SendEnvelope,
	type SendForward,
} from "@/lib/composer-send";
import { useSessionSlots } from "./useSessionSlots";

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let run: {
	session?: ThreadSession | null;
	usage?: { used: number; size: number; at: string } | null;
} | null = null;
let coldResume: "ask" | "send" | "compact" = "ask";
const compactMutate = vi.fn();
const autoResumeMutate = vi.fn();

vi.mock("@/lib/api/hooks/use-investigations-orpc", () => ({
	useInvestigation: () => ({ data: run }),
}));

vi.mock("@/lib/api/hooks", () => ({
	useHarnessSettings: () => ({ data: { coldResume } }),
}));

vi.mock("@/lib/api/hooks/use-session-orpc", () => ({
	useCompactSession: () => ({ mutate: compactMutate, isPending: false }),
	useSetAutoResume: () => ({ mutate: autoResumeMutate, isPending: false }),
}));

const unmounts: (() => void)[] = [];
let container: HTMLDivElement;
let root: Root;
let queryClient: QueryClient;

function HookHarness<T>({
	hook,
	onResult,
}: {
	hook: () => T;
	onResult: (val: T) => void;
}) {
	const val = hook();
	onResult(val);
	return null;
}

function renderHook<T>(hook: () => T, client: QueryClient) {
	const result = { current: undefined as unknown as T };
	const hookContainer = document.createElement("div");
	document.body.appendChild(hookContainer);
	const hookRoot = createRoot(hookContainer);

	const rerender = () => {
		act(() => {
			hookRoot.render(
				<QueryClientProvider client={client}>
					<HookHarness
						hook={hook}
						onResult={(val) => {
							result.current = val;
						}}
					/>
				</QueryClientProvider>,
			);
		});
	};

	rerender();

	const unmount = () => {
		act(() => hookRoot.unmount());
		hookContainer.remove();
	};
	unmounts.push(unmount);

	return {
		result,
		rerender,
		unmount,
	};
}

const ctx: SlotContext = {
	page: "thread",
	threadId: "t1",
	incidentId: null,
	live: false,
	asks: [],
};

const coldSession: ThreadSession = {
	lastActivityAt: "2026-11-11T10:00:00Z",
	cache: "cold",
	contextTokens: 140_000,
	compaction: "none",
	compactCommand: "compact",
};

const env: SendEnvelope = envelopeOf("check the logs");
let forward: SendForward;

beforeEach(() => {
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
	queryClient = new QueryClient({
		defaultOptions: {
			queries: { retry: false },
			mutations: { retry: false },
		},
	});
	forward = vi.fn().mockResolvedValue(undefined);
	compactMutate.mockClear();
	autoResumeMutate.mockClear();
	coldResume = "ask";
	run = null;
});

afterEach(async () => {
	for (const u of unmounts) u();
	unmounts.length = 0;
	await act(async () => root.unmount());
	container.remove();
});

describe("useSessionSlots", () => {
	it("coldResume ask and a cold session: calling interceptor returns deferred with a settled promise, forward is not called, and after a rerender dock holds an item with id cold-conversation and order 30", async () => {
		coldResume = "ask";
		run = { session: coldSession };
		const { result, rerender } = renderHook(
			() => useSessionSlots(ctx),
			queryClient,
		);
		const interceptResult = await result.current.interceptor?.(
			env,
			false,
			forward,
		);
		expect(interceptResult?.result).toBe("deferred");
		expect(typeof interceptResult?.settled?.then).toBe("function");
		expect(forward).not.toHaveBeenCalled();

		rerender();
		const coldDock = result.current.dock?.find(
			(d) => d?.id === "cold-conversation",
		);
		expect(coldDock?.id).toBe("cold-conversation");
		expect(coldDock?.order).toBe(30);
	});

	it("coldResume send and the same session: the interceptor returns null and no cold-conversation dock item appears", async () => {
		coldResume = "send";
		run = { session: coldSession };
		const { result, rerender } = renderHook(
			() => useSessionSlots(ctx),
			queryClient,
		);
		const interceptResult = await result.current.interceptor?.(
			env,
			false,
			forward,
		);
		expect(interceptResult).toBeNull();

		rerender();
		const coldDock = result.current.dock?.find(
			(d) => d?.id === "cold-conversation",
		);
		expect(coldDock).toBeUndefined();
	});

	it("coldResume compact with compactCommand: calls forward once with compact true and false, and resolves to sent", async () => {
		coldResume = "compact";
		run = { session: coldSession };
		const { result } = renderHook(() => useSessionSlots(ctx), queryClient);
		const interceptResult = await result.current.interceptor?.(
			env,
			false,
			forward,
		);
		expect(forward).toHaveBeenCalledTimes(1);
		expect(forward).toHaveBeenCalledWith({ ...env, compact: true }, false);
		expect(interceptResult).toEqual({ result: "sent" });
	});

	it("coldResume compact without compactCommand: defers and dock appears with id cold-conversation", async () => {
		coldResume = "compact";
		run = { session: { ...coldSession, compactCommand: undefined } };
		const { result, rerender } = renderHook(
			() => useSessionSlots(ctx),
			queryClient,
		);
		const interceptResult = await result.current.interceptor?.(
			env,
			false,
			forward,
		);
		expect(interceptResult?.result).toBe("deferred");

		rerender();
		const coldDock = result.current.dock?.find(
			(d) => d?.id === "cold-conversation",
		);
		expect(coldDock?.id).toBe("cold-conversation");
	});

	it("a warm session with 140_000 tokens: the interceptor returns null", async () => {
		coldResume = "ask";
		run = { session: { ...coldSession, cache: "warm" } };
		const { result } = renderHook(() => useSessionSlots(ctx), queryClient);
		const interceptResult = await result.current.interceptor?.(
			env,
			false,
			forward,
		);
		expect(interceptResult).toBeNull();
	});

	it("ctx.live true: the interceptor returns null whatever the session", async () => {
		coldResume = "ask";
		run = { session: coldSession };
		const liveCtx: SlotContext = { ...ctx, live: true };
		const { result } = renderHook(() => useSessionSlots(liveCtx), queryClient);
		const interceptResult = await result.current.interceptor?.(
			env,
			false,
			forward,
		);
		expect(interceptResult).toBeNull();
	});

	it("an env that already has compact true: the interceptor returns null", async () => {
		coldResume = "ask";
		run = { session: coldSession };
		const { result } = renderHook(() => useSessionSlots(ctx), queryClient);
		const compactEnv = { ...env, compact: true };
		const interceptResult = await result.current.interceptor?.(
			compactEnv,
			false,
			forward,
		);
		expect(interceptResult).toBeNull();
	});

	describe("choosing in the cold dock", () => {
		it("clicking cold-dock-fresh calls forward with fresh true and false and resolves settled to sent", async () => {
			coldResume = "ask";
			run = { session: coldSession };
			const { result, rerender } = renderHook(
				() => useSessionSlots(ctx),
				queryClient,
			);
			const interceptResult = await result.current.interceptor?.(
				env,
				false,
				forward,
			);
			rerender();
			const coldDock = result.current.dock?.find(
				(d) => d?.id === "cold-conversation",
			);
			await act(async () => {
				root.render(<div>{coldDock?.node}</div>);
			});

			const freshButton = container.querySelector(
				'[data-testid="cold-dock-fresh"]',
			) as HTMLButtonElement;
			await act(async () => {
				freshButton.click();
			});

			expect(forward).toHaveBeenCalledTimes(1);
			expect(forward).toHaveBeenCalledWith({ ...env, fresh: true }, false);
			const outcome = await interceptResult?.settled;
			expect(outcome).toBe("sent");
		});

		it("clicking cold-dock-cancel resolves settled to cancelled with forward not called", async () => {
			coldResume = "ask";
			run = { session: coldSession };
			const { result, rerender } = renderHook(
				() => useSessionSlots(ctx),
				queryClient,
			);
			const interceptResult = await result.current.interceptor?.(
				env,
				false,
				forward,
			);
			rerender();
			const coldDock = result.current.dock?.find(
				(d) => d?.id === "cold-conversation",
			);
			await act(async () => {
				root.render(<div>{coldDock?.node}</div>);
			});

			const cancelButton = container.querySelector(
				'[data-testid="cold-dock-cancel"]',
			) as HTMLButtonElement;
			await act(async () => {
				cancelButton.click();
			});

			expect(forward).not.toHaveBeenCalled();
			const outcome = await interceptResult?.settled;
			expect(outcome).toBe("cancelled");
		});
	});

	it("a limit defers interceptor with id usage-limit and order 20, clicking limit-dock-send-at-reset calls autoResume mutate with draft, clicking limit-dock-dont-resume calls with on false, and clicking limit-dock-send-now calls forward with env and false", async () => {
		coldResume = "ask";
		const limit = {
			since: "2026-11-11T15:00:00Z",
			autoResume: true,
			resetsAt: "2026-11-11T15:43:00Z",
			nextAttemptAt: "2026-11-11T15:45:00Z",
			attempts: 1,
		};
		run = { session: { ...coldSession, limit } };
		const { result, rerender } = renderHook(
			() => useSessionSlots(ctx),
			queryClient,
		);
		const interceptResult = await result.current.interceptor?.(
			env,
			false,
			forward,
		);
		expect(interceptResult?.result).toBe("deferred");

		rerender();
		const limitDock = result.current.dock?.find((d) => d?.id === "usage-limit");
		expect(limitDock?.id).toBe("usage-limit");
		expect(limitDock?.order).toBe(20);

		await act(async () => {
			root.render(<div>{limitDock?.node}</div>);
		});

		const sendAtResetBtn = container.querySelector(
			'[data-testid="limit-dock-send-at-reset"]',
		) as HTMLButtonElement;
		await act(async () => {
			sendAtResetBtn.click();
		});
		expect(autoResumeMutate).toHaveBeenCalledTimes(1);
		expect(autoResumeMutate.mock.calls[0][0]).toEqual({
			on: true,
			message: "check the logs",
		});

		const dontResumeBtn = container.querySelector(
			'[data-testid="limit-dock-dont-resume"]',
		) as HTMLButtonElement;
		await act(async () => {
			dontResumeBtn.click();
		});
		expect(autoResumeMutate).toHaveBeenCalledTimes(2);
		expect(autoResumeMutate).toHaveBeenLastCalledWith({ on: false });

		const sendNowBtn = container.querySelector(
			'[data-testid="limit-dock-send-now"]',
		) as HTMLButtonElement;
		await act(async () => {
			sendNowBtn.click();
		});
		expect(forward).toHaveBeenCalledTimes(1);
		expect(forward).toHaveBeenCalledWith(env, false);
	});

	it("a gave-up limit with a warm session does not hold for the limit and returns null", async () => {
		coldResume = "ask";
		const limit = {
			since: "2026-11-11T15:00:00Z",
			gaveUp: true,
			attempts: 7,
			resetsAt: null,
			autoResume: true,
		};
		run = { session: { ...coldSession, cache: "warm", limit } };
		const { result } = renderHook(() => useSessionSlots(ctx), queryClient);
		const interceptResult = await result.current.interceptor?.(
			env,
			false,
			forward,
		);
		expect(interceptResult).toBeNull();
	});

	describe("composerFooter", () => {
		it("with run.usage used 142_000 and size 200_000 is non-null and rendered shows 71%", async () => {
			run = {
				session: coldSession,
				usage: { used: 142_000, size: 200_000, at: "2026-11-11T15:00:00Z" },
			};
			const { result } = renderHook(() => useSessionSlots(ctx), queryClient);
			expect(result.current.composerFooter).not.toBeNull();
			await act(async () => {
				root.render(<div>{result.current.composerFooter}</div>);
			});
			expect(container.textContent).toContain("71%");
		});

		it("with no usage composerFooter is null", () => {
			run = { session: coldSession, usage: null };
			const { result } = renderHook(() => useSessionSlots(ctx), queryClient);
			expect(result.current.composerFooter).toBeNull();
		});
	});
});
