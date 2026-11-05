// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { REFERENCE_KINDS } from "@prismalens/contracts";
import { insideRoot, lastAnswer, RecordsProvider } from "./records.provider.js";

const RUN = "6a3b1c2d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const INC = "8c8b1c0e-0d55-4f27-9f0a-3e7d1d1b6b11";
const SVC = "1d2e3f40-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
const REPO = "2e3f4051-6b7c-4d8e-9fa0-1b2c3d4e5f60";
const SCH = "3f405162-7c8d-4e9f-a0b1-2c3d4e5f6071";
const ATT = "40516273-8d9e-4fa0-b1c2-3d4e5f607182";
const ALERT = "51627384-9eaf-4ab1-82d3-4e5f60718293";
const base = { runId: RUN, branchId: "run", path: [], label: null, ts: "2026-11-07T10:00:00.000Z" };

function prisma() {
	const ev = (e: Record<string, unknown>) => ({ event: JSON.stringify({ ...base, ...e }) });
	return {
		investigation: {
			findMany: vi.fn(async () => [{ id: RUN, title: "Checkout slow", status: "running", kind: "chat" }]),
			findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
				where.id === RUN
					? {
							id: RUN,
							title: "Checkout slow",
							status: "running",
							incidentId: INC,
							repositoryId: REPO,
							serviceId: SVC,
							scheduleId: SCH,
							summary: null,
						}
					: null,
			),
		},
		incident: {
			findMany: vi.fn(async () => [{ id: INC, number: 7, title: "Checkout p99", status: "triggered" }]),
			findFirst: vi.fn(async ({ where }: { where: { number: number } }) =>
				where.number === 7 ? { id: INC, number: 7, title: "Checkout p99", status: "triggered" } : null,
			),
			findUnique: vi.fn(async () => ({
				id: INC,
				number: 7,
				title: "Checkout p99",
				severity: "high",
				status: "triggered",
				investigations: [{ rootCause: "Pool exhausted after deploy" }],
			})),
		},
		service: {
			findMany: vi.fn(async () => [{ id: SVC, name: "checkout-api", displayName: "Checkout" }]),
			findUnique: vi.fn(async () => ({
				id: SVC,
				name: "checkout-api",
				displayName: "Checkout",
				repositories: [{ repository: { fullName: "acme/shop", url: "https://github.com/acme/shop" } }],
			})),
		},
		repository: {
			findMany: vi.fn(async () => [{ id: REPO, fullName: "acme/shop", url: "https://github.com/acme/shop" }]),
			findUnique: vi.fn(async () => ({ id: REPO, fullName: "acme/shop", url: "https://github.com/acme/shop" })),
		},
		schedule: {
			findMany: vi.fn(async () => [{ id: SCH, name: "Nightly check", enabled: false }]),
			findUnique: vi.fn(async () => ({ id: SCH, name: "Nightly check", brief: "Check the pool", recurrence: "0 2 * * *" })),
		},
		attachment: {
			findMany: vi.fn(async () => [{ id: ATT, name: "app.log", mimeType: "text/plain" }]),
			findUnique: vi.fn(async () => ({ id: ATT, name: "app.log", mimeType: "text/plain", size: 20, investigationId: RUN })),
		},
		alert: {
			findMany: vi.fn(async () => [{ id: ALERT, title: "CheckoutSlow", status: "triggered" }]),
			findUnique: vi.fn(async () => ({
				title: "CheckoutSlow",
				status: "triggered",
				severity: "high",
				labels: '{"service":"checkout-api"}',
				description: "p99 above 2s",
				triggeredAt: new Date(base.ts),
				sourceUrl: "http://prom/graph",
			})),
		},
		investigationEvent: {
			findMany: vi.fn(async () => [
				ev({
					kind: "artifact_published",
					seq: 3,
					artifact: { id: "a1", title: "Latency chart", html: "<p/>", at: base.ts },
				}),
				ev({ kind: "agent_step", seq: 4, text: "The pool ran out.", toolCalls: [] }),
			]),
		},
	};
}

describe("RecordsProvider (#1024)", () => {
	let dir: string;
	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "pl-records-"));
		writeFileSync(join(dir, "pool.ts"), "");
	});
	afterEach(() => rmSync(dir, { recursive: true, force: true }));

	it("searches every kind it serves, grouped by kind", async () => {
		const p = new RecordsProvider(prisma() as never);
		const hits = await p.search("", {
			threadId: RUN,
			root: dir,
			kinds: REFERENCE_KINDS,
			limit: 50,
		});
		const kinds = new Set(hits.map((h) => h.ref.kind));
		for (const k of ["file", "thread", "incident", "service", "project", "schedule", "attachment", "artifact", "alert"])
			expect(kinds.has(k as never)).toBe(true);
		expect(hits.find((h) => h.ref.kind === "incident")).toMatchObject({
			ref: { label: "INC-7 Checkout p99" },
			group: "Incidents",
		});
		expect(hits.find((h) => h.ref.kind === "artifact")?.ref.id).toBe(`${RUN}/a1`);
	});

	it("finds an incident by number for #7", async () => {
		const p = new RecordsProvider(prisma() as never);
		const ctx = { root: null, kinds: ["incident"] as const, limit: 10 };
		expect(await p.byNumber(7, { ...ctx, kinds: ["incident"] })).toHaveLength(1);
		expect(await p.byNumber(8, { ...ctx, kinds: ["incident"] })).toEqual([]);
		expect(await p.byNumber(7, { ...ctx, kinds: ["thread"] })).toEqual([]);
	});

	it("snapshots each kind within bounds, naming the read tool only in scope", async () => {
		const p = new RecordsProvider(prisma() as never);
		const at = { threadId: RUN, root: dir };
		const snap = (kind: string, id: string) =>
			p.snapshot({ kind: kind as never, id, label: id }, at);
		expect(await snap("file", "pool.ts")).toMatchObject({ outOfScope: false, text: `File: ${join(dir, "pool.ts")}` });
		expect(await snap("file", "../../etc/passwd")).toMatchObject({ outOfScope: true });
		expect(await snap("incident", INC)).toMatchObject({
			readTool: "incident_get",
			text: expect.stringContaining("Cause: Pool exhausted after deploy"),
		});
		expect((await snap("thread", RUN))?.text).toContain("The pool ran out.");
		expect(await snap("service", SVC)).toMatchObject({
			outOfScope: false,
			text: expect.stringContaining("acme/shop"),
		});
		expect(await snap("project", REPO)).toMatchObject({ outOfScope: false });
		expect((await snap("schedule", SCH))?.text).toContain("Check the pool");
		expect(await snap("attachment", ATT)).toMatchObject({ readTool: "attachment_read" });
		expect((await snap("artifact", `${RUN}/a1`))?.text).toContain("Latency chart");
		expect((await snap("alert", ALERT))?.text).toContain("p99 above 2s");
		expect(await snap("command", "review")).toBeNull();
	});

	it("keeps a path inside its root, and reads the last thing the agent said", () => {
		expect(insideRoot(dir, "a/b.ts")).toBe(join(dir, "a", "b.ts"));
		expect(insideRoot(dir, "../x")).toBeNull();
		expect(
			lastAnswer([
				{ ...base, kind: "agent_step", seq: 1, text: "first", toolCalls: [] },
				{ ...base, kind: "agent_step", seq: 2, text: " ", toolCalls: [] },
			]),
		).toBe("first");
		expect(lastAnswer([])).toBeNull();
	});
});
