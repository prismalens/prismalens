// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RunRef } from "@/components/incidents/record-context";
import { NewerRunLine } from "./ConversationRoute";

let workspace: { repos: { name: string; head: string }[] } | null = null;

vi.mock("@/lib/api/hooks/use-investigations-orpc", () => ({
	useInvestigation: () => ({ data: { workspace } }),
}));
vi.mock("@/components/incidents/RecordLayout", () => ({
	RECORD_GRID: "",
	RecordLink: ({ children }: { children: ReactNode }) => (
		<a href="#run">{children}</a>
	),
}));
vi.mock("@/components/incidents/IncidentFacts", () => ({}));
vi.mock("./DockedComposer", () => ({}));
vi.mock("./Transcript", () => ({}));

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
	workspace = null;
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
});

const runs = [
	{ id: "new", createdAt: "2026-10-09T11:00:00Z" },
	{ id: "old", createdAt: "2026-10-09T10:00:00Z" },
] as RunRef[];

describe("NewerRunLine (#673 w27)", () => {
	const render = () =>
		act(async () => {
			root.render(
				<NewerRunLine incidentId="inc-1" runs={runs} selected="old" />,
			);
		});

	it("links the newer run even when it pinned no workspace", async () => {
		await render();
		const line = container.querySelector('[data-testid="newer-run-line"]');
		expect(line?.textContent).toBe("A newer run (Run #2) exists");
	});

	it("says which code the newer run looks at when it has one", async () => {
		workspace = { repos: [{ name: "api", head: "1234567890abcdef" }] };
		await render();
		const line = container.querySelector('[data-testid="newer-run-line"]');
		expect(line?.textContent).toBe("A newer run (Run #2) looks at 1234567");
	});
});
