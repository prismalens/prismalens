// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/** The manifest chain over a temp workspace and a migrated SQLite database. */
import { randomBytes, randomUUID } from "node:crypto";
import { readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { TokenVault } from "@prismalens/integrations";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prismalens/database";
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
const { ManifestService, artifactEntryBody, captureEntryBody } = await import("./manifest.js");

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
				identity: JSON.stringify(IDENTITY),
				identityMatches: true,
				state: "running",
				startedAt: now,
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

	/** Ends a capture as the runner does: the row's final state, then its capture entry. */
	async function finish(captureId: string): Promise<void> {
		const finishedAt = new Date("2026-10-15T10:01:00Z");
		await manifest.transaction(async (tx) => {
			const row = await tx.capture.update({
				where: { id: captureId },
				data: { state: "complete", finishedAt },
			});
			const artifactEntries = await tx.manifestEntry.findMany({
				where: { captureId, artifactId: { not: null } },
				orderBy: { seq: "asc" },
			});
			await manifest.append(
				tx,
				captureEntryBody(row, {
					recordedAt: finishedAt,
					notRun: [],
					artifactDigests: artifactEntries.map((e) => e.digest),
				}),
			);
		});
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

	it("breaks when a manifest entry body or prevDigest is edited after dropping append-only trigger", async () => {
		const { prisma: rawPrisma } = await import("@prismalens/database");
		await rawPrisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS "manifest_entries_append_only"');

		const bodyEditCap = await captureWith(1);
		const bodyEntry = await prisma.manifestEntry.findFirstOrThrow({ where: { captureId: bodyEditCap } });
		await prisma.manifestEntry.update({
			where: { seq: bodyEntry.seq },
			data: { body: `${bodyEntry.body} ` },
		});
		const bodyVerify = await manifest.verify([bodyEditCap]);
		expect(bodyVerify.ok).toBe(false);
		expect(bodyVerify.brokenAt).toMatchObject({
			seq: bodyEntry.seq,
			check: "chain",
			detail: "digest does not re-hash",
		});

		const prevEditCap = await captureWith(2);
		const entries = await prisma.manifestEntry.findMany({
			where: { captureId: prevEditCap },
			orderBy: { seq: "asc" },
		});
		const second = entries[1]!;
		await prisma.manifestEntry.update({
			where: { seq: second.seq },
			data: { prevDigest: "tampered-prev-digest" },
		});
		const prevVerify = await manifest.verify([prevEditCap]);
		expect(prevVerify.ok).toBe(false);
		expect(prevVerify.brokenAt).toMatchObject({
			seq: second.seq,
			check: "chain",
			detail: "prevDigest does not match the entry before it",
		});
	});

	it("breaks with columns check when manifest entry columns differ from the body", async () => {
		const { prisma: rawPrisma } = await import("@prismalens/database");
		await rawPrisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS "manifest_entries_append_only"');
		const colEditCap = await captureWith(1);
		const entry = await prisma.manifestEntry.findFirstOrThrow({ where: { captureId: colEditCap } });
		await prisma.manifestEntry.update({
			where: { seq: entry.seq },
			data: { artifactId: randomUUID() },
		});
		const res = await manifest.verify([colEditCap]);
		expect(res.ok).toBe(false);
		expect(res.brokenAt).toMatchObject({
			seq: entry.seq,
			check: "columns",
			detail: "captureId/artifactId columns differ from the body",
		});
	});

	it("breaks with metadata check when an artifact row is missing", async () => {
		const cId = await captureWith(1);
		await prisma.captureArtifact.deleteMany({ where: { captureId: cId } });
		const res = await manifest.verify([cId]);
		expect(res.ok).toBe(false);
		expect(res.brokenAt).toMatchObject({
			check: "metadata",
			detail: "artifact row is missing",
		});
	});

	it("verifies ok for a withheld artifact whose redactions errored", async () => {
		const now = new Date("2026-10-15T10:00:00Z");
		const c = await prisma.capture.create({
			data: {
				checklistVersion: 1,
				canonicalQuery: "{}",
				queryDigest: randomUUID(),
				kubeContext: "kind",
				cluster: "https://k",
				namespace: "shop",
				identity: JSON.stringify(IDENTITY),
				identityMatches: true,
				caseStartedAt: now,
				dueAt: now,
			},
		});
		const raw = Buffer.from("raw kubectl output");
		const { storedBytes, ...digests } = await store.write(c.id, 0, raw, null);
		await manifest.transaction(async (tx) => {
			const row = await tx.captureArtifact.create({
				data: {
					captureId: c.id,
					seq: 0,
					purpose: "events",
					command: JSON.stringify(["get", "events", "-o", "json"]),
					retrieval: "complete",
					exitCode: 0,
					startedAt: now,
					endedAt: now,
					redactions: JSON.stringify({ error: "redaction rule failed" }),
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
		const res = await manifest.verify([c.id]);
		expect(res).toEqual({ ok: true, entries: 1, expired: 0 });
	});

	it("detects unreadable or tampered raw files during verification", async () => {
		const cId = await captureWith(1);
		const rawPath = join(casesDir(), cId, "0.raw.enc");
		writeFileSync(rawPath, Buffer.from("invalid-ciphertext"));
		const unreadable = await manifest.verify([cId]);
		expect(unreadable.ok).toBe(false);
		expect(unreadable.brokenAt).toMatchObject({ check: "file", detail: expect.stringContaining("raw file unreadable") });

		// Tamper raw with valid encryption for different content
		const diffCipher = vault.encryptBytes(Buffer.from("different bytes"));
		writeFileSync(rawPath, diffCipher);
		const mismatch = await manifest.verify([cId]);
		expect(mismatch.ok).toBe(false);
		expect(mismatch.brokenAt).toMatchObject({ check: "file", detail: "raw file does not re-hash" });
	});

	it("breaks with metadata check when artifact row columns do not parse", async () => {
		const cId = await captureWith(1);
		await prisma.captureArtifact.updateMany({
			where: { captureId: cId },
			data: { command: "not-json" },
		});
		const res = await manifest.verify([cId]);
		expect(res.ok).toBe(false);
		expect(res.brokenAt).toMatchObject({
			check: "metadata",
			detail: "artifact row columns do not parse",
		});
	});

	it("breaks on every edit to a finished capture's displayed identity, target, state or times", async () => {
		const edits: Record<string, Prisma.CaptureUpdateInput> = {
			identity: { identity: JSON.stringify({ ...IDENTITY, kubeUser: "intruder" }) },
			identityMatches: { identityMatches: false },
			cluster: { cluster: "https://elsewhere" },
			kubeContext: { kubeContext: "prod" },
			namespace: { namespace: "payments" },
			state: { state: "partial" },
			stateReason: { stateReason: "timeout" },
			startedAt: { startedAt: new Date("2026-10-15T09:00:00Z") },
			finishedAt: { finishedAt: new Date("2026-10-15T11:00:00Z") },
			dueAt: { dueAt: new Date("2026-10-15T08:00:00Z") },
			missed: { missedFrom: new Date("2026-10-15T09:00:00Z"), missedTo: new Date("2026-10-15T09:30:00Z") },
		};
		for (const [field, data] of Object.entries(edits)) {
			const id = await captureWith(2);
			await finish(id);
			expect(await manifest.verify([id]), `${field} before the edit`).toMatchObject({ ok: true });
			await prisma.capture.update({ where: { id }, data });
			expect((await manifest.verify([id])).ok, `${field} after the edit`).toBe(false);
		}
	});

	it("breaks on an identity edit to a capture still running", async () => {
		const id = await captureWith(2);
		await prisma.capture.update({
			where: { id },
			data: { identity: JSON.stringify({ ...IDENTITY, cluster: "https://elsewhere" }) },
		});
		expect((await manifest.verify([id])).ok).toBe(false);
	});

	it("breaks on an edited artifact purpose or subject", async () => {
		for (const data of [{ purpose: "pods" }, { subject: "checkout/app" }]) {
			const id = await captureWith(1);
			await prisma.captureArtifact.updateMany({ where: { captureId: id }, data });
			expect((await manifest.verify([id])).ok).toBe(false);
		}
	});

	it("breaks when a terminal or artifact entry is deleted", async () => {
		const tail = await captureWith(2);
		await finish(tail);
		await prisma.manifestEntry.deleteMany({ where: { captureId: tail, artifactId: null } });
		expect((await manifest.verify([tail])).ok, "terminal entry at the chain tail").toBe(false);

		const middle = await captureWith(3);
		await finish(middle);
		const entries = await prisma.manifestEntry.findMany({ where: { captureId: middle }, orderBy: { seq: "asc" } });
		await prisma.manifestEntry.delete({ where: { seq: entries[1]!.seq } });
		expect((await manifest.verify([middle])).ok, "artifact entry mid-capture").toBe(false);

		const lastArtifact = await captureWith(2);
		const last = await prisma.manifestEntry.findFirstOrThrow({
			where: { captureId: lastArtifact },
			orderBy: { seq: "desc" },
		});
		await prisma.manifestEntry.delete({ where: { seq: last.seq } });
		expect((await manifest.verify([lastArtifact])).ok, "an artifact entry at the chain tail").toBe(false);

		const all = await captureWith(1);
		await prisma.manifestEntry.deleteMany({ where: { captureId: all } });
		expect(await manifest.verify([all]), "every entry, artifact kept").toMatchObject({ ok: false });

		const finishedOnly = await captureWith(0);
		await prisma.capture.update({ where: { id: finishedOnly }, data: { state: "blocked", stateReason: "unreachable", finishedAt: new Date() } });
		expect(await manifest.verify([finishedOnly]), "finished capture with no entry").toMatchObject({ ok: false });
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
