// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	DEFAULT_RUN_WORKSPACE_SETTINGS,
	type RunWorkspaceSettings,
	type WorkspaceRemoval,
} from "@prismalens/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaService } from "../../core/prisma/prisma.service.js";
import {
	RunWorkspaceNotFoundError,
	RunWorkspacesService,
} from "./run-workspaces.service.js";

// Mock ../../core/harness/run-worktree.js so no git runs
vi.mock("../../core/harness/run-worktree.js", () => {
	let sourceCallback: any = null;
	return {
		defaultWorktreeRoot: vi.fn(() => "/mock/default/worktrees"),
		keptWorkspaces: vi.fn((_runId?: string) => []),
		removeKeptWorkspace: vi.fn(async (dir: string) => ({
			removed: true,
			reason: "removed-by-user",
		})),
		setRunWorkspaceSource: vi.fn((source: any) => {
			sourceCallback = source;
		}),
		sweepRunWorktrees: vi.fn(async () => []),
		__getSourceCallback: () => sourceCallback,
	};
});

describe("RunWorkspacesService", () => {
	let mockPrisma: any;
	let service: RunWorkspacesService;

	beforeEach(() => {
		mockPrisma = {
			setting: {
				findMany: vi.fn(async () => []),
				findUnique: vi.fn(async () => null),
				upsert: vi.fn(async ({ create, update }: any) => ({
					...create,
					...update,
				})),
				deleteMany: vi.fn(async () => ({ count: 1 })),
			},
			service: {
				findUnique: vi.fn(async ({ where }: any) => {
					if (where.id === "svc-1") return { id: "svc-1", name: "auth-service" };
					return null;
				}),
			},
			investigation: {
				findMany: vi.fn(async () => []),
			},
		};
		service = new RunWorkspacesService(mockPrisma as unknown as PrismaService);
	});

	it("settings load from the runWorkspace.global row; a bad row falls back to defaults", async () => {
		// Valid global row
		const customSettings: RunWorkspaceSettings = {
			...DEFAULT_RUN_WORKSPACE_SETTINGS,
			method: "clone",
			keptPerProject: 5,
		};
		mockPrisma.setting.findMany.mockResolvedValueOnce([
			{
				key: "runWorkspace.global",
				value: JSON.stringify(customSettings),
			},
		]);

		const res = await service.getGlobal();
		expect(res.settings.method).toBe("clone");
		expect(res.settings.keptPerProject).toBe(5);

		// Now test bad row falls back to defaults
		const badService = new RunWorkspacesService(
			{
				...mockPrisma,
				setting: {
					...mockPrisma.setting,
					findMany: vi.fn(async () => [
						{
							key: "runWorkspace.global",
							value: "invalid-json{",
						},
					]),
				},
			} as unknown as PrismaService,
		);
		const badRes = await badService.getGlobal();
		expect(badRes.settings).toEqual(DEFAULT_RUN_WORKSPACE_SETTINGS);
	});

	it("setService stores only defined fields; getService returns inherited = the fields not set, and effective merges field by field", async () => {
		await service.ready();

		await service.setService("svc-1", {
			method: "clone",
			location: undefined,
		});

		expect(mockPrisma.setting.upsert).toHaveBeenCalledWith({
			where: { key: "runWorkspace.service.svc-1" },
			create: {
				key: "runWorkspace.service.svc-1",
				value: JSON.stringify({ method: "clone" }),
				type: "json",
				category: "runs",
			},
			update: { value: JSON.stringify({ method: "clone" }) },
		});

		const result = await service.getService("svc-1");
		expect(result.override).toEqual({ method: "clone" });
		expect(result.effective.method).toBe("clone");
		expect(result.effective.location).toBe(DEFAULT_RUN_WORKSPACE_SETTINGS.location);
		expect(result.inherited).toContain("location");
		expect(result.inherited).not.toContain("method");
	});

	it("setService with {} deletes the row (deleteMany called with key runWorkspace.service.<id>)", async () => {
		await service.ready();

		await service.setService("svc-1", {});

		expect(mockPrisma.setting.deleteMany).toHaveBeenCalledWith({
			where: { key: "runWorkspace.service.svc-1" },
		});
	});

	it("getService/setService on an unknown service throw RunWorkspaceNotFoundError", async () => {
		await expect(service.getService("unknown-svc")).rejects.toThrow(
			RunWorkspaceNotFoundError,
		);
		await expect(
			service.setService("unknown-svc", { method: "clone" }),
		).rejects.toThrow(RunWorkspaceNotFoundError);
	});

	it("the record passed to setRunWorkspaceSource stores newest first and keeps at most 100 (read back via removals())", async () => {
		const { __getSourceCallback } = await import(
			"../../core/harness/run-worktree.js" as any
		);
		await service.onModuleInit();
		const source = __getSourceCallback();
		expect(source).toBeDefined();

		// Create 105 removals to test the 100 limit and order
		const mockRemovals: WorkspaceRemoval[] = Array.from({ length: 105 }, (_, i) => ({
			runId: `run-${i}`,
			dir: `/tmp/worktree-${i}`,
			serviceId: "svc-1",
			removed: true,
			reason: "removed-by-user",
			at: new Date(1000 + i).toISOString(),
			teardown: null,
		}));

		// Mock existing empty row for REMOVALS_KEY
		mockPrisma.setting.findUnique.mockResolvedValue(null);

		let storedValue: string = "[]";
		mockPrisma.setting.upsert.mockImplementation(async ({ create, update }: any) => {
			storedValue = update?.value ?? create?.value;
			mockPrisma.setting.findUnique.mockImplementation(async ({ where }: any) => {
				if (where.key === "runWorkspace.removals") {
					return { key: "runWorkspace.removals", value: storedValue };
				}
				return null;
			});
			return { key: "runWorkspace.removals", value: storedValue };
		});

		source.record(mockRemovals);

		const result = await service.removals();
		expect(result).toHaveLength(100);
		// Newest first means the last item of batch (index 104) comes first
		expect(result[0].runId).toBe("run-104");
		expect(result[99].runId).toBe("run-5");
	});

	it("remove/open refuse a dir not returned by keptWorkspaces(runId) with RunWorkspaceNotFoundError", async () => {
		const { keptWorkspaces } = await import(
			"../../core/harness/run-worktree.js" as any
		);
		keptWorkspaces.mockReturnValue([
			{ dir: "/valid/dir", keptAt: new Date().toISOString() },
		]);

		expect(() => service.remove("run-1", "/invalid/dir")).toThrow(
			RunWorkspaceNotFoundError,
		);
		expect(() => service.open("run-1", "/invalid/dir")).toThrow(
			RunWorkspaceNotFoundError,
		);
	});

	it("sweep() passes isLive true for pending/running ids and isResolved true for ids whose incident is resolved/closed", async () => {
		const { sweepRunWorktrees } = await import(
			"../../core/harness/run-worktree.js" as any
		);

		mockPrisma.investigation.findMany.mockImplementation(
			async ({ where }: any) => {
				if (where?.status?.in) {
					return [{ id: "run-pending" }, { id: "run-running" }];
				}
				if (where?.incident?.status?.in) {
					return [{ id: "run-resolved" }, { id: "run-closed" }];
				}
				return [];
			},
		);

		await service.sweep();

		expect(sweepRunWorktrees).toHaveBeenCalledTimes(1);
		const sweepOpts = vi.mocked(sweepRunWorktrees).mock.calls[0][0];

		expect(sweepOpts.isLive("run-pending")).toBe(true);
		expect(sweepOpts.isLive("run-running")).toBe(true);
		expect(sweepOpts.isLive("run-other")).toBe(false);

		expect(sweepOpts.isResolved("run-resolved")).toBe(true);
		expect(sweepOpts.isResolved("run-closed")).toBe(true);
		expect(sweepOpts.isResolved("run-pending")).toBe(false);
	});
});

