// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { ORPCError } from "@orpc/nest";
import { ACCESS_SCOPE, OPERATE_SCOPE, READ_SCOPE } from "@prismalens/auth";
import type { Request } from "express";
import { describe, expect, it, vi } from "vitest";
import { InvestigationsController } from "../../modules/investigations/investigations.controller.js";
import { ThreadsController } from "../../modules/threads/threads.controller.js";
import {
	isOwner,
	OWNER_ONLY,
	requireOperate,
	requireOwner,
	VIEW_ONLY,
} from "./owner.js";

describe("owner and operate checks", () => {
	const req = (scopes?: string[]) =>
		({
			operator: scopes ? { device: { id: "dev", scopes } } : undefined,
		}) as unknown as Request;

	it("requireOperate refuses a view-only device and passes an operate device", () => {
		expect(() => requireOperate(req([READ_SCOPE]))).toThrow(ORPCError);
		expect(() => requireOperate(req([]))).toThrow(ORPCError);
		expect(() => requireOperate(req())).toThrow(ORPCError);
		try {
			requireOperate(req([READ_SCOPE]));
		} catch (error) {
			expect(error).toBeInstanceOf(ORPCError);
			expect((error as ORPCError<never, never>).code).toBe("FORBIDDEN");
			expect((error as ORPCError<never, never>).message).toBe(VIEW_ONLY);
		}

		expect(() => requireOperate(req([OPERATE_SCOPE]))).not.toThrow();
		expect(() => requireOperate(req([READ_SCOPE, OPERATE_SCOPE]))).not.toThrow();
	});

	it("threads.start refuses a view-only device FORBIDDEN before the service is called", async () => {
		const threads = { start: vi.fn(async () => ({ id: "t1" })) };
		const controller = new ThreadsController(
			threads as never,
			{} as never,
			{} as never,
			{} as never,
			{} as never,
			{} as never,
			{} as never,
			{} as never,
		);
		const route = controller.routes().start;
		// biome-ignore lint/suspicious/noExplicitAny: invoke procedure handler directly
		const handler = (route as any)["~orpc"].handler;

		expect(() =>
			handler({
				input: { subject: { kind: "none" }, text: "hello" },
				context: { request: req([READ_SCOPE]) },
			}),
		).toThrowError(
			expect.objectContaining({
				code: "FORBIDDEN",
				message: VIEW_ONLY,
			}),
		);
		expect(threads.start).not.toHaveBeenCalled();

		await handler({
			input: { subject: { kind: "none" }, text: "hello" },
			context: { request: req([READ_SCOPE, OPERATE_SCOPE]) },
		});
		expect(threads.start).toHaveBeenCalledTimes(1);
	});

	it("investigations.create refuses a view-only device FORBIDDEN before the service is called", async () => {
		const now = new Date();
		const investigationsService = {
			startOrGet: vi.fn(async () => ({
				investigation: {
					id: "inv-1",
					incidentId: "inc-1",
					status: "running",
					createdAt: now,
					updatedAt: now,
				},
				created: true,
			})),
		};
		const controller = new InvestigationsController(
			investigationsService as never,
			{} as never,
			{} as never,
			{} as never,
			{} as never,
			{} as never,
			{} as never,
			{} as never,
			{} as never,
		);
		const route = controller.investigations().create;
		// biome-ignore lint/suspicious/noExplicitAny: invoke procedure handler directly
		const handler = (route as any)["~orpc"].handler;

		await expect(
			handler({
				input: { incidentId: "inc-1" },
				context: { request: req([READ_SCOPE]) },
			}),
		).rejects.toMatchObject({
			code: "FORBIDDEN",
			message: VIEW_ONLY,
		});
		expect(investigationsService.startOrGet).not.toHaveBeenCalled();

		const res = await handler({
			input: { incidentId: "inc-1" },
			context: { request: req([READ_SCOPE, OPERATE_SCOPE]) },
		});
		expect(res.id).toBe("inv-1");
		expect(investigationsService.startOrGet).toHaveBeenCalledTimes(1);
	});

	it("isOwner and requireOwner check ACCESS_SCOPE", () => {
		expect(isOwner(req([ACCESS_SCOPE]))).toBe(true);
		expect(isOwner(req([READ_SCOPE]))).toBe(false);
		expect(requireOwner(req([ACCESS_SCOPE]))).toBe("dev");
		expect(() => requireOwner(req([READ_SCOPE]))).toThrow(ORPCError);
	});

	it.each([
		["setAutoResume", [READ_SCOPE], VIEW_ONLY],
		["editMessage", [READ_SCOPE], VIEW_ONLY],
		["withdrawMessage", [READ_SCOPE], VIEW_ONLY],
		["updateStatus", [READ_SCOPE, OPERATE_SCOPE], OWNER_ONLY],
		["writeResult", [READ_SCOPE, OPERATE_SCOPE], OWNER_ONLY],
	] as const)(
		"investigations.%s refuses a device without the scope before reading the run",
		async (name, scopes, message) => {
			const investigationsService = { findById: vi.fn() };
			const controller = new InvestigationsController(
				investigationsService as never,
				{} as never,
				{} as never,
				{} as never,
				{} as never,
				{} as never,
				{} as never,
				{} as never,
				{} as never,
			);
			const routes = controller.investigations() as Record<string, unknown>;
			// biome-ignore lint/suspicious/noExplicitAny: invoke procedure handler directly
			const handler = (routes[name] as any)["~orpc"].handler;
			await expect(
				handler({
					input: { id: "inv-1" },
					context: { request: req([...scopes]) },
					errors: {},
				}),
			).rejects.toMatchObject({ code: "FORBIDDEN", message });
			expect(investigationsService.findById).not.toHaveBeenCalled();
		},
	);
});
