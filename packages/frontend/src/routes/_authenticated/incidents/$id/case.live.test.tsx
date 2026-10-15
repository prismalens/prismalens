// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * OBJ-010: the Case page, mounted with the real query provider, real hooks and
 * the real change stream over a stubbed fetch, follows the server without a reload.
 */
import type {
	CaptureSummary,
	CaseView,
	LiveTopic,
} from "@prismalens/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LIVE_REFRESH_MS, useLiveChanges } from "@/lib/api/live-refresh";
import { Route } from "./case";

const INCIDENT = "7f1c3a52-9a8e-4d7b-8c11-2f5d6e4a9b10";

vi.mock("@/components/incidents/record-context", () => ({
	useIncidentRecord: () => ({
		incident: { id: INCIDENT, title: "checkout down" },
		openClose: vi.fn(),
		openReopen: vi.fn(),
		openEditCause: vi.fn(),
	}),
}));
vi.mock("@/components/run/IncidentHeader", () => ({
	IncidentHeader: () => <div data-testid="incident-header" />,
}));
vi.mock("@tanstack/react-router", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("@tanstack/react-router")>();
	return {
		...actual,
		Link: ({ children, ...props }: { children: ReactNode }) =>
			createElement("a", props, children),
	};
});

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function capture(state: CaptureSummary["state"]): CaptureSummary {
	return {
		id: "cap-1",
		state,
		stateReason: null,
		missed: null,
		shared: false,
		latencyMs: state === "complete" ? 4000 : null,
		identity: null,
		identityMatches: state === "complete" ? true : null,
		startedAt: "2026-10-15T10:00:00.000Z",
		finishedAt: state === "complete" ? "2026-10-15T10:00:04.000Z" : null,
		artifacts: [],
	};
}

function view(state: CaptureSummary["state"]): CaseView {
	return {
		enabled: true,
		asOf: "2026-10-15T10:00:05.000Z",
		binding: {
			kubeContext: "kind-pl",
			namespace: "shop",
			cluster: "https://k",
			probeState: "ok",
		},
		captures: [capture(state)],
		claims: [],
		openQuestions: [],
		agentToolCalls: [],
		manifest: { entries: 0, lastVerified: null },
	};
}

/** The server: what /cases returns now, and a change stream the test writes hints into. */
const server = {
	state: "running" as CaptureSummary["state"],
	caseReads: 0,
	stream: null as ReadableStreamDefaultController<Uint8Array> | null,
};

function json(body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status: 200,
		headers: { "content-type": "application/json" },
	});
}

const fakeFetch = vi.fn(
	async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = new URL(input instanceof Request ? input.url : String(input));
		const path = url.pathname.replace(/^\/api/, "");
		if (path === "/case-files/settings") return json({ enabled: true });
		if (path === `/cases/${INCIDENT}`) {
			server.caseReads += 1;
			return json(view(server.state));
		}
		if (path === "/live/changes") {
			const signal =
				init?.signal ?? (input instanceof Request ? input.signal : null);
			const body = new ReadableStream<Uint8Array>({
				start(controller) {
					server.stream = controller;
					// As a browser does: aborting the request ends the stream.
					signal?.addEventListener(
						"abort",
						() => controller.error(signal.reason),
						{ once: true },
					);
				},
			});
			return new Response(body, {
				status: 200,
				headers: { "content-type": "text/event-stream" },
			});
		}
		return new Response("not found", { status: 404 });
	},
);

function hint(topics: LiveTopic[]): void {
	server.stream?.enqueue(
		new TextEncoder().encode(
			`event: message\ndata: ${JSON.stringify({ topics })}\n\n`,
		),
	);
}

function Page() {
	const Component = Route.options.component;
	if (!Component) throw new Error("Route component missing");
	return <Component />;
}

/** The authenticated layout's one change stream (useLiveChanges), around the page. */
function LivePage() {
	useLiveChanges();
	return <Page />;
}

let container: HTMLDivElement;
let root: Root;
let queryClient: QueryClient;

async function mount(live: boolean): Promise<void> {
	// The app's defaults (router.tsx): a minute's staleTime, no refetch on focus.
	queryClient = new QueryClient({
		defaultOptions: {
			queries: { staleTime: 60_000, refetchOnWindowFocus: false, retry: false },
		},
	});
	await act(async () =>
		root.render(
			<QueryClientProvider client={queryClient}>
				{live ? <LivePage /> : <Page />}
			</QueryClientProvider>,
		),
	);
}

async function until(check: () => boolean, what: string): Promise<void> {
	for (let i = 0; i < 100; i++) {
		if (check()) return;
		await act(async () => {
			await new Promise((r) => setTimeout(r, 10));
		});
	}
	throw new Error(`timed out waiting for ${what}: ${container.textContent}`);
}

beforeEach(() => {
	vi.stubGlobal("fetch", fakeFetch);
	server.state = "running";
	server.caseReads = 0;
	server.stream = null;
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	queryClient.clear();
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe("Case page live refresh (OBJ-010)", () => {
	it("moves from Capturing to Captured when the server says a case changed", async () => {
		await mount(true);
		await until(
			() => (container.textContent ?? "").includes("Capturing kind-pl/shop"),
			"the running capture",
		);
		await until(() => server.stream !== null, "the change stream");

		server.state = "complete";
		await act(async () => hint(["cases"]));

		await until(
			() =>
				(container.textContent ?? "").includes(
					"Captured kind-pl/shop 4 s after the alert",
				),
			"the finished capture",
		);
		expect(container.textContent).not.toContain("Capturing");
		expect(server.caseReads).toBe(2);
	});

	it("re-reads the case when a run (the agent's report) changes", async () => {
		await mount(true);
		await until(
			() => server.caseReads === 1 && server.stream !== null,
			"the first read",
		);

		await act(async () => hint(["investigations"]));

		await until(() => server.caseReads === 2, "a second read of the case");
		expect(server.caseReads).toBe(2);
	});

	it("polls the case while the change stream is down", async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		await mount(false);
		await until(
			() => (container.textContent ?? "").includes("Capturing kind-pl/shop"),
			"the running capture",
		);

		server.state = "complete";
		await act(async () => {
			await vi.advanceTimersByTimeAsync(LIVE_REFRESH_MS + 100);
		});

		await until(
			() => (container.textContent ?? "").includes("Captured kind-pl/shop"),
			"the polled capture",
		);
		expect(server.caseReads).toBe(2);
	});
});
