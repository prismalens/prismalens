// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FolderPick, FolderPicker } from "@/lib/folder-picker";
import { AddProjectDialog } from "./AddProjectDialog";

let picker: FolderPicker;
let answer: FolderPick;
const pick = vi.fn(async () => answer);

vi.mock("@/lib/folder-picker", () => ({ useFolderPicker: () => picker }));
vi.mock("@/lib/api/hooks/use-app-settings-orpc", () => ({
	useGitHosts: () => ({ data: [] }),
}));
vi.mock("@/hooks/use-operator", () => ({
	useOperator: () => ({ managesPairing: true }),
}));
vi.mock("@tanstack/react-query", () => ({
	useQuery: () => ({ data: undefined }),
}));

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
const onChoose = vi.fn();

const byId = (id: string) =>
	document.body.querySelector(`[data-testid="${id}"]`);

beforeEach(async () => {
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
	pick.mockClear();
	onChoose.mockClear();
	picker = { desktop: false, available: true, pick };
	answer = { status: "picked", path: "C:\\work\\app" };
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
});

const render = () =>
	act(async () => {
		root.render(
			<AddProjectDialog open onOpenChange={vi.fn()} onChoose={onChoose} />,
		);
	});

const press = () =>
	act(async () => {
		(byId("add-project-pick-folder") as HTMLButtonElement).click();
	});

describe("AddProjectDialog Browse… (#1216)", () => {
	it("shows Browse… beside the folder list in a browser the host can pick in", async () => {
		await render();
		expect(byId("add-project-pick-folder")?.textContent).toBe("Browse…");
		expect(byId("add-project-entries")).not.toBeNull();
	});

	it("hides Browse… when the computer has no dialog or the viewer is not the host", async () => {
		picker = { desktop: false, available: false, pick };
		await render();
		expect(byId("add-project-pick-folder")).toBeNull();
		expect(byId("add-project-source")).not.toBeNull();
	});

	it("fills the folder path and hands it to the caller when a folder is picked", async () => {
		await render();
		await press();
		expect(pick).toHaveBeenCalledTimes(1);
		expect(onChoose).toHaveBeenCalledExactlyOnceWith("C:\\work\\app");
		expect((byId("add-project-source") as HTMLInputElement).value).toBe(
			"C:\\work\\app",
		);
	});

	it("changes nothing when the dialog is cancelled", async () => {
		answer = { status: "cancelled" };
		await render();
		await press();
		expect(pick).toHaveBeenCalledTimes(1);
		expect(onChoose).not.toHaveBeenCalled();
		expect((byId("add-project-source") as HTMLInputElement).value).toBe("");
	});

	it("changes nothing when the dialog turns out unavailable", async () => {
		answer = { status: "unavailable" };
		await render();
		await press();
		expect(onChoose).not.toHaveBeenCalled();
		expect((byId("add-project-source") as HTMLInputElement).value).toBe("");
	});
});
