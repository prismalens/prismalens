// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { SharedSet } from "@prismalens/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SharedSetOffer } from "./SharedSetOffer";

const updateSpy = vi.fn();
let mockSet: SharedSet | undefined;
let mockSources: { agent: string; path: string; key: string }[] | undefined;

vi.mock("@/lib/api/hooks/use-agent-setup-orpc", () => ({
	useSharedSet: () => ({ data: mockSet }),
	useSharedSources: () => ({ data: mockSources }),
	useUpdateSharedSet: () => ({ mutate: updateSpy, isPending: false }),
}));

// The share dialog's own form is covered in SharedSetSettings.test.tsx; here only its open and save.
vi.mock("./SharedSetSettings", () => ({
	ShareServerDialog: ({
		open,
		onSaved,
	}: {
		open: boolean;
		onSaved?: () => void;
	}) =>
		open ? (
			<button type="button" data-testid="stub-share-save" onClick={onSaved}>
				Save
			</button>
		) : null,
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
	updateSpy.mockClear();
	mockSet = {
		decided: null,
		instructions: "",
		instructionsFor: [],
		revision: "r0",
		servers: [],
	};
	mockSources = [{ agent: "codex", path: "~/.codex/config.toml", key: "docs" }];
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
});

const byId = (id: string) =>
	container.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const render = () => act(async () => root.render(<SharedSetOffer />));

describe("SharedSetOffer", () => {
	it("shows Your agents' setups, and Use as set up records the choice as-is", async () => {
		await render();
		expect(byId("shared-set-offer")?.querySelector("h3")?.textContent).toBe(
			"Your agents' setups",
		);
		await act(async () => byId("shared-set-offer-as-is")?.click());
		expect(updateSpy).toHaveBeenCalledTimes(1);
		expect(updateSpy).toHaveBeenCalledWith({ decided: "as-is" });
	});

	it("Share with every agent opens the share dialog, and its save records the choice as shared", async () => {
		await render();
		expect(byId("stub-share-save")).toBeNull();
		await act(async () => byId("shared-set-offer-share")?.click());
		expect(updateSpy).not.toHaveBeenCalled();
		await act(async () => byId("stub-share-save")?.click());
		expect(updateSpy).toHaveBeenCalledTimes(1);
		expect(updateSpy).toHaveBeenCalledWith({ decided: "shared" });
	});

	it("is not shown once the person has chosen", async () => {
		mockSet = { ...(mockSet as SharedSet), decided: "as-is" };
		await render();
		expect(byId("shared-set-offer")).toBeNull();
	});

	it("is not shown while no installed agent has a server to share", async () => {
		mockSources = [];
		await render();
		expect(byId("shared-set-offer")).toBeNull();
	});
});
