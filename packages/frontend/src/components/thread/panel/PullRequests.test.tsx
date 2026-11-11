// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { PrChecks, PrTone } from "@prismalens/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prToneClass } from "@/lib/pr-tone";
import {
	checksLine,
	PR_TONE_WORD,
	type PrWatch,
	PullRequestRow,
	type PullRequestView,
	watchLine,
} from "./PullRequests";

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

const basePr: PullRequestView = {
	id: "pr-1",
	number: 42,
	host: "github",
	repo: "repo",
	title: "feat: new thing",
	url: "https://github.com/o/r/pull/42",
	state: "open",
	tone: "open",
	checks: { state: "none", total: 0, failed: 0, pending: 0 },
	review: "none",
	conflicts: false,
	source: "branch",
	fetchedAt: null,
};

describe("checksLine (#1024)", () => {
	it.each([
		[
			{ state: "failing" as const, total: 9, failed: 2, pending: 1 },
			"2 failing · 1 running of 9",
		],
		[
			{ state: "passing" as const, total: 4, failed: 0, pending: 0 },
			"4 passing",
		],
		[{ state: "none" as const, total: 0, failed: 0, pending: 0 }, null],
	] as const)("checksLine of %j returns %s", (checks, expected) => {
		expect(checksLine(checks as PrChecks)).toBe(expected);
	});
});

describe("watchLine (#1024)", () => {
	it.each([
		[{ state: "watching" as const }, "Watching checks and reviews"],
		[{ state: "waiting" as const }, "Update waiting for the agent"],
		[{ state: "disconnected" as const }, "Host unreachable, retrying"],
		[
			{ state: "expired" as const, reason: "thread idle 7 days" },
			"Stopped watching: thread idle 7 days",
		],
		[{ state: "stopped" as const, reason: "merged" }, "Stopped: merged"],
	])("watchLine for %j returns %s", (watch, expected) => {
		expect(watchLine(watch as PrWatch)).toBe(expected);
	});
});

describe("PullRequestRow (#1024)", () => {
	it.each([
		"ready",
		"open",
		"draft",
		"attention",
		"failing",
		"merged",
		"closed",
		"unknown",
	] as const)(
		"shows tone word and mark class for tone %s",
		async (tone: PrTone) => {
			const pr: PullRequestView = { ...basePr, tone };
			await act(async () => {
				root.render(<PullRequestRow pr={pr} />);
			});
			const wordEl = container.querySelector('[data-testid="pr-tone-word"]');
			expect(wordEl?.textContent).toBe(PR_TONE_WORD[tone]);
			const icon = container.querySelector("svg");
			const expectedClass = prToneClass(tone);
			expect(icon?.getAttribute("class")).toContain(expectedClass);
		},
	);

	it("shows Merge conflict when conflicts is true", async () => {
		const pr: PullRequestView = { ...basePr, conflicts: true };
		await act(async () => {
			root.render(<PullRequestRow pr={pr} />);
		});
		const el = container.querySelector('[data-testid="pr-conflicts"]');
		expect(el?.textContent).toBe("Merge conflict");
	});

	it("shows Approved when review is approved", async () => {
		const pr: PullRequestView = { ...basePr, review: "approved" };
		await act(async () => {
			root.render(<PullRequestRow pr={pr} />);
		});
		const el = container.querySelector('[data-testid="pr-review"]');
		expect(el?.textContent).toBe("Approved");
	});

	it("expands check runs on click from aria-expanded false to true and shows 3 rows", async () => {
		const pr: PullRequestView = {
			...basePr,
			checks: { state: "failing", total: 3, failed: 1, pending: 1 },
			checkRuns: [
				{ name: "lint", state: "passing" },
				{ name: "test", state: "failing" },
				{ name: "build", state: "pending" },
			],
		};
		await act(async () => {
			root.render(<PullRequestRow pr={pr} />);
		});
		const btn = container.querySelector<HTMLButtonElement>(
			'[data-testid="pr-checks"]',
		);
		expect(btn?.getAttribute("aria-expanded")).toBe("false");
		expect(
			container.querySelectorAll('[data-testid="pr-check-run"]'),
		).toHaveLength(0);

		await act(async () => {
			btn?.click();
		});

		expect(btn?.getAttribute("aria-expanded")).toBe("true");
		const rows = container.querySelectorAll('[data-testid="pr-check-run"]');
		expect(rows).toHaveLength(3);
	});

	it("with onWatch button reads Stop watching for watching and calls onWatch(pr, false)", async () => {
		const onWatch = vi.fn();
		const pr: PullRequestView = {
			...basePr,
			watch: { state: "watching" },
		};
		await act(async () => {
			root.render(<PullRequestRow pr={pr} onWatch={onWatch} />);
		});
		const watchEl = container.querySelector('[data-testid="pr-watch"]');
		const btn = watchEl?.querySelector("button");
		expect(btn?.textContent).toBe("Stop watching");

		await act(async () => {
			btn?.click();
		});
		expect(onWatch).toHaveBeenCalledWith(pr, false);
	});

	it("with onWatch button reads Watch for stopped and calls onWatch(pr, true)", async () => {
		const onWatch = vi.fn();
		const pr: PullRequestView = {
			...basePr,
			watch: { state: "stopped", reason: "merged" },
		};
		await act(async () => {
			root.render(<PullRequestRow pr={pr} onWatch={onWatch} />);
		});
		const watchEl = container.querySelector('[data-testid="pr-watch"]');
		const btn = watchEl?.querySelector("button");
		expect(btn?.textContent).toBe("Watch");

		await act(async () => {
			btn?.click();
		});
		expect(onWatch).toHaveBeenCalledWith(pr, true);
	});
});
