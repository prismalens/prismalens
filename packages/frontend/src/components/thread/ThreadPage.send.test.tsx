// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type {
	CanonicalEvent,
	ComposerScope,
	Quote,
	ReferenceRef,
} from "@prismalens/contracts";
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
import type {
	SendEnvelope,
	SendInterceptor,
	SendReceipt,
} from "@/lib/composer-send";
import type { AttachmentView } from "@/lib/investigation-events";
import type { ComposerReply } from "./Composer";
import { ThreadPage } from "./ThreadPage";

let capturedProps: {
	onSend?: (
		env: SendEnvelope,
		now: boolean,
	) => Promise<ComposerReply> | ComposerReply;
	dock?: ReactNode;
	onChoice?: (next: {
		harnessId?: string;
		model?: string;
		effort?: string | null;
	}) => void;
	locked?: boolean;
	choice?: { model: string; effort: string | null };
	blockedReason?: string | null;
	placeholder?: string;
	sendLabel?: string;
} = {};

vi.mock("./Composer", () => ({
	Composer: (props: {
		onSend: (
			env: SendEnvelope,
			now: boolean,
		) => Promise<ComposerReply> | ComposerReply;
		dock?: ReactNode;
		onChoice?: (next: {
			harnessId?: string;
			model?: string;
			effort?: string | null;
		}) => void;
		locked?: boolean;
		choice?: { model: string; effort: string | null };
		blockedReason?: string | null;
		placeholder?: string;
		sendLabel?: string;
	}) => {
		capturedProps = {
			blockedReason: props.blockedReason ?? null,
			...(props.placeholder ? { placeholder: props.placeholder } : {}),
			...(props.sendLabel ? { sendLabel: props.sendLabel } : {}),
			onSend: props.onSend,
			dock: props.dock,
			...(props.onChoice ? { onChoice: props.onChoice } : {}),
			...(props.locked !== undefined ? { locked: props.locked } : {}),
			...(props.choice ? { choice: props.choice } : {}),
		};
		return <div data-testid="composer" />;
	},
}));

const slotState = vi.hoisted(() => ({
	slots: {
		dock: null as ReactNode,
		composerFooter: null as ReactNode,
		banner: null as ReactNode,
		interceptors: [] as SendInterceptor[],
	},
}));

// The header's parent crumb reads the thread tree, outside what these tests cover.
vi.mock("./ParentLink", () => ({ ParentLink: () => null }));

vi.mock("./slots", () => ({
	usePageSlots: () => slotState.slots,
}));

const sendMessage = vi.fn().mockResolvedValue(undefined);
const forkThread = vi.hoisted(() =>
	vi.fn().mockResolvedValue({ investigationId: "inv-fork" }),
);
const navigate = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const invState = vi.hoisted(() => ({
	investigation: {
		id: "inv-1",
		title: "Thread Investigation",
		status: "running" as const,
		kind: "chat",
		harness: "mock-harness",
		model: "base-model",
		effort: null,
		accessLevel: "auto-edits",
		startedAt: "2026-10-11T16:00:00.000Z",
		completedAt: null,
		error: null,
		stopRequested: false,
		lastTurnOutcome: null,
		endReason: null,
		workspace: { layout: "single" as const, cwd: "/app", repos: [] },
	},
	isLoading: false,
	error: null,
	refetch: vi.fn(),
	isActive: true,
	stopRequested: false,
	events: [] as CanonicalEvent[],
	pending: [],
	queued: [],
	steps: [],
	asks: [],
	ended: false,
	resumable: false,
	continuable: false,
	resumeBlockedReason: null as string | null,
	stop: vi.fn(),
}));

vi.mock("@/components/investigation/useInvestigationRun", () => ({
	useInvestigationRun: () => ({
		...invState,
		sendMessage,
	}),
}));

