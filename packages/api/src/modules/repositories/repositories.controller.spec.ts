// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ACCESS_SCOPE } from "@prismalens/auth";
import { afterAll, describe, expect, it, vi } from "vitest";
import { RepositoriesController } from "./repositories.controller.js";
import { RepositoriesService } from "./repositories.service.js";

const REPO_ID = "11111111-1111-4111-8111-111111111111";
const SCRIPT_ID = "22222222-2222-4222-8222-222222222222";

const request = (owner: boolean) => ({
	operator: { device: { scopes: owner ? [ACCESS_SCOPE] : [] } },
});

type Callable = {
	"~orpc": { handler: (o: { input: unknown; context: unknown }) => unknown };
};
const call = (r: unknown, input: unknown, owner = true) =>
	(r as Callable)["~orpc"].handler({
		input,
		context: { request: request(owner) },
	});

const tempDir = mkdtempSync(join(tmpdir(), "pl-repo-scripts-"));
writeFileSync(
	join(tempDir, "package.json"),
	JSON.stringify({ scripts: { build: "vite build" } }),
);
afterAll(() => rmSync(tempDir, { recursive: true, force: true }));

describe("RepositoriesController scripts routes (#1176)", () => {
	it("scripts route lists stored then detected scripts, and 404s for unknown repo", async () => {
		const repo = {
			id: REPO_ID,
			sourceKind: "folder",
			url: tempDir,
			subPath: null,
			metadata: JSON.stringify({
				scripts: [{ id: SCRIPT_ID, name: "lint", command: "biome check" }],
			}),
		};
		const service = {
			findById: vi
				.fn()
				.mockResolvedValueOnce(repo)
				.mockResolvedValueOnce(null),
		};
		const controller = new RepositoriesController(
			service as never,
			{} as never,
		);
		const routes = controller.repositories();

		const listed = (await call(routes.scripts, { id: REPO_ID })) as {
			scripts: Array<{ name: string; runner: string }>;
		};
		expect(listed.scripts).toEqual([
			{
				runner: "custom",
				id: SCRIPT_ID,
				name: "lint",
				command: "biome check",
			},
			{
				runner: "npm",
				name: "build",
				command: "npm run build",
			},
		]);

		await expect(call(routes.scripts, { id: REPO_ID })).rejects.toThrow(
			/not found/i,
		);
	});

	it("addScript adds a script for the owner, and refuses a non-owner write without saving", async () => {
		const editScripts = vi.fn().mockResolvedValue([
			{
				runner: "custom",
				id: SCRIPT_ID,
				name: "seed",
				command: "pnpm db:seed",
			},
		]);
		const service = { editScripts };
		const controller = new RepositoriesController(
			service as never,
			{} as never,
		);
		const routes = controller.repositories();

		// Non-owner write is refused
		await expect(
			call(
				routes.addScript,
				{ id: REPO_ID, name: "seed", command: "pnpm db:seed" },
				false,
			),
		).rejects.toThrow("Only the owner adds project scripts.");
		expect(editScripts).not.toHaveBeenCalled();

		// Owner write succeeds
		const result = await call(
			routes.addScript,
			{ id: REPO_ID, name: "seed", command: "pnpm db:seed" },
			true,
		);
		expect(result).toEqual({
			scripts: [
				{
					runner: "custom",
					id: SCRIPT_ID,
					name: "seed",
					command: "pnpm db:seed",
				},
			],
		});
		expect(editScripts).toHaveBeenCalledWith(REPO_ID, {
			op: "add",
			name: "seed",
			command: "pnpm db:seed",
		});
	});

	it("updateScript edits a stored script for owner, and refuses non-owner", async () => {
		const editScripts = vi.fn().mockResolvedValue([
			{
				runner: "custom",
				id: SCRIPT_ID,
				name: "seed:fresh",
				command: "pnpm db:seed --fresh",
			},
		]);
		const service = { editScripts };
		const controller = new RepositoriesController(
			service as never,
			{} as never,
		);
		const routes = controller.repositories();

		// Non-owner write refused
		await expect(
			call(
				routes.updateScript,
				{
					id: REPO_ID,
					scriptId: SCRIPT_ID,
					name: "seed:fresh",
					command: "pnpm db:seed --fresh",
				},
				false,
			),
		).rejects.toThrow("Only the owner adds project scripts.");
		expect(editScripts).not.toHaveBeenCalled();

		// Owner succeeds
		const result = await call(
			routes.updateScript,
			{
				id: REPO_ID,
				scriptId: SCRIPT_ID,
				name: "seed:fresh",
				command: "pnpm db:seed --fresh",
			},
			true,
		);
		expect(result).toEqual({
			scripts: [
				{
					runner: "custom",
					id: SCRIPT_ID,
					name: "seed:fresh",
					command: "pnpm db:seed --fresh",
				},
			],
		});
		expect(editScripts).toHaveBeenCalledWith(REPO_ID, {
			op: "update",
			scriptId: SCRIPT_ID,
			name: "seed:fresh",
			command: "pnpm db:seed --fresh",
		});
	});

	it("removeScript removes a stored script for owner, and refuses non-owner", async () => {
		const editScripts = vi.fn().mockResolvedValue([]);
		const service = { editScripts };
		const controller = new RepositoriesController(
			service as never,
			{} as never,
		);
		const routes = controller.repositories();

		// Non-owner write refused
		await expect(
			call(
				routes.removeScript,
				{ id: REPO_ID, scriptId: SCRIPT_ID },
				false,
			),
		).rejects.toThrow("Only the owner adds project scripts.");
		expect(editScripts).not.toHaveBeenCalled();

		// Owner succeeds
		const result = await call(
			routes.removeScript,
			{ id: REPO_ID, scriptId: SCRIPT_ID },
			true,
		);
		expect(result).toEqual({ scripts: [] });
		expect(editScripts).toHaveBeenCalledWith(REPO_ID, {
			op: "remove",
			scriptId: SCRIPT_ID,
		});
	});
});

