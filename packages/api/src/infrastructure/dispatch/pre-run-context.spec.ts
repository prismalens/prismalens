// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	CONTEXT_DIR,
	readPreRunContext,
	snapshotWindow,
	writePreRunContext,
} from "./pre-run-context.js";

const NOW = new Date("2026-10-24T10:00:00Z");
const WINDOW = { start: new Date("2026-10-24T09:00:00Z"), end: NOW };

let runDir: string;
beforeEach(() => {
	runDir = mkdtempSync(join(os.tmpdir(), "pl-prerun-"));
});
afterEach(() => rmSync(runDir, { recursive: true, force: true }));

describe("the run's context folder (#848 ruling 2026-10-24)", () => {
	it("writes the snapshot, past incidents and runbooks beside the checkout, and an index the prompt names", () => {
		const ctx = writePreRunContext(runDir, {
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
		const dir = join(runDir, CONTEXT_DIR);
		expect(ctx.dir).toBe(dir);
		expect(ctx.files.map((f) => f.name)).toEqual([
			"telemetry-prometheus-1.json",
			"past-incidents.json",
			"runbooks.md",
		]);
		const snap = readFileSync(join(dir, "telemetry-prometheus-1.json"), "utf8");
		expect(snap).toContain("[redacted]");
		expect(snap).not.toContain("tok-123456");
		expect(JSON.parse(snap).window).toEqual({ start: "2026-10-24T09:00:00.000Z", end: "2026-10-24T10:00:00.000Z" });
		expect(readFileSync(join(dir, "runbooks.md"), "utf8")).toContain("Path: repo/runbooks/checkout.md");
		expect(ctx.sources).toEqual([
			expect.objectContaining({ label: "prod prom", status: "found", file: "telemetry-prometheus-1.json" }),
			{ kind: "loki", label: "LOKI_URL", from: "env", status: "skipped", detail: "the source did not answer in time" },
		]);
		expect(readPreRunContext(runDir)).toEqual(ctx);
	});

	it("with every source skipped it still writes an index naming them, and no telemetry file", () => {
		const ctx = writePreRunContext(runDir, {
			window: WINDOW,
			telemetry: [{ kind: "prometheus", label: "p", from: "set", status: "skipped", reason: "credential missing" }],
			pastIncidents: [],
			runbooks: [],
			now: NOW,
		});
		expect(ctx.files).toEqual([]);
		expect(existsSync(join(runDir, CONTEXT_DIR, "index.json"))).toBe(true);
		expect(ctx.sources[0]).toMatchObject({ status: "skipped", detail: "credential missing" });
	});

	it("a rewrite replaces the folder, so a retried run never keeps an older fetch", () => {
		writePreRunContext(runDir, {
			window: WINDOW,
			telemetry: [{ kind: "loki", label: "l", from: "set", status: "found", part: { summary: "x", data: {}, count: 1 }, secrets: [] }],
			pastIncidents: [],
			runbooks: [],
			now: NOW,
		});
		writePreRunContext(runDir, { window: WINDOW, telemetry: [], pastIncidents: [], runbooks: [], now: NOW });
		expect(existsSync(join(runDir, CONTEXT_DIR, "telemetry-loki-1.json"))).toBe(false);
	});

	it("reading back keeps the folder this run's dir names, whatever the file claims", () => {
		writePreRunContext(runDir, { window: WINDOW, telemetry: [], pastIncidents: [], runbooks: [], now: NOW });
		const index = join(runDir, CONTEXT_DIR, "index.json");
		writeFileSync(index, JSON.stringify({ ...JSON.parse(readFileSync(index, "utf8")), dir: "/etc" }));
		expect(readPreRunContext(runDir)?.dir).toBe(join(runDir, CONTEXT_DIR));
		writeFileSync(index, "{not json");
		expect(readPreRunContext(runDir)).toBeNull();
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
});
