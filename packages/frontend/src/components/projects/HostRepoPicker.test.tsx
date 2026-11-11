// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { GitHostView } from "@prismalens/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HostRepoPicker, hostChoices } from "./HostRepoPicker";

const { useHostRepositoriesMock } = vi.hoisted(() => ({
	useHostRepositoriesMock: vi.fn(),
}));

vi.mock("@/lib/api/hooks/use-app-settings-orpc", () => ({
	useHostRepositories: (host: string | null, search: string) =>
		useHostRepositoriesMock(host, search),
	useHostImages: () => true,
}));

vi.mock("@/components/settings/SourceConnectDialog", () => ({
	SourceConnectDialog: ({ initialKind }: { initialKind: string }) => (
		<div data-testid="connect-dialog">{initialKind}</div>
	),
}));

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
	useHostRepositoriesMock.mockReset();
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
});

describe("HostRepoPicker", () => {
	it("returns disconnected GitHub when host list is empty", () => {
		expect(hostChoices([])).toEqual([
			{ host: "github.com", label: "GitHub", connected: false },
		]);
	});

	it("places connected GitLab before disconnected GitHub in hostChoices", () => {
		const gitlabView: GitHostView = {
			host: "gitlab.com",
			order: ["stored"],
			stored: [
				{
					connectionId: "conn-gitlab-1",
					label: "Personal Access Token",
					fingerprint: "fp-gitlab",
					status: "ACTIVE",
					testedAt: "2026-11-01T00:00:00Z",
					pinnedRepos: [],
				},
			],
			env: null,
			machine: null,
			ambiguous: false,
			unpinnedRepos: [],
		};

		expect(hostChoices([gitlabView])).toEqual([
			{ host: "gitlab.com", label: "GitLab", connected: true },
			{ host: "github.com", label: "GitHub", connected: false },
		]);
	});

	it("shows Connect GitHub and Paste buttons for none credential and triggers dialog and paste", async () => {
		useHostRepositoriesMock.mockReturnValue({
			data: { credential: "none", repositories: [] },
			isLoading: false,
			error: null,
			refetch: vi.fn(),
		});

		const onChoose = vi.fn();
		const onPasteUrl = vi.fn();

		await act(async () => {
			root.render(
				<HostRepoPicker
					choice={{
						host: "github.com",
						label: "GitHub",
						connected: false,
					}}
					onChoose={onChoose}
					onPasteUrl={onPasteUrl}
					pending={false}
				/>,
			);
		});

		expect(container.textContent).toContain("Connect GitHub");
		expect(container.textContent).toContain("Paste a URL instead");

		const connectButton = container.querySelector<HTMLButtonElement>(
			'[data-testid="host-repos-connect-button"]',
		);
		await act(async () => {
			connectButton?.click();
		});

		const connectDialog = container.querySelector(
			'[data-testid="connect-dialog"]',
		);
		expect(connectDialog?.textContent).toBe("github");

		const pasteButton = container.querySelector<HTMLButtonElement>(
			'[data-testid="host-repos-paste"]',
		);
		await act(async () => {
			pasteButton?.click();
		});
		expect(onPasteUrl).toHaveBeenCalledTimes(1);
	});

	it("renders repository items for resolved credential and updates hook on search input", async () => {
		useHostRepositoriesMock.mockReturnValue({
			data: {
				credential: "resolved",
				repositories: [
					{
						fullName: "prismalens/frontend",
						url: "https://github.com/prismalens/frontend.git",
						ownerAvatarUrl: null,
						private: false,
						pushedAt: null,
					},
					{
						fullName: "prismalens/api",
						url: "https://github.com/prismalens/api.git",
						ownerAvatarUrl: null,
						private: true,
						pushedAt: null,
					},
				],
				hasMore: false,
			},
			isLoading: false,
			error: null,
			refetch: vi.fn(),
		});

		const onChoose = vi.fn();
		const onPasteUrl = vi.fn();

		await act(async () => {
			root.render(
				<HostRepoPicker
					choice={{
						host: "github.com",
						label: "GitHub",
						connected: true,
					}}
					onChoose={onChoose}
					onPasteUrl={onPasteUrl}
					pending={false}
				/>,
			);
		});

		const buttons = container.querySelectorAll<HTMLButtonElement>(
			'[data-testid="host-repo"]',
		);
		expect(buttons.length).toBe(2);

		await act(async () => {
			buttons[1].click();
		});
		expect(onChoose).toHaveBeenCalledWith(
			"https://github.com/prismalens/api.git",
		);

		const searchInput = container.querySelector<HTMLInputElement>(
			'[data-testid="host-repos-search"]',
		);
		expect(searchInput).not.toBeNull();
		await act(async () => {
			Object.getOwnPropertyDescriptor(
				HTMLInputElement.prototype,
				"value",
			)?.set?.call(searchInput as HTMLInputElement, "api");
			(searchInput as HTMLInputElement).dispatchEvent(
				new Event("input", { bubbles: true }),
			);
		});

		await vi.waitFor(() => {
			expect(useHostRepositoriesMock).toHaveBeenLastCalledWith(
				"github.com",
				"api",
			);
		});
	});

	it("displays No repositories for empty repository list with no search text", async () => {
		useHostRepositoriesMock.mockReturnValue({
			data: {
				credential: "resolved",
				repositories: [],
				hasMore: false,
			},
			isLoading: false,
			error: null,
			refetch: vi.fn(),
		});

		const onChoose = vi.fn();
		const onPasteUrl = vi.fn();

		await act(async () => {
			root.render(
				<HostRepoPicker
					choice={{
						host: "github.com",
						label: "GitHub",
						connected: true,
					}}
					onChoose={onChoose}
					onPasteUrl={onPasteUrl}
					pending={false}
				/>,
			);
		});

		const empty = container.querySelector('[data-testid="host-repos-empty"]');
		expect(empty?.textContent).toBe("No repositories");
	});
});