describe("RepositoriesService editScripts (#1176)", () => {
	function makePrisma(initialRepo: { id: string; metadata: string | null } | null) {
		let current = initialRepo;
		return {
			repository: {
				findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
					return current && current.id === where.id ? { ...current, sourceKind: "url", url: "https://github.com/a/b", subPath: null } : null;
				}),
				update: vi.fn(async ({ where, data }: { where: { id: string }; data: { metadata: string } }) => {
					if (!current || current.id !== where.id) throw new Error("not found");
					current = { ...current, metadata: data.metadata };
					return { ...current, sourceKind: "url", url: "https://github.com/a/b", subPath: null };
				}),
			},
			getMetadata: () => current?.metadata,
		};
	}

	it("adds, edits, and removes scripts in repository metadata, keeping other keys", async () => {
		const prisma = makePrisma({
			id: REPO_ID,
			metadata: JSON.stringify({ keep: "yes", scripts: [] }),
		});
		const svc = new RepositoriesService(
			prisma as never,
			{} as never,
			{} as never,
			{} as never,
		);

		// Add
		const afterAdd = await svc.editScripts(REPO_ID, {
			op: "add",
			name: "lint",
			command: "pnpm lint",
		});
		expect(afterAdd).toHaveLength(1);
		expect(afterAdd[0]?.name).toBe("lint");
		expect(afterAdd[0]?.runner).toBe("custom");
		const scriptId = String(afterAdd[0]?.id);
		expect(scriptId.length).toBeGreaterThan(10);

		// Verify metadata preserved other keys
		const meta1 = JSON.parse(String(prisma.getMetadata()));
		expect(meta1.keep).toBe("yes");
		expect(meta1.scripts).toHaveLength(1);

		// Update
		const afterUpdate = await svc.editScripts(REPO_ID, {
			op: "update",
			scriptId,
			name: "lint:all",
			command: "pnpm lint --all",
		});
		expect(afterUpdate).toHaveLength(1);
		expect(afterUpdate[0]?.name).toBe("lint:all");
		expect(afterUpdate[0]?.command).toBe("pnpm lint --all");

		// Remove
		const afterRemove = await svc.editScripts(REPO_ID, {
			op: "remove",
			scriptId,
		});
		expect(afterRemove).toHaveLength(0);
		const meta2 = JSON.parse(String(prisma.getMetadata()));
		expect(meta2.keep).toBe("yes");
		expect(meta2.scripts).toEqual([]);
	});

	it("throws NotFoundException when repository is not found", async () => {
		const prisma = makePrisma(null);
		const svc = new RepositoriesService(
			prisma as never,
			{} as never,
			{} as never,
			{} as never,
		);

		await expect(
			svc.editScripts("nonexistent", { op: "add", name: "a", command: "b" }),
		).rejects.toThrow("Repository not found");
	});

	it("throws BadRequestException when adding to a repository with 50 scripts", async () => {
		const scripts = Array.from({ length: 50 }, (_, i) => ({
			id: `id-${i}`,
			name: `s-${i}`,
			command: `echo ${i}`,
		}));
		const prisma = makePrisma({
			id: REPO_ID,
			metadata: JSON.stringify({ scripts }),
		});
		const svc = new RepositoriesService(
			prisma as never,
			{} as never,
			{} as never,
			{} as never,
		);

		await expect(
			svc.editScripts(REPO_ID, { op: "add", name: "new", command: "echo new" }),
		).rejects.toThrow("This project holds 50 scripts already");
	});

	it("throws NotFoundException when updating or removing an unknown script id", async () => {
		const prisma = makePrisma({
			id: REPO_ID,
			metadata: JSON.stringify({ scripts: [] }),
		});
		const svc = new RepositoriesService(
			prisma as never,
			{} as never,
			{} as never,
			{} as never,
		);

		await expect(
			svc.editScripts(REPO_ID, {
				op: "update",
				scriptId: "missing-id",
				name: "x",
				command: "y",
			}),
		).rejects.toThrow("Script not found");

		await expect(
			svc.editScripts(REPO_ID, {
				op: "remove",
				scriptId: "missing-id",
			}),
		).rejects.toThrow("Script not found");
	});
});
