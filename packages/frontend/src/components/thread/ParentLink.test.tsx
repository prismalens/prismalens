// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// fd1fac924: the mark reads the thread's start links, not a tree.
const links = vi.hoisted(() => ({ startedBy: null as unknown }));
vi.mock("@/lib/api/hooks/use-thread-tree-orpc", () => ({
	useThreadLinks: () => ({ data: { startedBy: links.startedBy, started: [] } }),
}));
vi.mock("@tanstack/react-router", () => ({
	Link: ({
		params,
		children,
		...rest
	}: {
		params: { id: string };
		children: ReactNode;
	}) => (
		<a href={`/threads/${params.id}`} {...rest}>
			{children}
		</a>
	),
}));
vi.mock("@/components/shared/Hint", () => ({
	Hint: ({ children }: { children: ReactNode }) => children,
}));

import { ParentLink } from "./ParentLink";

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const by = (id: string, title: string, via: "agent" | "fork" = "agent") => ({
	id,
	title,
	link: `/threads/${id}`,
	state: "running",
	unread: 0,
	via,
});

describe("ParentLink", () => {
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

	it("links a started thread to its starter by title, saying an agent started it", async () => {
		links.startedBy = by("root", "Checkout latency");
		await act(async () => root.render(<ParentLink threadId="kid" />));
		const a = container.querySelector('[data-testid="thread-parent"]');
		expect(a?.getAttribute("href")).toBe("/threads/root");
		expect(a?.getAttribute("aria-label")).toBe("Started by Checkout latency");
		expect(a?.getAttribute("data-via")).toBe("agent");
		expect(a?.textContent).toBe("Checkout latency");
	});

	it("says Forked from on a fork", async () => {
		links.startedBy = by("root", "Raise the timeout", "fork");
		await act(async () => root.render(<ParentLink threadId="f" />));
		expect(
			container
				.querySelector('[data-testid="thread-parent"]')
				?.getAttribute("aria-label"),
		).toBe("Forked from Raise the timeout");
	});

	it("draws nothing on a thread nobody started", async () => {
		links.startedBy = null;
		await act(async () => root.render(<ParentLink threadId="root" />));
		expect(container.innerHTML).toBe("");
	});
});
