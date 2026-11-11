// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { CanonicalEvent } from "@prismalens/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Transcript } from "@/components/investigation/Transcript";
import { deriveTranscript } from "@/lib/investigation-events";
import { hasTranscriptNode, TranscriptNode } from "./registry";
import type { TranscriptNodeProps } from "./types";

vi.mock("./nodes.composer", () => ({
	composerNodes: {
		thread_started: {
			Node: ({ event }: TranscriptNodeProps) => (
				<span data-testid="fake-node">{event.kind}</span>
			),
		},
	},
}));

vi.mock("./nodes.panel", () => ({
	panelNodes: {
		action_proposed: {
			Node: ({ event }: TranscriptNodeProps) => (
				<span data-testid="fake-node">{event.kind}</span>
			),
		},
	},
}));

vi.mock("./nodes.app", () => ({
	appNodes: {
		action_resolved: {
			Node: ({ event }: TranscriptNodeProps) => (
				<span data-testid="fake-node">{event.kind}</span>
			),
		},
	},
}));

vi.mock("@tanstack/react-router", () => ({
	Link: ({ children }: { children: React.ReactNode }) => children,
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
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
});

const baseEvent = (kind: CanonicalEvent["kind"], seq = 1): CanonicalEvent =>
	({
		kind,
		runId: "00000000-0000-0000-0000-000000000001",
		branchId: "run",
		path: [],
		seq,
		label: null,
		ts: "2026-10-11T16:00:00.000Z",
	}) as unknown as CanonicalEvent;

describe("transcript registry (#1024)", () => {
	it("renders composerNodes entries in Transcript with data-testid transcript-node and data-kind thread_started holding text thread_started", async () => {
		const event = baseEvent("thread_started");
		const items = deriveTranscript([event], { nodes: hasTranscriptNode });
		await act(async () => {
			root.render(<Transcript items={items} incidentId={null} agent="agent" />);
		});
		const el = container.querySelector(
			'[data-testid="transcript-node"][data-kind="thread_started"]',
		);
		expect(el?.textContent).toBe("thread_started");
	});

	it("renders panelNodes entries in Transcript with data-testid transcript-node and data-kind action_proposed holding text action_proposed", async () => {
		const event = baseEvent("action_proposed");
		const items = deriveTranscript([event], { nodes: hasTranscriptNode });
		await act(async () => {
			root.render(<Transcript items={items} incidentId={null} agent="agent" />);
		});
		const el = container.querySelector(
			'[data-testid="transcript-node"][data-kind="action_proposed"]',
		);
		expect(el?.textContent).toBe("action_proposed");
	});

	it("renders appNodes entries in Transcript with data-testid transcript-node and data-kind action_resolved holding text action_resolved", async () => {
		const event = baseEvent("action_resolved");
		const items = deriveTranscript([event], { nodes: hasTranscriptNode });
		await act(async () => {
			root.render(<Transcript items={items} incidentId={null} agent="agent" />);
		});
		const el = container.querySelector(
			'[data-testid="transcript-node"][data-kind="action_resolved"]',
		);
		expect(el?.textContent).toBe("action_resolved");
	});

	it("returns no node item for an unregistered kind and TranscriptNode renders nothing warning exactly once across two renders", async () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		const event = baseEvent("pull_request_linked");
		const items = deriveTranscript([event], { nodes: hasTranscriptNode });
		expect(items.some((item) => item.kind === "node")).toBe(false);

		await act(async () => {
			root.render(
				<TranscriptNode event={event} incidentId={null} nodes={{}} />,
			);
		});
		expect(container.firstElementChild).toBeNull();

		await act(async () => {
			root.render(
				<TranscriptNode event={event} incidentId={null} nodes={{}} />,
			);
		});
		expect(container.firstElementChild).toBeNull();

		expect(warnSpy).toHaveBeenCalledTimes(1);
		expect(warnSpy).toHaveBeenCalledWith(
			'No transcript node for "pull_request_linked"',
		);
		warnSpy.mockRestore();
	});

	it("returns ['empty'] from deriveTranscript without the nodes option for an event stream holding thread_started", () => {
		const event = baseEvent("thread_started");
		const items = deriveTranscript([event]);
		expect(items.map((i) => i.kind)).toEqual(["empty"]);
	});
});
