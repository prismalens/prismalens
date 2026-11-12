// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { PullRequest } from "@prismalens/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { headerPr, ThreadPrChip } from "./ThreadPrChip";

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

describe("headerPr (#1101)", () => {
	it("picks the newest open or draft PR, else the newest", () => {
		const prs1 = [
			{ id: "1", state: "closed" as const },
			{ id: "2", state: "open" as const },
			{ id: "3", state: "draft" as const },
			{ id: "4", state: "merged" as const },
		];
		expect(headerPr(prs1)).toEqual({ id: "3", state: "draft" });

		const prs2 = [
			{ id: "1", state: "closed" as const },
			{ id: "2", state: "open" as const },
			{ id: "3", state: "merged" as const },
		];
		expect(headerPr(prs2)).toEqual({ id: "2", state: "open" });

		const prsClosed = [
			{ id: "1", state: "closed" as const },
			{ id: "2", state: "merged" as const },
		];
		expect(headerPr(prsClosed)).toEqual({ id: "2", state: "merged" });

		expect(headerPr([])).toBeUndefined();
	});
});

describe("ThreadPrChip (#1101)", () => {
	it("shows #N, the tone word and N/M checks, +K for more PRs, and calls onOpen(id) on click", async () => {
		const onOpen = vi.fn();
		const pr: Pick<PullRequest, "id" | "number" | "tone" | "checks"> = {
			id: "pr-412",
			number: 412,
			tone: "failing",
			checks: { state: "failing", total: 10, failed: 2, pending: 1 },
		};

		await act(async () => {
			root.render(<ThreadPrChip pr={pr} more={3} onOpen={onOpen} />);
		});

		const chip = container.querySelector<HTMLButtonElement>(
			'[data-testid="thread-pr-chip"]',
		);
		expect(chip).not.toBeNull();
		expect(chip?.textContent).toContain("#412");
		expect(chip?.textContent).toContain("Failing");
		expect(chip?.textContent).toContain("7/10 checks");
		expect(chip?.textContent).toContain("+3");

		await act(async () => {
			chip?.click();
		});

		expect(onOpen).toHaveBeenCalledTimes(1);
		expect(onOpen).toHaveBeenCalledWith("pr-412");
	});
});
