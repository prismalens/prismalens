// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { ORPCError } from "@orpc/nest";
import { ACCESS_SCOPE } from "@prismalens/auth";
import type { Request } from "express";
import { describe, expect, it, vi } from "vitest";
import { RunWorkspacesController } from "./run-workspaces.controller.js";
import type { RunWorkspacesService } from "./run-workspaces.service.js";

function makeRequest(isHostUser: boolean): Request {
	return {
		operator: {
			device: {
				scopes: isHostUser ? [ACCESS_SCOPE] : [],
			},
		},
	} as unknown as Request;
}

describe("RunWorkspacesController", () => {
	const mockService = {
		getGlobal: vi.fn(async () => ({
			settings: {} as any,
			defaultLocation: "/default/worktrees",
		})),
		setGlobal: vi.fn(async () => ({
			settings: {} as any,
			defaultLocation: "/default/worktrees",
		})),
		getService: vi.fn(async () => ({
			serviceId: "svc-1",
			override: {},
			effective: {} as any,
			inherited: [],
		})),
		setService: vi.fn(async () => ({
			serviceId: "svc-1",
			override: {},
			effective: {} as any,
			inherited: [],
		})),
		remove: vi.fn(async () => ({ removed: true, reason: "removed-by-user" })),
		open: vi.fn(() => ({ opened: true })),
		removals: vi.fn(async () => []),
		listForRun: vi.fn(() => []),
	};

	const controller = new RunWorkspacesController(
		mockService as unknown as RunWorkspacesService,
	);
	// biome-ignore lint/suspicious/noExplicitAny: oRPC handler extraction
	const procs = controller.runWorkspaces() as Record<string, any>;

	const getHandler = procs.get["~orpc"].handler;
	const updateHandler = procs.update["~orpc"].handler;
	const updateServiceHandler = procs.updateService["~orpc"].handler;
	const removeHandler = procs.remove["~orpc"].handler;
	const openHandler = procs.open["~orpc"].handler;

	it("update, updateService, remove, open throw ORPCError FORBIDDEN when the request is not the host", async () => {
		const nonHostReq = makeRequest(false);

		await expect(
			updateHandler({ input: {} as any, context: { request: nonHostReq } }),
		).rejects.toMatchObject({
			code: "FORBIDDEN",
		});

		await expect(
			updateServiceHandler({
				input: { serviceId: "svc-1", override: {} },
				context: { request: nonHostReq },
			}),
		).rejects.toMatchObject({
			code: "FORBIDDEN",
		});

		await expect(
			removeHandler({
				input: { runId: "run-1", dir: "/dir" },
				context: { request: nonHostReq },
			}),
		).rejects.toMatchObject({
			code: "FORBIDDEN",
		});

		expect(() =>
			openHandler({
				input: { runId: "run-1", dir: "/dir" },
				context: { request: nonHostReq },
			}),
		).toThrowError(
			expect.objectContaining({
				code: "FORBIDDEN",
			}),
		);
		expect(() =>
			openHandler({
				input: { runId: "run-1", dir: "/dir" },
				context: { request: nonHostReq },
			}),
		).toThrow(ORPCError);
	});

	it("get returns canEdit false for a paired device", async () => {
		const nonHostReq = makeRequest(false);
		const result = await getHandler({ context: { request: nonHostReq } });
		expect(result.canEdit).toBe(false);

		const hostReq = makeRequest(true);
		const hostResult = await getHandler({ context: { request: hostReq } });
		expect(hostResult.canEdit).toBe(true);
	});
});
