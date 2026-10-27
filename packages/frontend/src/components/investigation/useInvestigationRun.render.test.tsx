// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { useInvestigationRun } from "./useInvestigationRun";

const h = vi.hoisted(() => ({
	status: "running",
	history: undefined as unknown[] | undefined,
	isLoading: false,
	isError: false,
	catchUp: vi.fn(async () => {}),
}));

vi.mock("@tanstack/react-query", async (importOriginal) => ({
	...(await importOriginal<typeof import("@tanstack/react-query")>()),
	useQueryClient: () => ({ invalidateQueries: vi.fn() }),
	useQuery: () => ({
		data: { id: "inv", status: h.status, workspace: null },
		isLoading: false,
		isRefetching: false,
		refetch: vi.fn(),
	}),
}));
vi.mock("@/lib/api/orpc-client", () => ({
	orpc: {
		investigations: {
			get: { queryOptions: () => ({}) },
			getStatus: { queryOptions: () => ({}) },
		},
	},
}));
vi.mock("@/lib/api/hooks/use-investigation-events", () => ({
	useInvestigationEventsHistory: () => ({
		data: h.history,
		isLoading: h.isLoading,
		isError: h.isError,
		catchUp: h.catchUp,
	}),
}));
vi.mock("@/lib/api/hooks/use-investigation-stream", () => ({
	useInvestigationStream: () => ({
		status: "error",
		events: [],
		latestText: null,
	}),
}));
vi.mock("@/lib/api/hooks/use-investigations-orpc", () => ({
	investigationKeys: { detail: () => [], lists: () => [] },
	useCancelInvestigation: () => ({ mutate: vi.fn(), isPending: false }),
	useSendInvestigationMessage: () => ({
		mutateAsync: vi.fn(),
		isPending: false,
	}),
}));
vi.mock("@/lib/api/hooks/use-incidents-orpc", () => ({
	incidentKeys: { all: () => [] },
}));

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function Probe() {
	useInvestigationRun("inv");
	return null;
}

describe("useInvestigationRun: a run that ends with its stream down", () => {
	it("reads the rest of the record once when the run turns terminal", async () => {
		const root = createRoot(document.createElement("div"));
		h.history = [];
		await act(async () => root.render(<Probe />));
		h.catchUp.mockClear();

		h.status = "completed";
		await act(async () => root.render(<Probe />));

		expect(h.catchUp).toHaveBeenCalledTimes(1);
		await act(async () => root.unmount());
	});

	it("waits for the history to load, then reads once", async () => {
		const root = createRoot(document.createElement("div"));
		h.status = "running";
		h.history = undefined;
		await act(async () => root.render(<Probe />));
		h.catchUp.mockClear();

		h.status = "completed";
		await act(async () => root.render(<Probe />));
		expect(h.catchUp).not.toHaveBeenCalled();

		h.history = [];
		await act(async () => root.render(<Probe />));
		expect(h.catchUp).toHaveBeenCalledTimes(1);
		await act(async () => root.unmount());
	});

	it("reads again after a failed read until one succeeds", async () => {
		vi.useFakeTimers();
		const root = createRoot(document.createElement("div"));
		h.status = "running";
		h.history = [];
		await act(async () => root.render(<Probe />));
		h.catchUp.mockReset();
		h.catchUp.mockRejectedValueOnce(new Error("offline")).mockResolvedValue();

		h.status = "completed";
		await act(async () => root.render(<Probe />));
		expect(h.catchUp).toHaveBeenCalledTimes(1);

		await act(async () => vi.advanceTimersByTime(3000));
		expect(h.catchUp).toHaveBeenCalledTimes(2);

		await act(async () => vi.advanceTimersByTime(10000));
		expect(h.catchUp).toHaveBeenCalledTimes(2);
		await act(async () => root.unmount());
		vi.useRealTimers();
	});

	it("exposes eventsLoading and eventsError from history (#848)", async () => {
		let captured: ReturnType<typeof useInvestigationRun> | undefined;
		function Capture() {
			captured = useInvestigationRun("inv");
			return null;
		}
		const root = createRoot(document.createElement("div"));
		h.isLoading = true;
		h.isError = false;
		await act(async () => root.render(<Capture />));
		expect(captured?.eventsLoading).toBe(true);
		expect(captured?.eventsError).toBe(false);

		h.isLoading = false;
		h.isError = true;
		await act(async () => root.render(<Capture />));
		expect(captured?.eventsLoading).toBe(false);
		expect(captured?.eventsError).toBe(true);
		await act(async () => root.unmount());
	});
});
