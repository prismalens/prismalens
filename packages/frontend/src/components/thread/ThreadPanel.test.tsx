// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { WorktreeChanges } from "@prismalens/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AskCard } from "@/components/investigation/RunDock";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { AskRecord } from "@/lib/run-asks";
import { StatusBox } from "./StatusBox";
import { ThreadPanel } from "./ThreadPanel";

const state = vi.hoisted(() => ({
	changes: { repos: [] } as WorktreeChanges | Error,
	canEdit: false,
	opened: [] as unknown[],
}));

vi.mock("@/lib/api/orpc-client", () => ({
	orpc: {
		investigations: {
			getChanges: {
				queryOptions: ({ input }: { input: { id: string } }) => ({
					queryKey: ["changes", input.id],
					queryFn: async () => {
						if (state.changes instanceof Error) throw state.changes;
						return state.changes;
					},
				}),
			},
		},
		runWorkspaces: {
			listForRun: {
				queryOptions: ({ input }: { input: { runId: string } }) => ({
					queryKey: ["kept", input.runId],
					queryFn: async () => ({ workspaces: [], canEdit: state.canEdit }),
				}),
			},
			open: {
				mutationOptions: () => ({
					mutationFn: async (v: unknown) => {
						state.opened.push(v);
						return { opened: true };
					},
				}),
			},
		},
	},
}));
vi.mock("@/lib/api/hooks/use-investigations-orpc", () => ({
	useAnswerAsk: () => ({
		mutate: vi.fn(),
		isPending: false,
		isSuccess: false,
		isError: false,
	}),
}));
vi.mock("@/components/run/EvidenceFileView", () => ({
	EvidenceFileView: () => null,
	CODE_STYLE: {},
	POOL: { poolOptions: {}, highlighterOptions: {} },
}));
vi.mock("@pierre/diffs/react", () => ({
	PatchDiff: ({ patch }: { patch: string }) => (
		<pre data-testid="patch">{patch}</pre>
	),
	WorkerPoolContextProvider: ({ children }: { children: ReactNode }) =>
		children,
}));
vi.mock("@/components/run/BrowserTab", () => ({
	BrowserTab: () => <p data-testid="browser-tab">browser</p>,
}));
vi.mock("@/lib/providers/theme-provider", () => ({
	useTheme: () => ({ theme: "dark" }),
}));
vi.mock("@tanstack/react-router", () => ({
	Link: ({ children }: { children: ReactNode }) => children,
}));

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
if (typeof globalThis.ResizeObserver === "undefined")
	globalThis.ResizeObserver = class {
		observe() {}
		unobserve() {}
		disconnect() {}
	};

const HEAD = "a".repeat(40);
const workspace = {
	layout: "single" as const,
	cwd: "/w/pl-1",
	repos: [
		{
			name: "repo",
			dir: "/w/pl-1",
			sourceKind: "folder" as const,
			url: "/code/shop",
			subPath: null,
			connectionId: null,
			head: HEAD,
			branch: "prismalens/shop-1",
			services: [],
		},
	],
};
const files = {
	runId: "r1",
	workspace,
	touched: [],
	links: [],
	viewing: null,
	onOpen: vi.fn(),
	onClose: vi.fn(),
	backLabel: "Back",
	reads: [],
	codeHost: null,
	stepFile: () => null,
	onOpenHypotheses: vi.fn(),
};

let container: HTMLDivElement;
let root: Root;
const q = (id: string) => container.querySelector(`[data-testid="${id}"]`);

let client: QueryClient;

async function render(node: ReactNode) {
	client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	await act(async () => root.unmount());
	root = createRoot(container);
	await act(async () =>
		root.render(
			<QueryClientProvider client={client}>
				<TooltipProvider>{node}</TooltipProvider>
			</QueryClientProvider>,
		),
	);
	// Let the queries settle.
	await act(async () => new Promise((r) => setTimeout(r, 20)));
}

beforeEach(() => {
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
	state.changes = { repos: [] };
	state.canEdit = false;
	state.opened = [];
});
afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
});

