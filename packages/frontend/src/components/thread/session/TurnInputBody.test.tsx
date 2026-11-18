// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TurnInputRef } from "@/lib/investigation-events";
import { TurnInputBody } from "./TurnInputBody";

const queryState = vi.hoisted(() => ({
	data: undefined as unknown,
	isError: false,
	isPending: false,
	refetch: vi.fn(),
}));

vi.mock("@tanstack/react-query", async (importOriginal) => ({
	...(await importOriginal<typeof import("@tanstack/react-query")>()),
	useQuery: () => queryState,
}));

vi.mock("@/lib/api/orpc-client", () => ({
	orpc: {
		investigations: {
			turnInput: {
				queryOptions: () => ({ queryKey: ["turnInput"] }),
			},
		},
	},
}));

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
	queryState.data = undefined;
	queryState.isError = false;
	queryState.isPending = false;
	queryState.refetch = vi.fn();
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
});

describe("TurnInputBody (#1166)", () => {
	const ref = (recorded: boolean): TurnInputRef => ({
		runId: "run-1",
		inputId: "input-1",
		attempt: 1,
		chars: 120,
		recorded,
	});

	it("shows 'Not recorded.' and no Retry when input.recorded is false", async () => {
		await act(async () => {
			root.render(<TurnInputBody input={ref(false)} agent="Claude Code" />);
		});
		expect(container.textContent).toContain("Not recorded.");
		expect(container.textContent).not.toContain("Retry");
		expect(container.querySelector("button")).toBeNull();
	});

	it("shows 'Couldn't load what it got' with a Retry button when recorded is true and query errors, refetching on click", async () => {
		queryState.isError = true;
		queryState.isPending = false;
		await act(async () => {
			root.render(<TurnInputBody input={ref(true)} agent="Claude Code" />);
		});
		expect(container.textContent).toContain("Couldn't load what it got");
		const button = container.querySelector("button");
		expect(button).not.toBeNull();
		expect(button?.textContent).toContain("Retry");
		await act(async () => {
			button?.click();
		});
		expect(queryState.refetch).toHaveBeenCalledTimes(1);
	});

	it("shows system and text part labels when query resolves with transcript link", async () => {
		queryState.isError = false;
		queryState.isPending = false;
		queryState.data = {
			parts: [
				{ type: "system", text: "You are investigating an alert." },
				{
					type: "text",
					text: "Continue from .prismalens-handoff/transcript.md",
				},
			],
		};
		await act(async () => {
			root.render(<TurnInputBody input={ref(true)} agent="Claude Code" />);
		});
		expect(container.textContent).toContain("Added to its system prompt");
		expect(container.textContent).toContain(
			"Sent, with the full transcript in .prismalens-handoff/transcript.md, which it can read",
		);
	});
});
