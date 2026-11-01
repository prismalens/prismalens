// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { RestartSummary } from "@prismalens/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatClock } from "@/lib/format-time";
import { SEEN_KEY, shouldShowRestartNotice } from "@/lib/restart-notice";
import { RestartNotice } from "./RestartNotice";

const NOW = new Date("2026-10-28T09:30:00").getTime();
const STARTED = new Date("2026-10-28T09:14:00").toISOString();
const STOPPED = new Date("2026-10-28T08:52:00").toISOString();

const ref = (n: number, title: string) => ({
	investigationId: `run-${n}`,
	incidentId: `inc-${n}`,
	incidentNumber: n,
	title,
});

const summary = (over: Partial<NonNullable<RestartSummary>> = {}) =>
	({
		at: STARTED,
		stoppedAt: STOPPED,
		resumed: [ref(42, "Checkout"), ref(44, "Queue"), ref(45, "DNS")],
		skipped: [
			{
				...ref(41, "Payments"),
				reason: "Not resumed: Codex isn't signed in",
			},
		],
		...over,
	}) as NonNullable<RestartSummary>;

let data: RestartSummary | undefined;
let phone = false;

vi.mock("@/lib/api/hooks", () => ({
	useRestartSummary: () => ({ data }),
}));
vi.mock("@/hooks/use-media-query", () => ({
	PHONE: "phone",
	useMediaQuery: () => phone,
}));
vi.mock("@tanstack/react-router", () => ({
	Link: ({
		children,
		onClick,
		...rest
	}: {
		children: React.ReactNode;
		onClick?: () => void;
		params?: unknown;
		search?: { investigation?: string };
		to?: string;
	}) => (
		<a
			href={`/run/${rest.search?.investigation}`}
			data-to={rest.to}
			onClick={onClick}
			data-testid={(rest as Record<string, string>)["data-testid"]}
		>
			{children}
		</a>
	),
}));

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(NOW);
	localStorage.clear();
	data = summary();
	phone = false;
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	vi.useRealTimers();
});

const mount = () =>
	act(async () => {
		root.render(<RestartNotice />);
	});
const notice = () => container.querySelector('[data-testid="restart-notice"]');

describe("the startup notice (#981)", () => {
	it("shows what resumed and what could not, with the way into the first one", async () => {
		await mount();
		const text = notice()?.textContent ?? "";
		expect(text).toContain("PrismaLens started again");
		expect(text).toContain(
			`It stopped at ${formatClock(STOPPED)} and was off for 22 minutes.`,
		);
		expect(text).toContain("3 investigations resumed");
		expect(text).toContain("1 couldn't: INC-41, Codex isn't signed in");
		expect(
			container.querySelector('[data-testid="restart-notice-open"]')
				?.textContent,
		).toBe("Open INC-41");
		expect(notice()?.getAttribute("data-layout")).toBe("toast");
	});

	it("opens a skipped run with no incident on its run page, not an incident", async () => {
		data = summary({
			skipped: [
				{
					investigationId: "run-7",
					incidentId: null,
					incidentNumber: null,
					title: "Nightly checkout check",
					reason: "Not resumed: Codex isn't signed in",
				},
			],
		} as unknown as Partial<NonNullable<RestartSummary>>);
		await mount();
		const open = container.querySelector('[data-testid="restart-notice-open"]');
		expect(open?.getAttribute("data-to")).toBe("/investigations/$id");
		expect(open?.textContent).toBe("Open Nightly checkout check");
	});

	it("leaves out the gap when PrismaLens does not know when it stopped", async () => {
		data = summary({ stoppedAt: null });
		await mount();
		expect(notice()?.textContent).not.toContain("It stopped at");
	});

	it("is a banner on a phone, without the gap line", async () => {
		phone = true;
		await mount();
		expect(notice()?.getAttribute("data-layout")).toBe("banner");
		expect(notice()?.textContent).toContain("3 investigations resumed");
		expect(notice()?.textContent).not.toContain("It stopped at");
	});

	it("dismissing hides it and keeps it hidden on this device", async () => {
		await mount();
		await act(async () => {
			container
				.querySelector<HTMLButtonElement>(
					'[data-testid="restart-notice-dismiss"]',
				)
				?.click();
		});
		expect(notice()).toBeNull();
		expect(localStorage.getItem(SEEN_KEY)).toBe(STARTED);
		await act(async () => root.unmount());
		root = createRoot(container);
		await mount();
		expect(notice()).toBeNull();
	});

	it("shows again for a later start, even after an earlier one was dismissed", async () => {
		localStorage.setItem(SEEN_KEY, "2026-10-27T09:14:00.000Z");
		await mount();
		expect(notice()).not.toBeNull();
	});

	it("shows nothing for no summary, an empty one, or a start over an hour ago", async () => {
		const gone = [
			null,
			summary({ resumed: [], skipped: [] }),
			summary({ at: new Date(NOW - 3_700_000).toISOString() }),
		];
		for (const d of gone) {
			data = d;
			await mount();
			expect(notice()).toBeNull();
		}
	});
});

describe("when the notice shows (#981)", () => {
	it("needs a recent start, some run touched, and not seen on this device", () => {
		expect(shouldShowRestartNotice(summary(), null, NOW)).toBe(true);
		expect(shouldShowRestartNotice(summary(), STARTED, NOW)).toBe(false);
		expect(shouldShowRestartNotice(undefined, null, NOW)).toBe(false);
		expect(shouldShowRestartNotice(null, null, NOW)).toBe(false);
	});
});
