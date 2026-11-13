// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tree = vi.hoisted(() => ({ nodes: [] as unknown[] }));
vi.mock("@/lib/api/hooks/use-thread-tree-orpc", () => ({
	useThreadTree: () => ({ data: { nodes: tree.nodes } }),
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

const node = (
	id: string,
	parentId: string | null,
	title: string,
	role: string | null = null,
) => ({
	id,
	parentId,
	title,
	role,
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

	it("links a child to its parent by title, saying an agent started it", async () => {
		tree.nodes = [
			node("root", null, "Checkout latency"),
			node("kid", "root", "Read logs"),
		];
		await act(async () => root.render(<ParentLink threadId="kid" />));
		const a = container.querySelector('[data-testid="thread-parent"]');
		expect(a?.getAttribute("href")).toBe("/threads/root");
		expect(a?.getAttribute("aria-label")).toBe("Started from Checkout latency");
		expect(a?.textContent).toBe("Checkout latency");
	});

	it("says Forked from on a fork", async () => {
		tree.nodes = [
			node("root", null, "Raise the timeout"),
			node("f", "root", "Try 45 s", "fork"),
		];
		await act(async () => root.render(<ParentLink threadId="f" />));
		expect(
			container
				.querySelector('[data-testid="thread-parent"]')
				?.getAttribute("aria-label"),
		).toBe("Forked from Raise the timeout");
	});

	it("draws nothing on a root thread", async () => {
		tree.nodes = [node("root", null, "Checkout latency")];
		await act(async () => root.render(<ParentLink threadId="root" />));
		expect(container.innerHTML).toBe("");
	});
});
