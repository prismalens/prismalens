// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { ALWAYS_ALLOW_MAX } from "@prismalens/contracts";
import { describe, expect, it, vi } from "vitest";
import type { PrismaService } from "../../core/prisma/prisma.service.js";
import type { OverlayService } from "../overlay/overlay.service.js";
import type { SettingsService } from "../../core/settings/settings.service.js";
import type { TimelineService } from "../timeline/timeline.service.js";
import { InvestigationsService } from "../investigations/investigations.service.js";
import { allowedAsks, withAsk } from "./allowed-asks.js";

describe("a schedule's remembered asks (#1020 R33)", () => {
	it("reads nothing from unreadable or malformed text", () => {
		expect(allowedAsks(null)).toEqual([]);
		expect(allowedAsks("{not json")).toEqual([]);
		expect(allowedAsks('[{"kind":1}]')).toEqual([]);
	});

	it("adds an ask once, newest last, and drops the oldest past the cap", () => {
		const one = withAsk(null, { kind: "execute", title: "npm test" });
		expect(allowedAsks(withAsk(one, { kind: "execute", title: "npm test" }))).toHaveLength(1);
		let json: string | null = null;
		for (let i = 0; i <= ALWAYS_ALLOW_MAX; i++)
			json = withAsk(json, { kind: "execute", title: `cmd ${i}` });
		const all = allowedAsks(json);
		expect(all).toHaveLength(ALWAYS_ALLOW_MAX);
		expect(all[0]?.title).toBe("cmd 1");
		expect(all.at(-1)?.title).toBe(`cmd ${ALWAYS_ALLOW_MAX}`);
	});
});

describe("InvestigationsService.rememberAsk (#1020 R33)", () => {
	function service(run: { scheduleId: string | null } | null, events: unknown[]) {
		const tx = {
			schedule: {
				findUnique: vi.fn(async () => ({ alwaysAllow: null })),
				update: vi.fn(async () => ({})),
			},
		};
		const prisma = {
			investigation: { findUnique: vi.fn(async () => run) },
			$transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
		};
		const svc = new InvestigationsService(
			prisma as unknown as PrismaService,
			{} as TimelineService,
			{} as OverlayService,
			{} as SettingsService,
			{} as never,
		);
		vi.spyOn(svc, "allEvents").mockResolvedValue(events as never);
		return { svc, tx };
	}
	const ask = { kind: "permission_ask", askId: "ask-1", title: "npm test", toolKind: "execute" };

	it("stores the ask as the run's own events show it, on the run's schedule", async () => {
		const { svc, tx } = service({ scheduleId: "sch-1" }, [ask]);
		expect(await svc.rememberAsk("inv-1", "ask-1")).toBe("remembered");
		expect(tx.schedule.update).toHaveBeenCalledWith({
			where: { id: "sch-1" },
			data: { alwaysAllow: JSON.stringify([{ kind: "execute", title: "npm test" }]) },
		});
	});

	it("stores nothing for a run with no schedule, an ask it never made, or an over-long title", async () => {
		for (const [run, events, id] of [
			[{ scheduleId: null }, [ask], "ask-1"],
			[{ scheduleId: "sch-1" }, [ask], "ask-2"],
			[{ scheduleId: "sch-1" }, [{ ...ask, title: "x".repeat(501) }], "ask-1"],
		] as const) {
			const { svc, tx } = service(run, [...events]);
			expect(await svc.rememberAsk("inv-1", id)).toBe("unknown");
			expect(tx.schedule.update).not.toHaveBeenCalled();
		}
	});
});
