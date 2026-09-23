#!/usr/bin/env npx tsx
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// Standalone entry for `prisma db seed` (packages/@prismalens/database's
// `prisma.seed`). There is no account to create (ADR 0001 §2); this seeds
// demo data into an empty database.
import { prisma, seedDemoData } from "@prismalens/database";

export async function seed(db: typeof prisma): Promise<void> {
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
	await seed(prisma);
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
