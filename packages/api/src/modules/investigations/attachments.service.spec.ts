// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
			delete: vi.fn(async ({ where }: { where: { id: string } }) => {
				rows = rows.filter((r) => r.id !== where.id);
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

	const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]);

	it("types an image by its bytes, and refuses bytes that are not the image or text they claim (R4.3)", async () => {
		const shot = await service().upload(INCIDENT, new File([PNG], "panel.jpg", { type: "image/jpeg" }));
		expect(shot.mimeType).toBe("image/png");
		await expect(
			service().upload(INCIDENT, new File(["<script>x</script>"], "panel.png", { type: "image/png" })),
		).rejects.toMatchObject({ code: "UNSUPPORTED_MEDIA_TYPE", message: "That file is not a PNG, JPEG, WebP or GIF image." });
		await expect(
			service().upload(INCIDENT, new File([new Uint8Array([0xff, 0xfe, 0x00, 0xc3])], "page.html", { type: "text/html" })),
		).rejects.toMatchObject({ code: "UNSUPPORTED_MEDIA_TYPE", message: "That file is not UTF-8 text." });
		expect(rows).toHaveLength(1);
	});

	it("keeps no row when the file cannot be written, and the same bytes upload once the disk is back", async () => {
		writeFileSync(join(dir, "attachments"), "not a directory");
		await expect(service().upload(INCIDENT, new File(["x"], "a.txt", { type: "text/plain" }))).rejects.toThrow();
		expect(rows).toHaveLength(0);
		rmSync(join(dir, "attachments"));
		const made = await service().upload(INCIDENT, new File(["x"], "a.txt", { type: "text/plain" }));
		const [job] = await service().forJob(INCIDENT, [made.id]);
		expect(readFileSync(job?.path ?? "", "utf8")).toBe("x");
	});

	it("writes the bytes again when the same upload finds its row without a file", async () => {
		const made = await service().upload(INCIDENT, new File(["x"], "a.txt", { type: "text/plain" }));
		rmSync(join(dir, "attachments", made.id));
		const again = await service().upload(INCIDENT, new File(["x"], "a.txt", { type: "text/plain" }));
		expect(again.id).toBe(made.id);
		expect(readFileSync(join(dir, "attachments", made.id), "utf8")).toBe("x");
	});

	it("refuses an id that is not on the incident", async () => {
		await expect(service().forJob(INCIDENT, ["22222222-2222-4222-8222-222222222222"])).rejects.toMatchObject({
			code: "BAD_REQUEST",
		});
	});
});
