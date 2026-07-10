// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
	CanonicalEvent,
	InvestigationReport,
} from "@prismalens/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSessionManager, type GroupRecord } from "./session.js";

/** Read a group's row + its alerts back out of the raw db (not on the interface). */
async function readGroup(baseDir: string, runId: string) {
	const { DatabaseSync } = await import("node:sqlite");
	const db = new DatabaseSync(join(baseDir, "prismalens.db"));
	try {
		const group = db.prepare("SELECT * FROM groups WHERE id = ?").get(runId) as
			| { group_key: string | null; formed_by: string }
			| undefined;
		const rows = db
			.prepare(
				"SELECT payload, late FROM group_alerts WHERE group_id = ? ORDER BY id",
			)
			.all(runId) as { payload: string; late: number }[];
		const alerts = rows
			.filter((r) => r.late === 0)
			.map((r) => JSON.parse(r.payload) as Record<string, unknown>);
		const lateAlerts = rows
			.filter((r) => r.late === 1)
			.map((r) => JSON.parse(r.payload) as Record<string, unknown>);
		return { group, alerts, lateAlerts };
	} finally {
		db.close();
	}
}

describe("SqliteSessionManager", () => {
	let baseDir: string;
	let sessions: ReturnType<typeof createSessionManager>;

	beforeEach(() => {
		baseDir = join(tmpdir(), `prismalens-test-${randomUUID()}`);
		sessions = createSessionManager(baseDir);
	});

	afterEach(async () => {
		try {
			await rm(baseDir, { recursive: true, force: true });
		} catch {}
	});

	it("1. Round-trip: create -> get/list/readEvents/readReport", async () => {
		const runId = "test-run-1";
		const record = await sessions.create({ runId, alertname: "TestAlert" });
		expect(record.runId).toBe(runId);
		expect(record.status).toBe("running");
		expect(record.alertname).toBe("TestAlert");

		const fetched = await sessions.get(runId);
		expect(fetched).toEqual(record);

		const list = await sessions.list();
		expect(list).toHaveLength(1);
		expect(list[0]).toEqual(record);

		const events = await sessions.readEvents(runId);
		expect(events).toEqual([]);

		const report = await sessions.readReport(runId);
		expect(report).toBeNull();
	});

	it("2. update: merges + stamps updated_at; throws if not found; status transitions", async () => {
		const runId = "test-run-2";
		await sessions.create({ runId });

		const updated = await sessions.update(runId, {
			status: "done",
			error: "Some error",
			completedAt: "2026-01-01T00:00:00Z",
		});

		expect(updated.status).toBe("done");
		expect(updated.error).toBe("Some error");
		expect(updated.completedAt).toBe("2026-01-01T00:00:00Z");

		const fetched = await sessions.get(runId);
		expect(fetched).toEqual(updated);
		// updated_at should be >= created_at, but we can't easily assert exactly.
		expect(updated.updatedAt >= updated.createdAt).toBe(true);

		await expect(
			sessions.update("missing-run", { status: "done" }),
		).rejects.toThrow('Session "missing-run" not found');
	});

	it("3. Event ordering: append N events -> readEvents returns in insertion order", async () => {
		const runId = "test-run-3";
		await sessions.create({ runId });

		const ev1 = { kind: "started", runId } as CanonicalEvent;
		const ev2 = { kind: "completed", runId } as CanonicalEvent;

		await sessions.appendEvent(runId, ev1);
		await sessions.appendEvent(runId, ev2);

		const events = await sessions.readEvents(runId);
		expect(events).toEqual([ev1, ev2]);
	});

	it("4. Forgiving reads: missing ids -> get/readReport=null, readEvents=[]", async () => {
		const runId = "missing-run-4";
		expect(await sessions.get(runId)).toBeNull();
		expect(await sessions.readReport(runId)).toBeNull();
		expect(await sessions.readEvents(runId)).toEqual([]);
	});

	it("5. list: created_at desc; status filter narrows correctly", async () => {
		const sessions2 = createSessionManager(baseDir); // same db

		await sessions2.create({ runId: "r1" });
		await sessions2.create({ runId: "r2" });
		await sessions2.update("r1", { status: "done" });
		await sessions2.update("r2", { status: "errored" });
		await sessions2.create({ runId: "r3" }); // status: running

		const all = await sessions2.list();
		expect(all).toHaveLength(3);
		expect(all.map((r) => r.runId)).toEqual(["r3", "r2", "r1"]); // desc order

		const doneAndError = await sessions2.list({ status: ["done", "errored"] });
		expect(doneAndError).toHaveLength(2);
		expect(doneAndError.map((r) => r.runId).sort()).toEqual(["r1", "r2"]);

		const running = await sessions2.list({ status: ["running"] });
		expect(running).toHaveLength(1);
		expect(running[0].runId).toBe("r3");
	});

	it("6. formed_by: create yields a groups row with formed_by='window'", async () => {
		const runId = "test-run-6";
		await sessions.create({ runId });

		// Verify the `groups` row directly — not on the SessionManager interface.
		const { DatabaseSync } = await import("node:sqlite");
		const db = new DatabaseSync(join(baseDir, "prismalens.db"));
		try {
			const row = db.prepare("SELECT * FROM groups WHERE id = ?").get(runId) as
				| { formed_by: string }
				| undefined;
			expect(row?.formed_by).toBe("window");
		} finally {
			db.close();
		}
	});

	it("7. RUN_ID_RE guard preserved: invalid runId throws", async () => {
		const invalid = "invalid/run/id";
		await expect(sessions.create({ runId: invalid })).rejects.toThrow(
			"Invalid runId",
		);
		await expect(sessions.get(invalid)).rejects.toThrow("Invalid runId");
		expect(() => sessions.workspaceDir(invalid)).toThrow("Invalid runId");
	});

	it("8. Migration idempotency: openDatabase twice does not throw", async () => {
		const runId = "test-run-8";
		await sessions.create({ runId });

		const sessions2 = createSessionManager(baseDir);
		const r = await sessions2.get(runId);
		expect(r?.runId).toBe(runId);
	});

	it("9. Concurrency: two SqliteSessionManager instances on same file", async () => {
		const runId1 = "r1";
		const runId2 = "r2";

		const s1 = createSessionManager(baseDir);
		const s2 = createSessionManager(baseDir);

		await s1.create({ runId: runId1 });
		await s2.create({ runId: runId2 });

		// Append concurrently
		await Promise.all([
			s1.appendEvent(runId1, {
				kind: "started",
				runId: runId1,
			} as CanonicalEvent),
			s2.appendEvent(runId2, {
				kind: "started",
				runId: runId2,
			} as CanonicalEvent),
		]);

		const ev1 = await s1.readEvents(runId1);
		expect(ev1).toHaveLength(1);

		const ev2 = await s2.readEvents(runId2);
		expect(ev2).toHaveLength(1);
	});

	it("11. writeReport upserts successfully", async () => {
		const runId = "test-run-11";
		await sessions.create({ runId });

		const report: InvestigationReport = {
			title: "R",
			summary: "S",
			findings: [],
			timeline: [],
			related_alerts: [],
		};
		await sessions.writeReport(runId, report);

		let read = await sessions.readReport(runId);
		expect(read?.title).toBe("R");

		report.title = "Updated";
		await sessions.writeReport(runId, report);

		read = await sessions.readReport(runId);
		expect(read?.title).toBe("Updated");
	});

	it("12. group round-trip: persists group_key, formed_by, and formative alert order", async () => {
		const runId = "grp-run-12";
		const rec: GroupRecord = {
			groupKey: '{}:{alertname="A", service="web"}',
			formedBy: "window",
			alerts: [{ fingerprint: "a1" }, { fingerprint: "a2" }],
			lateAlerts: [],
		};
		await sessions.writeGroupRecord(runId, rec);

		const g = await readGroup(baseDir, runId);
		expect(g.group?.group_key).toBe('{}:{alertname="A", service="web"}');
		expect(g.group?.formed_by).toBe("window");
		expect(g.alerts).toEqual([{ fingerprint: "a1" }, { fingerprint: "a2" }]);
		expect(g.lateAlerts).toEqual([]);
	});

	it("13. formed_by comes from the record, not a hardcoded default", async () => {
		const runId = "grp-run-13";
		await sessions.writeGroupRecord(runId, {
			groupKey: "k",
			formedBy: "overlay",
			alerts: [{ fingerprint: "a1" }],
			lateAlerts: [],
		});

		const g = await readGroup(baseDir, runId);
		expect(g.group?.formed_by).toBe("overlay");
	});

	it("14. appendGroupAlert: late alerts land after formative ones, in arrival order", async () => {
		const runId = "grp-run-14";
		await sessions.writeGroupRecord(runId, {
			groupKey: "k",
			formedBy: "window",
			alerts: [{ fingerprint: "f1" }],
			lateAlerts: [],
		});
		await sessions.appendGroupAlert(runId, { fingerprint: "late-1" });
		await sessions.appendGroupAlert(runId, { fingerprint: "late-2" });

		const g = await readGroup(baseDir, runId);
		expect(g.alerts).toEqual([{ fingerprint: "f1" }]);
		expect(g.lateAlerts).toEqual([
			{ fingerprint: "late-1" },
			{ fingerprint: "late-2" },
		]);

		await expect(
			sessions.appendGroupAlert("no-such-group", { fingerprint: "x" }),
		).rejects.toThrow(
			"Cannot append alert to missing group for run no-such-group",
		);
	});

	it("15. writeGroupRecord is idempotent: re-writing replaces alerts, no duplicates", async () => {
		const runId = "grp-run-15";
		await sessions.writeGroupRecord(runId, {
			groupKey: "k1",
			formedBy: "window",
			alerts: [{ fingerprint: "a1" }],
			lateAlerts: [{ fingerprint: "l1" }],
		});
		await sessions.writeGroupRecord(runId, {
			groupKey: "k2",
			formedBy: "window",
			alerts: [{ fingerprint: "b1" }, { fingerprint: "b2" }],
			lateAlerts: [],
		});

		const g = await readGroup(baseDir, runId);
		expect(g.group?.group_key).toBe("k2");
		expect(g.alerts).toEqual([{ fingerprint: "b1" }, { fingerprint: "b2" }]);
		expect(g.lateAlerts).toEqual([]);
	});
});
