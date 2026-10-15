// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/** Artifact files over a temp workspace and a migrated SQLite database. */
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { TokenVault } from "@prismalens/integrations";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { CredentialsService } from "../../integrations/crypto/credentials.service.js";

const env = await vi.hoisted(async () => {
	const fs = await import("node:fs");
	const os = await import("node:os");
	const path = await import("node:path");
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "pl-case-store-"));
	process.env.PRISMALENS_WORKSPACE_DIR = path.join(root, "data");
	return { root };
});

const { PrismaService } = await import("../../../core/prisma/prisma.service.js");
const { ArtifactStore, casesDir, sha256Hex } = await import("./artifact-store.js");

const credentials = {
	getVault: () => vault,
} as unknown as CredentialsService;
const vault = new TokenVault(randomBytes(32));

describe("ArtifactStore", () => {
	let prisma: InstanceType<typeof PrismaService>;
	let store: InstanceType<typeof ArtifactStore>;
	let bindingId: string;

	async function capture(createdAt: Date, bytesStored: number) {
		const c = await prisma.capture.create({
			data: {
				bindingId,
				checklistVersion: 1,
				canonicalQuery: "{}",
				queryDigest: randomUUID(),
				kubeContext: "kind",
				cluster: "https://k",
				namespace: "shop",
				state: "complete",
				caseStartedAt: createdAt,
				dueAt: createdAt,
				createdAt,
				bytesStored,
			},
		});
		const raw = Buffer.from("x");
		const { storedBytes: _stored, ...digests } = await store.write(c.id, 0, raw, raw);
		await prisma.captureArtifact.create({
			data: {
				captureId: c.id,
				seq: 0,
				purpose: "events",
				command: "[]",
				retrieval: "complete",
				startedAt: createdAt,
				endedAt: createdAt,
				redactions: "{}",
				...digests,
			},
		});
		return c.id;
	}

	beforeAll(async () => {
		const { resolveMigrationsDir, runMigrations } = await import("@prismalens/database/migrator");
		await runMigrations({ migrationsDir: resolveMigrationsDir(), log: () => {} });
		prisma = new PrismaService();
		await prisma.$connect();
		store = new ArtifactStore(prisma, credentials);
		const service = await prisma.service.create({ data: { name: "checkout" } });
		const binding = await prisma.serviceBinding.create({
			data: {
				serviceId: service.id,
				kubeContext: "kind",
				cluster: "https://k",
				namespace: "shop",
				detected: "{}",
				confirmedAt: new Date(),
			},
		});
		bindingId = binding.id;
	});

	afterAll(async () => {
		await prisma?.$disconnect();
		rmSync(env.root, { recursive: true, force: true });
	});

	it("keeps raw bytes exact through the vault, files 0600, and reads the redacted copy capped", async () => {
		const captureId = randomUUID();
		const raw = Buffer.from([0xff, 0xfe, 0x41, 0x00, 0xc3]);
		const redacted = Buffer.from("hello world");
		const out = await store.write(captureId, 3, raw, redacted);
		expect(out).toMatchObject({
			rawSha256: sha256Hex(raw),
			rawBytes: 5,
			redactedSha256: sha256Hex(redacted),
			redactedBytes: 11,
		});
		const ref = { captureId, seq: 3, expiredAt: null };
		expect((await store.readRaw(ref)).equals(raw)).toBe(true);
		expect(await store.readRedacted(ref, 5)).toEqual({ text: "hello", truncated: true });
		for (const name of ["3.raw.enc", "3.redacted"])
			expect(statSync(join(casesDir(), captureId, name)).mode & 0o777).toBe(0o600);

		const withheld = await store.write(captureId, 4, raw, null);
		expect(withheld).toMatchObject({ redactedSha256: sha256Hex(""), redactedBytes: 0 });
		expect(await store.readRedacted({ captureId, seq: 4, expiredAt: null }, 10)).toBeNull();
		await expect(store.write("../x", 0, raw, null)).rejects.toThrow("unsafe capture id");
	});

	it("sweeps the oldest first past budget and age, keeping rows", async () => {
		const now = new Date("2026-10-15T00:00:00Z");
		const old = await capture(new Date("2026-09-01T00:00:00Z"), 10);
		const big = await capture(new Date("2026-10-10T00:00:00Z"), 300 * 1024 * 1024);
		const fresh = await capture(new Date("2026-10-14T00:00:00Z"), 10);

		expect(await store.sweep(bindingId, now)).toEqual([old, big]);
		expect(existsSync(join(casesDir(), old))).toBe(false);
		expect(existsSync(join(casesDir(), fresh))).toBe(true);
		const rows = await prisma.captureArtifact.findMany({ where: { captureId: { in: [old, big, fresh] } } });
		expect(rows).toHaveLength(3);
		expect(rows.filter((r) => r.expiredAt).map((r) => r.captureId).sort()).toEqual([old, big].sort());
		expect(await store.readRedacted(rows.find((r) => r.captureId === old) ?? rows[0], 10)).toBeNull();
	});
});
