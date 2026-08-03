// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Database Seed Entry Point
 *
 * This file is the main entry point for seeding the database.
 * It's called by Prisma when running `prisma db seed` or `pnpm db:seed`.
 */

import { prisma } from "../client.js";
import { seedDemoData } from "./seeds/demo-data.js";

async function main() {
	const alertCount = await prisma.alert.count();
	if (alertCount > 0) {
		console.log("database not empty — skipping demo seed");
		return;
	}

	console.log("🌱 Starting database seeding...\n");
	await seedDemoData(prisma);
	console.log("\n✅ Database seeding complete!");
}

main()
	.catch((e) => {
		console.error("❌ Seeding failed:", e);
		process.exit(1);
	})
	.finally(async () => {
		await prisma.$disconnect();
	});
