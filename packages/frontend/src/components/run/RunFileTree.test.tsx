// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel
// @vitest-environment happy-dom

import type { RunWorkspace } from "@prismalens/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TouchedFile } from "@/lib/run-panel";
import { RunFileTree } from "./RunFileTree";

const model = vi.hoisted(() => ({
	resetPaths: vi.fn(),
	scrollToPath: vi.fn(),
}));

vi.mock("@pierre/trees/react", () => ({
	FileTree: () => null,
	useFileTree: () => ({ model }),
}));

vi.mock("@tanstack/react-query", () => ({ useQueries: () => [] }));

vi.mock("@/lib/api/orpc-client", () => ({
	orpc: {
		investigations: {
			getTree: { queryOptions: () => ({ queryKey: ["tree"] }) },
		},
	},
}));

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const workspace = {
	repos: [{ name: "repo", head: "a".repeat(40) }],
} as unknown as RunWorkspace;

const touched = (...paths: string[]): TouchedFile[] =>
	paths.map((path) => ({ path, mark: "R" }) as unknown as TouchedFile);

const selected = {
	repo: "repo",
	sha: "a".repeat(40),
	path: "src/b.ts",
	line: null,
	end: null,
};

const tree = (files: TouchedFile[]) => (
	<RunFileTree
		mode="touched"
		runId="run-1"
		workspace={workspace}
		touched={files}
		selected={selected}
		onPick={vi.fn()}
	/>
);

describe("RunFileTree scroll to the selected file (#975)", () => {
	let container: HTMLDivElement;
	let root: Root;
	beforeEach(() => {
		model.scrollToPath.mockClear();
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
	});
	afterEach(() => {
		act(() => root.unmount());
		container.remove();
	});

	it("does not re-scroll when re-rendered with the same paths", async () => {
		await act(async () => root.render(tree(touched("src/a.ts", "src/b.ts"))));
		expect(model.scrollToPath).toHaveBeenCalledTimes(1);

		await act(async () => root.render(tree(touched("src/a.ts", "src/b.ts"))));
		await act(async () => root.render(tree(touched("src/a.ts", "src/b.ts"))));
		expect(model.scrollToPath).toHaveBeenCalledTimes(1);
	});

	it("scrolls again when the selected file arrives in the tree", async () => {
		await act(async () => root.render(tree(touched("src/a.ts"))));
		expect(model.scrollToPath).not.toHaveBeenCalled();

		await act(async () => root.render(tree(touched("src/a.ts", "src/b.ts"))));
		expect(model.scrollToPath).toHaveBeenCalledWith("src/b.ts", {
			focus: false,
		});
	});
});
