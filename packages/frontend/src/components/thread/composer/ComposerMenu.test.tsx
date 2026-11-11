// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type {
	ReferenceHit,
	ReferenceSearchResult,
} from "@prismalens/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ComposerMenu, groupHits, menuRows } from "./ComposerMenu";

vi.mock("@tanstack/react-router", () => ({
	Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
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
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
});

const hit = (over: Partial<ReferenceHit>): ReferenceHit => ({
	ref: { kind: "command", id: "run", label: "/run" },
	source: "app",
	group: "PrismaLens",
	why: "match",
	score: 1,
	...over,
});

const q = (testId: string) =>
	container.querySelector(`[data-testid="${testId}"]`);

describe("ComposerMenu (#1024)", () => {
	it("under /, puts PrismaLens first even when the agent group ranks first", () => {
		const agentHit = hit({
			ref: { kind: "command", id: "agent:review", label: "/review" },
			source: "agent",
			group: "Claude Code",
		});
		const appHit = hit({
			ref: { kind: "command", id: "compact", label: "/compact" },
			source: "app",
			group: "PrismaLens",
		});
		const groups = groupHits([agentHit, appHit], "/", "");
		expect(groups.map((g) => g.label)).toEqual(["PrismaLens", "Claude Code"]);
	});

	it("an agent group with 8 commands shows 5 rows and 3 more when query is empty, and all 8 once query is r", () => {
		const hits: ReferenceHit[] = Array.from({ length: 8 }, (_, i) =>
			hit({
				ref: { kind: "command", id: `agent:cmd${i}`, label: `/cmd${i}` },
				source: "agent",
				group: "Codex",
			}),
		);
		const emptyGroups = groupHits(hits, "/", "");
		expect(emptyGroups[0]?.hits.length).toBe(5);
		expect(emptyGroups[0]?.more).toBe(3);
		expect(menuRows(emptyGroups).length).toBe(5);

		const filteredGroups = groupHits(hits, "/", "r");
		expect(filteredGroups[0]?.hits.length).toBe(8);
		expect(filteredGroups[0]?.more).toBe(0);
		expect(menuRows(filteredGroups).length).toBe(8);
	});

	it("renders an inputHint as its text", async () => {
		const result: ReferenceSearchResult = {
			hits: [
				hit({
					ref: { kind: "command", id: "agent:review", label: "/review" },
					source: "agent",
					group: "Codex",
					inputHint: "focus",
				}),
			],
			truncated: false,
			unavailable: [],
		};
		await act(async () => {
			root.render(
				<ComposerMenu
					trigger="/"
					query=""
					result={result}
					loading={false}
					failed={null}
					active={0}
					onActive={vi.fn()}
					onPick={vi.fn()}
				/>,
			);
		});
		const row = q("composer-menu-row");
		expect(row?.textContent).toContain("focus");
	});

	it("renders unavailable sources as source: unavailable", async () => {
		const result: ReferenceSearchResult = {
			hits: [],
			truncated: false,
			unavailable: [{ source: "GitLab", message: "no token" }],
		};
		await act(async () => {
			root.render(
				<ComposerMenu
					trigger="/"
					query=""
					result={result}
					loading={false}
					failed={null}
					active={0}
					onActive={vi.fn()}
					onPick={vi.fn()}
				/>,
			);
		});
		const unavail = q("composer-menu-unavailable");
		expect(unavail?.textContent).toBe("GitLab: unavailable");
	});

	it("renders No matches for an empty result", async () => {
		const result: ReferenceSearchResult = {
			hits: [],
			truncated: false,
			unavailable: [],
		};
		await act(async () => {
			root.render(
				<ComposerMenu
					trigger="/"
					query="unknown"
					result={result}
					loading={false}
					failed={null}
					active={0}
					onActive={vi.fn()}
					onPick={vi.fn()}
				/>,
			);
		});
		const empty = q("composer-menu-empty");
		expect(empty?.textContent).toBe("No matches");
	});

	it("renders Connect a source for # with empty query and nothing", async () => {
		const result: ReferenceSearchResult = {
			hits: [],
			truncated: false,
			unavailable: [],
		};
		await act(async () => {
			root.render(
				<ComposerMenu
					trigger="#"
					query=""
					result={result}
					loading={false}
					failed={null}
					active={0}
					onActive={vi.fn()}
					onPick={vi.fn()}
				/>,
			);
		});
		const connect = q("composer-menu-connect");
		expect(connect?.textContent).toContain("Connect a source");
	});

	it("renders composer-menu-loading when loading with no result", async () => {
		await act(async () => {
			root.render(
				<ComposerMenu
					trigger="/"
					query=""
					result={undefined}
					loading={true}
					failed={null}
					active={0}
					onActive={vi.fn()}
					onPick={vi.fn()}
				/>,
			);
		});
		expect(q("composer-menu-loading")).not.toBeNull();
	});
});
