// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { ThreadRow } from "@prismalens/contracts";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RowBadges } from "./RowBadges";
import { RowPlace, useRest } from "./RowLines";

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
const draw = (el: ReactElement) => act(() => root.render(el));
const names = () =>
	[...host.querySelectorAll('[role="img"][data-testid^="row-badge-"]')].map(
		(e) => [e.getAttribute("data-testid"), e.getAttribute("aria-label")],
	);

beforeEach(() => {
	host = document.createElement("div");
	document.body.append(host);
	root = createRoot(host);
});
afterEach(() => {
	act(() => root.unmount());
	host.remove();
	vi.useRealTimers();
});

type Badged = Pick<ThreadRow, "pr" | "commits" | "harness" | "model">;
const t = (over: Partial<Badged> = {}): Badged => ({
	harness: null,
	model: null,
	...over,
});

describe("RowBadges", () => {
	it("draws PR, commits, alerts and agent in that order, each named in words, the agent last", async () => {
		await draw(
			<RowBadges
				t={t({
					pr: { number: 412, tone: "failing", count: 3 },
					commits: 2,
					harness: "claude",
					model: "opus",
				})}
				alerts={4}
			/>,
		);
		expect(names()).toEqual([
			["row-badge-pr", "3 PRs, newest #412, checks failing"],
			["row-badge-commits", "2 commits"],
			["row-badge-alerts", "4 alerts"],
			["row-badge-agent", "Claude · opus"],
		]);
		expect(
			host.querySelector('[data-testid="row-badge-pr"]')?.textContent,
		).toBe("#412+2");
	});

	it("names one PR as a pull request, one commit and one alert in the singular", async () => {
		await draw(
			<RowBadges
				t={t({ pr: { number: 9, tone: "open" }, commits: 1 })}
				alerts={1}
			/>,
		);
		expect(names()).toEqual([
			["row-badge-pr", "Pull request #9, open"],
			["row-badge-commits", "1 commit"],
			["row-badge-alerts", "1 alert"],
		]);
	});

	it("leaves out a badge with nothing to say: no PR, no commits, no alerts, no agent", async () => {
		await draw(<RowBadges t={t({ commits: 0 })} alerts={0} />);
		expect(names()).toEqual([]);
	});

	it("hands the PR badge's element to the rest handler as the pointer enters, and says when it leaves", async () => {
		const onPrEnter = vi.fn();
		const onPrLeave = vi.fn();
		await draw(
			<RowBadges
				t={t({ pr: { number: 9, tone: "open" } })}
				onPrEnter={onPrEnter}
				onPrLeave={onPrLeave}
			/>,
		);
		const badge = host.querySelector<HTMLElement>(
			'[data-testid="row-badge-pr"]',
		);
		await act(async () => {
			badge?.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
		});
		expect(onPrEnter.mock.calls).toEqual([[badge]]);
		await act(async () => {
			badge?.dispatchEvent(new PointerEvent("pointerout", { bubbles: true }));
		});
		expect(onPrLeave).toHaveBeenCalledTimes(1);
	});
});

describe("RowPlace", () => {
	it("names a service before a project, and draws nothing for neither", async () => {
		await draw(
			<RowPlace t={{ serviceName: "checkout-api", projectName: "shop" }} />,
		);
		const place = host.querySelector('[data-testid="row-place"]');
		expect([
			place?.getAttribute("aria-label"),
			place?.getAttribute("data-place"),
		]).toEqual(["Service checkout-api", "service"]);
		await draw(<RowPlace t={{ serviceName: null, projectName: "shop" }} />);
		expect(
			host
				.querySelector('[data-testid="row-place"]')
				?.getAttribute("aria-label"),
		).toBe("Project shop");
		await draw(<RowPlace t={{ serviceName: null, projectName: null }} />);
		expect(host.innerHTML).toBe("");
	});
});

function Rest({ ms }: { ms: number }) {
	const rest = useRest(ms);
	return (
		<button
			type="button"
			onPointerEnter={(e) => rest.enter(e.currentTarget)}
			onPointerLeave={rest.leave}
			data-open={rest.at ? "yes" : "no"}
		/>
	);
}

describe("useRest", () => {
	it("opens only once the pointer has rested the full wait, and closes as it leaves", async () => {
		vi.useFakeTimers();
		await draw(<Rest ms={450} />);
		const el = host.querySelector("button") as HTMLButtonElement;
		const open = () => el.getAttribute("data-open");
		await act(async () => {
			el.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
			vi.advanceTimersByTime(449);
		});
		expect(open()).toBe("no");
		await act(async () => {
			vi.advanceTimersByTime(1);
		});
		expect(open()).toBe("yes");
		await act(async () => {
			el.dispatchEvent(new PointerEvent("pointerout", { bubbles: true }));
		});
		expect(open()).toBe("no");
	});
});
