// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { autoResumeBody, LimitDock } from "./LimitDock";
import type { ThreadLimit } from "./session-words";

const clock = (at: string) => at.slice(11, 16);
const fixedNow = Date.parse("2026-11-11T15:00:00.000Z");

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

const fixtures: readonly [string, ThreadLimit, string][] = [
	[
		"resuming",
		{
			since: "2026-11-11T15:00:00.000Z",
			autoResume: true,
			resetsAt: "2026-11-11T15:43:00.000Z",
			nextAttemptAt: "2026-11-11T15:45:00.000Z",
			attempts: 1,
		},
		"Usage limit reached · resumes 15:45",
	],
	[
		"retrying",
		{
			since: "2026-11-11T15:00:00.000Z",
			autoResume: true,
			resetsAt: null,
			nextAttemptAt: "2026-11-11T16:10:00.000Z",
			attempts: 2,
			maxAttempts: 6,
		},
		"Usage limit reached · trying again at 16:10 (2 of 6)",
	],
	[
		"off",
		{
			since: "2026-11-11T15:00:00.000Z",
			autoResume: false,
			resetsAt: "2026-11-11T15:45:00.000Z",
			attempts: 1,
		},
		"Usage limit reached · resets 15:45",
	],
	[
		"gaveUp",
		{
			since: "2026-11-11T15:00:00.000Z",
			gaveUp: true,
			autoResume: true,
			resetsAt: null,
			attempts: 7,
		},
		"Stopped trying after 6 tries",
	],
];

describe("LimitDock states and lines", () => {
	it.each(fixtures)(
		"data-state is %s and limit-dock-line holds %s",
		async (state, limit, line) => {
			await act(async () =>
				root.render(
					<LimitDock
						limit={limit}
						onDontResume={vi.fn()}
						onSendAtReset={vi.fn()}
						now={fixedNow}
						clock={clock}
					/>,
				),
			);
			const dock = container.querySelector('[data-testid="limit-dock"]');
			expect(dock?.getAttribute("data-state")).toBe(state);
			const dockLine = container.querySelector(
				'[data-testid="limit-dock-line"]',
			);
			expect(dockLine?.textContent).toBe(line);
		},
	);
});

describe("LimitDock countdown", () => {
	it("resuming with now 10 minutes before nextAttemptAt shows limit-dock-countdown 10:00", async () => {
		const nextAttemptAt = "2026-11-11T15:45:00.000Z";
		const now = Date.parse("2026-11-11T15:35:00.000Z");
		const limit: ThreadLimit = {
			since: "2026-11-11T15:00:00.000Z",
			autoResume: true,
			resetsAt: "2026-11-11T15:43:00.000Z",
			nextAttemptAt,
			attempts: 1,
		};
		await act(async () =>
			root.render(
				<LimitDock
					limit={limit}
					onDontResume={vi.fn()}
					onSendAtReset={vi.fn()}
					now={now}
					clock={clock}
				/>,
			),
		);
		const cd = container.querySelector('[data-testid="limit-dock-countdown"]');
		expect(cd?.textContent).toBe("10:00");
	});

	it("off shows no countdown", async () => {
		const limit: ThreadLimit = {
			since: "2026-11-11T15:00:00.000Z",
			autoResume: false,
			resetsAt: "2026-11-11T15:45:00.000Z",
			attempts: 1,
		};
		await act(async () =>
			root.render(
				<LimitDock
					limit={limit}
					onDontResume={vi.fn()}
					onSendAtReset={vi.fn()}
					now={fixedNow}
					clock={clock}
				/>,
			),
		);
		expect(
			container.querySelector('[data-testid="limit-dock-countdown"]'),
		).toBeNull();
	});

	it("retrying shows no countdown", async () => {
		const limit: ThreadLimit = {
			since: "2026-11-11T15:00:00.000Z",
			autoResume: true,
			resetsAt: null,
			nextAttemptAt: "2026-11-11T16:10:00.000Z",
			attempts: 2,
		};
		await act(async () =>
			root.render(
				<LimitDock
					limit={limit}
					onDontResume={vi.fn()}
					onSendAtReset={vi.fn()}
					now={fixedNow}
					clock={clock}
				/>,
			),
		);
		expect(
			container.querySelector('[data-testid="limit-dock-countdown"]'),
		).toBeNull();
	});
});

