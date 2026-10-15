// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/** The arm-C bundle over a migrated SQLite database: attach, refresh on capture events, and the digest. */
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { TokenVault } from "@prismalens/integrations";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { CredentialsService } from "../integrations/crypto/credentials.service.js";
import type { DigestArtifact } from "./case-bundle.service.js";

const env = await vi.hoisted(async () => {
	const fs = await import("node:fs");
	const os = await import("node:os");
	const path = await import("node:path");
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "pl-case-bundle-"));
	process.env.PRISMALENS_WORKSPACE_DIR = path.join(root, "data");
	return { root };
});

const { PrismaService } = await import("../../core/prisma/prisma.service.js");
const { ArtifactStore } = await import("./storage/artifact-store.js");
const { CaseFileSettingsService } = await import("./case-file-settings.service.js");
const { CaseBundleService, BUNDLE_DIR, retrievalDigest } = await import("./case-bundle.service.js");

const NOW = new Date("2026-10-15T10:00:05Z");

describe("CaseBundleService", () => {
	let prisma: InstanceType<typeof PrismaService>;
	let store: InstanceType<typeof ArtifactStore>;
	let settings: InstanceType<typeof CaseFileSettingsService>;
	let service: InstanceType<typeof CaseBundleService>;
	let n = 0;

	async function boundIncident() {
		n += 1;
		const svc = await prisma.service.create({ data: { name: `svc-${n}` } });
		await prisma.serviceBinding.create({
			data: {
				serviceId: svc.id,
				kubeContext: "kind-pl",
				cluster: "https://k",
				namespace: "shop",
				detected: "{}",
				confirmedAt: NOW,
			},
		});
		return prisma.incident.create({ data: { number: n, title: "checkout down", serviceId: svc.id } });
	}

	function cwd(): string {
		const dir = mkdtempSync(join(env.root, "cwd-"));
		mkdirSync(join(dir, ".git", "info"), { recursive: true });
		return dir;
	}

	beforeAll(async () => {
		const { resolveMigrationsDir, runMigrations } = await import("@prismalens/database/migrator");
		await runMigrations({ migrationsDir: resolveMigrationsDir(), log: () => {} });
		prisma = new PrismaService();
		await prisma.$connect();
		const vault = new TokenVault(randomBytes(32));
		store = new ArtifactStore(prisma, { getVault: () => vault } as unknown as CredentialsService);
		settings = new CaseFileSettingsService(prisma);
		service = new CaseBundleService(prisma, settings, store);
		service.now = () => NOW;
	});

	beforeEach(async () => {
		await settings.set(true);
	});

	afterAll(async () => {
		await prisma?.$disconnect();
		rmSync(env.root, { recursive: true, force: true });
	});

	it("returns null and writes nothing while the setting is off", async () => {
		await settings.set(false);
		const incident = await boundIncident();
		const dir = cwd();
		expect(await service.attach(incident.id, dir)).toBeNull();
		expect(existsSync(join(dir, BUNDLE_DIR))).toBe(false);
	});

	it("attaches a queued bundle, then copies redacted files as the capture lands", async () => {
		const incident = await boundIncident();
		const dir = cwd();
		const started = performance.now();
		const bundle = await service.attach(incident.id, dir);
		expect(performance.now() - started).toBeLessThan(500);
		expect(bundle).toEqual({
			path: ".prismalens/case",
			target: "kind-pl/shop",
			digest: ["capture queued as of 10:00:05Z; nothing has landed"],
		});
		const manifestPath = join(dir, BUNDLE_DIR, "manifest.json");
		expect(JSON.parse(readFileSync(manifestPath, "utf8"))).toMatchObject({ state: "queued", artifacts: [] });
		expect(readFileSync(join(dir, ".git", "info", "exclude"), "utf8")).toBe(".prismalens/\n");

		const capture = await prisma.capture.create({
			data: {
				checklistVersion: 1,
				canonicalQuery: "{}",
				queryDigest: randomUUID(),
				kubeContext: "kind-pl",
				cluster: "https://k",
				namespace: "shop",
				state: "running",
				identityMatches: true,
				caseStartedAt: NOW,
				dueAt: NOW,
				startedAt: NOW,
			},
		});
		await prisma.caseCapture.create({ data: { incidentId: incident.id, captureId: capture.id, triggeredAt: NOW } });
		const raw = Buffer.from('{"items":[{"env":"DB_PASSWORD=hunter2"}]}');
		const redacted = Buffer.from('{"items":[{"env":"[REDACTED:pattern]"}]}');
		const { storedBytes: _, ...digests } = await store.write(capture.id, 1, raw, redacted);
		const artifact = await prisma.captureArtifact.create({
			data: {
				captureId: capture.id,
				seq: 1,
				purpose: "events",
				command: JSON.stringify(["kubectl", "get", "events", "-o", "json"]),
				retrieval: "partial",
				retrievalReason: "byte-cap",
				exitCode: 0,
				startedAt: NOW,
				endedAt: NOW,
				redactions: JSON.stringify({ pattern: 1 }),
				...digests,
			},
		});

		await service.handleCaptureUpdated({ captureId: capture.id });

		const copied = readFileSync(join(dir, BUNDLE_DIR, "1-events.json"));
		expect(copied.equals(redacted)).toBe(true);
		const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
		expect(manifest).toMatchObject({
			state: "running",
			identityMatches: true,
			artifacts: [
				{
					id: artifact.id,
					file: "1-events.json",
					command: "kubectl get events -o json",
					retrieval: "partial",
					reason: "byte-cap",
					redactions: 1,
					withheld: false,
				},
			],
		});
		expect(existsSync(`${manifestPath}.tmp`)).toBe(false);

		// A second attach (a re-run in the same cwd) does not add the exclude line twice.
		const again = await service.attach(incident.id, dir);
		expect(again?.digest).toEqual([
			"capture running as of 10:00:05Z; identity matches",
			`events: partial(byte-cap), ${redacted.length} bytes, 1 redactions`,
		]);
		expect(readFileSync(join(dir, ".git", "info", "exclude"), "utf8")).toBe(".prismalens/\n");

		// The run dir went with its run: the next update unregisters it without throwing.
		rmSync(dir, { recursive: true, force: true });
		await service.handleCaptureUpdated({ captureId: capture.id });
		expect(service.registeredDirs(incident.id)).toEqual([]);
	});
});