const panel = (over: Partial<Parameters<typeof ThreadPanel>[0]> = {}) => (
	<ThreadPanel
		surface={null}
		onSurface={vi.fn()}
		onClose={vi.fn()}
		runId="r1"
		live={false}
		investigation={false}
		files={files}
		suspects={[]}
		{...over}
	/>
);

describe("ThreadPanel (#1020)", () => {
	it("opens on no surface, and a chat has no Suspects tab", async () => {
		await render(panel());
		expect(q("surface-empty")?.textContent).toBe("Open a surface");
		expect(q("surface-files")).not.toBeNull();
		expect(q("surface-diff")).not.toBeNull();
		expect(q("surface-browser")).not.toBeNull();
		expect(q("surface-suspects")).toBeNull();
		// The empty panel is still named for assistive technology.
		const panelEl = container.querySelector('[role="tabpanel"]');
		expect(panelEl?.getAttribute("aria-label")).toBe("Surfaces");
	});

	it("lists an investigation's suspects in the agent's order with its status words", async () => {
		const onSurface = vi.fn();
		await render(
			panel({
				investigation: true,
				surface: "suspects",
				onSurface,
				suspects: [
					{
						id: "h2",
						statement: "Cache stampede",
						status: "refuted",
						evidenceIds: [],
						at: "x",
					},
					{
						id: "h1",
						statement: "Retry storm",
						status: "supported",
						evidenceIds: [],
						at: "x",
					},
				],
			}),
		);
		const rows = Array.from(
			container.querySelectorAll('[data-testid="suspect"]'),
		);
		expect(rows.map((r) => r.textContent)).toEqual([
			"RefutedCache stampede",
			"SupportedRetry storm",
		]);
		expect(container.textContent).not.toMatch(/leading/i);
		await act(async () => (q("surface-diff") as HTMLButtonElement).click());
		expect(onSurface).toHaveBeenCalledWith("diff");
	});

	it("says when there are no suspects yet", async () => {
		await render(panel({ investigation: true, surface: "suspects" }));
		expect(q("suspects-empty")?.textContent).toBe("No suspects yet");
	});
});

describe("WorktreeDiff (#1020)", () => {
	const ok = (over: Record<string, unknown> = {}) => ({
		state: "ok" as const,
		repo: "repo",
		base: HEAD,
		branch: "prismalens/shop-1",
		files: [],
		additions: 0,
		deletions: 0,
		patch: "",
		omitted: null,
		truncated: false,
		...over,
	});

	it("shows each changed file and the picked file's patch", async () => {
		state.changes = {
			repos: [
				ok({
					files: [
						{
							path: "src/a.ts",
							status: "modified",
							additions: 2,
							deletions: 1,
						},
						{
							path: "vendor/lib",
							status: "submodule",
							additions: null,
							deletions: null,
						},
					],
					additions: 2,
					deletions: 1,
					patch:
						"diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1,2 @@\n-x\n+y\n+z\n",
				}),
			],
		};
		await render(panel({ surface: "diff" }));
		const rows = Array.from(
			container.querySelectorAll('[data-testid="diff-file"]'),
		);
		expect(rows.map((r) => r.getAttribute("data-status"))).toEqual([
			"modified",
			"submodule",
		]);
		expect(q("patch")?.textContent).toContain("+z");
	});

	it("falls back to the first file when the picked one leaves the list, and says when the list is cut short", async () => {
		const file = (path: string) => ({
			path,
			status: "modified" as const,
			additions: 1,
			deletions: 0,
		});
		const patch = (path: string) =>
			`diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n-x\n+in ${path}\n`;
		state.changes = {
			repos: [
				ok({
					files: [file("a.ts"), file("b.ts")],
					patch: patch("a.ts") + patch("b.ts"),
				}),
			],
		};
		await render(panel({ surface: "diff" }));
		const rows = () =>
			Array.from(container.querySelectorAll('[data-testid="diff-file"]'));
		await act(async () => (rows()[1] as HTMLButtonElement).click());
		expect(q("patch")?.textContent).toContain("in b.ts");
		expect(q("diff-truncated")).toBeNull();

		state.changes = {
			repos: [
				ok({ files: [file("a.ts")], patch: patch("a.ts"), truncated: true }),
			],
		};
		await act(async () => {
			await client.invalidateQueries();
		});
		await act(async () => new Promise((r) => setTimeout(r, 20)));
		expect(rows()[0]?.getAttribute("aria-current")).toBe("true");
		expect(q("patch")?.textContent).toContain("in a.ts");
		expect(q("diff-truncated")?.textContent).toContain("1000");
	});

	it("has a state for no code, no changes, a removed workspace, too large and a failed read", async () => {
		await render(panel({ surface: "diff" }));
		expect(q("diff-none")?.textContent).toBe("No code here");

		state.changes = { repos: [ok()] };
		await render(panel({ surface: "diff" }));
		expect(q("diff-empty")?.textContent).toBe("No changes yet");

		state.changes = {
			repos: [{ state: "unavailable", repo: "repo", reason: "removed" }],
		};
		await render(panel({ surface: "diff" }));
		expect(q("diff-unavailable")?.textContent).toBe("Workspace removed");

		state.changes = {
			repos: [
				ok({
					files: [
						{ path: "big.txt", status: "modified", additions: 9, deletions: 0 },
					],
					patch: null,
					omitted: "too-large",
				}),
			],
		};
		await render(panel({ surface: "diff" }));
		expect(q("diff-too-large")?.textContent).toBe("Too large to show");

		state.changes = new Error("boom");
		await render(panel({ surface: "diff" }));
		expect(q("state-problem")?.textContent).toContain("Changes did not load");
	});
});

