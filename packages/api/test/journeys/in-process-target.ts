// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Target } from "../../../../scripts/journeys/types.mjs";
import { ScenarioApp } from "../scenarios/support/scenario-app.js";

/** PrismaLens in this process on an empty workspace: real SQLite and HTTP, the scripted agent on PATH. */
export async function inProcessTarget(): Promise<Target> {
	const pl = new ScenarioApp();
	await pl.boot();
	const workDir = join(pl.workspace, "journeys");
	mkdirSync(workDir);
	return {
		name: "in-process",
		agent: "scripted",
		get baseUrl() {
			return pl.url;
		},
		workDir,
		workspace: join(pl.workspace, "data"),
		runTimeoutMs: 60_000,
		api: (path, init) => pl.api(path, init),
		sendAlert: (body) =>
			fetch(pl.webhookUrl, {
				method: "POST",
				headers: {
					"content-type": "application/json",
					authorization: `Bearer ${pl.webhookToken}`,
				},
				body: JSON.stringify(body),
			}),
		// A stop that ran long enough not to read as a boot loop (#981).
		async restart() {
			await pl.ranSince(new Date(Date.now() - 10 * 60_000));
			await pl.stop();
			await pl.boot();
		},
		// The alert catch-up wait before a resume is not what a journey is about (#981).
		async skipRecoveryDelay(investigationId) {
			const db = await pl.prisma();
			await db.job.updateMany({
				where: { investigationId, status: "pending" },
				data: { runAt: new Date() },
			});
			await pl.tick();
		},
		cleanup: () => pl.dispose(),
	};
}
