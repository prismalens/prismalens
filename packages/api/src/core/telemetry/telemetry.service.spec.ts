// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { afterEach, describe, expect, it, vi } from "vitest";
import type { PrismaService } from "../prisma/prisma.service.js";
import { TelemetryService, telemetryForcedOff } from "./telemetry.service.js";

function fakePrisma() {
	const rows = new Map<string, { value: string }>();
	return {
		rows,
		setting: {
			findUnique: vi.fn(async ({ where }: { where: { key: string } }) =>
				rows.get(where.key) ?? null,
			),
			upsert: vi.fn(
				async ({
					where,
					create,
				}: {
					where: { key: string };
					create: { value: string };
				}) => {
					rows.set(where.key, { value: create.value });
				},
			),
		},
	};
}

function setup() {
	const prisma = fakePrisma();
	const fetchImpl = vi.fn(
		async (_url: string, _init: RequestInit) => new Response(null, { status: 200 }),
	);
	const service = new TelemetryService(
		prisma as unknown as PrismaService,
		fetchImpl as unknown as typeof fetch,
	);
	const sent = () =>
		fetchImpl.mock.calls.map(
			([, init]) => JSON.parse(String(init.body)) as Record<string, unknown>,
		);
	return { prisma, service, fetchImpl, sent };
}

afterEach(() => vi.unstubAllEnvs());

describe("TelemetryService (#602)", () => {
	it("is off and undecided until the owner answers, and sends nothing", async () => {
		const { service, fetchImpl } = setup();
		expect(await service.getSettings()).toEqual({
			enabled: false,
			decided: false,
			forcedOff: false,
		});
		await service.capture("service_added", {});
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it("a no is remembered as decided and still sends nothing", async () => {
		const { service, fetchImpl } = setup();
		expect(await service.setEnabled(false)).toMatchObject({
			enabled: false,
			decided: true,
		});
		await service.capture("service_added", {});
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it("opting in reports setup once, then events with only the allowed fields", async () => {
		const { service, sent } = setup();
		await service.setEnabled(true);
		await service.setEnabled(false);
		await service.setEnabled(true);
		await service.capture("investigation_started", { harness: "opencode" });

		const events = sent();
		expect(events.map((e) => e.event)).toEqual([
			"setup_completed",
			"investigation_started",
		]);
		const started = events[1];
		expect(Object.keys(started).sort()).toEqual([
			"api_key",
			"distinct_id",
			"event",
			"properties",
		]);
		expect(Object.keys(started.properties as object).sort()).toEqual([
			"$process_person_profile",
			"arch",
			"harness",
			"os",
			"version",
		]);
		expect(started.distinct_id).toBe(events[0].distinct_id);
	});

	it("reports one terminal state per investigation", async () => {
		const { service, sent } = setup();
		await service.setEnabled(true);
		await service.captureFinished("inv-1", "failed");
		await service.captureFinished("inv-1", "failed");
		await service.captureFinished("inv-2", "completed");
		expect(sent().filter((e) => e.event === "investigation_finished")).toHaveLength(2);
	});

	it("PRISMALENS_TELEMETRY=off wins over an opt-in", async () => {
		const { service, fetchImpl } = setup();
		await service.setEnabled(true);
		fetchImpl.mockClear();
		vi.stubEnv("PRISMALENS_TELEMETRY", "off");
		expect(await service.getSettings()).toMatchObject({
			enabled: false,
			forcedOff: true,
		});
		await service.capture("service_added", {});
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it("never throws when the network fails", async () => {
		const { service, fetchImpl } = setup();
		await service.setEnabled(true);
		fetchImpl.mockRejectedValue(new TypeError("fetch failed"));
		await expect(service.capture("service_added", {})).resolves.toBeUndefined();
	});
});

describe("telemetryForcedOff", () => {
	it("reads off, 0 and false", () => {
		for (const v of ["off", "0", "false", "OFF"]) {
			expect(telemetryForcedOff({ PRISMALENS_TELEMETRY: v })).toBe(true);
		}
		expect(telemetryForcedOff({})).toBe(false);
		expect(telemetryForcedOff({ PRISMALENS_TELEMETRY: "on" })).toBe(false);
	});
});
