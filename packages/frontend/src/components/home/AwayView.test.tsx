// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { type AwayView as AwayData, textDoc } from "@prismalens/contracts";
import { act, type ReactNode, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import { writeJournal } from "@/components/thread/composer/draft-store";
import { loadEditorKit } from "@/components/thread/composer/editor/load-kit";
import {
	getText,
	settleEditor,
} from "@/components/thread/composer/editor/test-helpers";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AwayFold, digestLines } from "./AwayView";
import { HomeComposer, type NewThreadSearch } from "./HomeComposer";

// The real Home wiring under test (HomeComposer, NewThread, Composer, the draft journal); only the
// network, the router and the agent pickers are stood in for.
vi.mock("@tanstack/react-router", async (importOriginal) => ({
	...(await importOriginal<typeof import("@tanstack/react-router")>()),
	useNavigate: () => vi.fn(),
	Link: ({ children }: { children?: ReactNode }) => <a href="/">{children}</a>,
}));
vi.mock("@/lib/api/hooks", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/api/hooks")>()),
	useServices: () => ({
		data: {
			data: [
				{
					id: "s1",
					name: "shop",
					displayName: "shop",
					repositories: [
						{
							repositoryId: "r1",
							subPath: null,
							repository: {
								sourceKind: "git",
								url: "https://example.test/acme/shop.git",
							},
						},
					],
				},
			],
		},
	}),
	useRepositories: () => ({
		data: {
			data: [
				{
					id: "r1",
					fullName: "acme/shop",
					defaultBranch: "main",
					plain: false,
				},
			],
		},
	}),
	useCreateIncident: () => ({ mutateAsync: vi.fn() }),
	useInvestigateIncident: () => ({ mutateAsync: vi.fn() }),
	useUpdateIncident: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock("@/lib/api/hooks/use-schedules-orpc", () => ({
	useSchedules: () => ({ data: { canEdit: false } }),
}));
vi.mock("@/lib/api/hooks/use-threads-orpc", async (importOriginal) => ({
	...(await importOriginal<
		typeof import("@/lib/api/hooks/use-threads-orpc")
	>()),
	useStartThread: () => ({ mutateAsync: vi.fn() }),
	useForkThread: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock("@/lib/api/hooks/use-drafts-orpc", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/api/hooks/use-drafts-orpc")>()),
	fetchServerDraft: async () => null,
	useServerDraft: () => ({ data: null, isPending: false }),
	useSaveDraft: () => ({
		mutateAsync: vi.fn(async () => ({ rev: 1, generation: 0 })),
	}),
}));
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
vi.mock("@/components/agent/AgentPicker", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/components/agent/AgentPicker")>()),
	ModelChip: () => <span />,
	EffortChip: () => <span />,
	ModeChip: () => <span />,
	effortLevels: () => [],
	useAgentChoice: () => ({
		harnesses: [],
		effective: undefined,
		model: "",
		models: {},
		efforts: {},
		axes: { accessLevels: {} },
		isLoading: false,
	}),
	defaultAccessOf: () => ({ level: { level: "supervised" } }),
	unreadyLine: () => null,
}));
vi.mock("@/components/shared/Hint", () => ({
	Hint: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/components/usage/UsageLimitsPanel", async (importOriginal) => ({
	...(await importOriginal<
		typeof import("@/components/usage/UsageLimitsPanel")
	>()),
	ComposerUsageRing: () => null,
}));
vi.mock("./HomeHandover", () => ({ HomeHandover: () => null }));
vi.mock("./HomePurpose", () => ({ HomePurpose: () => null }));
vi.mock("@/components/shell/RestartNotice", () => ({
	RestartNotice: () => null,
}));

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

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

const thread = (id: string) => ({ thread: { id }, events: [] });
const data = (since: string | null) =>
	({
		since,
		long: false,
		groups: [
			{ root: { id: "a" }, threads: [thread("a"), thread("a1")] },
			{ root: { id: "b" }, threads: [thread("b")] },
		],
	}) as unknown as AwayData;

