// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NotificationsSettings } from "./NotificationsSettings";

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const state = {
	slackConfigured: false,
	updateMutate: vi.fn(),
};

vi.mock("@tanstack/react-query", () => ({
	useQueryClient: () => ({
		setQueryData: vi.fn(),
	}),
	useQuery: () => ({
		data: { slackConfigured: state.slackConfigured },
	}),
	useMutation: () => ({
		mutate: state.updateMutate,
		isPending: false,
		error: null,
	}),
}));

vi.mock("@/lib/api/orpc-client", () => ({
	orpc: {
		settings: {
			delivery: {
				get: {
					queryOptions: () => ({}),
					queryKey: () => ["delivery"],
				},
				update: {
					mutationOptions: () => ({}),
				},
			},
		},
	},
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
	state.slackConfigured = false;
	state.updateMutate = vi.fn();
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	vi.restoreAllMocks();
});

describe("NotificationsSettings (case 1 rest and notifications)", () => {
	it("renders Post reports to Slack with slack-delivery test id and no git hosts", async () => {
		await act(async () => root.render(createElement(NotificationsSettings)));

		const group = container.querySelector('[data-testid="slack-delivery"]');
		expect(group).not.toBeNull();
		expect(group?.textContent).toContain("Post reports to Slack");
		expect(group?.textContent).not.toContain("Git");
	});

	it("renders URL input and Save when unconfigured", async () => {
		state.slackConfigured = false;
		await act(async () => root.render(createElement(NotificationsSettings)));

		const input = container.querySelector('input[type="password"]');
		expect(input).not.toBeNull();

		const saveBtn = Array.from(container.querySelectorAll("button")).find(
			(b) => b.textContent?.trim() === "Save",
		);
		expect(saveBtn).not.toBeNull();
	});

	it("renders Set notice and Replace button when configured, and switch off posts null", async () => {
		state.slackConfigured = true;
		await act(async () => root.render(createElement(NotificationsSettings)));

		expect(container.textContent).toContain(
			"Set; the address is never shown again",
		);
		const replaceBtn = container.querySelector('[data-testid="slack-replace"]');
		expect(replaceBtn).not.toBeNull();

		// Toggle switch off
		const switchEl = container.querySelector(
			'[data-testid="slack-switch"]',
		) as HTMLButtonElement;
		expect(switchEl).not.toBeNull();

		await act(async () => switchEl.click());
		expect(state.updateMutate).toHaveBeenCalledWith({
			slackWebhookUrl: null,
		});
	});

	it("the row's label is the switch's: tapping it toggles the switch (#848 touch)", async () => {
		state.slackConfigured = true;
		await act(async () => root.render(createElement(NotificationsSettings)));
		const switchEl = container.querySelector('[data-testid="slack-switch"]');
		const label = Array.from(container.querySelectorAll("label")).find(
			(l) => l.textContent === "Post reports to Slack",
		);
		expect(label?.htmlFor).toBe(switchEl?.id);
		expect(switchEl?.id).not.toBe("");
		await act(async () => label?.click());
		expect(state.updateMutate).toHaveBeenCalledWith({
			slackWebhookUrl: null,
		});
	});
});
