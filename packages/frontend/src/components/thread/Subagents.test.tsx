// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { CanonicalEvent } from "@prismalens/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RunSubagentPanel } from "@/components/run/RunSubagentPanel";
import type { TranscriptItem } from "@/lib/investigation-events";
import type { SubagentView } from "@/lib/subagents";
import { ThreadSidePanel } from "./panel/ThreadSidePanel";
import { StatusBox, SubagentList } from "./StatusBox";
import { SubagentNode } from "./SubagentNode";
import { askMainQuote, SubagentPane } from "./SubagentPane";

const state = vi.hoisted(() => ({
	cancelled: [] as unknown[],
	refuse: false,
}));

vi.mock("@/lib/api/orpc-client", () => ({
	orpc: {
		investigations: {
			getChanges: {
				queryOptions: () => ({
					queryKey: ["changes"],
					queryFn: async () => ({ repos: [] }),
				}),
			},
			cancelSubagent: {
				mutationOptions: () => ({
					mutationFn: async (v: unknown) => {
						state.cancelled.push(v);
						if (state.refuse)
							throw new Error("The agent does not let this sub-agent stop");
						return { state: "cancelling" };
					},
				}),
			},
		},
		runWorkspaces: {
			listForRun: {
				queryOptions: () => ({
					queryKey: ["kept"],
					queryFn: async () => ({ workspaces: [], canEdit: false }),
				}),
			},
			open: { mutationOptions: () => ({ mutationFn: async () => ({}) }) },
		},
	},
}));
// The pane's steps render through the thread's own transcript; here, its prose is enough.
vi.mock("@/components/investigation/Transcript", () => ({
	Transcript: ({ items }: { items: TranscriptItem[] }) => (
		<ol data-testid="pane-transcript">
			{items.map((i) =>
				i.kind === "prose" ? <li key={i.key}>{i.text}</li> : null,
			)}
		</ol>
	),
}));
vi.mock("@/components/run/RunDetailsPanel", () => ({ FilesPane: () => null }));
vi.mock("@/components/run/BrowserTab", () => ({ BrowserTab: () => null }));
vi.mock("./WorktreeDiff", () => ({
	WorktreeDiff: () => null,
	useWorktreeChanges: () => ({ data: undefined, isLoading: false }),
	changeTotals: () => null,
}));
vi.mock("@/components/shared/Hint", () => ({
	Hint: ({ children }: { children: ReactNode }) => children,
}));

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const RUN_ID = "00000000-0000-0000-0000-000000000001";
const NOW = Date.parse("2026-11-06T10:05:00Z");

const view = (over: Partial<SubagentView> = {}): SubagentView => ({
	sessionId: "s1",
	parent: [],
	title: "Check deploys",
	task: "List deploys in the last hour",
	state: "running",
	canCancel: true,
	step: "Bash kubectl rollout",
	startedAt: "2026-11-06T10:03:00Z",
	textCapped: false,
	...over,
});

const words = (path: string[], text: string, seq: number): CanonicalEvent => ({
	kind: "agent_step",
	runId: RUN_ID,
	branchId: "run",
	path,
	seq,
	label: null,
	ts: "2026-11-06T10:03:30Z",
	text,
	toolCalls: [],
});

let container: HTMLDivElement;
let root: Root;
const q = (id: string) => container.querySelector(`[data-testid="${id}"]`);
const all = (id: string) =>
	Array.from(container.querySelectorAll(`[data-testid="${id}"]`));

async function render(node: ReactNode) {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	await act(async () =>
		root.render(
			<QueryClientProvider client={client}>{node}</QueryClientProvider>,
		),
	);
	await act(async () => new Promise((r) => setTimeout(r, 10)));
}

beforeEach(() => {
	vi.useFakeTimers({ toFake: ["Date"], now: NOW });
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
	state.cancelled = [];
	state.refuse = false;
});
afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	vi.useRealTimers();
});

describe("a sub-agent's transcript node (#1025)", () => {
	it("shows its title, its state in a word and its last step, and opens its view", async () => {
		const onOpen = vi.fn();
		await render(
			<ol>
				<SubagentNode agent={view()} onOpen={onOpen} />
			</ol>,
		);
		expect(q("transcript-subagent")?.textContent).toContain("Check deploys");
		expect(q("subagent-state")?.textContent).toBe("Working");
		expect(q("subagent-step")?.textContent).toBe("Bash kubectl rollout");
		await act(async () => (q("subagent-open") as HTMLButtonElement).click());
		expect(onOpen).toHaveBeenCalledWith("s1");
	});

	it("says Done, Failed or Stopped once it ends", async () => {
		await render(
			<ol>
				<SubagentNode agent={view({ state: "completed" })} />
				<SubagentNode agent={view({ sessionId: "s2", state: "failed" })} />
				<SubagentNode agent={view({ sessionId: "s3", state: "cancelled" })} />
			</ol>,
		);
		expect(all("subagent-state").map((e) => e.textContent)).toEqual([
			"Done",
			"Failed",
			"Stopped",
		]);
	});
});

