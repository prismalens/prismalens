// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ScenarioApp } from "./support/scenario-app.js";

const pl = new ScenarioApp();

beforeAll(async () => {
	await pl.boot();
}, 60_000);
afterAll(async () => {
	await pl.dispose();
}, 60_000);

const project = async (fullName: string) =>
	(await pl.prisma()).repository.create({
		data: { fullName, url: `/work/${fullName}`, sourceKind: "folder" },
	});

const deliver = (serviceName: string, title: string) =>
	fetch(`${pl.url}/api/webhooks/generic`, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			authorization: `Bearer ${pl.webhookToken}`,
		},
		body: JSON.stringify({ title, severity: "low", serviceName }),
	});

describe("An alert that names a project makes the project's service", () => {
	it("Given two projects whose folder names match, When an alert names each, Then each gets its own service and the second is named by its full name", async () => {
		const a = await project("team-a/api");
		const b = await project("team-b/api");

		for (const name of ["team-a/api", "team-b/api"]) {
			expect((await deliver(name, `Boom in ${name}`)).status).toBeLessThan(300);
		}

		const prisma = await pl.prisma();
		const links = await prisma.serviceRepository.findMany({
			where: { repositoryId: { in: [a.id, b.id] } },
			include: { service: true },
		});
		const byRepo = Object.fromEntries(
			links.map((l) => [l.repositoryId, l.service.name]),
		);
		expect(byRepo).toEqual({ [a.id]: "api", [b.id]: "team-b/api" });
		expect(
			await prisma.serviceRepository.count({
				where: { service: { name: "api" } },
			}),
		).toBe(1);
	}, 60_000);

	it("Given an unlinked project, When eight first alerts for it resolve at once, Then all get the same service and it has one link", async () => {
		const shop = await project("team-c/shop");
		const mapping = await pl.alertMapping();

		const resolved = await Promise.all(
			Array.from({ length: 8 }, (_, i) =>
				mapping.resolveServiceForAlert({
					title: `Checkout is failing ${i}`,
					serviceName: "team-c/shop",
				}),
			),
		);

		const prisma = await pl.prisma();
		const links = await prisma.serviceRepository.findMany({
			where: { repositoryId: shop.id },
			include: { service: true },
		});
		expect(links.map((l) => l.service.name)).toEqual(["shop"]);
		expect(resolved.map((s) => s?.id)).toEqual(
			resolved.map(() => links[0]?.serviceId),
		);
	}, 60_000);
});
