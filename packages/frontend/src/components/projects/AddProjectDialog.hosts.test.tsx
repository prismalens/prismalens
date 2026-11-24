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

	const hostView = (host: string): GitHostView => ({
		host,
		order: ["stored"],
		stored: [
			{
				connectionId: `conn-${host}`,
				label: "Token",
				fingerprint: "fp",
				status: "ACTIVE",
				testedAt: "2026-11-01T00:00:00Z",
				pinnedRepos: [],
			},
		],
		env: null,
		machine: null,
		ambiguous: false,
		unpinnedRepos: [],
	});
	const rows = () =>
		Array.from(
			document.body.querySelectorAll('[data-testid="add-project-from"] > li'),
		).map((li) => li.textContent);
	const render = async () =>
		act(async () => {
			root.render(
				<AddProjectDialog
					open={true}
					onOpenChange={vi.fn()}
					onChoose={vi.fn()}
				/>,
			);
		});

	it("lists Local folder, Paste repository URL, then every declared host, with no host connected", async () => {
		await render();
		expect(rows()).toEqual([
			"Local folder",
			"Paste repository URL",
			"GitHubConnect",
			"GitLabConnect",
			"BitbucketConnect",
		]);
		expect(
			document.body.querySelector('[data-testid="add-project-source"]'),
		).not.toBeNull();
	});

	it("keeps the same order and opens Local folder when only GitLab is connected", async () => {
		mockGitHosts = [hostView("gitlab.com")];
		await render();
		expect(rows()).toEqual([
			"Local folder",
			"Paste repository URL",
			"GitHubConnect",
			"GitLabConnectedBrowse",
			"BitbucketConnect",
		]);
		expect(
			document.body.querySelector('[data-testid="host-repos"]'),
		).toBeNull();
	});

	it("opens the connect dialog on the host's kind from its Connect button", async () => {
		await render();
		await act(async () => {
			document.body
				.querySelector<HTMLButtonElement>(
					'[data-testid="add-project-connect-bitbucket"]',
				)
				?.click();
		});
		expect(
			document.body.querySelector('[data-testid="connect-dialog"]')
				?.textContent,
		).toBe("bitbucket");
	});

	it("offers the native folder button and no in-page browser when the desktop bridge picks folders", async () => {
		mockBridge = { pickFolder: async () => ({ path: "/work" }) };
		await render();
		expect(
			document.body.querySelector('[data-testid="add-project-native"]')
				?.textContent,
		).toBe("Choose folder");
		expect(
			document.body.querySelector('[data-testid="add-project-entries"]'),
		).toBeNull();
	});

	it("enables Add on the URL row only for a git URL", async () => {
		await render();
		await act(async () => {
			document.body
				.querySelector<HTMLButtonElement>('[data-testid="add-project-row-url"]')
				?.click();
		});
		const submit = () =>
			document.body.querySelector<HTMLButtonElement>(
				'[data-testid="add-project-submit"]',
			);
		expect(submit()?.disabled).toBe(true);
		const input = document.body.querySelector<HTMLInputElement>(
			'[data-testid="add-project-url"]',
		);
		await act(async () => {
			const set = Object.getOwnPropertyDescriptor(
				HTMLInputElement.prototype,
				"value",
			)?.set;
			set?.call(input, "https://github.com/prismalens/frontend.git");
			input?.dispatchEvent(new Event("input", { bubbles: true }));
		});
		expect(submit()?.disabled).toBe(false);
	});

	it("shows GitHub repositories once Browse is pressed on a connected GitHub", async () => {
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

		await act(async () => {
			document.body
				.querySelector<HTMLButtonElement>(
					'[data-testid="add-project-browse-github"]',
				)
				?.click();
		});
		const reposView = document.body.querySelector('[data-testid="host-repos"]');
		expect(reposView).not.toBeNull();
	});
});
