import { Controller, UseGuards } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { Implement, implement, ORPCError } from '@orpc/nest';
import { setupContract, type SetupStep } from '@prismalens/contracts';
import type { ModelsListResponse } from '@prismalens/contracts/schemas';
import { PrismaService } from '../prisma/prisma.service.js';
import { LlmSettingsService } from '../settings/llm-settings.service.js';
import { UsersService } from '../users/users.service.js';
import { Public } from '../auth/public.decorator.js';

// Public: setup runs before any user exists, so auth is not possible.
// createOwner is self-guarding ("already set up" check).
// Mutation endpoints (saveLlmCredential, updateLlmSettings, etc.) are guarded
// inline by assertSetupNotComplete() to block access after setup.
// ThrottlerGuard prevents brute-force / spam on public endpoints.
@Public()
@UseGuards(ThrottlerGuard)
@Controller()
export class SetupController {
  constructor(
    private readonly usersService: UsersService,
    private readonly prisma: PrismaService,
    private readonly llmSettingsService: LlmSettingsService,
  ) {}

  /**
   * Check if LLM is configured OR skipped
   */
  private async checkLlmComplete(): Promise<boolean> {
    // LLM is complete if settings exist (has activeProvider set)
    const configured = await this.prisma.setting.findUnique({
      where: { key: 'LLM_SETTINGS' },
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
      where: { key: 'SETUP_SKIPPED_LLM' },
    });
    return skipped !== null;
  }

  /**
   * Block mutation endpoints once setup is complete.
   * Read-only endpoints (getStatus, getLlmEnvStatus, getLlmModels) remain open.
   * createOwner is self-guarding via usersService.setupOwner().
   */
  private async assertSetupNotComplete(): Promise<void> {
    const isComplete = await this.usersService.isSetupComplete();
    if (isComplete) {
      throw new ORPCError('FORBIDDEN', {
        message:
          'Setup already complete. Use authenticated settings endpoints instead.',
      });
    }
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
      where: { key: 'SETUP_SKIPPED_INTEGRATIONS' },
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
          currentStep = 'account';
        } else if (!llmComplete) {
          currentStep = 'ai';
        } else if (!integrationsComplete) {
          currentStep = 'integration';
        } else {
          currentStep = 'complete';
        }

        return {
          setupComplete: currentStep === 'complete',
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
              error.message.includes('already set up')
            ) {
              throw new ORPCError('FORBIDDEN', {
                message: 'Instance already set up. Admin account exists.',
              });
            }
            throw error;
          }
        },
      ),

      // POST /setup/skip - Mark an optional step as skipped
      markStepSkipped: implement(setupContract.markStepSkipped).handler(
        async ({ input }) => {
          await this.assertSetupNotComplete();
          const key =
            input.step === 'ai'
              ? 'SETUP_SKIPPED_LLM'
              : 'SETUP_SKIPPED_INTEGRATIONS';

          await this.prisma.setting.upsert({
            where: { key },
            update: { value: 'true' },
            create: { key, value: 'true', type: 'boolean', category: 'setup' },
          });

          return { success: true };
        },
      ),

      // GET /setup/llm/env-status - LLM env status (public for setup wizard)
      getLlmEnvStatus: implement(setupContract.getLlmEnvStatus).handler(
        async () => {
          return this.llmSettingsService.getLlmEnvStatus();
        },
      ),

      // GET /setup/llm/models - Available models (public for setup wizard)
      getLlmModels: implement(setupContract.getLlmModels).handler(
        async ({ input }) => {
          return this.llmSettingsService.getAvailableModels(
            input.provider,
          ) as Promise<ModelsListResponse>;
        },
      ),

      // POST /setup/llm/credentials - Save API key (public for setup wizard)
      saveLlmCredential: implement(setupContract.saveLlmCredential).handler(
        async ({ input }) => {
          await this.assertSetupNotComplete();
          await this.llmSettingsService.saveLlmCredential(
            input.provider,
            input.apiKey,
          );
          return { success: true };
        },
      ),

      // PUT /setup/llm/settings - Update LLM settings (public for setup wizard)
      updateLlmSettings: implement(setupContract.updateLlmSettings).handler(
        async ({ input }) => {
          await this.assertSetupNotComplete();
          return this.llmSettingsService.updateLlmSettings(input);
        },
      ),

      // POST /setup/llm/test-connection - Test connection (public for setup wizard)
      testLlmConnection: implement(setupContract.testLlmConnection).handler(
        async ({ input }) => {
          await this.assertSetupNotComplete();
          return this.llmSettingsService.testLlmConnectionWithEnv(
            input.provider,
            input.model,
            input.baseUrl,
          );
        },
      ),
    };
  }
}
