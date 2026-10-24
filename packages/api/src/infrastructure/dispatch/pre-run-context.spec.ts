// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { buildPreRunSnapshot, parseStoredSnapshot, snapshotWindow } from "./pre-run-context.js";

const NOW = new Date("2026-10-24T10:00:00Z");
const WINDOW = { start: new Date("2026-10-24T09:00:00Z"), end: NOW };

describe("the run's pre-run snapshot (#848)", () => {
	it("holds the snapshot, past incidents and runbooks as scrubbed files, and reads back as stored", () => {
		const ctx = buildPreRunSnapshot({
			window: WINDOW,
			telemetry: [
				{
					kind: "prometheus",
					label: "prod prom",
					from: "set",
					status: "found",
					part: { summary: "2 rule alerts", data: { alerts: [{ token: "tok-123456" }] }, count: 1 },
					secrets: ["tok-123456"],
				},
				{ kind: "loki", label: "LOKI_URL", from: "env", status: "skipped", reason: "the source did not answer in time" },
			],
			pastIncidents: [{ reference: "INC-7", title: "pool exhausted" } as never],
			runbooks: [
				{
					title: "checkout",
					path: "repo/runbooks/checkout.md",
					service: "checkout",
					matchedBy: "runbooks/",
					origin: "repo",
				},
			],
			now: NOW,
		});
		expect(ctx.files.map((f) => f.name)).toEqual([
			"telemetry-prometheus-1.json",
			"past-incidents.json",
			"runbooks.md",
		]);
		const text = (name: string) => ctx.files.find((f) => f.name === name)?.text ?? "";
		const snap = text("telemetry-prometheus-1.json");
		expect(snap).toContain("[redacted]");
		expect(snap).not.toContain("tok-123456");
		expect(JSON.parse(snap).window).toEqual({ start: "2026-10-24T09:00:00.000Z", end: "2026-10-24T10:00:00.000Z" });
		expect(text("runbooks.md")).toContain("Path: repo/runbooks/checkout.md");
		expect(ctx.sources).toEqual([
			expect.objectContaining({ label: "prod prom", status: "found", file: "telemetry-prometheus-1.json" }),
			{ kind: "loki", label: "LOKI_URL", from: "env", status: "skipped", detail: "the source did not answer in time" },
		]);
		expect(parseStoredSnapshot(JSON.stringify(ctx))).toEqual(ctx);
	});

	it("with every source skipped it still names them, and holds no telemetry file", () => {
		const ctx = buildPreRunSnapshot({
			window: WINDOW,
			telemetry: [{ kind: "prometheus", label: "p", from: "set", status: "skipped", reason: "credential missing" }],
			pastIncidents: [],
			runbooks: [],
			now: NOW,
		});
		expect(ctx.files).toEqual([]);
		expect(ctx.sources[0]).toMatchObject({ status: "skipped", detail: "credential missing" });
	});

	it("a stored text that does not parse reads as none", () => {
		expect(parseStoredSnapshot("{not json")).toBeNull();
		expect(parseStoredSnapshot(JSON.stringify({ fetchedAt: "x" }))).toBeNull();
	});

	it("the window starts half an hour before the first alert, at most six hours back", () => {
		const alert = (startsAt: string | null) => ({ alertname: "a", severity: null, labels: {}, annotations: {}, startsAt });
		expect(snapshotWindow([alert("2026-10-24T09:20:00Z"), alert(null)], NOW, "checkout")).toEqual({
			start: new Date("2026-10-24T08:50:00Z"),
			end: NOW,
			service: "checkout",
		});
		expect(snapshotWindow([alert("2026-10-20T00:00:00Z")], NOW).start).toEqual(new Date("2026-10-24T04:00:00Z"));
		expect(snapshotWindow([alert(null)], NOW).start).toEqual(new Date("2026-10-24T09:00:00Z"));
	});

	it("200 log lines of 1,000 three-byte characters stay under 262,144 bytes, with truncated recorded", () => {
		const euro = "\u20AC";
		const line = euro.repeat(1000);
		const ctx = writePreRunContext(runDir, {
			window: WINDOW,
			telemetry: [
				{
					kind: "loki",
					label: "loki-prod",
					from: "set",
					status: "found",
					part: {
						summary: "200 lines",
						data: {
							result: [
								{
									stream: { service: "checkout" },
									values: Array.from({ length: 200 }, (_, i) => [String(i), line]),
								},
							],
						},
						count: 200,
					},
					secrets: [],
				},
			],
			pastIncidents: [],
			runbooks: [],
			now: NOW,
		});
		const file = join(runDir, CONTEXT_DIR, "telemetry-loki-1.json");
		const content = readFileSync(file);
		expect(content.byteLength).toBeLessThanOrEqual(262_144);
		expect(ctx.sources[0]?.truncated).toEqual({
			dropped: expect.any(Number),
			reason: "the 256 KiB snapshot limit",
		});
		expect(ctx.sources[0]?.truncated?.dropped).toBeGreaterThan(0);
	});
});
