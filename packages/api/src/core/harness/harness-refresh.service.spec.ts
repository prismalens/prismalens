// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { HarnessId } from "@prismalens/config/harness";
import type { HarnessProbeResult } from "@prismalens/contracts/schemas";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HarnessModelsService } from "./harness-models.service.js";
import { HarnessProbeService } from "./harness-probe.service.js";
import {
	HarnessRefreshService,
	harnessRefreshPort,
	type RefreshMinutes,
	type RefreshPort,
} from "./harness-refresh.service.js";

const mocks = vi.hoisted(() => ({ probeHarness: vi.fn() }));

vi.mock("@prismalens/engine", async (importOriginal) => ({
	...(await importOriginal<typeof import("@prismalens/engine")>()),
	probeHarness: mocks.probeHarness,
}));

const MIN = 60_000;
const answered = (id: HarnessId): HarnessProbeResult => ({
	id,
	outcome: "answers-acp",
	detail: "answers ACP",
	hard: false,
});

function port(over: Partial<RefreshPort> & { minutes?: () => Promise<RefreshMinutes> } = {}) {
	const checked: HarnessId[] = [];
	const read: HarnessId[] = [];
	/** Every port call in order, so a test can see checks run before limit reads. */
	const order: string[] = [];
	const p: RefreshPort = {
		targets: async () => ["codex", "cursor"],
		minutes: async () => 15,
		check: async (id) => {
			checked.push(id);
			order.push(`check ${id}`);
			return answered(id);
		},
		readLimits: async (id) => {
			read.push(id);
			order.push(`limits ${id}`);
		},
		safeCheck: (id) => id !== "cursor",
		...over,
	};
	return { p, checked, read, order };
}

/** Lets a tick's awaited port calls settle under fake timers. */
const settle = async () => {
	for (let i = 0; i < 10; i++) await Promise.resolve();
};

describe("HarnessRefreshService (#1180 §1.4)", () => {
	let svc: HarnessRefreshService | null = null;
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-11-26T10:00:00Z"));
	});
	afterEach(() => {
		svc?.stop();
		svc = null;
		vi.useRealTimers();
	});

	it("Check every Off runs no pass", async () => {
		const { p, checked } = port({ minutes: async () => 0 });
		svc = new HarnessRefreshService(p);
		svc.start();
		for (let i = 0; i < 120; i++) {
			await vi.advanceTimersByTimeAsync(MIN);
			await settle();
		}
		expect(checked).toEqual([]);
	});

	it("every 15 minutes runs a pass at 15 and at 30, checks first, then reads limits", async () => {
		const { p, checked, read, order } = port({ targets: async () => ["codex", "claude-code", "cursor"] });
		svc = new HarnessRefreshService(p);
		svc.start();
		await vi.advanceTimersByTimeAsync(14 * MIN);
		await settle();
		expect(checked).toEqual([]);
		await vi.advanceTimersByTimeAsync(MIN);
		await settle();
		expect(order).toEqual(["check codex", "check claude-code", "limits codex", "limits claude-code"]);
		await vi.advanceTimersByTimeAsync(15 * MIN);
		await settle();
		expect([checked, read]).toEqual([
			["codex", "claude-code", "codex", "claude-code"],
			["codex", "claude-code", "codex", "claude-code"],
		]);
	});

	it("Check all waits for a running pass, so one agent never has two checks at once", async () => {
		let release = () => {};
		let open = 0;
		let most = 0;
		const { p, checked } = port({
			check: (id) => {
				checked.push(id);
				most = Math.max(most, ++open);
				return new Promise((r) => {
					release = () => {
						open--;
						r(answered(id));
					};
				});
			},
		});
		svc = new HarnessRefreshService(p);
		const pass = svc.pass();
		await settle();
		const all = svc.checkAll();
		await settle();
		expect(checked).toEqual(["codex"]);
		release();
		await pass;
		await settle();
		release();
		expect([(await all).map((r) => r.id), checked, most]).toEqual([["codex"], ["codex", "codex"], 1]);
	});

	it("never starts a pass while one is running", async () => {
		let release = () => {};
		const { p, checked } = port({
			check: (id) => {
				checked.push(id);
				return new Promise((r) => {
					release = () => r(answered(id));
				});
			},
		});
		svc = new HarnessRefreshService(p);
		const first = svc.pass();
		const second = svc.pass();
		await settle();
		expect(second).toBe(first);
		await svc.tick();
		expect(checked).toEqual(["codex"]);
		release();
		await first;
		expect(checked).toEqual(["codex"]);
	});

	it("a pass and Check all never start an agent with no safe check, which keeps its last check and date", async () => {
		const models = new HarnessModelsService();
		const probe = new HarnessProbeService(models);
		models.rememberCheck("cursor", {
			outcome: "answers-acp",
			detail: "answers ACP",
			version: null,
			companionVersion: null,
			servedModel: null,
			effort: null,
			modes: null,
			efforts: null,
			images: false,
			sandbox: null,
			protocol: null,
			account: null,
		});
		const before = models.checked("cursor");
		mocks.probeHarness.mockReset();
		mocks.probeHarness.mockImplementation(async (id: HarnessId) => answered(id));
		// The production port, so a launch that lost its isolation requirement would show here.
		const p = harnessRefreshPort(
			{
				installedIds: async () => ["codex", "cursor"],
				getSettings: async () => ({}),
				check: (id, o) => probe.check(id, undefined, undefined, undefined, o),
			} as Parameters<typeof harnessRefreshPort>[0],
			{ readLimits: async () => null } as unknown as Parameters<typeof harnessRefreshPort>[1],
		);
		svc = new HarnessRefreshService(p);
		await svc.pass();
		const all = await svc.checkAll();
		expect(mocks.probeHarness.mock.calls.map((c) => c[0])).toEqual(["codex", "codex"]);
		expect(mocks.probeHarness.mock.calls[0]?.[1]).toMatchObject({ requireIsolation: true });
		expect(all.map((r) => r.id)).toEqual(["codex"]);
		expect(models.checked("cursor")).toEqual(before);
	});

	it("a no-answer after a pass keeps answers-acp, with the failed try beside it", async () => {
		const models = new HarnessModelsService();
		const probe = new HarnessProbeService(models);
		mocks.probeHarness.mockReset();
		mocks.probeHarness
			.mockResolvedValueOnce(answered("codex"))
			.mockResolvedValueOnce({
				id: "codex",
				outcome: "no-answer",
				detail: "no answer",
				hard: false,
			});
		const { p } = port({ check: (id) => probe.check(id) });
		svc = new HarnessRefreshService(p);
		await svc.pass();
		const passAt = models.checked("codex")?.at;
		vi.setSystemTime(new Date("2026-11-26T10:15:00Z"));
		await svc.pass();
		expect(models.checked("codex")).toMatchObject({
			outcome: "answers-acp",
			at: passAt,
			lastTry: {
				at: "2026-11-26T10:15:00.000Z",
				outcome: "no-answer",
				detail: "no answer",
			},
		});
	});
});