describe("LimitDock actions", () => {
	it("draft send the logs: clicking Send this draft when it resets calls onSendAtReset with send the logs", async () => {
		const onSendAtReset = vi.fn();
		const limit: ThreadLimit = {
			since: "2026-11-11T15:00:00.000Z",
			autoResume: true,
			resetsAt: "2026-11-11T15:45:00.000Z",
			attempts: 1,
		};
		await act(async () =>
			root.render(
				<LimitDock
					limit={limit}
					draft="  send the logs  "
					onDontResume={vi.fn()}
					onSendAtReset={onSendAtReset}
					now={fixedNow}
					clock={clock}
				/>,
			),
		);
		const button = container.querySelector(
			'[data-testid="limit-dock-send-at-reset"]',
		) as HTMLButtonElement;
		await act(async () => {
			button.click();
		});
		expect(onSendAtReset).toHaveBeenCalledTimes(1);
		expect(onSendAtReset).toHaveBeenCalledWith("send the logs");
	});

	it("no draft, no such button", async () => {
		const limit: ThreadLimit = {
			since: "2026-11-11T15:00:00.000Z",
			autoResume: true,
			resetsAt: "2026-11-11T15:45:00.000Z",
			attempts: 1,
		};
		await act(async () =>
			root.render(
				<LimitDock
					limit={limit}
					draft=""
					onDontResume={vi.fn()}
					onSendAtReset={vi.fn()}
					now={fixedNow}
					clock={clock}
				/>,
			),
		);
		expect(
			container.querySelector('[data-testid="limit-dock-send-at-reset"]'),
		).toBeNull();
	});

	it("autoResume true: clicking Don't resume calls onDontResume once", async () => {
		const onDontResume = vi.fn();
		const limit: ThreadLimit = {
			since: "2026-11-11T15:00:00.000Z",
			autoResume: true,
			resetsAt: "2026-11-11T15:45:00.000Z",
			attempts: 1,
		};
		await act(async () =>
			root.render(
				<LimitDock
					limit={limit}
					onDontResume={onDontResume}
					onSendAtReset={vi.fn()}
					now={fixedNow}
					clock={clock}
				/>,
			),
		);
		const button = container.querySelector(
			'[data-testid="limit-dock-dont-resume"]',
		) as HTMLButtonElement;
		await act(async () => {
			button.click();
		});
		expect(onDontResume).toHaveBeenCalledTimes(1);
	});

	it("autoResume false: no limit-dock-dont-resume", async () => {
		const limit: ThreadLimit = {
			since: "2026-11-11T15:00:00.000Z",
			autoResume: false,
			resetsAt: "2026-11-11T15:45:00.000Z",
			attempts: 1,
		};
		await act(async () =>
			root.render(
				<LimitDock
					limit={limit}
					onDontResume={vi.fn()}
					onSendAtReset={vi.fn()}
					now={fixedNow}
					clock={clock}
				/>,
			),
		);
		expect(
			container.querySelector('[data-testid="limit-dock-dont-resume"]'),
		).toBeNull();
	});

	it("gave up with onSend: shows limit-dock-send and neither of the other controls", async () => {
		const onSend = vi.fn();
		const limit: ThreadLimit = {
			since: "2026-11-11T15:00:00.000Z",
			gaveUp: true,
			autoResume: true,
			resetsAt: null,
			attempts: 7,
		};
		await act(async () =>
			root.render(
				<LimitDock
					limit={limit}
					draft="some draft"
					onDontResume={vi.fn()}
					onSendAtReset={vi.fn()}
					onSend={onSend}
					now={fixedNow}
					clock={clock}
				/>,
			),
		);
		expect(
			container.querySelector('[data-testid="limit-dock-send"]'),
		).not.toBeNull();
		expect(
			container.querySelector('[data-testid="limit-dock-send-at-reset"]'),
		).toBeNull();
		expect(
			container.querySelector('[data-testid="limit-dock-dont-resume"]'),
		).toBeNull();
	});
});

describe("autoResumeBody", () => {
	it("autoResumeBody.dontResume() equals {on: false}", () => {
		expect(autoResumeBody.dontResume()).toEqual({ on: false });
	});

	it("autoResumeBody.sendAtReset(x) equals {on: true, message: x}", () => {
		expect(autoResumeBody.sendAtReset("x")).toEqual({
			on: true,
			message: "x",
		});
	});
});