describe("Home's folded away view (sheet §1, #1101 category 3)", () => {
	it("is one closed mark with the count, naming what changed in its label", async () => {
		await act(async () =>
			root.render(
				<TooltipProvider>
					<AwayFold data={data(null)} now={0} onOpen={() => {}} />
				</TooltipProvider>,
			),
		);
		const line = container.querySelector('[data-testid="away-fold"]');
		// The fold is a mark and its count, its words in the label (the commit making it a mark).
		expect(line?.textContent).toBe("3");
		expect(line?.getAttribute("aria-label")).toBe("3 threads changed");
		expect(line?.getAttribute("aria-expanded")).toBe("false");
	});

	it("opens the list only when clicked", async () => {
		const onOpen = vi.fn();
		await act(async () =>
			root.render(
				<TooltipProvider>
					<AwayFold data={data(null)} now={0} onOpen={onOpen} />
				</TooltipProvider>,
			),
		);
		expect(onOpen).toHaveBeenCalledTimes(0);
		await act(async () =>
			container
				.querySelector<HTMLButtonElement>('[data-testid="away-fold"]')
				?.click(),
		);
		expect(onOpen).toHaveBeenCalledTimes(1);
	});
});

describe("Home's what changed reads an incident once", () => {
	const event = (threadId: string, kind: string, at: string) => ({
		id: `${threadId}-${kind}`,
		threadId,
		kind,
		detail: null,
		resetsAt: null,
		at,
		readAt: null,
		thread: {
			id: threadId,
			incident: null,
			cause: null,
			answer: null,
			error: null,
		},
	});
	const entry = (
		id: string,
		title: string,
		status: string,
		events: ReturnType<typeof event>[],
		incident: string | null,
	) => ({
		thread: {
			id,
			title,
			status,
			incident: incident ? { id: incident, number: 1, severity: "low" } : null,
		},
		events,
	});
	const away = (threads: ReturnType<typeof entry>[]) =>
		({
			since: null,
			long: false,
			groups: [{ root: { id: "r" }, threads }],
		}) as unknown as AwayData;

	it("shows one line for a failed run and its retry, titled and marked by the retry", () => {
		const lines = digestLines(
			away([
				entry(
					"t-failed",
					"Test alert: repo is failing",
					"failed",
					[event("t-failed", "failed", "2026-11-24T10:00:00.000Z")],
					"inc-1",
				),
				entry(
					"t-retry",
					"Test alert on demo repo",
					"done",
					[event("t-retry", "finished", "2026-11-24T10:03:00.000Z")],
					"inc-1",
				),
			]),
		);
		expect(lines.map((l) => [l.id, l.title, l.status])).toEqual([
			["t-retry", "Test alert on demo repo", "done"],
		]);
	});

	it("keeps threads of different incidents, and threads with no incident, apart", () => {
		const lines = digestLines(
			away([
				entry(
					"a",
					"A",
					"done",
					[event("a", "finished", "2026-11-24T10:00:00.000Z")],
					"inc-1",
				),
				entry(
					"b",
					"B",
					"done",
					[event("b", "finished", "2026-11-24T10:01:00.000Z")],
					"inc-2",
				),
				entry(
					"c",
					"C",
					"done",
					[event("c", "finished", "2026-11-24T10:02:00.000Z")],
					null,
				),
				entry(
					"d",
					"D",
					"done",
					[event("d", "finished", "2026-11-24T10:03:00.000Z")],
					null,
				),
			]),
		);
		expect(lines.map((l) => l.id)).toEqual(["d", "c", "b", "a"]);
	});
});

describe("Home's draft when Incident is turned on from a project", () => {
	beforeAll(() => loadEditorKit());
	afterAll(() => localStorage.clear());

	const journal = (text: string) => ({
		doc: textDoc(text),
		baseRev: 0,
		generation: 0,
		dirty: true,
		at: Date.now(),
		files: [],
	});

	function Home() {
		const [search, setSearch] = useState<NewThreadSearch>({ project: "r1" });
		return (
			<TooltipProvider>
				<HomeComposer
					search={search}
					onSearch={(next) => setSearch((prev) => ({ ...prev, ...next }))}
				/>
			</TooltipProvider>
		);
	}

	it("keeps the project's draft text when the service has a draft of its own", async () => {
		localStorage.clear();
		writeJournal("new:project:r1", journal("project brief"));
		writeJournal("new:service:s1", journal("service brief"));
		await act(async () => root.render(<Home />));
		await settleEditor();
		const box = () =>
			document.body.querySelector('[data-testid="composer-input"]') as Element;
		expect(getText(box())).toBe("project brief");

		await act(async () =>
			(
				document.body.querySelector(
					'[data-testid="composer-incident"]',
				) as HTMLButtonElement
			).click(),
		);
		await settleEditor();

		expect(
			document.body
				.querySelector('[data-testid="composer-incident"]')
				?.getAttribute("aria-pressed"),
		).toBe("true");
		expect(getText(box())).toBe("project brief");
	});
});
