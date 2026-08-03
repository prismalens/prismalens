// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { resetConfig } from "@prismalens/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "../../prisma/generated/client.js";
import { seedDemoData } from "./demo-data.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

describe("seedDemoData", () => {
	let tempDir: string;
	let prisma: PrismaClient;

	beforeAll(() => {
		tempDir = mkdtempSync(join(tmpdir(), "prismalens-seed-test-"));
		process.env.PRISMALENS_WORKSPACE_DIR = tempDir;
		process.env.PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION = "yes";
		resetConfig();

		const dbPath = join(tempDir, "prismalens.db");
		const dbUrl = `file:${dbPath}`;

		const packageRoot = resolve(__dirname, "../..");
		execSync("pnpm exec prisma migrate deploy --config prisma.config.ts", {
			cwd: packageRoot,
			env: {
				...process.env,
				PRISMALENS_WORKSPACE_DIR: tempDir,
				PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION: "yes",
			},
			stdio: "pipe",
		});

		const adapter = new PrismaBetterSqlite3({ url: dbUrl });
		prisma = new PrismaClient({ adapter });
	});

	afterAll(async () => {
		if (prisma) {
			await prisma.$disconnect();
		}
		if (tempDir) {
			rmSync(tempDir, { recursive: true, force: true });
		}
	});

	it("seeds demo data with correct row counts and structure on first run", async () => {
		await seedDemoData(prisma);

		const serviceCount = await prisma.service.count();
		const ruleCount = await prisma.correlationRule.count();
		const alertCount = await prisma.alert.count();
		const incidentCount = await prisma.incident.count();
		const investigationCount = await prisma.investigation.count();

		expect(serviceCount).toBeGreaterThanOrEqual(4);
		expect(ruleCount).toBe(2);
		expect(alertCount).toBe(60);
		expect(incidentCount).toBeGreaterThanOrEqual(2);
		expect(investigationCount).toBe(2);

		// Assert suppressed alert (#244 path)
		const suppressedAlert = await prisma.alert.findFirst({
			where: { status: "suppressed" },
		});
		expect(suppressedAlert).not.toBeNull();
		expect(suppressedAlert?.incidentId).toBeNull();

		// Assert storm incident alert count (#276 storm path)
		const stormIncident = await prisma.incident.findFirst({
			where: { id: "b0111111-1111-4111-8111-111111111111" },
			include: { alerts: true },
		});
		expect(stormIncident).not.toBeNull();
		expect(stormIncident?.alerts.length).toBeGreaterThanOrEqual(8);
		expect(stormIncident?.alerts.length).toBeLessThanOrEqual(12);

		// Assert investigations (#282/ADR-0026 culprit rendering proof)
		const invs = await prisma.investigation.findMany();
		expect(invs.length).toBe(2);

		const parsedReports = invs.map((inv) =>
			JSON.parse(inv.report || "{}"),
		);
		const withCulprit = parsedReports.find(
			(r) => r.culprit && r.culprit.service === "auth-service",
		);
		const withoutCulprit = parsedReports.find((r) => r.culprit === null);

		expect(withCulprit).toBeDefined();
		expect(withCulprit.culprit.changeRef).toBe("v2.4.1");
		expect(withCulprit.culprit.mechanism).toBe("connection-pool exhaustion");

		expect(withoutCulprit).toBeDefined();
	});

	it("is idempotent on second run (no duplicate rows, identical IDs)", async () => {
		const alertsBefore = await prisma.alert.findMany({ select: { id: true } });
		const incidentsBefore = await prisma.incident.findMany({ select: { id: true } });

		await seedDemoData(prisma);

		const alertCountAfter = await prisma.alert.count();
		const incidentCountAfter = await prisma.incident.count();
		const alertsAfter = await prisma.alert.findMany({ select: { id: true } });

		expect(alertCountAfter).toBe(alertsBefore.length);
		expect(incidentCountAfter).toBe(incidentsBefore.length);
		expect(alertsAfter.map((a) => a.id).sort()).toEqual(
			alertsBefore.map((a) => a.id).sort(),
		);
	});
});