describe("RunWorkspacesService location history (#925 review)", () => {
	it("a failed history write is retried by the next save, and nothing is saved without it", async () => {
		const rows = new Map<string, string>();
		let failOnce = true;
		const prisma = {
			setting: {
				findMany: vi.fn(async () => []),
				findUnique: vi.fn(async ({ where }: { where: { key: string } }) =>
					rows.has(where.key) ? { key: where.key, value: rows.get(where.key) } : null,
				),
				upsert: vi.fn(async ({ where, create }: { where: { key: string }; create: { value: string } }) => {
					if (where.key === "runWorkspace.locations" && failOnce) {
						failOnce = false;
						throw new Error("disk full");
					}
					rows.set(where.key, create.value);
				}),
				deleteMany: vi.fn(async () => ({ count: 0 })),
			},
		};
		const svc = new RunWorkspacesService(prisma as never);
		const settings = { ...DEFAULT_RUN_WORKSPACE_SETTINGS, location: "/runs/d" };
		await expect(svc.setGlobal(settings)).rejects.toThrow("disk full");
		expect(rows.has("runWorkspace.global")).toBe(false);
		await svc.setGlobal(settings);
		expect(JSON.parse(rows.get("runWorkspace.locations") as string)).toEqual(["/runs/d"]);
		expect(JSON.parse(rows.get("runWorkspace.global") as string).location).toBe("/runs/d");
	});
});

describe("RunWorkspacesService cloned copies (#925)", () => {
	it("a new folder remembers the one before it until its copies are unused", async () => {
		const rows = new Map<string, string>();
		const prisma = {
			setting: {
				findMany: vi.fn(async () => []),
				findUnique: vi.fn(async () => null),
				upsert: vi.fn(async ({ where, create }: { where: { key: string }; create: { value: string } }) => {
					rows.set(where.key, create.value);
				}),
				deleteMany: vi.fn(async () => ({ count: 0 })),
			},
		};
		const svc = new RunWorkspacesService(prisma as never);
		const first = await svc.setCopies("/copies/a");
		expect(first.copies.location).toBe("/copies/a");
		expect(first.copies.previous).toEqual([first.copies.defaultLocation]);
		const second = await svc.setCopies("/copies/b");
		expect(second.copies.previous).toEqual([first.copies.defaultLocation, "/copies/a"]);
		expect(JSON.parse(rows.get("runWorkspace.copies") as string)).toEqual({
			location: "/copies/b",
			previous: [first.copies.defaultLocation, "/copies/a"],
		});
		const same = await svc.setCopies("/copies/b");
		expect(same.copies.previous).toHaveLength(2);
	});
});
