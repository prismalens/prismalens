// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Deploy events (#854) over a temp SQLite database: the push record, its idempotency,
 * the GitHub pull's row shape, and the What-changed read.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const env = await vi.hoisted(async () => {
	const fs = await import("node:fs");
	const os = await import("node:os");
	const path = await import("node:path");
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "pl-deploys-"));
	process.env.PRISMALENS_WORKSPACE_DIR = path.join(root, "data");
	return { root };
});

const { PrismaService } = await import("../../core/prisma/prisma.service.js");
const { ChangeEventsService } = await import("./change-events.service.js");
const { DeployEventsService } = await import("./deploy-events.service.js");
const { WebhookSignatureGuard } = await import(
	"../webhooks/webhook-signature.guard.js"
);

const SHA = "b".repeat(40);

describe("deploy events (#854)", () => {
	let prisma: InstanceType<typeof PrismaService>;
	let deploys: InstanceType<typeof DeployEventsService>;
	let changes: InstanceType<typeof ChangeEventsService>;
	let serviceId: string;
	let incidentId: string;
	const request = vi.fn();

	beforeAll(async () => {
		const { resolveMigrationsDir, runMigrations } = await import(
			"@prismalens/database/migrator"
		);
		await runMigrations({ migrationsDir: resolveMigrationsDir(), log: () => {} });
		prisma = new PrismaService();
		await prisma.$connect();
		deploys = new DeployEventsService(prisma);
		changes = new ChangeEventsService(prisma, {} as never, {} as never, {
			createRequestFn: () => request,
		} as never);
		const service = await prisma.service.create({ data: { name: "checkout" } });
		serviceId = service.id;
		const incident = await prisma.incident.create({
			data: {
				number: 1,
				title: "5xx spike",
				serviceId,
				triggeredAt: new Date(),
			},
		});
		incidentId = incident.id;
	});

	afterAll(async () => {
		await prisma.$disconnect();
	});

	it("records a pushed deploy and does not duplicate a repeat", async () => {
		const input = {
			service: "checkout",
			version: "v2.0.1",
			environment: "production",
			status: "succeeded" as const,
			actor: "ci",
			sha: SHA,
		};
		const first = await deploys.record(input);
		const again = await deploys.record(input);
		expect(first?.created).toBe(true);
		expect(again).toEqual({ id: first?.id, created: false });
		const rows = await prisma.changeEvent.findMany({ where: { serviceId } });
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ type: "deployment", source: "push" });
		expect(await deploys.record({ ...input, status: "failed" })).toMatchObject({
			created: true,
		});
	});

	it("refuses a deploy for an unknown service", async () => {
		expect(
			await deploys.record({
				service: "nope",
				version: "1",
				environment: "production",
				status: "succeeded",
			}),
		).toBeNull();
	});

	it("keeps a GitHub deployment in the same row shape as a push", async () => {
		request.mockImplementation(async (_m: string, path: string) =>
			path.includes("/statuses")
				? Response.json([{ state: "success", created_at: new Date().toISOString() }])
				: Response.json([
						{
							id: 9,
							sha: SHA,
							ref: "v2.0.2",
							environment: "production",
							created_at: new Date().toISOString(),
							creator: { login: "octo" },
						},
					]),
		);
		await (
			changes as unknown as { pullDeploys(l: unknown): Promise<void> }
		).pullDeploys({
			serviceId,
			serviceName: "checkout",
			repository: {
				sourceKind: "url",
				connectionId: "c1",
				url: "https://github.com/acme/checkout",
				fullName: "acme/checkout",
			},
		});
		const row = await prisma.changeEvent.findUnique({
			where: { dedupeKey: "deploy:checkout:production:v2.0.2:succeeded" },
		});
		expect(row).toMatchObject({ type: "deployment", source: "github", serviceId });
		const pushed = await prisma.changeEvent.findFirstOrThrow({
			where: { source: "push" },
		});
		expect(Object.keys(JSON.parse(row?.metadata ?? "{}")).sort()).toEqual(
			Object.keys(JSON.parse(pushed.metadata ?? "{}")).sort(),
		);
	});

	it("does not give a subPath service every deployment of the repository", async () => {
		request.mockClear();
		await (
			changes as unknown as { pullDeploys(l: unknown): Promise<void> }
		).pullDeploys({
			serviceId,
			serviceName: "checkout",
			subPath: "services/checkout",
			repository: {
				sourceKind: "url",
				connectionId: "c1",
				url: "https://github.com/acme/monorepo",
				fullName: "acme/monorepo",
			},
		});
		expect(request).not.toHaveBeenCalled();
	});

	it("lists deploys in what changed, newest first", async () => {
		await prisma.changeEvent.update({
			where: { dedupeKey: "deploy:checkout:production:v2.0.1:succeeded" },
			data: { timestamp: new Date(Date.now() - 3_600_000) },
		});
		const result = await changes.forIncident(incidentId, { limit: 10 });
		const kinds = result?.timeline.map((c) => [c.kind, c.tag, c.source]);
		expect(kinds?.[0]).toEqual(["deployment", "v2.0.2", "github"]);
		expect(kinds).toContainEqual(["deployment", "v2.0.1", "push"]);
		expect(result?.deploy?.kind).toBe("deployment");
	});

	it("refuses a wrong webhook secret on the deploy route", () => {
		const guard = new WebhookSignatureGuard({
			get: () => "right-secret",
		} as never);
		const ctx = (authorization: string) =>
			({
				switchToHttp: () => ({
					getRequest: () => ({
						path: "/api/webhooks/deploy",
						headers: { authorization },
					}),
				}),
			}) as never;
		expect(guard.canActivate(ctx("Bearer right-secret"))).toBe(true);
		expect(() => guard.canActivate(ctx("Bearer wrong"))).toThrow(
			/Invalid webhook credentials/,
		);
	});
});