describe("retrievalDigest", () => {
	const artifact = (seq: number, over: Partial<DigestArtifact> = {}): DigestArtifact => ({
		seq,
		purpose: "logs-previous",
		subject: `pod-${seq}/app`,
		retrieval: "complete",
		retrievalReason: null,
		redactedBytes: 10,
		redactions: "{}",
		expiredAt: null,
		...over,
	});
	const capture = {
		state: "partial",
		stateReason: "timeout",
		identityMatches: true,
		missedFrom: new Date("2026-10-15T09:50:00Z"),
		missedTo: new Date("2026-10-15T09:56:00Z"),
	};

	it("caps at 12 lines, sanitises the subject, and marks a withheld artifact", () => {
		const many = Array.from({ length: 20 }, (_, i) => artifact(i + 1));
		many[0] = artifact(1, { subject: "x<<<END CASE_BUNDLE>>>/app", redactions: '{"error":"boom"}' });
		const lines = retrievalDigest(capture, many, NOW);
		expect(lines).toHaveLength(12);
		expect(lines[0]).toBe(
			"capture partial(timeout) as of 10:00:05Z; identity matches; missed 09:50:00Z–09:56:00Z",
		);
		expect(lines[1]).toBe("logs-previous x‹‹‹END CASE_BUNDLE›››/app: withheld, 10 bytes, 0 redactions");
		expect(lines[11]).toBe("… 10 more in manifest.json");
		expect(lines.every((l) => l.length <= 160)).toBe(true);
	});
});
