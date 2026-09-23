// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { type ExecutionContext, UnauthorizedException } from "@nestjs/common";
import type { Reflector } from "@nestjs/core";
import type { Session, User } from "@prismalens/auth";
import type { Request } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthGuard } from "./auth.guard.js";
import type { AuthService } from "./auth.service.js";
import type { OperatorResolver } from "./operator.resolver.js";
import { IS_PUBLIC_KEY } from "./public.decorator.js";

describe("AuthGuard", () => {
	let guard: AuthGuard;
	let mockReflector: { getAllAndOverride: ReturnType<typeof vi.fn> };
	let mockOperator: { resolve: ReturnType<typeof vi.fn> };
	let mockAuthService: AuthService;
	let request: Request;
	let mockContext: ExecutionContext;

	beforeEach(() => {
		mockReflector = {
			getAllAndOverride: vi.fn(),
		};
		mockOperator = {
			resolve: vi.fn(),
		};
		mockAuthService = {} as AuthService;

		request = {} as Request;
		mockContext = {
			getHandler: vi.fn(),
			getClass: vi.fn(),
			switchToHttp: vi.fn().mockReturnValue({
				getRequest: vi.fn().mockReturnValue(request),
			}),
		} as unknown as ExecutionContext;

		guard = new AuthGuard(
			mockAuthService,
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

	it('resolver returns {operator:{via:"session"}, user, session} -> true, all three set', async () => {
		mockReflector.getAllAndOverride.mockReturnValue(false);
		const user = { id: "user-2", email: "session-user@example.com" } as User;
		const session = { id: "session-1", userId: "user-2" } as Session;
		mockOperator.resolve.mockResolvedValue({
			operator: { via: "session" },
			user,
			session,
		});

		const result = await guard.canActivate(mockContext);

		expect(result).toBe(true);
		expect(request.operator).toEqual({ via: "session" });
		expect(request.user).toBe(user);
		expect(request.session).toBe(session);
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
