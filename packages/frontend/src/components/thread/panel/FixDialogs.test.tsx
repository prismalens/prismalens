// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type {
	FixPreview,
	FixRefusal,
	HarnessStatus,
} from "@prismalens/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
	FixPreviewBody,
	FixThreadDialog,
	REFUSAL_WORD,
	RerunConfirm,
} from "./FixDialogs";

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const previewState = vi.hoisted(() => ({
	data: null as FixPreview | null,
	isLoading: false,
	error: null as unknown,
	refetch: vi.fn(),
}));

const startState = vi.hoisted(() => ({
	mutate: vi.fn(),
	reset: vi.fn(),
	error: null as unknown,
	isPending: false,
}));

const harnessState = vi.hoisted(() => ({
	harnesses: [] as HarnessStatus[],
}));

vi.mock("@/lib/api/hooks/use-fix-thread", () => ({
	useFixPreview: () => ({
		data: previewState.data,
		isLoading: previewState.isLoading,
		error: previewState.error,
		refetch: previewState.refetch,
	}),
	useStartFixThread: () => ({
		mutate: startState.mutate,
		reset: startState.reset,
		error: startState.error,
		isPending: startState.isPending,
	}),
}));

vi.mock("@/lib/api/hooks/use-settings-orpc", () => ({
	useHarnesses: () => ({
		data: { harnesses: harnessState.harnesses },
	}),
}));

