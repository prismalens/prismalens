// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { ThreadStartSubject } from "@prismalens/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HomeComposer } from "./HomeComposer";

const h = vi.hoisted(() => ({
	repos: undefined as { id: string; fullName: string }[] | undefined,
	box: null as {
		scopeSubject: ThreadStartSubject;
		onText: (text: string) => void;
	} | null,
}));

vi.mock("@/components/thread/NewThread", () => ({
	NewThread: (props: NonNullable<typeof h.box>) => {
		h.box = props;
		return null;
	},
}));
vi.mock("@/components/agent/AgentPicker", () => ({
	CHIP: "",
	unreadyReason: () => null,
	useAgentChoice: () => ({ isLoading: true }),
}));
vi.mock("@/lib/api/hooks", () => ({
	useServices: () => ({ data: { data: [] } }),
	useRepositories: () => ({ data: h.repos && { data: h.repos } }),
}));
vi.mock("@/lib/api/hooks/use-schedules-orpc", () => ({
	useSchedules: () => ({ data: undefined }),
}));
vi.mock("@tanstack/react-router", () => ({
	Link: () => null,
	useNavigate: () => vi.fn(),
}));
vi.mock("@/components/kit/Picker", () => ({ Picker: () => null }));
vi.mock("@/components/shell/RestartNotice", () => ({
	RestartNotice: () => null,
}));
vi.mock("./HomeHandover", () => ({ HomeHandover: () => null }));
vi.mock("./HomePurpose", () => ({ HomePurpose: () => null }));

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
	h.repos = undefined;
	h.box = null;
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});
afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
});

const render = () => act(async () => root.render(<HomeComposer />));
const loadOneProject = async () => {
	h.repos = [{ id: "r1", fullName: "acme/api" }];
	await render();
};

describe("Home's only-project default (#1216)", () => {
	it("moves an empty box to the only project", async () => {
		await render();
		await loadOneProject();
		expect(h.box?.scopeSubject).toEqual({
			kind: "project",
			repositoryId: "r1",
		});
	});

	it("leaves a box with typed text on Home's draft when the projects arrive", async () => {
		await render();
		await act(async () => h.box?.onText("checkout is down"));
		await loadOneProject();
		expect(h.box?.scopeSubject).toEqual({ kind: "none" });
	});
});
