#!/usr/bin/env npx tsx
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// Standalone entry for `prisma db seed` (packages/@prismalens/database's
// `prisma.seed`) — not a NestJS module, so it cannot use `UsersService`.
// Replicates `UsersService.setupOwner` directly against Prisma + Better Auth,
// which avoids a database → api(auth) module dependency cycle.

import { ADMIN_ROLES, createAuth } from "@prismalens/auth";
import { getConfig } from "@prismalens/config";
import { prisma, seedDemoData } from "@prismalens/database";

const OWNER_EMAIL = "admin@prismalens.dev";
const OWNER_PASSWORD = "admin123";

export async function seed(
	db: typeof prisma,
	auth: ReturnType<typeof createAuth>,
): Promise<void> {
	const existingOwner = await db.user.findFirst({
		where: { role: { in: [...ADMIN_ROLES] } },
	});
	if (!existingOwner) {
		const result = await auth.api.signUpEmail({
			body: { email: OWNER_EMAIL, password: OWNER_PASSWORD, name: "Admin" },
		});
		if (!result?.user) {
			throw new Error("seed: failed to create the owner account");
		}
		await db.user.update({
			where: { id: result.user.id },
			data: { role: "owner" },
		});
		// Same reasoning as UsersService.setupOwner: the auto-signed-in session's
		// token was minted before the role write, so its cached session data would
		// hold "member" for its lifetime — drop it rather than hand out a stale role.
		if (result.token) {
			await db.session.deleteMany({ where: { token: result.token } });
		}
		console.log(`seed: created owner ${OWNER_EMAIL}`);
	} else {
		console.log("seed: an owner/admin already exists — skipped");
	}

	const [alertCount, incidentCount] = await Promise.all([
		db.alert.count(),
		db.incident.count(),
	]);
	if (alertCount === 0 && incidentCount === 0) {
		await seedDemoData(db);
		console.log("seed: provisioned demo data into the empty database");
	} else {
		console.log("seed: database not empty — skipped demo data");
	}
}

async function main(): Promise<void> {
	const config = getConfig();
	// getConfig() always resolves this (auto-generated and persisted if unset —
	// see @prismalens/config's getOrCreateAuthSecret()); the schema still types
	// it optional, so guard rather than assert.
	if (!config.PRISMALENS_AUTH_SECRET) {
		throw new Error("seed: PRISMALENS_AUTH_SECRET is required");
	}
	const auth = createAuth(prisma, {
		baseURL: `http://localhost:${config.PRISMALENS_PORT}`,
		secret: config.PRISMALENS_AUTH_SECRET,
		secureCookies: false,
	});
	await seed(prisma, auth);
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main()
		.catch((err) => {
			console.error("seed: failed:", err);
			process.exit(1);
		})
		.finally(async () => {
			await prisma.$disconnect();
		});
}
