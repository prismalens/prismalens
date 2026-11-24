// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import routes from "@prismalens/contracts/contract.min.json";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

export interface ApiRequest {
	/** `{id}` segments of the route path. */
	params: Record<string, string>;
	query: Record<string, string>;
	body: unknown;
}

/** A route's answer: a value, or a function of the request (a thrown or rejected error answers 500). */
export type ApiFn = (req: ApiRequest) => unknown;
export type ApiHandler = ApiFn | object | string | number | boolean | null;
/** Keyed by procedure id, e.g. `investigations.get`. */
export type ApiMap = Record<string, ApiHandler>;

/** A call the test did not map: it names the route so the missing key is obvious. */
export class UnmockedApiRouteError extends Error {
	constructor(route: string, mapped: string[]) {
		super(
			`unit tests have no API: ${route} is not in the api map (mapped: ${mapped.join(", ") || "none"})`,
		);
		this.name = "UnmockedApiRouteError";
	}
}

interface Route {
	id: string;
	method: string;
	segments: string[];
}

function collect(node: unknown, prefix: string[], out: Route[]) {
	if (typeof node !== "object" || node === null) return;
	const orpc = (node as Record<string, unknown>)["~orpc"] as
		| { route?: { method?: string; path?: string } }
		| undefined;
	if (orpc?.route?.path) {
		out.push({
			id: prefix.join("."),
			method: orpc.route.method ?? "POST",
			segments: orpc.route.path.split("/").filter(Boolean),
		});
		return;
	}
	for (const [key, child] of Object.entries(node))
		collect(child, [...prefix, key], out);
}

const table: Route[] = [];
collect(routes, [], table);

function match(method: string, pathname: string) {
	const parts = pathname.split("/").filter(Boolean);
	let best: {
		route: Route;
		params: Record<string, string>;
		fixed: number;
	} | null = null;
	for (const route of table) {
		if (route.method !== method || route.segments.length !== parts.length)
			continue;
		const params: Record<string, string> = {};
		let fixed = 0;
		const ok = route.segments.every((seg, i) => {
			const part = parts[i] ?? "";
			if (seg.startsWith("{") && seg.endsWith("}")) {
				params[seg.slice(1, -1).replace(/^\+/, "")] = decodeURIComponent(part);
				return true;
			}
			fixed++;
			return seg === part;
		});
		// A literal segment beats a `{id}` one: /alerts/stats over /alerts/{id}.
		if (ok && (!best || fixed > best.fixed)) best = { route, params, fixed };
	}
	return best;
}

function json(status: number, body: unknown) {
	return new Response(body === undefined ? null : JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

function fakeFetch(api: ApiMap, calls: string[]) {
	return async (input: RequestInfo | URL, init?: RequestInit) => {
		const req = input instanceof Request ? input : null;
		const url = new URL(req ? req.url : String(input), window.location.href);
		const method = (init?.method ?? req?.method ?? "GET").toUpperCase();
		const hit = url.pathname.startsWith("/api/")
			? match(method, url.pathname.slice("/api".length))
			: null;
		const label = `${method} ${url.pathname}`;
		if (!hit || !(hit.route.id in api))
			throw new UnmockedApiRouteError(
				hit ? `${label} (${hit.route.id})` : label,
				Object.keys(api),
			);
		calls.push(hit.route.id);
		const raw = req ? await req.text() : String(init?.body ?? "");
		const handler = api[hit.route.id];
		try {
			const value =
				typeof handler === "function"
					? await handler({
							params: hit.params,
							query: Object.fromEntries(url.searchParams),
							body: raw ? JSON.parse(raw) : undefined,
						})
					: handler;
			return json(200, value);
		} catch (error) {
			return json(500, {
				defined: false,
				code: "INTERNAL_SERVER_ERROR",
				status: 500,
				message: error instanceof Error ? error.message : String(error),
			});
		}
	};
}

export interface RenderedApp {
	container: HTMLDivElement;
	queryClient: QueryClient;
	/** Procedure ids answered so far, in order. */
	calls: string[];
	rerender(ui: ReactNode): Promise<void>;
	/** For a test on fake timers, where an async `act` never settles. */
	rerenderSync(ui: ReactNode): void;
	unmount(): Promise<void>;
	unmountSync(): void;
}

export interface RenderOptions {
	api?: ApiMap;
	/** Reuse a client a test seeded before rendering. */
	queryClient?: QueryClient;
}

const live: RenderedApp[] = [];
let restore: (() => void) | null = null;

afterEach(async () => {
	for (const app of live.splice(0)) await app.unmount();
	restore?.();
	restore = null;
});

/**
 * Renders `ui` inside the providers the app root supplies, with a fake API
 * behind the real oRPC client: a mapped route answers, any other rejects with
 * `UnmockedApiRouteError`. Everything is torn down after the test.
 */
export async function renderWithApp(
	ui: ReactNode,
	options: RenderOptions = {},
): Promise<RenderedApp> {
	const app = mountApp(options);
	await app.rerender(ui);
	return app;
}

/** `renderWithApp` that mounts inside a synchronous `act`. */
export function renderWithAppSync(
	ui: ReactNode,
	options: RenderOptions = {},
): RenderedApp {
	const app = mountApp(options);
	app.rerenderSync(ui);
	return app;
}

function mountApp({ api = {}, queryClient }: RenderOptions): RenderedApp {
	const calls: string[] = [];
	if (!restore) {
		const previous = globalThis.fetch;
		globalThis.fetch = fakeFetch(api, calls) as typeof fetch;
		restore = () => {
			globalThis.fetch = previous;
		};
	} else {
		// A second render in one test swaps in its own map for the same fetch.
		globalThis.fetch = fakeFetch(api, calls) as typeof fetch;
	}
	const client =
		queryClient ??
		new QueryClient({
			defaultOptions: {
				queries: { retry: false },
				mutations: { retry: false },
			},
		});
	const container = document.createElement("div");
	document.body.appendChild(container);
	const root: Root = createRoot(container);
	const wrap = (node: ReactNode) => (
		<QueryClientProvider client={client}>
			<TooltipProvider>{node}</TooltipProvider>
		</QueryClientProvider>
	);
	let gone = false;
	const app: RenderedApp = {
		container,
		queryClient: client,
		calls,
		rerender: (next) => act(async () => root.render(wrap(next))),
		rerenderSync: (next) => act(() => root.render(wrap(next))),
		unmount: async () => {
			if (gone) return;
			gone = true;
			await act(async () => root.unmount());
			container.remove();
		},
		unmountSync: () => {
			if (gone) return;
			gone = true;
			act(() => root.unmount());
			container.remove();
		},
	};
	live.push(app);
	return app;
}

/** `renderWithApp` for a hook: `result.current` holds what the hook returned on the last render. */
export async function renderHookWithApp<T>(
	hook: () => T,
	options: RenderOptions = {},
) {
	const result = { current: undefined as unknown as T };
	function Probe() {
		result.current = hook();
		return null;
	}
	const app = await renderWithApp(<Probe />, options);
	return { ...app, result };
}

/** `renderHookWithApp` for a test on fake timers. */
export function renderHookWithAppSync<T>(
	hook: () => T,
	options: RenderOptions = {},
) {
	const result = { current: undefined as unknown as T };
	function Probe() {
		result.current = hook();
		return null;
	}
	const app = renderWithAppSync(<Probe />, options);
	return { ...app, result };
}
