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
		const one = withAsk(null, { kind: "execute", identity: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" });
		expect(allowedAsks(withAsk(one, { kind: "execute", identity: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }))).toHaveLength(1);
		// A list from before identities (titles) reads as none.
		expect(allowedAsks('[{"kind":"execute","title":"npm test"}]')).toEqual([]);
		let json: string | null = null;
		for (let i = 0; i <= ALWAYS_ALLOW_MAX; i++)
			json = withAsk(json, { kind: "execute", identity: i.toString(16).padStart(64, "0") });
		const all = allowedAsks(json);
		expect(all).toHaveLength(ALWAYS_ALLOW_MAX);
		expect(all[0]?.identity).toBe((1).toString(16).padStart(64, "0"));
		expect(all.at(-1)?.identity).toBe(ALWAYS_ALLOW_MAX.toString(16).padStart(64, "0"));
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
	const ask = { kind: "permission_ask", askId: "ask-1", title: "Run command", toolKind: "execute", identity: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" };

	it("stores the ask as the run's own events show it, on the run's schedule", async () => {
		const { svc, tx } = service({ scheduleId: "sch-1" }, [ask]);
		expect(await svc.rememberAsk("inv-1", "ask-1")).toBe("remembered");
		expect(tx.schedule.update).toHaveBeenCalledWith({
			where: { id: "sch-1" },
			data: { alwaysAllow: JSON.stringify([{ kind: "execute", identity: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }]) },
		});
	});

	it("stores nothing for a run with no schedule, an ask it never made, or an ask nothing stable names (CP4 OBJ-011)", async () => {
		const { identity: _none, ...unnamed } = ask;
		for (const [run, events, id] of [
			[{ scheduleId: null }, [ask], "ask-1"],
			[{ scheduleId: "sch-1" }, [ask], "ask-2"],
			[{ scheduleId: "sch-1" }, [unnamed], "ask-1"],
			[{ scheduleId: "sch-1" }, [{ ...ask, identity: "not-a-hash" }], "ask-1"],
		] as const) {
			const { svc, tx } = service(run, [...events]);
			expect(await svc.rememberAsk("inv-1", id)).toBe("unknown");
			expect(tx.schedule.update).not.toHaveBeenCalled();
		}
	});
});
