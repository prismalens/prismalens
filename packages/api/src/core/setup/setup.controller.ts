// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Controller, Logger, UseGuards } from "@nestjs/common";
import { ThrottlerGuard } from "@nestjs/throttler";
import { Implement, implement, ORPCError } from "@orpc/nest";
import { type SetupStep, setupContract } from "@prismalens/contracts";
import { AuthService } from "../auth/auth.service.js";
import { Public } from "../auth/public.decorator.js";
import { applySetCookieHeaders } from "../auth/session-cookies.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { LlmSettingsService } from "../settings/llm-settings.service.js";
import { UsersService } from "../users/users.service.js";

/** Providers that work without an API key, so "no credential" is not "not configured". */
const KEYLESS_PROVIDERS = new Set(["ollama", "custom"]);

// Public: setup runs before any user exists, so auth is not possible.
// createOwner is self-guarding ("already set up" check).
// @Public() must be class-level because @Implement generates individual
// route handlers — method-level @Public() doesn't propagate to them.
//
// getStatus therefore answers unauthenticated callers. It returns BOOLEANS ONLY
// — never a provider name, a checkout path, or a count — so the most an
// unauthenticated caller on a single-tenant instance learns is how far its
// operator got through the wizard. Before an owner exists it short-circuits and
// probes nothing at all.
@Public()
@UseGuards(ThrottlerGuard)
@Controller()
export class SetupController {
	private readonly logger = new Logger(SetupController.name);

	constructor(
		private readonly usersService: UsersService,
		private readonly authService: AuthService,
		private readonly prisma: PrismaService,
		private readonly llmSettingsService: LlmSettingsService,
	) {}

	/**
	 * Is an LLM provider usable? True when any provider has a key (stored
	 * encrypted in the DB, or supplied by env), or when the operator has
	 * deliberately made a keyless provider active and given it a model.
	 *
	 * Deliberately does NOT call `getLlmEnvStatus()`: that pings Ollama over
	 * HTTP, and this handler runs on an unauthenticated route that the app's
	 * layout hits on load. Setup status must stay three cheap reads.
	 */
	private async isAiProviderConfigured(): Promise<boolean> {
		const credentialStatus =
			await this.llmSettingsService.getLlmCredentialStatus();
		if (
			Object.values(credentialStatus).some((s) => s.hasDbKey || s.hasEnvKey)
		) {
			return true;
		}

		const settings = await this.llmSettingsService.getLlmSettings();
		const active = settings.activeProvider;
		return (
			!!active &&
			KEYLESS_PROVIDERS.has(active) &&
			!!settings.providers[active]?.model
		);
	}

	@Implement(setupContract)
	setup() {
		return {
			// GET /setup/status
			getStatus: implement(setupContract.getStatus).handler(async () => {
				const owner = await this.usersService.isSetupComplete();

				// No owner yet: nothing downstream can be true, and an
				// unauthenticated caller gets told nothing about the instance.
				if (!owner) {
					return {
						setupComplete: false,
						steps: {
							owner: false,
							aiProvider: false,
							codeLocation: false,
							firstIncident: false,
						},
						currentStep: "account" as SetupStep,
					};
				}

				const [aiProvider, mappedServices, incidents] = await Promise.all([
					this.isAiProviderConfigured(),
					this.prisma.service.count({
						where: { localCheckoutPath: { not: null } },
					}),
					this.prisma.incident.count(),
				]);

				const steps = {
					owner,
					aiProvider,
					codeLocation: mappedServices > 0,
					firstIncident: incidents > 0,
				};

				// currentStep is the first incomplete step. Order is the contract's
				// own enum order, so the progress bar cannot drift from the server.
				let currentStep: SetupStep = "complete";
				if (!steps.owner) currentStep = "account";
				else if (!steps.aiProvider) currentStep = "ai_provider";
				else if (!steps.codeLocation) currentStep = "code_location";
				else if (!steps.firstIncident) currentStep = "first_incident";

				return {
					// An owner exists — the app is usable. The remaining steps are
					// on-ramp, not a gate.
					setupComplete: true,
					steps,
					currentStep,
				};
			}),

			// POST /setup
			createOwner: implement(setupContract.createOwner).handler(
				async ({ input, context }) => {
					try {
						const user = await this.usersService.setupOwner({
							email: input.email,
							password: input.password,
							name: input.name,
						});

						// Finishing the wizard has to leave the browser signed in
						// (#358). `setupOwner` runs Better Auth server-side, so the
						// Set-Cookie it produces goes nowhere — the response the client
						// gets is plain JSON, and the first reload bounced the
						// brand-new owner to the login screen. Ask for a real session
						// through the same route the login form posts to and put its
						// cookies on this response.
						//
						// A failure here is not worth losing the account over: the
						// owner exists and can sign in by hand, which is strictly the
						// old behaviour. Warn and carry on rather than 500 after a
						// successful write.
						try {
							const headers = await this.authService.createSessionCookies({
								email: input.email,
								password: input.password,
							});
							applySetCookieHeaders(headers, context.request.res);
						} catch (sessionError) {
							this.logger.warn(
								`Owner account created but the setup session could not be established (${
									sessionError instanceof Error
										? sessionError.message
										: String(sessionError)
								}). Sign in from the login page to continue.`,
							);
						}

						return {
							user: {
								id: user.id,
								email: user.email,
								name: user.name,
								role: user.role,
							},
						};
					} catch (error) {
						if (
							error instanceof Error &&
							error.message.includes("already set up")
						) {
							throw new ORPCError("FORBIDDEN", {
								message: "Instance already set up. Admin account exists.",
							});
						}
						throw error;
					}
				},
			),
		};
	}
}
