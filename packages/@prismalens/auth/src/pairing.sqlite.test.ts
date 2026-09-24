// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	authenticateDevice,
	createPairingLink,
	PairingError,
	prismaPairingStore,
	redeemPairingLink,
} from "./pairing.js";

describe("device pairing on real migrated SQLite", () => {
	const dir = mkdtempSync(join(tmpdir(), "pl-pairing-"));
	let prisma: typeof import("@prismalens/database").prisma;

	beforeAll(async () => {
		process.env.PRISMALENS_WORKSPACE_DIR = dir;
		execSync("pnpm exec prisma migrate deploy --config prisma.config.ts", {
			cwd: resolve(
				fileURLToPath(new URL(".", import.meta.url)),
				"../../database",
			),
			env: {
				...process.env,
				PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION: "yes",
			},
			stdio: "pipe",
		});
		({ prisma } = await import("@prismalens/database"));
	}, 120_000);

	afterAll(async () => {
		await prisma?.$disconnect();
		rmSync(dir, { recursive: true, force: true });
	});

	it("the full flow: createPairingLink → redeemPairingLink → authenticateDevice → listDevices shows it → revokeDevice → authenticateDevice null → listDevices empty; revokeDevice on an unknown id returns null", async () => {
		const store = prismaPairingStore(prisma);

		// createPairingLink
		const link = await createPairingLink(store, { label: "Work computer" });
		expect(link.token).toBeDefined();

		// redeemPairingLink
		const redeemed = await redeemPairingLink(store, {
			token: link.token,
			name: "Work computer",
			userAgent: "Mozilla/5.0",
		});
		expect(redeemed.token).toBeDefined();
		expect(redeemed.device.name).toBe("Work computer");

		// authenticateDevice
		const device = await authenticateDevice(store, redeemed.token);
		expect(device).not.toBeNull();
		expect(device?.id).toBe(redeemed.device.id);

		// listDevices shows it
		const devices = await store.listDevices();
		expect(devices).toHaveLength(1);
		expect(devices[0]?.id).toBe(redeemed.device.id);

		// revokeDevice
		const revoked = await store.revokeDevice(redeemed.device.id, new Date());
		expect(revoked).not.toBeNull();
		expect(revoked?.id).toBe(redeemed.device.id);
		expect(revoked?.revokedAt).not.toBeNull();

		// authenticateDevice null
		const unauthenticated = await authenticateDevice(store, redeemed.token);
		expect(unauthenticated).toBeNull();

		// listDevices empty
		const devicesAfterRevoke = await store.listDevices();
		expect(devicesAfterRevoke).toHaveLength(0);

		// revokeDevice on an unknown id returns null
		const unknownRevoke = await store.revokeDevice(
			"unknown-device-id",
			new Date(),
		);
		expect(unknownRevoke).toBeNull();
	});

	it("five concurrent redemptions of one link: exactly one fulfilled, four rejected with reason used, and prisma.deviceSession.count() is 1", async () => {
		const store = prismaPairingStore(prisma);
		await prisma.deviceSession.deleteMany();
		await prisma.pairingLink.deleteMany();

		const link = await createPairingLink(store, { label: "Shared Link" });

		const results = await Promise.allSettled(
			Array.from({ length: 5 }, (_, i) =>
				redeemPairingLink(store, {
					token: link.token,
					name: `Racer ${i}`,
				}),
			),
		);

		const fulfilled = results.filter((r) => r.status === "fulfilled");
		const rejected = results.filter((r) => r.status === "rejected");

		expect(fulfilled).toHaveLength(1);
		expect(rejected).toHaveLength(4);

		for (const r of rejected) {
			const rejection = r as PromiseRejectedResult;
			expect(rejection.reason).toBeInstanceOf(PairingError);
			expect((rejection.reason as PairingError).reason).toBe("used");
		}

		expect(await prisma.deviceSession.count()).toBe(1);
	});
});
