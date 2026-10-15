// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Capture artifact files (R3): `<appData>/cases/<captureId>/<seq>.raw.enc`
 * (the exact bytes, vault-encrypted) and `<seq>.redacted`. Paths derive from
 * ids and are never stored; the raw copy is read only by manifest verify.
 */
import { createHash } from "node:crypto";
import { rmSync } from "node:fs";
import { chmod, mkdir, open, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Injectable } from "@nestjs/common";
import { getAppDataDir } from "@prismalens/config";
// biome-ignore lint/style/useImportType: Nest injects by the runtime class
import { PrismaService } from "../../../core/prisma/prisma.service.js";
// biome-ignore lint/style/useImportType: Nest injects by the runtime class
import { CredentialsService } from "../../integrations/crypto/credentials.service.js";

// Mirrors RETENTION_BYTES_PER_BINDING / RETENTION_DAYS in capture/budget.ts (WU2): assumptions.
const RETENTION_BYTES_PER_BINDING = 256 * 1024 * 1024;
const RETENTION_DAYS = 30;
const DAY_MS = 86_400_000;

export interface StoredArtifact {
	rawSha256: string;
	rawBytes: number;
	redactedSha256: string;
	redactedBytes: number;
	/** Bytes on disk for both files: what a capture's `bytesStored` grows by. */
	storedBytes: number;
}

export interface ArtifactRef {
	captureId: string;
	seq: number;
	expiredAt: Date | null;
}

export const sha256Hex = (data: Buffer | string): string =>
	createHash("sha256").update(data).digest("hex");

export function casesDir(): string {
	return join(getAppDataDir(), "cases");
}

/** Every case file goes with a Danger zone reset. */
export function removeAllCaseFiles(): void {
	rmSync(casesDir(), { recursive: true, force: true });
}

const SAFE_ID = /^[A-Za-z0-9-]+$/;

function captureDir(captureId: string): string {
	if (!SAFE_ID.test(captureId))
		throw new Error(`unsafe capture id: ${captureId}`);
	return join(casesDir(), captureId);
}

function filePath(
	captureId: string,
	seq: number,
	ext: "raw.enc" | "redacted",
): string {
	if (!Number.isInteger(seq) || seq < 0)
		throw new Error(`bad artifact seq: ${seq}`);
	return join(captureDir(captureId), `${seq}.${ext}`);
}

async function writePrivate(path: string, data: Buffer): Promise<void> {
	await writeFile(path, data, { mode: 0o600 });
	await chmod(path, 0o600);
}

async function readIfPresent(path: string): Promise<Buffer | null> {
	try {
		return await readFile(path);
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw err;
	}
}

@Injectable()
export class ArtifactStore {
	constructor(
		private readonly prisma: PrismaService,
		private readonly credentials: CredentialsService,
	) {}

	/** `redacted` is null when redaction failed: no redacted file, empty-string digest, 0 bytes. */
	async write(
		captureId: string,
		seq: number,
		raw: Buffer,
		redacted: Buffer | null,
	): Promise<StoredArtifact> {
		await mkdir(captureDir(captureId), { recursive: true, mode: 0o700 });
		const sealed = this.credentials.getVault().encryptBytes(raw);
		await writePrivate(filePath(captureId, seq, "raw.enc"), sealed);
		if (redacted)
			await writePrivate(filePath(captureId, seq, "redacted"), redacted);
		const kept = redacted ?? Buffer.alloc(0);
		return {
			rawSha256: sha256Hex(raw),
			rawBytes: raw.length,
			redactedSha256: sha256Hex(kept),
			redactedBytes: kept.length,
			storedBytes: sealed.length + kept.length,
		};
	}

	/** The redacted copy up to `maxBytes`; null when expired or withheld. */
	async readRedacted(
		artifact: ArtifactRef,
		maxBytes: number,
	): Promise<{ text: string; truncated: boolean } | null> {
		if (artifact.expiredAt) return null;
		let handle: Awaited<ReturnType<typeof open>>;
		try {
			handle = await open(
				filePath(artifact.captureId, artifact.seq, "redacted"),
				"r",
			);
		} catch (err) {
			if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
			throw err;
		}
		try {
			const { size } = await handle.stat();
			const length = Math.min(size, maxBytes);
			const buf = Buffer.alloc(length);
			await handle.read(buf, 0, length, 0);
			return { text: buf.toString("utf8"), truncated: size > maxBytes };
		} finally {
			await handle.close();
		}
	}

	/** Whole redacted file, or null when absent; for verify. */
	readRedactedBytes(artifact: ArtifactRef): Promise<Buffer | null> {
		return readIfPresent(
			filePath(artifact.captureId, artifact.seq, "redacted"),
		);
	}

	/** Decrypted raw bytes. Internal: never served by a route (R3). */
	async readRaw(artifact: ArtifactRef): Promise<Buffer> {
		const sealed = await readFile(
			filePath(artifact.captureId, artifact.seq, "raw.enc"),
		);
		return this.credentials.getVault().decryptBytes(sealed);
	}

	/** Deletes the files; rows and manifest entries stay (OBJ-024). */
	async expire(captureId: string, now: Date = new Date()): Promise<void> {
		const dir = captureDir(captureId);
		await this.prisma.$transaction([
			this.prisma.captureArtifact.updateMany({
				where: { captureId, expiredAt: null },
				data: { expiredAt: now },
			}),
			this.prisma.capture.update({
				where: { id: captureId },
				data: { bytesStored: 0 },
			}),
		]);
		await rm(dir, { recursive: true, force: true });
	}

	/** Oldest finished captures first, until the binding is within budget and none is past retention. */
	async sweep(bindingId: string, now: Date = new Date()): Promise<string[]> {
		const all = await this.prisma.capture.aggregate({
			where: { bindingId },
			_sum: { bytesStored: true },
		});
		let total = all._sum.bytesStored ?? 0;
		const candidates = await this.prisma.capture.findMany({
			where: {
				bindingId,
				state: { notIn: ["queued", "running"] },
				artifacts: { some: { expiredAt: null } },
			},
			orderBy: { createdAt: "asc" },
			select: { id: true, createdAt: true, bytesStored: true },
		});
		const cutoff = now.getTime() - RETENTION_DAYS * DAY_MS;
		const expired: string[] = [];
		for (const c of candidates) {
			if (
				total <= RETENTION_BYTES_PER_BINDING &&
				c.createdAt.getTime() >= cutoff
			)
				continue;
			await this.expire(c.id, now);
			total -= c.bytesStored;
			expired.push(c.id);
		}
		return expired;
	}
}