vi.mock("@tanstack/react-router", () => ({
	Link: ({
		children,
		to,
		params,
		...props
	}: {
		children: ReactNode;
		to?: string;
		params?: Record<string, string>;
	}) => {
		let href = to ?? "";
		if (params) {
			for (const [k, v] of Object.entries(params)) {
				href = href.replace(`$${k}`, v);
			}
		}
		return (
			<a href={href} {...props}>
				{children}
			</a>
		);
	},
	useNavigate: () => vi.fn(),
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
	previewState.data = null;
	previewState.isLoading = false;
	previewState.error = null;
	previewState.refetch = vi.fn();
	startState.mutate = vi.fn();
	startState.reset = vi.fn();
	startState.error = null;
	startState.isPending = false;
	harnessState.harnesses = [];
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
});

function renderWithClient(ui: React.ReactNode) {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	return (
		<QueryClientProvider client={queryClient}>
			<TooltipProvider>{ui}</TooltipProvider>
		</QueryClientProvider>
	);
}

async function show(ui: React.ReactNode) {
	await act(async () => {
		root.render(renderWithClient(ui));
	});
}

const basePreview: FixPreview = {
	title: "Fix failing checks",
	items: [{ kind: "check", ident: "app:1:test", label: "unit tests" }],
	covered: [],
	failed: [],
	text: "Fix the failing check",
	evidence: "Log excerpt",
	digest: "a".repeat(64),
	place: {
		projectId: "proj-1",
		projectName: "acme/shop",
		source: "folder",
		headRef: "feat/order",
		headSha: "0123456789abcdef0123456789abcdef01234567",
		fetch: false,
		push: "branch",
		pushUrl: "https://github.com/acme/shop.git",
		pushNote: null,
		own: true,
		harness: "mock-harness",
		model: "mock-model",
		effort: "medium",
		accessLevel: "full-access",
	},
	refusal: null,
};

describe("FixDialogs (#1176)", () => {
	it("renders every refusal word correctly", async () => {
		const refusals: FixRefusal[] = [
			"no-project",
			"plain-folder",
			"fork-branch",
			"no-head",
			"closed",
			"missing-commit",
			"not-failing",
			"cancelled",
			"resolved",
			"status-off",
		];

		const seen: { reason: string | null; words: boolean }[] = [];
		for (const r of refusals) {
			const preview: FixPreview = {
				...basePreview,
				items: [],
				refusal: { reason: r, detail: `Detail for ${r}` },
			};
			await show(<FixPreviewBody preview={preview} />);
			const el = container.querySelector('[data-testid="fix-refusal"]');
			seen.push({
				reason: el?.getAttribute("data-reason") ?? null,
				words: !!el?.textContent?.includes(REFUSAL_WORD[r]),
			});
		}
		expect(seen).toEqual(refusals.map((reason) => ({ reason, words: true })));
	});

	it("renders the covered state with link to existing thread and Go to thread button", async () => {
		previewState.data = {
			...basePreview,
			items: [],
			covered: [
				{
					ident: "app:1:test",
					label: "unit tests",
					link: {
						id: "thread-cov-123",
						state: "running",
						status: "working",
						title: "Fix thread",
						link: "/threads/thread-cov-123",
						unread: 0,
					},
				},
			],
		};

		await show(
			<FixThreadDialog
				threadId="thread-1"
				prId="pr-1"
				items={[{ kind: "check", runId: "1" }]}
				onClose={vi.fn()}
			/>,
		);

		const coveredRow = document.body.querySelector(
			'[data-testid="fix-covered-row"]',
		);
		expect(coveredRow).not.toBeNull();
		expect(coveredRow?.textContent).toContain("unit tests");
		expect(coveredRow?.textContent).toContain("Has a thread");

		const goToBtn = document.body.querySelector<HTMLAnchorElement>(
			'[data-testid="fix-go-to"]',
		);
		expect(goToBtn).not.toBeNull();
		expect(goToBtn?.textContent).toBe("Go to thread");
		expect(goToBtn?.getAttribute("href")).toBe("/threads/thread-cov-123");
	});

	it('handles conflict path and renders "It changed; review again"', async () => {
		previewState.data = basePreview;

		await show(
			<FixThreadDialog
				threadId="thread-1"
				prId="pr-1"
				items={[{ kind: "check", runId: "1" }]}
				onClose={vi.fn()}
			/>,
		);

		const startBtn = document.body.querySelector<HTMLButtonElement>(
			'[data-testid="fix-start"]',
		);
		expect(startBtn).not.toBeNull();

		// Trigger start mutation callback with a CONFLICT error
		startState.mutate.mockImplementation((_args, { onError }) => {
			const conflictErr = new Error("Conflict");
			(conflictErr as any).code = "CONFLICT";
			(conflictErr as any).status = 409;
			onError(conflictErr);
		});

		await act(async () => {
			startBtn?.click();
		});

		expect(
			document.body.querySelector('[data-testid="fix-changed"]')?.textContent,
		).toBe("It changed; review again");
		expect(previewState.refetch).toHaveBeenCalled();
	});

	it("handles failed start with Retry button", async () => {
		previewState.data = basePreview;

		await show(
			<FixThreadDialog
				threadId="thread-1"
				prId="pr-1"
				items={[{ kind: "check", runId: "1" }]}
				onClose={vi.fn()}
			/>,
		);

		const startBtn = document.body.querySelector<HTMLButtonElement>(
			'[data-testid="fix-start"]',
		);

		// Trigger normal error
		startState.mutate.mockImplementation((_args, { onError }) => {
			startState.error = new Error("Failed to start");
			onError(new Error("Failed to start"));
		});

		await act(async () => {
			startBtn?.click();
		});

		// Re-render dialog to reflect startState.error
		await show(
			<FixThreadDialog
				threadId="thread-1"
				prId="pr-1"
				items={[{ kind: "check", runId: "1" }]}
				onClose={vi.fn()}
			/>,
		);

		const problem = document.body.querySelector(
			'[data-testid="state-problem"]',
		);
		expect(problem).not.toBeNull();
		expect(problem?.textContent).toContain("Thread didn't start");
		const retryBtn = problem?.querySelector("button");
		expect(retryBtn?.textContent).toBe("Retry");
	});

	it("renders agent row words with harness label, model name, effort, and access", async () => {
		harnessState.harnesses = [
			{
				id: "mock-harness",
				label: "Mock Harness",
				models: {
					source: "static",
					asOf: "now",
					entries: [
						{
							id: "mock-model",
							name: "Mock Model v1",
							reasoning: false,
							contextWindow: 100_000,
						},
					],
				},
			} as unknown as HarnessStatus,
		];

		const preview: FixPreview = {
			...basePreview,
			place: {
				...basePreview.place!,
				harness: "mock-harness",
				model: "mock-model",
				effort: "high",
				accessLevel: "full-access",
			},
		};

		await show(<FixPreviewBody preview={preview} />);

		const agentRow = container.querySelector('[data-testid="fix-place-agent"]');
		expect(agentRow).not.toBeNull();
		expect(agentRow?.textContent).toContain("Mock Harness");
		expect(agentRow?.textContent).toContain("Mock Model v1");
		expect(agentRow?.textContent).toContain("high");
		expect(agentRow?.textContent).toContain("Full access");
	});

	it('renders "The last fix thread failed" with "Open it" before Start when preview has failed threads', async () => {
		const preview: FixPreview = {
			...basePreview,
			failed: [
				{
					id: "failed-thread-999",
					state: "failed",
					status: "failed",
					title: "Old fix",
					link: "/threads/failed-thread-999",
					unread: 0,
				},
			],
		};

		await show(<FixPreviewBody preview={preview} />);

		const failedNotice = container.querySelector(
			'[data-testid="fix-failed-before"]',
		);
		expect(failedNotice).not.toBeNull();
		expect(failedNotice?.textContent).toContain("The last fix thread failed");
		const openLink = failedNotice?.querySelector("a");
		expect(openLink?.textContent).toBe("Open it");
		expect(openLink?.getAttribute("href")).toBe("/threads/failed-thread-999");
	});
});
