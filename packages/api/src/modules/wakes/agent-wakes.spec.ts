// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it, vi } from "vitest";
import { endAgentWakes } from "./agent-wakes.js";

const prisma = (watchFails = false) => ({
	threadWake: { updateMany: vi.fn(async () => ({ count: 1 })) },
	prWatch: {
		deleteMany: vi.fn(async () => {
			if (watchFails) throw new Error("db busy");
			return { count: 1 };
		}),
	},
	cronJob: { deleteMany: vi.fn(async () => ({ count: 1 })) },
});

describe("ending what an agent scheduled (#1024 spec B)", () => {
	it("cancels the pending agent, PR-watch and cron wakes and deletes the watches and cron jobs of the threads named", async () => {
		const db = prisma();
		await endAgentWakes(db as never, ["t1", "t2"]);
		expect(db.prWatch.deleteMany).toHaveBeenCalledWith({
			where: { investigationId: { in: ["t1", "t2"] } },
		});
		expect(db.cronJob.deleteMany).toHaveBeenCalledWith({
			where: { investigationId: { in: ["t1", "t2"] } },
		});
		expect(db.threadWake.updateMany).toHaveBeenCalledWith({
			where: {
				investigationId: { in: ["t1", "t2"] },
				kind: { in: ["agent", "pr_watch", "cron"] },
				state: "pending",
			},
			data: { state: "cancelled", doneAt: expect.any(Date) },
		});
	});

	it("cancels no wake when the watches could not be deleted, so a failed stop or settle loses nothing", async () => {
		const db = prisma(true);
		await expect(endAgentWakes(db as never, ["t1"])).rejects.toThrow("db busy");
		expect(db.threadWake.updateMany).not.toHaveBeenCalled();
	});

	it("does nothing for no threads", async () => {
		const db = prisma();
		await endAgentWakes(db as never, []);
		expect(db.prWatch.deleteMany).not.toHaveBeenCalled();
		expect(db.cronJob.deleteMany).not.toHaveBeenCalled();
	});
});
