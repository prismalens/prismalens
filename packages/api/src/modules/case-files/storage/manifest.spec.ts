// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/** The manifest chain over a temp workspace and a migrated SQLite database. */
import { randomBytes, randomUUID } from "node:crypto";
import { readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { TokenVault } from "@prismalens/integrations";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { CredentialsService } from "../../integrations/crypto/credentials.service.js";

const env = await vi.hoisted(async () => {
	const fs = await import("node:fs");
	const os = await import("node:os");
	const path = await import("node:path");
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "pl-case-manifest-"));
	process.env.PRISMALENS_WORKSPACE_DIR = path.join(root, "data");
	return { root };
});

const { PrismaService } = await import("../../../core/prisma/prisma.service.js");
const { ArtifactStore, casesDir } = await import("./artifact-store.js");
const { ManifestService, artifactEntryBody } = await import("./manifest.js");

const vault = new TokenVault(randomBytes(32));
const credentials = { getVault: () => vault } as unknown as CredentialsService;
const IDENTITY = {
	kubeContext: "kind",
	cluster: "https://k",
	kubeUser: "admin",
	whoami: null,
	matchesBinding: true,
};
const TARGET = { kubeContext: "kind", cluster: "https://k", namespace: "shop" };

describe("ManifestService", () => {
	let prisma: InstanceType<typeof PrismaService>;
	let store: InstanceType<typeof ArtifactStore>;
	let manifest: InstanceType<typeof ManifestService>;

	/** One capture with `n` artifacts, each appended as WU4a will: row + entry in one chained transaction. */
	async function captureWith(n: number): Promise<string> {
		const now = new Date("2026-10-15T10:00:00Z");
		const c = await prisma.capture.create({
			data: {
				checklistVersion: 1,
				canonicalQuery: "{}",
				queryDigest: randomUUID(),
				kubeContext: "kind",
				cluster: "https://k",
				namespace: "shop",
				caseStartedAt: now,
				dueAt: now,
			},
		});
		await Promise.all(
			Array.from({ length: n }, async (_, seq) => {
				const raw = Buffer.from(`{"items":[${seq}]}`);
				const { storedBytes, ...digests } = await store.write(c.id, seq, raw, raw);
				await manifest.transaction(async (tx) => {
					const row = await tx.captureArtifact.create({
						data: {
							captureId: c.id,
							seq,
							purpose: "events",
							command: JSON.stringify(["get", "events", "-o", "json"]),
							retrieval: "complete",
							exitCode: 0,
							startedAt: now,
							endedAt: now,
							redactions: "{}",
							...digests,
						},
					});
					await tx.capture.update({
						where: { id: c.id },
						data: { bytesStored: { increment: storedBytes } },
					});
					await manifest.append(
						tx,
						artifactEntryBody(row, { target: TARGET, identity: IDENTITY, recordedAt: now }),
					);
				});
			}),
		);
		return c.id;
	}

	beforeAll(async () => {
		const { resolveMigrationsDir, runMigrations } = await import("@prismalens/database/migrator");
		await runMigrations({ migrationsDir: resolveMigrationsDir(), log: () => {} });
		prisma = new PrismaService();
		await prisma.$connect();
		store = new ArtifactStore(prisma, credentials);
		manifest = new ManifestService(prisma, store);
	});

	afterAll(async () => {
		await prisma?.$disconnect();
		rmSync(env.root, { recursive: true, force: true });
	});

	it("keeps concurrent appends one chain that verifies", async () => {
		const a = await captureWith(4);
		const b = await captureWith(3);
		const entries = await prisma.manifestEntry.findMany({ orderBy: { seq: "asc" } });
		expect(entries).toHaveLength(7);
		entries.forEach((e, i) => expect(e.prevDigest).toBe(i === 0 ? "" : entries[i - 1]?.digest));
		expect(await manifest.verify([a, b])).toEqual({ ok: true, entries: 7, expired: 0 });
	});

	it("breaks on a changed artifact row and on a changed redacted byte; an expired artifact is counted", async () => {
		const rowEdit = await captureWith(1);
		await prisma.captureArtifact.updateMany({ where: { captureId: rowEdit }, data: { retrieval: "partial" } });
		expect((await manifest.verify([rowEdit])).brokenAt).toMatchObject({ check: "metadata" });

		const fileEdit = await captureWith(1);
		const path = join(casesDir(), fileEdit, "0.redacted");
		const bytes = readFileSync(path);
		bytes[0] = (bytes[0] ?? 0) ^ 0x01;
		writeFileSync(path, bytes);
		expect((await manifest.verify([fileEdit])).brokenAt).toMatchObject({ check: "file" });

		const gone = await captureWith(2);
		await store.expire(gone);
		expect(await manifest.verify([gone])).toEqual({ ok: true, entries: 2, expired: 2 });
	});

	it("has no update or delete path on the append-only tables outside specs", () => {
		const root = join(import.meta.dirname, "..");
		const files = (readdirSync(root, { recursive: true }) as string[])
			.filter((f) => f.endsWith(".ts") && !f.endsWith(".spec.ts"))
			.map((f) => join(root, f));
		const forbidden = /(claimRevision|manifestEntry)\.(update|delete)/;
		const hits = files.filter((f) => forbidden.test(readFileSync(f, "utf8")));
		expect(hits.map((f) => relative(root, f))).toEqual([]);
	});
});
