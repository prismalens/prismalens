import { Controller } from "@nestjs/common";
import { Implement, implement, ORPCError } from "@orpc/nest";
import { setupContract, type SetupStep } from "@prismalens/contracts";
import { PrismaService } from "../prisma/prisma.service.js";
import { UsersService } from "../users/users.service.js";
import { Public } from "../auth/public.decorator.js";

// Public: setup runs before any user exists, so auth is not possible.
// createOwner is self-guarding ("already set up" check).
// markStepSkipped only toggles non-destructive "skipped" flags.
@Public()
@Controller()
export class SetupController {
	constructor(
		private readonly usersService: UsersService,
		private readonly prisma: PrismaService,
	) {}

	/**
	 * Check if LLM is configured OR skipped
	 */
	private async checkLlmComplete(): Promise<boolean> {
		// LLM is complete if settings exist (has activeProvider set)
		const configured = await this.prisma.setting.findUnique({
			where: { key: "LLM_SETTINGS" },
		});
		if (configured) {
			try {
				const settings = JSON.parse(configured.value);
				if (settings.activeProvider) return true;
			} catch {
				// Invalid JSON — treat as not configured
			}
		}

		// Or if explicitly skipped
		const skipped = await this.prisma.setting.findUnique({
			where: { key: "SETUP_SKIPPED_LLM" },
		});
		return skipped !== null;
	}

	/**
	 * Check if integrations are connected OR skipped
	 */
	private async checkIntegrationsComplete(): Promise<boolean> {
		// Integrations complete if at least 1 connected
		const count = await this.prisma.integrationConnection.count();
		if (count > 0) return true;

		// Or if explicitly skipped
		const skipped = await this.prisma.setting.findUnique({
			where: { key: "SETUP_SKIPPED_INTEGRATIONS" },
		});
		return skipped !== null;
	}

	/**
	 * Implement the setup contract for initial setup operations
	 * All endpoints are type-safe with input validation via Zod
	 */
	@Implement(setupContract)
	setup() {
		return {
			// GET /setup/status - Check if setup is complete (public: needed before login)
			getStatus: implement(setupContract.getStatus).handler(async () => {
				const ownerComplete = await this.usersService.isSetupComplete();
				const llmComplete = await this.checkLlmComplete();
				const integrationsComplete = await this.checkIntegrationsComplete();

				// Determine the current step based on completion status
				let currentStep: SetupStep;
				if (!ownerComplete) {
					currentStep = "account";
				} else if (!llmComplete) {
					currentStep = "ai";
				} else if (!integrationsComplete) {
					currentStep = "integration";
				} else {
					currentStep = "complete";
				}

				return {
					setupComplete: currentStep === "complete",
					steps: {
						owner: ownerComplete,
						llm: llmComplete,
						integrations: integrationsComplete,
					},
					currentStep,
				};
			}),

			// POST /setup - Create the first admin account
			createOwner: implement(setupContract.createOwner).handler(
				async ({ input }) => {
					try {
						const user = await this.usersService.setupOwner({
							email: input.email,
							password: input.password,
							name: input.name,
						});
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

			// POST /setup/skip - Mark an optional step as skipped
			markStepSkipped: implement(setupContract.markStepSkipped).handler(
				async ({ input }) => {
					const key =
						input.step === "ai"
							? "SETUP_SKIPPED_LLM"
							: "SETUP_SKIPPED_INTEGRATIONS";

					await this.prisma.setting.upsert({
						where: { key },
						update: { value: "true" },
						create: { key, value: "true", type: "boolean", category: "setup" },
					});

					return { success: true };
				},
			),
		};
	}
}
