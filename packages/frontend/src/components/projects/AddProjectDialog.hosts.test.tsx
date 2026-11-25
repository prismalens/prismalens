// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { GitHostView } from "@prismalens/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AddProjectDialog } from "./AddProjectDialog";

let mockGitHosts: GitHostView[] | undefined = [];
let mockHostsError = false;
const mockHostsRefetch = vi.fn();
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
	useGitHosts: () => ({
		data: mockGitHosts,
		isError: mockHostsError,
		refetch: mockHostsRefetch,
	}),
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
	mockHostsError = false;
	mockHostsRefetch.mockReset();
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
			document.body
				.querySelector('[data-testid="add-project-row-folder"]')
				?.getAttribute("aria-pressed"),
		).toBe("true");
		expect(
			document.body.querySelector('[data-testid="add-project-source"]'),
		).not.toBeNull();
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

	it("offers the Browse… button and no in-page browser when the desktop bridge picks folders", async () => {
		mockBridge = { pickFolder: async () => ({ path: "/work" }) };
		await render();
		expect(
			document.body.querySelector('[data-testid="add-project-pick-folder"]')
				?.textContent,
		).toBe("Browse…");
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
		const type = async (value: string) =>
			act(async () => {
				const set = Object.getOwnPropertyDescriptor(
					HTMLInputElement.prototype,
					"value",
				)?.set;
				set?.call(input, value);
				input?.dispatchEvent(new Event("input", { bubbles: true }));
			});
		await type("not-a-repository-url");
		expect(submit()?.disabled).toBe(true);
		await type("https://github.com/prismalens/frontend.git");
		expect(submit()?.disabled).toBe(false);
	});

	it("keeps the paste row apart from a connected host that is named url", async () => {
		mockGitHosts = [hostView("url")];
		await render();
		await act(async () => {
			document.body
				.querySelector<HTMLButtonElement>('[data-testid="add-project-row-url"]')
				?.click();
		});
		expect(
			document.body.querySelector('[data-testid="add-project-url"]'),
		).not.toBeNull();
		expect(
			document.body.querySelector('[data-testid="host-repos"]'),
		).toBeNull();
	});

	it("names the host in each Connect and Browse button", async () => {
		mockGitHosts = [hostView("gitlab.com")];
		await render();
		const names = Array.from(
			document.body.querySelectorAll(
				'[data-testid="add-project-from"] li > button:not([aria-pressed])',
			),
		).map((b) => b.getAttribute("aria-label"));
		expect(names).toEqual([
			"Connect GitHub",
			"Browse GitLab",
			"Connect Bitbucket",
		]);
	});

	it("says the code hosts did not load, retries, and keeps Local folder and the URL row usable", async () => {
		mockGitHosts = undefined;
		mockHostsError = true;
		await render();
		expect(rows().slice(0, 2)).toEqual([
			"Local folder",
			"Paste repository URL",
		]);
		expect(
			document.body.querySelector('[data-testid="state-problem"]')?.textContent,
		).toContain("Code hosts did not load.");
		expect(
			document.body.querySelector('[data-testid="add-project-row-github"]'),
		).toBeNull();
		await act(async () => {
			document.body
				.querySelector<HTMLButtonElement>(
					'[data-testid="state-problem"] button',
				)
				?.click();
		});
		expect(mockHostsRefetch).toHaveBeenCalledTimes(1);
		expect(
			document.body.querySelector<HTMLButtonElement>(
				'[data-testid="add-project-row-url"]',
			)?.disabled,
		).toBe(false);
		const field = () =>
			document.body.querySelector('[data-testid="add-project-source"]');
		const press = async (id: string) =>
			act(async () => {
				document.body
					.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`)
					?.click();
			});
		await press("add-project-row-url");
		expect(field()).toBeNull();
		await press("add-project-row-folder");
		expect(field()).not.toBeNull();
	});

	it("shows loading rows, not disabled host rows, while the code hosts load", async () => {
		mockGitHosts = undefined;
		await render();
		expect(
			document.body.querySelector('[data-testid="state-loading"]'),
		).not.toBeNull();
		expect(
			document.body.querySelector('[data-testid="add-project-row-github"]'),
		).toBeNull();
	});

	it("locks the source rows while the computer's folder dialog is open", async () => {
		mockGitHosts = [hostView("gitlab.com")];
		let answer: (v: unknown) => void = () => undefined;
		mockBridge = {
			pickFolder: () => new Promise((resolve) => (answer = resolve)),
		};
		await render();
		await act(async () => {
			document.body
				.querySelector<HTMLButtonElement>(
					'[data-testid="add-project-pick-folder"]',
				)
				?.click();
		});
		const locked = (id: string) =>
			document.body.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`)
				?.disabled;
		const sources = () =>
			[
				"add-project-row-folder",
				"add-project-row-url",
				"add-project-pick-folder",
				"add-project-browse-gitlab",
				"add-project-connect-github",
			].map(locked);
		expect(sources()).toEqual([true, true, true, true, true]);
		await act(async () => answer({ path: null }));
		expect(sources()).toEqual([false, false, false, false, false]);
	});

	it("adds nothing when the dialog closed before the folder dialog answered", async () => {
		let answer: (v: unknown) => void = () => undefined;
		mockBridge = {
			pickFolder: () => new Promise((resolve) => (answer = resolve)),
		};
		const onChoose = vi.fn();
		const view = (open: boolean) => (
			<AddProjectDialog
				open={open}
				onOpenChange={vi.fn()}
				onChoose={onChoose}
			/>
		);
		await act(async () => root.render(view(true)));
		await act(async () => {
			document.body
				.querySelector<HTMLButtonElement>(
					'[data-testid="add-project-pick-folder"]',
				)
				?.click();
		});
		await act(async () => root.render(view(false)));
		await act(async () => answer({ path: "/work" }));
		expect(onChoose).not.toHaveBeenCalled();
	});

	it("adds nothing when the dialog was unmounted by its owner before the folder dialog answered", async () => {
		let answer: (v: unknown) => void = () => undefined;
		mockBridge = {
			pickFolder: () => new Promise((resolve) => (answer = resolve)),
		};
		const onChoose = vi.fn();
		await act(async () => {
			root.render(
				<AddProjectDialog open onOpenChange={vi.fn()} onChoose={onChoose} />,
			);
		});
		await act(async () => {
			document.body
				.querySelector<HTMLButtonElement>(
					'[data-testid="add-project-pick-folder"]',
				)
				?.click();
		});
		await act(async () => root.render(<div />));
		await act(async () => answer({ path: "/work" }));
		expect(onChoose).not.toHaveBeenCalled();
	});

	it("leaves the typed path alone when an add started before the folder dialog answered", async () => {
		let answer: (v: unknown) => void = () => undefined;
		mockBridge = {
			pickFolder: () => new Promise((resolve) => (answer = resolve)),
		};
		const onChoose = vi.fn();
		const view = (pending: boolean) => (
			<AddProjectDialog
				open
				pending={pending}
				onOpenChange={vi.fn()}
				onChoose={onChoose}
			/>
		);
		await act(async () => root.render(view(false)));
		const field = () =>
			document.body.querySelector<HTMLInputElement>(
				'[data-testid="add-project-source"]',
			);
		await act(async () => {
			const set = Object.getOwnPropertyDescriptor(
				HTMLInputElement.prototype,
				"value",
			)?.set;
			set?.call(field(), "/typed");
			field()?.dispatchEvent(new Event("input", { bubbles: true }));
		});
		await act(async () => {
			document.body
				.querySelector<HTMLButtonElement>(
					'[data-testid="add-project-pick-folder"]',
				)
				?.click();
		});
		await act(async () => root.render(view(true)));
		await act(async () => answer({ path: "/work" }));
		expect(field()?.value).toBe("/typed");
		expect(onChoose).not.toHaveBeenCalled();
	});

	it("adds the folder the computer's dialog picked while the dialog is still on Local folder", async () => {
		mockBridge = { pickFolder: async () => ({ path: "/work" }) };
		const onChoose = vi.fn();
		await act(async () => {
			root.render(
				<AddProjectDialog open onOpenChange={vi.fn()} onChoose={onChoose} />,
			);
		});
		await act(async () => {
			document.body
				.querySelector<HTMLButtonElement>(
					'[data-testid="add-project-pick-folder"]',
				)
				?.click();
		});
		expect(onChoose).toHaveBeenCalledExactlyOnceWith("/work");
	});

	it("says so, and keeps Browse, when the folder dialog failed on the way", async () => {
		mockBridge = {
			pickFolder: async () => {
				throw new TypeError("Failed to fetch");
			},
		};
		await render();
		await act(async () => {
			document.body
				.querySelector<HTMLButtonElement>(
					'[data-testid="add-project-pick-folder"]',
				)
				?.click();
		});
		expect(
			document.body.querySelector('[data-testid="add-project-pick-failed"]')
				?.textContent,
		).toBe("The folder dialog did not open. Try again.");
		expect(
			document.body.querySelector<HTMLButtonElement>(
				'[data-testid="add-project-pick-folder"]',
			)?.disabled,
		).toBe(false);
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