// ThreadPage reads the agent choice from its light module (#1101 category 12).
vi.mock("@/components/agent/agent-choice", () => ({
	useAgentChoice: () => ({
		harnesses: [
			{
				id: "mock-harness",
				label: "Agent",
				checked: { outcome: "answers-acp" },
			},
		],
		effective: undefined,
		model: "base-model",
		models: {},
		efforts: {},
		axes: { accessLevels: {} },
		isLoading: false,
	}),
	modelName: (_h: unknown, m: string) => m,
}));

// 3d891b694: the header reads who answered from the answer calls.
vi.mock("@/lib/api/hooks/use-investigations-orpc", () => ({
	useAnsweredHere: () => [],
	useAnswerAsk: () => ({
		mutate: vi.fn(),
		mutateAsync: vi.fn(),
		isPending: false,
	}),
	useResumeInvestigation: () => ({
		mutate: vi.fn(),
		isPending: false,
	}),
}));

vi.mock("@/lib/api/hooks/use-repositories-orpc", () => ({
	useRepository: () => ({ data: null }),
}));

// The header reads an alert's thread as its incident (#1101).
vi.mock("@/lib/api/hooks/use-incidents-orpc", () => ({
	useIncident: () => ({ data: undefined }),
}));

vi.mock("@/lib/api/hooks/use-services-orpc", () => ({
	useService: () => ({ data: null }),
}));

vi.mock("@/components/shell/ThreadMenu", () => ({ ThreadMenu: () => null }));

// The attention lane's hooks and bell call the API; this file tests sending only.
vi.mock("@/lib/attention/use-attention", () => ({
	useOpeningRead: () => ({ data: undefined, isFetched: false }),
	useReadAdvance: vi.fn(),
	useTabVisible: () => true,
}));
// 2e87e72c3: the header ⋯ reads the follow state at every width.
vi.mock("@/components/attention/FollowButton", () => ({
	FollowButton: () => null,
}));
// The follow hook lives apart from its button, which loads after the first content.
vi.mock("@/components/attention/thread-follow", () => ({
	useThreadFollow: () => ({ follow: null, choose: vi.fn() }),
}));
vi.mock("@/lib/api/hooks/use-schedules-orpc", () => ({
	useSchedules: () => ({ data: { canEdit: false } }),
}));
vi.mock("@/lib/api/hooks/use-threads-orpc", () => ({
	useVisitThread: vi.fn(),
	useFeedRow: () => undefined,
	useThreadStatuses: () => ({ data: undefined }),
	useSettleThread: () => ({ mutate: vi.fn() }),
	useForkThread: () => ({ mutateAsync: forkThread }),
}));
vi.mock("./aside", () => ({
	AsideHost: () => null,
	askAside: vi.fn(),
	btwQuestion: () => null,
	onPrimeAside: () => () => {},
}));

vi.mock("@/lib/api/hooks/use-thread-tree-orpc", () => ({
	useThreadLinks: () => ({ data: undefined }),
}));
vi.mock("@/lib/api/hooks/use-thread-context-orpc", () => ({
	useThreadContext: () => ({ data: null, isLoading: false }),
}));

vi.mock("@/lib/api/hooks/use-thread-pull-requests", () => ({
	usePanelPullRequests: () => ({ data: undefined, watch: () => undefined }),
}));

vi.mock("@/hooks/use-page-title", () => ({
	usePageTitle: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
	Link: ({ children }: { children: ReactNode }) => children,
	useSearch: () => ({}),
	useNavigate: () => navigate,
}));

vi.mock("@/components/shared/Hint", () => ({
	Hint: ({ children }: { children: ReactNode }) => children,
}));

vi.mock("@/components/investigation/Transcript", () => ({
	Transcript: () => <div data-testid="transcript" />,
}));

// The parent line reads the thread tree; it sits outside the transcript since #1101.
vi.mock("@/components/investigation/transcript/ChildCards", () => ({
	ParentBar: () => null,
}));

