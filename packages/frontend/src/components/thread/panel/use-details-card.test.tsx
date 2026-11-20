// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { ThreadContext } from "@prismalens/contracts";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useDetailsCard } from "./use-details-card";

const h = vi.hoisted(() => ({ open: vi.fn(), toast: vi.fn() }));

vi.mock("@/lib/api/orpc-client", () => ({
	orpc: { runWorkspaces: { openInEditor: { call: h.open } } },
}));
vi.mock("@/hooks/use-toast", () => ({ toast: h.toast }));

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type Repo = ThreadContext["workspace"] extends infer W
	? W extends { repos: (infer R)[] }
		? R
		: never
	: never;

const repo = (over: Partial<Repo> & { name: string }): Repo =>
	({
		branch: null,
		head: "aaa",
		additions: 0,
		deletions: 0,
		ahead: null,
		behind: null,
		tip: "aaa",
		detached: true,
		pushable: true,
		...over,
	}) as Repo;

const contextOf = (repos: Repo[]) =>
	({
		threadId: "t1",
		machine: { isHost: true, isOwner: true, os: "linux" },
		git: null,
		pullRequests: [],
		workspace: {
			layout: "multi",
			cwd: "/w",
			repos,
			kept: [],
			suggestedBranch: "prismalens/fix-111111",
		},
	}) as unknown as ThreadContext;

function Harness({
	context,
	out,
}: {
	context: ThreadContext;
	out: { current: ReturnType<typeof useDetailsCard> };
}) {
	out.current = useDetailsCard({
		threadId: "t1",
		context,
		workspace: null,
		pulls: undefined,
		terminal: false,
		openPr: vi.fn(),
		openTerminal: vi.fn(),
	});
	return null;
}

async function mount(context: ThreadContext) {
	const out = {
		current: undefined as unknown as ReturnType<typeof useDetailsCard>,
	};
	const root = createRoot(document.createElement("div"));
	await act(async () => {
		root.render(<Harness context={context} out={out} />);
	});
	return out;
}

beforeEach(() => {
	h.open.mockReset();
	h.toast.mockReset();
});

describe("useDetailsCard open failures (#1176)", () => {
	it("names a missing editor, not the host, when the server answers not found", async () => {
		h.open.mockRejectedValue({
			code: "NOT_FOUND",
			message: "vscode is not installed",
		});
		const out = await mount(contextOf([repo({ name: "api" })]));
		await act(async () => {
			out.current.ctx.opener?.open("vscode");
		});
		expect(h.toast).toHaveBeenCalledWith(
			expect.objectContaining({
				title: "The folder did not open",
				description: expect.stringContaining("vscode is not installed"),
			}),
		);
	});

	it("shows the failure, not the host-only message, when the request itself fails", async () => {
		h.open.mockRejectedValue(new TypeError("Failed to fetch"));
		const out = await mount(contextOf([repo({ name: "api" })]));
		await act(async () => {
			out.current.ctx.opener?.open("vscode");
		});
		expect(h.toast).toHaveBeenCalledWith(
			expect.objectContaining({
				title: "The folder did not open",
				description: expect.stringContaining("did not answer"),
			}),
		);
	});

	it("keeps the host-only message for the owner-only rejection", async () => {
		h.open.mockRejectedValue({ code: "FORBIDDEN", message: "Only the owner" });
		const out = await mount(contextOf([repo({ name: "api" })]));
		await act(async () => {
			out.current.ctx.opener?.open("vscode");
		});
		expect(h.toast).toHaveBeenCalledWith({ title: "Opens only on the host" });
	});
});

describe("useDetailsCard detached repositories (#1176 F2)", () => {
	it("offers the branch on the detached repository that has work, not the first", async () => {
		const out = await mount(
			contextOf([repo({ name: "web" }), repo({ name: "api", tip: "bbb" })]),
		);
		expect(out.current.ctx.newBranch).toMatchObject({ repo: "api" });
	});

	it("takes the first when every detached repository is unchanged", async () => {
		const out = await mount(
			contextOf([repo({ name: "web" }), repo({ name: "api" })]),
		);
		expect(out.current.ctx.newBranch).toMatchObject({ repo: "web" });
	});
});
