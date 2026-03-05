import { Controller, UseGuards } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { Implement, implement, ORPCError } from '@orpc/nest';
import { setupContract, type SetupStep } from '@prismalens/contracts';
import { PrismaService } from '../prisma/prisma.service.js';
import { UsersService } from '../users/users.service.js';
import { Public } from '../auth/public.decorator.js';

// Public: setup runs before any user exists, so auth is not possible.
// createOwner is self-guarding ("already set up" check).
// @Public() must be class-level because @Implement generates individual
// route handlers — method-level @Public() doesn't propagate to them.
@Public()
@UseGuards(ThrottlerGuard)
@Controller()
export class SetupController {
  constructor(
    private readonly usersService: UsersService,
    private readonly prisma: PrismaService,
  ) {}

  @Implement(setupContract)
  setup() {
    return {
      // GET /setup/status
      getStatus: implement(setupContract.getStatus).handler(async () => {
        const ownerComplete = await this.usersService.isSetupComplete();
        const currentStep: SetupStep = ownerComplete ? 'complete' : 'account';

        return {
          setupComplete: ownerComplete,
          steps: { owner: ownerComplete },
          currentStep,
        };
      }),

      // POST /setup
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
    };
  }
}
