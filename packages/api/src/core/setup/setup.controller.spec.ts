// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Regression cover for #358: completing the setup wizard has to leave a session
 * cookie, not just a created account.
 */

import { Logger } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import { ThrottlerGuard } from "@nestjs/throttler";
import { AuthService } from "../auth/auth.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { LlmSettingsService } from "../settings/llm-settings.service.js";
import { UsersService } from "../users/users.service.js";
import { SetupController } from "./setup.controller.js";

const OWNER = {
	id: "user-1",
	email: "owner@example.com",
	name: "Owner",
	role: "owner",
};

const SESSION_COOKIE =
	"prismalens.session_token=abc123; Path=/; HttpOnly; SameSite=Lax";
const DATA_COOKIE =
	"prismalens.session_data=cached; Path=/; HttpOnly; SameSite=Lax";

const mockUsersService = {
	isSetupComplete: vi.fn(),
	setupOwner: vi.fn(),
};

const mockAuthService = {
	createSessionCookies: vi.fn(),
};

const mockLlmSettingsService = {
	getLlmCredentialStatus: vi.fn(),
	getLlmSettings: vi.fn(),
};

describe("SetupController", () => {
	let controller: SetupController;
	let res: { append: ReturnType<typeof vi.fn> };

	beforeEach(async () => {
		vi.clearAllMocks();
		vi.spyOn(Logger.prototype, "log").mockImplementation(() => {});
		vi.spyOn(Logger.prototype, "warn").mockImplementation(() => {});

		res = { append: vi.fn() };

		const module: TestingModule = await Test.createTestingModule({
			controllers: [SetupController],
			providers: [
				{ provide: UsersService, useValue: mockUsersService },
				{ provide: AuthService, useValue: mockAuthService },
				{ provide: PrismaService, useValue: {} },
				{ provide: LlmSettingsService, useValue: mockLlmSettingsService },
			],
		})
			.overrideGuard(ThrottlerGuard)
			.useValue({ canActivate: () => true })
			.compile();

		controller = module.get<SetupController>(SetupController);
	});

	// Unwrap oRPC ImplementedProcedure objects: each value is a DecoratedProcedure
	// whose actual handler function lives at ['~orpc'].handler
	// biome-ignore lint/suspicious/noExplicitAny: oRPC internals are untyped here
	function getHandlers(): any {
		// biome-ignore lint/suspicious/noExplicitAny: oRPC internals are untyped here
		const procedures = controller.setup() as Record<string, any>;
		return Object.fromEntries(
			Object.entries(procedures).map(([key, proc]) => [
				key,
				proc?.["~orpc"]?.handler ?? proc,
			]),
		);
	}

	function callCreateOwner() {
		return getHandlers().createOwner({
			input: {
				email: OWNER.email,
				password: "hunter2hunter2",
				name: OWNER.name,
			},
			context: { request: { res } },
		});
	}

	it("puts Better Auth's session cookies on the response so a reload stays signed in", async () => {
		mockUsersService.setupOwner.mockResolvedValue(OWNER);
		const headers = new Headers();
		headers.append("set-cookie", SESSION_COOKIE);
		headers.append("set-cookie", DATA_COOKIE);
		mockAuthService.createSessionCookies.mockResolvedValue(headers);

		const result = await callCreateOwner();

		expect(mockAuthService.createSessionCookies).toHaveBeenCalledWith({
			email: OWNER.email,
			password: "hunter2hunter2",
		});
		// Each cookie appended separately — a comma-joined single header would be
		// unparseable once a cookie carries an `Expires` date.
		expect(res.append).toHaveBeenCalledWith("Set-Cookie", SESSION_COOKIE);
		expect(res.append).toHaveBeenCalledWith("Set-Cookie", DATA_COOKIE);
		expect(result.user.email).toBe(OWNER.email);
	});

	it("signs in only after the owner role is written, so the cached session is not stale", async () => {
		const order: string[] = [];
		mockUsersService.setupOwner.mockImplementation(async () => {
			order.push("setupOwner");
			return OWNER;
		});
		mockAuthService.createSessionCookies.mockImplementation(async () => {
			order.push("createSessionCookies");
			return new Headers();
		});

		await callCreateOwner();

		expect(order).toEqual(["setupOwner", "createSessionCookies"]);
	});

	it("still returns the created owner when the session cannot be established", async () => {
		mockUsersService.setupOwner.mockResolvedValue(OWNER);
		mockAuthService.createSessionCookies.mockRejectedValue(
			new Error("auth unavailable"),
		);

		const result = await callCreateOwner();

		expect(result.user.email).toBe(OWNER.email);
		expect(res.append).not.toHaveBeenCalled();
	});

	it("maps an already-set-up instance to FORBIDDEN", async () => {
		mockUsersService.setupOwner.mockRejectedValue(
			new Error("Instance already set up. Owner account exists."),
		);

		await expect(callCreateOwner()).rejects.toMatchObject({
			code: "FORBIDDEN",
		});
		expect(mockAuthService.createSessionCookies).not.toHaveBeenCalled();
	});
});
