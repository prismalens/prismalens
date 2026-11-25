// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The three composers share one gate: a signed-out or unchecked provider login
 * warns and still sends, as the server starts that run; a failed check blocks.
 */
import type { HarnessStatus } from "@prismalens/contracts";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import { DockedComposer } from "@/components/investigation/DockedComposer";
import { OverviewComposer } from "@/components/overview/OverviewComposer";
import type { Overview } from "@/components/overview/use-overview";
import { loadEditorKit } from "@/components/thread/composer/editor/load-kit";
import {
	getEditor,
	settleEditor,
} from "@/components/thread/composer/editor/test-helpers";
import { NewThread } from "@/components/thread/NewThread";

const h = vi.hoisted(() => ({
	harness: {} as unknown,
	record: {} as Record<string, unknown>,
	start: vi.fn(async () => ({ investigationId: "run-1" })),
}));

vi.mock("@/components/usage/UsageLimitsPanel", () => ({
	ComposerUsageRing: () => null,
}));
vi.mock("@/components/shared/Hint", () => ({
	Hint: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/components/agent/AgentPicker", () => ({
	ModelChip: () => null,
	EffortChip: () => null,
	ModeChip: () => null,
	effortLevels: () => [],
	modelName: (_h: unknown, id: string) => id,
	defaultAccessOf: () => ({ level: { level: "supervised", from: "agent" } }),
	useAgentChoice: () => ({
		harnesses: [h.harness],
		effective: h.harness,
		model: "google/gemini-4-neon",
		models: {},
		efforts: {},
		axes: { accessLevels: {} },
		isLoading: false,
	}),
}));
vi.mock("@/lib/api/hooks", () => ({
	useCreateIncident: () => ({ mutateAsync: vi.fn() }),
	useInvestigateIncident: () => ({ mutateAsync: vi.fn() }),
	useUpdateIncident: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock("@/lib/api/hooks/use-threads-orpc", () => ({
	useStartThread: () => ({ mutateAsync: h.start }),
	useForkThread: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock("@tanstack/react-router", () => ({
	useNavigate: () => vi.fn(async () => {}),
	Link: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@tanstack/react-query", async (importOriginal) => ({
	...(await importOriginal<typeof import("@tanstack/react-query")>()),
	useQuery: () => ({ data: undefined }),
}));
vi.mock("@/lib/api/orpc-client", () => {
	const dummy = { queryOptions: () => ({}), mutationOptions: () => ({}) };
	return {
		orpc: {
			investigations: { handoff: dummy, compact: dummy },
			threads: { statuses: dummy },
			references: { search: dummy, use: dummy, resolve: dummy },
			drafts: { get: dummy, put: dummy, delete: dummy, attachments: dummy },
		},
	};
});
vi.mock("@/lib/api/hooks/use-references-orpc", async (importOriginal) => ({
	...(await importOriginal<
		typeof import("@/lib/api/hooks/use-references-orpc")
	>()),
	useReferenceSearch: () => ({
		data: undefined,
		isFetching: false,
		error: null,
	}),
	useReferenceUse: () => ({ mutate: vi.fn() }),
	useResolveLinks: () => ({ mutate: vi.fn() }),
}));
vi.mock("@/lib/api/hooks/use-drafts-orpc", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/api/hooks/use-drafts-orpc")>()),
	fetchServerDraft: async () => null,
	useServerDraft: () => ({ data: null, isPending: false }),
	useSaveDraft: () => ({
		mutate: vi.fn(),
		mutateAsync: vi.fn(async () => ({ rev: 1, generation: 0 })),
	}),
}));
vi.mock("@/lib/api/hooks/use-investigations-orpc", () => ({
	useCompactThread: () => ({ mutate: vi.fn() }),
}));
vi.mock("@/components/incidents/record-context", () => ({
	useIncidentRecord: () => h.record,
}));
vi.mock("@/components/incidents/run-facts", () => ({
	useRunAgentModel: () => ({ agent: "OpenCode", model: "m" }),
	runEffort: () => null,
	runNumber: () => 1,
	runElapsed: () => 0,
	runTimed: () => false,
	modelSource: () => "the agent's own",
	runAccessLine: () => null,
}));

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

// The composers read the login for the model they would send, so the fixture holds the login list.
const LOGINS = {
	"signed-in": ["Google"],
	"signed-out": [],
	unchecked: null,
};

const agent = (
	login: keyof typeof LOGINS,
	outcome: "answers-acp" | "sign-in-needed" = "answers-acp",
) =>
	({
		id: "opencode",
		label: "OpenCode",
		installed: true,
		loginHint: "",
		modelVia: "acp",
		models: { source: "harness", asOf: "", entries: [] },
		checked: {
			outcome,
			detail: "answers ACP",
			servedModel: "google/gemini-4-neon",
			providers: LOGINS[login],
			images: false,
		},
	}) as unknown as HarnessStatus;

const investigate = vi.fn(async () => {});

function incidentRecord() {
	return {
		draft: true,
		draftText: "look",
		draftChoice: {},
		setDraftText: vi.fn(),
		setDraftChoice: vi.fn(),
		runs: [],
		liveRun: null,
		incident: { id: "inc-1", alertCount: 1 },
		isStarting: false,
		investigate,
		chat: vi.fn(),
		newRun: vi.fn(),
		addNote: vi.fn(),
		run: {
			state: null,
			events: [],
			investigation: null,
			queued: [],
			asks: [],
		},
	};
}

let container: HTMLDivElement;
let root: Root;
const q = (id: string) =>
	container.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const send = () => q("composer-send") as HTMLButtonElement;

beforeAll(() => loadEditorKit());
beforeEach(() => {
	localStorage.clear();
	h.start.mockClear();
	investigate.mockClear();
	h.record = incidentRecord();
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});
afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
});

async function show(node: ReactNode) {
	await act(async () => root.render(node));
	await settleEditor();
}

const composers = [
	{
		name: "NewThread",
		sent: h.start,
		render: async () => {
			await show(<NewThread subject={{ kind: "none" }} branch={null} />);
			const box = q("composer-input") as HTMLElement;
			await act(async () => {
				getEditor(box).commands.insertContent("look");
			});
		},
	},
	{
		name: "DockedComposer",
		sent: investigate,
		render: () => show(<DockedComposer />),
	},
	{
		name: "OverviewComposer",
		sent: investigate,
		render: () =>
			show(
				<OverviewComposer
					o={
						{
							record: h.record,
							live: null,
							latest: null,
							report: null,
							latestRun: { isActive: false, asks: [], queued: [] },
						} as unknown as Overview
					}
					action="investigate"
					onAction={() => {}}
				/>,
			),
	},
];

describe.each(composers)("$name's agent gate", ({ render, sent }) => {
	it.each([
		[
			"signed-out",
			"OpenCode is not signed in to Google. Sign in with its own CLI, then retry. Check it in Settings, Agent.",
		],
		[
			"unchecked",
			"OpenCode: sign-in not checked. Check it in Settings, Agent.",
		],
	] as const)("warns on a %s login and still sends", async (login, line) => {
		h.harness = agent(login);
		await render();
		expect(q("composer-blocked")?.textContent).toBe(line);
		expect(send().disabled).toBe(false);
		await act(async () => send().click());
		expect(sent).toHaveBeenCalledTimes(1);
	});

	it("blocks Send when the agent's check needs a sign-in", async () => {
		h.harness = agent("signed-out", "sign-in-needed");
		await render();
		expect(q("composer-blocked")?.textContent).toBe(
			"OpenCode is not signed in to its model provider. Sign in with its own CLI, then retry. Check it in Settings, Agent.",
		);
		expect(q("composer-input")?.getAttribute("aria-disabled")).toBe("true");
		expect(send().disabled).toBe(true);
	});

	it("says nothing and sends on a signed-in login", async () => {
		h.harness = agent("signed-in");
		await render();
		expect(q("composer-blocked")).toBeNull();
		expect(send().disabled).toBe(false);
	});
});
