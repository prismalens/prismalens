// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectList } from "./ProjectList";

const h = vi.hoisted(() => ({
	rows: [] as {
		id: string;
		fullName: string;
		url: string;
		subPath: string | null;
		iconUrl: null;
		syncBranch: null;
	}[],
}));

vi.mock("@tanstack/react-router", () => ({
	useNavigate: () => vi.fn(),
	Link: ({ children }: { children: unknown }) => children,
}));
vi.mock("@/components/shell/PlaceTabs", () => ({ PlaceTabs: () => null }));
vi.mock("@/components/shared/ProjectMark", () => ({ ProjectMark: () => null }));
vi.mock("./AddProjectFlow", () => ({
	AddProjectFlow: () => <div data-testid="add-project-flow" />,
}));
vi.mock("@/lib/api/hooks/use-repositories-orpc", () => ({
	useRepositories: () => ({
		data: { data: h.rows },
		isLoading: false,
		error: null,
	}),
}));

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
	h.rows = [];
	host = document.createElement("div");
	document.body.append(host);
	root = createRoot(host);
});
afterEach(() => {
	act(() => root.unmount());
	host.remove();
});

const adds = () => host.querySelectorAll('[data-testid="add-project"]');

describe("ProjectList with no projects", () => {
	it("shows one Add project, in the page body, under a title that says what to do", () => {
		act(() => root.render(<ProjectList />));
		expect(
			host.querySelector('[data-testid="projects-none"] h2')?.textContent,
		).toBe("Add your first project");
		expect(adds()).toHaveLength(1);
		expect(host.querySelector("header [data-testid='add-project']")).toBeNull();
		act(() => (adds()[0] as HTMLButtonElement).click());
		expect(
			host.querySelector('[data-testid="add-project-flow"]'),
		).not.toBeNull();
	});

	it("keeps Add project in the header once a project exists", () => {
		h.rows = [
			{
				id: "p1",
				fullName: "shop",
				url: "C:/work/shop",
				subPath: null,
				iconUrl: null,
				syncBranch: null,
			},
		];
		act(() => root.render(<ProjectList />));
		expect(host.querySelector('[data-testid="projects-none"]')).toBeNull();
		expect(adds()).toHaveLength(1);
		expect(
			host.querySelector("header [data-testid='add-project']"),
		).not.toBeNull();
	});
});

describe("ProjectList rows", () => {
	it("tells two projects with one name apart by where each lives", () => {
		h.rows = ["C:/work/a/shop", "C:/work/b/shop"].map((url, i) => ({
			id: `p${i}`,
			fullName: "shop",
			url,
			subPath: i === 1 ? "api" : null,
			iconUrl: null,
			syncBranch: null,
		}));
		act(() => root.render(<ProjectList />));
		expect(
			Array.from(
				host.querySelectorAll('[data-testid="project-row-url"]'),
				(e) => e.textContent,
			),
		).toEqual(["C:/work/a/shop", "C:/work/b/shop/api"]);
	});
});
