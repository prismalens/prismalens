// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { GitHostView } from "@prismalens/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { recentSources } from "@/lib/project-source";
import { AddProjectDialog } from "./AddProjectDialog";

let mockGitHosts: GitHostView[] | undefined = [];
const mockHostRepos = {
	credential: "resolved",
	repositories: [
		{
			fullName: "prismalens/frontend",
			url: "https://github.com/prismalens/frontend.git",
			ownerAvatarUrl: null,
			private: false,
			pushedAt: null,
		},
	],
	hasMore: false,
};

vi.mock("@/lib/api/hooks/use-app-settings-orpc", () => ({
	useGitHosts: () => ({ data: mockGitHosts }),
	useHostRepositories: () => ({
		data: mockHostRepos,
		isLoading: false,
		error: null,
		refetch: vi.fn(),
	}),
	useHostImages: () => true,
}));

vi.mock("@/hooks/use-operator", () => ({
	useOperator: () => ({ managesPairing: true }),
}));

vi.mock("@tanstack/react-query", () => ({
	useQuery: () => ({ data: undefined }),
}));

vi.mock("@/components/settings/SourceConnectDialog", async () => {
	const real = await vi.importActual<
		typeof import("@/components/settings/SourceConnectDialog")
	>("@/components/settings/SourceConnectDialog");
	return {
		SOURCE_KINDS: real.SOURCE_KINDS,
		SourceConnectDialog: ({ initialKind }: { initialKind: string }) => (
			<div data-testid="connect-dialog">{initialKind}</div>
		),
	};
});

let mockBridge: { pickFolder?: () => Promise<unknown> } | null = null;
vi.mock("@/lib/desktop", () => ({
	desktopBridge: () => mockBridge,
	titleRowHeight: () => 0,
}));

const domStubs: Record<string, () => unknown> = {
	hasPointerCapture: () => false,
	setPointerCapture: () => undefined,
	releasePointerCapture: () => undefined,
	scrollIntoView: () => undefined,
};
for (const [k, v] of Object.entries(domStubs)) {
	if (!(k in Element.prototype)) Object.assign(Element.prototype, { [k]: v });
}

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
	mockGitHosts = [];
	mockBridge = null;
	localStorage.clear();
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
});

async function addFolder(
	onChoose: (s: string) => Promise<unknown> | undefined,
) {
	await act(async () => {
		root.render(
			<AddProjectDialog open onOpenChange={vi.fn()} onChoose={onChoose} />,
		);
	});
	const input = document.body.querySelector(
		'[data-testid="add-project-source"]',
	) as HTMLInputElement;
	await act(async () => {
		Object.getOwnPropertyDescriptor(
			HTMLInputElement.prototype,
			"value",
		)?.set?.call(input, "/work/repo");
		input.dispatchEvent(new Event("input", { bubbles: true }));
	});
	await act(async () => {
		document.body
			.querySelector("#add-project-form")
			?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
	});
}

describe("AddProjectDialog recents", () => {
	it("remembers the folder once the add resolves", async () => {
		await addFolder(() => Promise.resolve());
		expect(recentSources()).toEqual(["/work/repo"]);
	});

	it("does not remember a folder whose add was refused", async () => {
		await addFolder(() => Promise.reject(new Error("not a git repository")));
		expect(recentSources()).toEqual([]);
	});

	it("keeps the footer outside the scrolling body so a short screen still shows Add", async () => {
		await addFolder(() => Promise.resolve());
		const submit = document.body.querySelector(
			'[data-testid="add-project-submit"]',
		) as HTMLButtonElement;
		expect(submit.getAttribute("form")).toBe("add-project-form");
		const body = document.body.querySelector(".min-h-0.flex-1.overflow-y-auto");
		expect(
			body?.contains(document.body.querySelector("#add-project-form")),
		).toBe(true);
		expect(body?.contains(submit)).toBe(false);
		expect(submit.textContent).toBe("Add");
	});
});