describe("the status box's sub-agents (#1025)", () => {
	const box = (subagents: SubagentView[], onOpenSubagent = vi.fn()) => (
		<StatusBox
			runId={RUN_ID}
			live
			project={null}
			workspace={null}
			onOpenDiff={vi.fn()}
			subagents={subagents}
			onOpenSubagent={onOpenSubagent}
		/>
	);

	it("lists running ones with a timer and folds finished ones under Earlier", async () => {
		const onOpen = vi.fn();
		await render(
			box(
				[
					view(),
					view({ sessionId: "s2", title: "Read logs", state: "completed" }),
				],
				onOpen,
			),
		);
		const earlier = q("status-subagents-earlier") as HTMLDetailsElement;
		const rows = all("status-subagent");
		expect(rows.map((r) => r.getAttribute("data-state"))).toEqual([
			"running",
			"completed",
		]);
		expect(earlier.contains(rows[0] as Node)).toBe(false);
		expect(earlier.contains(rows[1] as Node)).toBe(true);
		expect(earlier.open).toBe(false);
		expect(q("status-subagent-elapsed")?.textContent).toBe("2m 00s");
		await act(async () => (rows[1] as HTMLButtonElement).click());
		expect(onOpen).toHaveBeenCalledWith("s2");
	});

	it("shows no sub-agent area when there are none", async () => {
		await render(box([]));
		expect(q("status-subagents")).toBeNull();
	});
});

describe("a sub-agent's read-only view (#1025)", () => {
	const pane = (
		over: Partial<SubagentView> = {},
		opts: {
			live?: boolean;
			onAskMain?: ((q: string) => void) | null;
		} = {},
	) => (
		<SubagentPane
			runId={RUN_ID}
			agent={view(over)}
			events={[
				words([], "Main agent words.", 0),
				words(["s1"], "Sub-agent words.", 1),
			]}
			live={opts.live ?? true}
			onAskMain={
				opts.onAskMain === null ? undefined : (opts.onAskMain ?? vi.fn())
			}
		/>
	);

	it("shows its title, task and own words, and no composer", async () => {
		await render(pane());
		expect(q("subagent-title")?.textContent).toBe("Check deploys");
		expect(q("subagent-task")?.textContent).toBe(
			"List deploys in the last hour",
		);
		expect(q("pane-transcript")?.textContent).toBe("Sub-agent words.");
		expect(container.querySelector("textarea")).toBeNull();
		expect(q("subagent-capped")).toBeNull();
	});

	it("says once when its text was over the cap", async () => {
		await render(pane({ textCapped: true }));
		expect(q("subagent-capped")?.textContent).toBe("Text over 200 KB not kept");
	});

	it("offers Cancel only while it runs and its agent granted it", async () => {
		await render(pane({ canCancel: false }));
		expect(q("subagent-cancel")).toBeNull();
		await render(pane({ state: "completed" }));
		expect(q("subagent-cancel")).toBeNull();
		await render(pane({}, { live: false }));
		expect(q("subagent-cancel")).toBeNull();
		await render(pane());
		await act(async () => (q("subagent-cancel") as HTMLButtonElement).click());
		expect(state.cancelled).toEqual([{ id: RUN_ID, sessionId: "s1" }]);
	});

	it("shows the server's refusal when Cancel fails", async () => {
		state.refuse = true;
		await render(pane());
		await act(async () => (q("subagent-cancel") as HTMLButtonElement).click());
		await act(async () => new Promise((r) => setTimeout(r, 10)));
		expect(container.querySelector('[role="alert"]')?.textContent).toBe(
			"The agent does not let this sub-agent stop",
		);
	});

	it("hands the main composer a quote of it", async () => {
		const onAskMain = vi.fn();
		await render(pane({}, { onAskMain }));
		await act(async () =>
			(q("subagent-ask-main") as HTMLButtonElement).click(),
		);
		expect(onAskMain).toHaveBeenCalledWith(
			'> Sub-agent "Check deploys": List deploys in the last hour\n\n',
		);
	});

	it("offers no Ask main agent where the page has no composer", async () => {
		await render(pane({}, { onAskMain: null }));
		expect(q("subagent-ask-main")).toBeNull();
		expect(q("subagent-cancel")).not.toBeNull();
	});

	it("keeps the quote to one short line", () => {
		const quote = askMainQuote({ title: "A", task: `x\n${"y".repeat(400)}` });
		expect(quote.split("\n")[0]?.length).toBeLessThan(260);
		expect(askMainQuote({ title: "A", task: null })).toBe(
			'> Sub-agent "A"\n\n',
		);
	});

	it("opens in the thread panel's sub-agent surface", async () => {
		await render(
			<ThreadSidePanel
				tabs={[{ id: "thread", label: "Thread" }]}
				tab="thread"
				onTab={vi.fn()}
				onClose={vi.fn()}
				content={null}
				override={pane()}
				overrideLabel="Sub-agent"
			/>,
		);
		expect(q("subagent-pane")).not.toBeNull();
		expect(
			container
				.querySelector('[data-testid="panel-body"]')
				?.getAttribute("aria-label"),
		).toBe("Sub-agent");
	});
});

describe("a sub-agent on the incident run page (#1025)", () => {
	it("opens in the details panel with a way back to the details", async () => {
		const onBack = vi.fn();
		await render(
			<RunSubagentPanel
				runId={RUN_ID}
				agent={view()}
				events={[words(["s1"], "Sub-agent words.", 1)]}
				live
				onBack={onBack}
				onAskMain={vi.fn()}
			/>,
		);
		expect(q("subagent-pane")).not.toBeNull();
		expect(q("subagent-ask-main")).not.toBeNull();
		await act(async () =>
			(q("run-subagent-back") as HTMLButtonElement).click(),
		);
		expect(onBack).toHaveBeenCalled();
	});

	it("lists the run's sub-agents above its summary, running and Earlier", async () => {
		const onOpen = vi.fn();
		await render(
			<SubagentList
				agents={[view(), view({ sessionId: "s2", state: "failed" })]}
				onOpen={onOpen}
			/>,
		);
		expect(all("status-subagent")).toHaveLength(2);
		expect(q("status-subagents-earlier")).not.toBeNull();
		await act(async () =>
			(all("status-subagent")[0] as HTMLButtonElement).click(),
		);
		expect(onOpen).toHaveBeenCalledWith("s1");
	});
});
