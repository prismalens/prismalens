// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { PrFiles } from "@prismalens/contracts";
import { act, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type RenderedApp, renderWithApp } from "@/test/render";
import { PrFileList, PrHostFiles } from "./PrFiles";

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const filesState = vi.hoisted(() => ({
	data: null as PrFiles | null,
	isLoading: false,
	error: null as unknown,
	refetch: vi.fn(),
}));

vi.mock("@/lib/providers/theme-provider", () => ({
	useTheme: () => ({ theme: "light" }),
}));

vi.mock("@/lib/api/hooks/use-fix-thread", () => ({
	usePrFiles: () => ({
		data: filesState.data,
		isLoading: filesState.isLoading,
		error: filesState.error,
		refetch: filesState.refetch,
	}),
}));

vi.mock("@pierre/diffs/react", () => ({
	PatchDiff: ({ patch }: { patch: string }) => (
		<div data-testid="mock-patch-diff">{patch}</div>
	),
	WorkerPoolContextProvider: ({ children }: { children: ReactNode }) => (
		<div>{children}</div>
	),
}));

let container: HTMLDivElement;
let app: RenderedApp | undefined;

beforeEach(() => {
	app = undefined;
	filesState.data = null;
	filesState.isLoading = false;
	filesState.error = null;
	filesState.refetch = vi.fn();
});

async function show(ui: React.ReactNode) {
	if (app) await app.rerender(ui);
	else app = await renderWithApp(ui);
	container = app.container;
}

describe("PrFiles (#1176)", () => {
	it("renders file list content with path, status, and additions/deletions", async () => {
		const filesData: PrFiles = {
			headSha: "abcdef123456",
			files: [
				{
					path: "src/main.ts",
					status: "modified",
					additions: 12,
					deletions: 3,
					patch: "@@ -1 +1 @@\n-old\n+new",
				},
				{
					path: "src/large.ts",
					status: "added",
					additions: 100,
					deletions: 0,
					patch: null,
				},
			],
			truncated: true,
			unavailable: null,
		};

		await show(<PrFileList data={filesData} open="src/main.ts" />);

		const rows = container.querySelectorAll('[data-testid="pr-file-row"]');
		expect(rows).toHaveLength(2);

		// First row: modified file
		expect(rows[0]?.textContent).toContain("src/main.ts");
		expect(rows[0]?.textContent).toContain("Modified");
		expect(rows[0]?.textContent).toContain("+12");
		expect(rows[0]?.textContent).toContain("−3");
		// Patch open by default via `open="src/main.ts"`
		expect(
			rows[0]?.querySelector('[data-testid="mock-patch-diff"]')?.textContent,
		).toContain("--- a/src/main.ts\n+++ b/src/main.ts");

		// Second row: patch null => "Too large to show"
		expect(rows[1]?.textContent).toContain("src/large.ts");
		expect(
			rows[1]?.querySelector('[data-testid="pr-file-too-large"]')?.textContent,
		).toBe("Too large to show");

		// Truncated indicator
		expect(
			container.querySelector('[data-testid="pr-files-more"]')?.textContent,
		).toBe("More on the host");
	});

	it('renders empty state "No files changed" when files list is empty', async () => {
		const emptyData: PrFiles = {
			headSha: "abcdef123456",
			files: [],
			truncated: false,
			unavailable: null,
		};

		await show(<PrFileList data={emptyData} />);

		const empty = container.querySelector('[data-testid="state-empty"]');
		expect(empty).not.toBeNull();
		expect(empty?.textContent).toBe("No files changed");
	});

	it('renders failed state "Files didn\'t load" with Retry button when usePrFiles fails', async () => {
		filesState.isLoading = false;
		filesState.error = new Error("Failed to fetch files");
		filesState.data = null;

		await show(<PrHostFiles threadId="t-1" prId="pr-1" />);

		const problem = container.querySelector('[data-testid="state-problem"]');
		expect(problem).not.toBeNull();
		expect(problem?.textContent).toContain("Files didn't load");

		const retryBtn = problem?.querySelector("button");
		expect(retryBtn).not.toBeNull();
		expect(retryBtn?.textContent).toBe("Retry");

		await act(async () => {
			retryBtn?.click();
		});

		expect(filesState.refetch).toHaveBeenCalledTimes(1);
	});
});
