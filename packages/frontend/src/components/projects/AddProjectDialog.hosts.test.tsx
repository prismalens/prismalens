// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { GitHostView } from "@prismalens/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

vi.mock("@/lib/desktop", () => ({
	desktopBridge: () => null,
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
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
});

describe("AddProjectDialog (git hosts)", () => {
	it("omits git host switch element when folderOnly is true", async () => {
		await act(async () => {
			root.render(
				<AddProjectDialog
					open={true}
					onOpenChange={vi.fn()}
					onChoose={vi.fn()}
					folderOnly={true}
				/>,
			);
		});

		const switcher = document.body.querySelector(
			'[data-testid="add-project-from"]',
		);
		expect(switcher).toBeNull();
	});

	it("shows GitHub and Folder or URL switch options and defaults to source field when no host is connected", async () => {
		mockGitHosts = [];

		await act(async () => {
			root.render(
				<AddProjectDialog
					open={true}
					onOpenChange={vi.fn()}
					onChoose={vi.fn()}
				/>,
			);
		});

		const switcher = document.body.querySelector(
			'[data-testid="add-project-from"]',
		);
		expect(switcher).not.toBeNull();
		expect(switcher?.textContent).toContain("GitHub");
		expect(switcher?.textContent).toContain("Folder or URL");

		const sourceInput = document.body.querySelector(
			'[data-testid="add-project-source"]',
		);
		expect(sourceInput).not.toBeNull();
	});

	it("shows host repositories by default when GitHub host is connected", async () => {
		mockGitHosts = [
			{
				host: "github.com",
				order: ["stored"],
				stored: [
					{
						connectionId: "conn-gh-1",
						label: "GitHub Personal Access Token",
						fingerprint: "fp-gh",
						status: "ACTIVE",
						testedAt: "2026-11-01T00:00:00Z",
						pinnedRepos: [],
					},
				],
				env: null,
				machine: null,
				ambiguous: false,
				unpinnedRepos: [],
			},
		];

		await act(async () => {
			root.render(
				<AddProjectDialog
					open={true}
					onOpenChange={vi.fn()}
					onChoose={vi.fn()}
				/>,
			);
		});

		const reposView = document.body.querySelector('[data-testid="host-repos"]');
		expect(reposView).not.toBeNull();
	});
});