vi.mock("@/components/investigation/RunDock", () => ({
	RunDock: () => <div data-testid="run-dock" />,
}));

vi.mock("@/components/shell/PanelShell", () => ({
	RightPanel: ({ children }: { children: ReactNode }) => children,
	// The page reads the panel's Widen state since the diff-and-panes climb fix.
	useRightPanelWidth: () => ({ can: false, wide: false, setWide: () => {} }),
}));

vi.mock("./panel/ThreadSidePanel", () => ({
	ThreadSidePanel: () => <div data-testid="thread-panel" />,
	PanelStack: ({ children }: { children: ReactNode }) => children,
}));

vi.mock("./panel/use-thread-panes", () => ({
	useThreadPanes: () => ({
		tools: [],
		layout: { split: null, ratio: 0.5, opened: [], browserUrl: null },
		setLayout: () => {},
		open: () => {},
	}),
}));

vi.mock("./panel/KindTab", () => ({
	KindTab: () => null,
}));

vi.mock("./panel/ThreadTab", () => ({
	ThreadTab: () => null,
	prAnswersOf: () => null,
}));
vi.mock("@/components/schedules/schedule-templates", () => ({
	AddScheduleFromThread: () => null,
}));

vi.mock("./StatusBox", () => ({
	StatusBox: () => <div data-testid="status-box" />,
}));

vi.mock("./SubagentPane", () => ({
	SubagentPane: () => <div data-testid="subagent-pane" />,
}));

if (typeof globalThis.ResizeObserver === "undefined") {
	globalThis.ResizeObserver = class {
		observe() {}
		unobserve() {}
		disconnect() {}
	};
}

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

// The page loads its composer after its first frame; warm the mock so one act resolves it.
beforeAll(async () => {
	await import("./Composer");
});

beforeEach(() => {
	capturedProps = {};
	slotState.slots.interceptors = [];
	sendMessage.mockClear();
	forkThread.mockClear();
	navigate.mockClear();
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
});

