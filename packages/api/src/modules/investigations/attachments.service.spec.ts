// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AttachmentsService } from "./attachments.service.js";

const INCIDENT = "11111111-1111-4111-8111-111111111111";

describe("AttachmentsService (R4.3)", () => {
	let dir: string;
	let rows: Record<string, unknown>[];
	const timeline = { create: vi.fn(async () => ({})) };
	const prisma = {
		incident: { findUnique: vi.fn(async () => ({ id: INCIDENT })) },
		attachment: {
			findFirst: vi.fn(async ({ where }: { where: Record<string, string> }) =>
				rows.find((r) => Object.entries(where).every(([k, v]) => r[k] === v)) ?? null,
			),
			findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
				rows.filter((r) => where.id.in.includes(r.id as string)),
			),
			create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
				const row = { id: `a000000${rows.length}-0000-4000-8000-000000000000`, createdAt: new Date(), ...data };
				rows.push(row);
				return row;
			}),
		},
	};
	const service = () => new AttachmentsService(prisma as never, timeline as never);

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "pl-attach-"));
		vi.stubEnv("PRISMALENS_WORKSPACE_DIR", dir);
		rows = [];
		timeline.create.mockClear();
	});
	afterEach(() => {
		vi.unstubAllEnvs();
		rmSync(dir, { recursive: true, force: true });
	});

	it("stores a text file outside any run, notes it on the timeline, and hands a job its path", async () => {
		const made = await service().upload(INCIDENT, new File(["14:02 pool exhausted\n"], "app.log", { type: "" }));
		expect(made).toMatchObject({ name: "app.log", mimeType: "text/plain", size: 21 });
		expect(timeline.create).toHaveBeenCalledWith(expect.objectContaining({ title: "Attached app.log", source: "user" }));
		const [job] = await service().forJob(INCIDENT, [made.id]);
		expect(job?.path.startsWith(dir)).toBe(true);
		expect(existsSync(job?.path ?? "")).toBe(true);
		expect(readFileSync(job?.path ?? "", "utf8")).toBe("14:02 pool exhausted\n");
	});

	it("keeps one row for the same bytes on one incident", async () => {
		const a = await service().upload(INCIDENT, new File(["x"], "a.txt", { type: "text/plain" }));
		const b = await service().upload(INCIDENT, new File(["x"], "b.txt", { type: "text/plain" }));
		expect(b.id).toBe(a.id);
		expect(rows).toHaveLength(1);
	});

	it("refuses an image over 4 MB with 413 and a PDF with 415", async () => {
		const big = new File([new Uint8Array(4 * 1024 * 1024 + 1)], "panel.png", { type: "image/png" });
		await expect(service().upload(INCIDENT, big)).rejects.toMatchObject({
			code: "PAYLOAD_TOO_LARGE",
			message: "Images up to 4 MB",
		});
		await expect(
			service().upload(INCIDENT, new File(["%PDF"], "report.pdf", { type: "application/pdf" })),
		).rejects.toMatchObject({ code: "UNSUPPORTED_MEDIA_TYPE" });
		expect(rows).toHaveLength(0);
	});

	it("refuses an id that is not on the incident", async () => {
		await expect(service().forJob(INCIDENT, ["22222222-2222-4222-8222-222222222222"])).rejects.toMatchObject({
			code: "BAD_REQUEST",
		});
	});
});
