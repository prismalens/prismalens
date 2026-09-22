// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { type ExecutionContext, UnauthorizedException } from "@nestjs/common";
import type { Reflector } from "@nestjs/core";
import type { DeviceRecord } from "@prismalens/auth";
import type { Request } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthGuard } from "./auth.guard.js";
import type { OperatorResolver } from "./operator.resolver.js";
import { IS_PUBLIC_KEY } from "./public.decorator.js";

describe("AuthGuard", () => {
	let guard: AuthGuard;
	let mockReflector: { getAllAndOverride: ReturnType<typeof vi.fn> };
	let mockOperator: { resolve: ReturnType<typeof vi.fn> };
	let request: Request;
	let mockContext: ExecutionContext;

	beforeEach(() => {
		mockReflector = {
			getAllAndOverride: vi.fn(),
		};
		mockOperator = {
			resolve: vi.fn(),
		};

		request = {} as Request;
		mockContext = {
			getHandler: vi.fn(),
			getClass: vi.fn(),
			switchToHttp: vi.fn().mockReturnValue({
				getRequest: vi.fn().mockReturnValue(request),
			}),
		} as unknown as ExecutionContext;

		guard = new AuthGuard(
			mockOperator as unknown as OperatorResolver,
			mockReflector as unknown as Reflector,
		);
	});

	it("@Public() handler -> true, resolver never called", async () => {
		mockReflector.getAllAndOverride.mockReturnValue(true);

		const result = await guard.canActivate(mockContext);

		expect(result).toBe(true);
		expect(mockReflector.getAllAndOverride).toHaveBeenCalledWith(
			IS_PUBLIC_KEY,
			[mockContext.getHandler(), mockContext.getClass()],
		);
		expect(mockOperator.resolve).not.toHaveBeenCalled();
	});

	it('resolver returns {via:"loopback"} -> true, request.operator set', async () => {
		mockReflector.getAllAndOverride.mockReturnValue(false);
		mockOperator.resolve.mockResolvedValue({ via: "loopback" });

		const result = await guard.canActivate(mockContext);

		expect(result).toBe(true);
		expect(request.operator).toEqual({ via: "loopback" });
	});

	it('resolver returns {via:"device", device} -> true, request.operator set', async () => {
		mockReflector.getAllAndOverride.mockReturnValue(false);
		const device = {
			id: "device-1",
			name: "Ada's phone",
			scopes: [],
			createdAt: new Date(),
			lastSeenAt: null,
			revokedAt: null,
		} as DeviceRecord;
		mockOperator.resolve.mockResolvedValue({ via: "device", device });

		const result = await guard.canActivate(mockContext);

		expect(result).toBe(true);
		expect(request.operator).toEqual({ via: "device", device });
	});

	it("resolver returns null -> throws UnauthorizedException", async () => {
		mockReflector.getAllAndOverride.mockReturnValue(false);
		mockOperator.resolve.mockResolvedValue(null);

		await expect(guard.canActivate(mockContext)).rejects.toThrow(
			UnauthorizedException,
		);
		await expect(guard.canActivate(mockContext)).rejects.toThrow(
			"Authentication required",
		);
	});

	it("resolver throws a plain Error -> throws UnauthorizedException (not the raw error)", async () => {
		mockReflector.getAllAndOverride.mockReturnValue(false);
		const plainError = new Error("Database outage");
		mockOperator.resolve.mockRejectedValue(plainError);

		await expect(guard.canActivate(mockContext)).rejects.toThrow(
			UnauthorizedException,
		);

		try {
			await guard.canActivate(mockContext);
			expect.unreachable("Expected canActivate to throw");
		} catch (error) {
			expect(error).toBeInstanceOf(UnauthorizedException);
			expect(error).not.toBe(plainError);
			expect((error as UnauthorizedException).message).toBe(
				"Authentication required",
			);
		}
	});
});