describe("ThreadPage send handling (#1024)", () => {
	const view: AttachmentView = {
		id: "att-view-1",
		name: "snapshot.png",
		mimeType: "image/png",
		size: 1024,
	};
	const quote: Quote = {
		source: {
			threadId: "11111111-1111-1111-1111-111111111111",
			kind: "transcript",
		},
		text: "quote line",
	};
	const reference: ReferenceRef = {
		kind: "file",
		id: "packages/frontend/src/index.ts",
		label: "index.ts",
	};
	const draftScope: ComposerScope =
		"thread:11111111-1111-1111-1111-111111111111";
	const text = "Investigate the failure";
	const envelope: SendEnvelope = {
		text,
		attachments: [view],
		quotes: [quote],
		references: [reference],
		draftScope,
		draftRev: 4,
		compact: true,
	};

	it("forwards every envelope field to sendMessage and resolves sent", async () => {
		await act(async () => {
			root.render(<ThreadPage id="inv-1" />);
		});

		const send = capturedProps.onSend;
		if (!send) throw new Error("ThreadPage did not mount the composer");
		const receipt = await send(envelope, true);

		expect(sendMessage).toHaveBeenCalledTimes(1);
		expect(sendMessage).toHaveBeenCalledWith(text, "now", {
			attachments: [view],
			kind: "chat",
			fields: {
				quotes: [quote],
				references: [reference],
				draftScope,
				draftRev: 4,
				compact: true,
			},
		});
		expect(receipt).toEqual({ result: "sent" });
	});

	it("resolves result deferred and does not call sendMessage when an interceptor defers", async () => {
		const interceptor = vi.fn().mockResolvedValue({
			result: "deferred" as const,
		});
		slotState.slots.interceptors = [interceptor];

		await act(async () => {
			root.render(<ThreadPage id="inv-1" />);
		});

		const send = capturedProps.onSend;
		if (!send) throw new Error("ThreadPage did not mount the composer");
		const receipt = await send(envelope, true);

		expect(receipt).toEqual({ result: "deferred" });
		expect(sendMessage).not.toHaveBeenCalled();
	});

	describe("the next message's model and effort (#1024)", () => {
		afterEach(() => {
			invState.isActive = true;
		});

		it("locks the agent chips while the run works", async () => {
			await act(async () => {
				root.render(<ThreadPage id="inv-1" />);
			});
			expect(capturedProps.locked).toBe(true);
		});

		it("sends a picked model and effort with the next follow-up only, then the run's own again", async () => {
			invState.isActive = false;
			await act(async () => {
				root.render(<ThreadPage id="inv-1" />);
			});
			expect(capturedProps.locked).toBe(false);
			await act(async () =>
				capturedProps.onChoice?.({ model: "other-model", effort: "high" }),
			);
			expect(capturedProps.choice).toMatchObject({
				model: "other-model",
				effort: "high",
			});
			const plain = {
				...envelope,
				attachments: [],
				quotes: [],
				references: [],
			};
			const { draftScope: _s, draftRev: _r, compact: _c, ...bare } = plain;
			await act(async () => {
				await capturedProps.onSend?.(bare, false);
			});
			expect(sendMessage).toHaveBeenLastCalledWith(text, "queue", {
				attachments: [],
				kind: "chat",
				fields: { model: "other-model", effort: "high" },
			});
			await act(async () => {
				await capturedProps.onSend?.(bare, false);
			});
			expect(sendMessage).toHaveBeenLastCalledWith(text, "queue", {
				attachments: [],
				kind: "chat",
				fields: {},
			});
		});

		it("ignores a pick of another agent: the thread keeps its agent", async () => {
			invState.isActive = false;
			await act(async () => {
				root.render(<ThreadPage id="inv-1" />);
			});
			await act(async () =>
				capturedProps.onChoice?.({ harnessId: "codex", model: "gpt-x" }),
			);
			expect(capturedProps.choice).toMatchObject({ model: "base-model" });
		});
	});

	// The fork route for a thread that kept no workspace: ThreadPage's startsFresh.
	describe("a thread that kept no workspace", () => {
		beforeEach(() => {
			invState.isActive = false;
			invState.ended = true;
			invState.resumeBlockedReason = "No workspace to continue in";
		});
		afterEach(() => {
			invState.isActive = true;
			invState.ended = false;
			invState.resumeBlockedReason = null;
		});

		it("leaves the box open, reading Reply, with the send button saying it goes to a new thread (cc4a20440)", async () => {
			await act(async () => {
				root.render(<ThreadPage id="inv-1" />);
			});
			expect(capturedProps.blockedReason).toBeNull();
			expect(capturedProps.placeholder).toBe("Reply");
			expect(capturedProps.sendLabel).toBe("Send to a new thread");
		});

		it("forks the thread with the message and its quotes, then opens the fork", async () => {
			await act(async () => {
				root.render(<ThreadPage id="inv-1" />);
			});
			const receipt = await capturedProps.onSend?.(
				{ text, attachments: [], quotes: [quote], references: [] },
				false,
			);
			expect(forkThread).toHaveBeenCalledWith({
				id: "inv-1",
				mode: "fork",
				text,
				quotes: [quote],
			});
			expect(navigate).toHaveBeenCalledWith({
				to: "/threads/$id",
				params: { id: "inv-fork" },
			});
			expect(sendMessage).not.toHaveBeenCalled();
			expect(receipt).toEqual({ result: "sent" });
		});

		it("refuses files, which a fork can't carry yet", async () => {
			await act(async () => {
				root.render(<ThreadPage id="inv-1" />);
			});
			await expect(
				capturedProps.onSend?.(
					{ text, attachments: [view], quotes: [], references: [] },
					false,
				),
			).rejects.toThrow("Files can't start a new thread from here yet.");
			expect(forkThread).not.toHaveBeenCalled();
		});
	});
});