describe("StatusBox (#1020)", () => {
	it("shows the project, branch and changes, which open the Diff", async () => {
		state.changes = {
			repos: [
				{
					state: "ok",
					repo: "repo",
					base: HEAD,
					branch: "prismalens/shop-1",
					files: [],
					additions: 77,
					deletions: 3,
					patch: "",
					omitted: null,
					truncated: false,
				},
			],
		};
		const onOpenDiff = vi.fn();
		await render(
			<StatusBox
				runId="r1"
				live={false}
				project="shop"
				workspace={workspace}
				onOpenDiff={onOpenDiff}
			/>,
		);
		expect(q("status-project")?.textContent).toBe("shop");
		expect(q("status-branch")?.textContent).toBe("prismalens/shop-1");
		expect(q("status-changes")?.textContent).toBe("+77 −3");
		expect(q("status-open-folder")).toBeNull();
		await act(async () => (q("status-changes") as HTMLButtonElement).click());
		expect(onOpenDiff).toHaveBeenCalled();
	});

	it("offers Open folder to the host only, and says when the workspace is gone", async () => {
		state.canEdit = true;
		state.changes = {
			repos: [{ state: "unavailable", repo: "repo", reason: "removed" }],
		};
		await render(
			<StatusBox
				runId="r1"
				live={false}
				project={null}
				workspace={workspace}
				onOpenDiff={vi.fn()}
			/>,
		);
		expect(q("status-project")?.textContent).toBe("No project");
		expect(q("status-changes-none")?.textContent).toBe("Workspace gone");
		await act(async () =>
			(q("status-open-folder") as HTMLButtonElement).click(),
		);
		expect(state.opened).toEqual([{ runId: "r1", dir: "/w/pl-1" }]);
	});
});

describe("AskCard inline (#1020)", () => {
	it("is the dock's card with its own test ids and no live announcement", async () => {
		const ask: AskRecord = {
			askId: "00000000-0000-4000-8000-000000000009",
			title: "pnpm test",
			detail: "pnpm test",
			input: null,
			server: null,
			at: "2026-11-03T10:00:00Z",
			expiresAt: "2026-11-03T10:10:00Z",
			clamped: false,
			state: "waiting",
		};
		await render(<AskCard ask={ask} runId="r1" agent="Agent" inline />);
		expect(q("inline-ask-approve")).not.toBeNull();
		expect(q("ask-approve")).toBeNull();
		expect(q("inline-ask-title")?.getAttribute("aria-live")).toBeNull();
	});
});
