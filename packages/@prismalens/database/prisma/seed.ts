/**
 * Database Seed Entry Point
 *
 * This file is the main entry point for seeding the database.
 * It's called by Prisma when running `prisma db seed` or `pnpm db:seed`.
 *
 * Add new seed functions by:
 * 1. Creating a new file in ./seeds/
 * 2. Exporting a function that takes PrismaClient
 * 3. Importing and calling it in the main() function below
 */

import { prisma } from "../client.js";

async function main() {
	console.log("🌱 Starting database seeding...\n");

	// Integration definitions are no longer seeded — they are now TypeScript
	// templates in @prismalens/integrations package.

	// Add more seeds here as needed:
	// await seedOtherData(prisma);

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
