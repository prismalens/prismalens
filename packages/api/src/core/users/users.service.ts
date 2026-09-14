// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { ForbiddenException, Injectable } from "@nestjs/common";
import { AuthService } from "../auth/auth.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { CreateUserDto } from "./dto/create-user.dto.js";

/**
 * Users Service
 *
 * Handles user management operations. Since Better Auth manages authentication,
 * this service focuses on:
 * - Initial setup (first owner creation)
 * - User queries for application-level features
 */
@Injectable()
export class UsersService {
	constructor(
		private prisma: PrismaService,
		private authService: AuthService,
	) {}

	async findOne(email: string) {
		return this.prisma.user.findUnique({ where: { email } });
	}

	/** Setup is complete once the instance's one account exists (ADR 0001 §13). */
	async isSetupComplete(): Promise<boolean> {
		return !!(await this.prisma.user.findFirst({ select: { id: true } }));
	}

	/**
	 * Create the first owner account during initial setup.
	 * This uses Better Auth's signup API to properly hash passwords.
	 */
	async setupOwner(createUserDto: CreateUserDto) {
		if (await this.isSetupComplete()) {
			throw new ForbiddenException(
				"Instance already set up. Owner account exists.",
			);
		}

		// Use Better Auth's signup API to create the user with proper password hashing
		const result = await this.authService.auth.api.signUpEmail({
			body: {
				email: createUserDto.email,
				password: createUserDto.password,
				name: createUserDto.name ?? createUserDto.email.split("@")[0],
			},
		});

		if (!result?.user) {
			throw new Error("Failed to create user");
		}

		// `signUpEmail` auto-signs-in server-side; that token never reaches a browser, so
		// drop it. The browser session comes from `AuthService.createSessionCookies`.
		if (result.token) {
			await this.prisma.session.deleteMany({ where: { token: result.token } });
		}

		return result.user;
	}
}
