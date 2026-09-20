// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it, vi } from "vitest";
import type { PrismaService } from "../../core/prisma/prisma.service.js";
import { ServicesService } from "./services.service.js";

function serviceWith(teams: Array<string | null>) {
	const findMany = vi.fn(async () => teams.map((team) => ({ team })));
	const service = new ServicesService({
		service: { findMany },
	} as unknown as PrismaService);
	return { service, findMany };
}

describe("ServicesService.listTeams (#325)", () => {
	it("asks the database for distinct, non-null teams in order", async () => {
		const { service, findMany } = serviceWith(["platform", "payments"]);

		await service.listTeams();

		expect(findMany).toHaveBeenCalledWith({
			where: { team: { not: null } },
			distinct: ["team"],
			select: { team: true },
			orderBy: { team: "asc" },
		});
	});

	it("drops blank and whitespace-only team names", async () => {
		const { service } = serviceWith(["platform", "   ", "", null, "payments"]);

		expect(await service.listTeams()).toEqual(["platform", "payments"]);
	});

	it("returns nothing when no service carries a team", async () => {
		const { service } = serviceWith([]);

		expect(await service.listTeams()).toEqual([]);
	});
});
