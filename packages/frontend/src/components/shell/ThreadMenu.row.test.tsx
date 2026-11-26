// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { surfaceEntries } from "@/components/kit/registry";
import { type MenuThread, useThreadCtx } from "./ThreadMenu";
import type { ThreadCtx } from "./thread.actions";

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const settleCalls = vi.hoisted(() => [] as unknown[]);
const pending = vi.hoisted(() => ({ resolve: () => {} }));
vi.mock("@/lib/api/hooks/use-threads-orpc", async (real) => ({
	...(await real<object>()),
	threadMenuMutations: {
		settle: () => ({
			mutate: (input: unknown) => {
				settleCalls.push(input);
				return new Promise((done) => {
					pending.resolve = () => done({});
				});
			},
		}),
	},
}));
vi.mock("@tanstack/react-router", async (real) => ({
	...(await real<object>()),
	useNavigate: () => () => {},
}));
vi.mock("@/hooks/use-operator", () => ({
	useOperator: () => ({ managesPairing: true, isPending: false }),
}));

const thread = (over: Partial<MenuThread> = {}): MenuThread => ({
	id: "t-1",
	title: "Thread",
	status: "completed",
	incidentId: null,
	scheduleId: null,
	repositoryId: null,
	settledAt: null,
	pinnedAt: null,
	archivedAt: null,
	...over,
});

let container: HTMLDivElement;
let root: Root;
let ctx: ThreadCtx;
const unsettled: (null | undefined)[] = [];

function Probe({ t }: { t: MenuThread }) {
	ctx = useThreadCtx(t, {
		row: true,
		onSettle: () => {},
		onUnsettled: (at) => unsettled.push(at),
	}).ctx;
	return null;
}

const ids = async (t: MenuThread) => {
	await act(async () =>
		root.render(
			createElement(
				QueryClientProvider,
				{ client: new QueryClient() },
				createElement(Probe, { t }),
			),
		),
	);
	const out = surfaceEntries("thread.row", "context", ctx).flatMap((e) =>
		"separator" in e ? [] : [e.id],
	);
	return out;
};

beforeEach(() => {
	container = document.createElement("div");
	root = createRoot(container);
	settleCalls.length = 0;
	unsettled.length = 0;
});
afterEach(async () => {
	await act(async () => root.unmount());
});

describe("a row's menu settles and unsettles as its row does", () => {
	it("offers Settle on an idle row, and not on a row asking a question or an approval", async () => {
		expect(await ids(thread())).toContain("settle");
		expect(
			await ids(
				thread({ state: { status: "question" } } as Partial<MenuThread>),
			),
		).not.toContain("settle");
		expect(
			await ids(
				thread({ state: { status: "approval" } } as Partial<MenuThread>),
			),
		).not.toContain("settle");
	});

	it("offers Unsettle, not Settle, on a settled thread; Unsettle takes it back and echoes it at once", async () => {
		const list = await ids(thread({ settledAt: "2026-11-12T10:00:00.000Z" }));
		expect(list).toContain("unsettle");
		expect(list).not.toContain("settle");
		const entry = surfaceEntries("thread.row", "context", ctx).find(
			(e) => !("separator" in e) && e.id === "unsettle",
		);
		await act(async () => {
			if (entry && !("separator" in entry)) entry.onSelect();
		});
		expect(settleCalls).toEqual([{ id: "t-1", settled: false }]);
		expect(unsettled).toEqual([null]);
		await act(async () => pending.resolve());
		expect(unsettled).toEqual([null]);
	});

	it("offers Settle, not Unsettle, on a row whose newer activity brought it back to Threads", async () => {
		const back = thread({
			settledAt: "2026-11-12T10:00:00.000Z",
			section: "active",
		} as Partial<MenuThread>);
		const list = await ids(back);
		expect(list).toContain("settle");
		expect(list).not.toContain("unsettle");
	});

	it("keeps Settle hidden on a row still in Settled", async () => {
		const list = await ids(
			thread({
				settledAt: "2026-11-12T10:00:00.000Z",
				section: "settled",
			} as Partial<MenuThread>),
		);
		expect(list).toContain("unsettle");
		expect(list).not.toContain("settle");
	});
});
