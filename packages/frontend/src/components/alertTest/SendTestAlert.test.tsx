// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GITLESS_WHY, NO_PROJECT_WHY } from "@/components/shell/app.actions";
import { SendTestAlert } from "./SendTestAlert";

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => ({
	projects: [] as { id: string; fullName: string; plain: boolean }[],
	mutate: vi.fn(),
	navigate: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => h.navigate }));
vi.mock("@/lib/api/hooks", () => ({
	useRepositories: () => ({ data: { data: h.projects } }),
}));
vi.mock("@/lib/api/hooks/use-webhooks-orpc", () => ({
	useSendTestAlert: () => ({ mutate: h.mutate, isPending: false, error: null }),
	webhookUrl: () => "http://localhost:3000/api/webhooks/generic",
}));

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
	h.projects = [];
	h.mutate.mockReset();
	host = document.createElement("div");
	document.body.append(host);
	root = createRoot(host);
});
afterEach(() => {
	act(() => root.unmount());
	host.remove();
});

const button = () =>
	host.querySelector<HTMLButtonElement>(
		'[data-testid="send-test-alert-button"]',
	);
const why = () =>
	host.querySelector('[data-testid="send-test-alert-why"]')?.textContent;

describe("SendTestAlert", () => {
	it("with no project, disables the button and says to add one", () => {
		act(() => root.render(createElement(SendTestAlert)));

		expect(button()?.disabled).toBe(true);
		expect(why()).toBe(NO_PROJECT_WHY);
	});

	it("for a folder with no git, disables the button and says to start git", () => {
		act(() =>
			root.render(
				createElement(SendTestAlert, {
					project: { id: "p1", fullName: "notes", plain: true },
				}),
			),
		);

		expect(button()?.disabled).toBe(true);
		expect(why()).toBe(GITLESS_WHY);
	});

	it("for a git project, sends the test alert named for that project", () => {
		act(() =>
			root.render(
				createElement(SendTestAlert, {
					project: { id: "p1", fullName: "demo-proj", plain: false },
				}),
			),
		);

		expect(button()?.disabled).toBe(false);
		expect(why()).toBeUndefined();
		act(() => button()?.click());
		expect(h.mutate).toHaveBeenCalledTimes(1);
		expect(h.mutate.mock.calls[0]?.[0]).toEqual({ serviceName: "demo-proj" });
	});

	it("picks the first git project over a folder with no git when the workspace has both", () => {
		h.projects = [
			{ id: "p1", fullName: "notes", plain: true },
			{ id: "p2", fullName: "demo-proj", plain: false },
		];
		act(() => root.render(createElement(SendTestAlert)));

		act(() => button()?.click());
		expect(h.mutate.mock.calls[0]?.[0]).toEqual({ serviceName: "demo-proj" });
	});

	it("shows the curl with a token placeholder and never a real token", () => {
		act(() =>
			root.render(
				createElement(SendTestAlert, {
					project: { id: "p1", fullName: "demo-proj", plain: false },
				}),
			),
		);

		const text = host.querySelector("details code")?.textContent;
		expect(text).toContain("Authorization: Bearer <TOKEN>");
		expect(text).toContain("http://localhost:3000/api/webhooks/generic");
		expect(text).toContain('"serviceName":"demo-proj"');
	});
});
