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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
} = {};

vi.mock("./Composer", () => ({
	Composer: (props: {
		onSend: (
			env: SendEnvelope,
			now: boolean,
		) => Promise<ComposerReply> | ComposerReply;
		dock?: ReactNode;
	}) => {
		capturedProps = { onSend: props.onSend, dock: props.dock };
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

vi.mock("./slots", () => ({
	usePageSlots: () => slotState.slots,
}));

const sendMessage = vi.fn().mockResolvedValue(undefined);
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
	resumeBlockedReason: null,
	stop: vi.fn(),
}));

vi.mock("@/components/investigation/useInvestigationRun", () => ({
	useInvestigationRun: () => ({
		...invState,
		sendMessage,
	}),
}));

vi.mock("@/components/agent/AgentPicker", () => ({
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

vi.mock("@/lib/api/hooks/use-investigations-orpc", () => ({
	useResumeInvestigation: () => ({
		mutate: vi.fn(),
		isPending: false,
	}),
}));

vi.mock("@/lib/api/hooks/use-repositories-orpc", () => ({
	useRepository: () => ({ data: null }),
}));

vi.mock("@/lib/api/hooks/use-services-orpc", () => ({
	useService: () => ({ data: null }),
}));

vi.mock("@/lib/api/hooks/use-threads-orpc", () => ({
	useVisitThread: vi.fn(),
}));

vi.mock("@/hooks/use-page-title", () => ({
	usePageTitle: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
	Link: ({ children }: { children: ReactNode }) => children,
}));

vi.mock("@/components/shared/Hint", () => ({
	Hint: ({ children }: { children: ReactNode }) => children,
}));

vi.mock("@/components/investigation/Transcript", () => ({
	Transcript: () => <div data-testid="transcript" />,
}));

vi.mock("@/components/investigation/RunDock", () => ({
	RunDock: () => <div data-testid="run-dock" />,
}));

vi.mock("@/components/shell/PanelShell", () => ({
	RightPanel: ({ children }: { children: ReactNode }) => children,
}));

vi.mock("./ThreadPanel", () => ({
	ThreadPanel: () => <div data-testid="thread-panel" />,
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

beforeEach(() => {
	capturedProps = {};
	slotState.slots.interceptors = [];
	sendMessage.mockClear();
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
});
