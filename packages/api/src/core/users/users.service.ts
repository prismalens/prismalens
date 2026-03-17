import { ForbiddenException, Injectable } from '@nestjs/common';
import { ADMIN_ROLES, type AppRole } from '@prismalens/auth';
import { AuthService } from '../auth/auth.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateUserDto } from './dto/create-user.dto.js';

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

  /**
   * Check if instance setup is complete (has an owner or admin user)
   */
  async isSetupComplete(): Promise<boolean> {
    const ownerOrAdmin = await this.prisma.user.findFirst({
      where: { role: { in: [...ADMIN_ROLES] } },
    });
    return !!ownerOrAdmin;
  }

  /**
   * Create the first owner account during initial setup.
   * This uses Better Auth's signup API to properly hash passwords.
   */
  async setupOwner(createUserDto: CreateUserDto) {
    // Check if any owner/admin exists
    const existingOwner = await this.prisma.user.findFirst({
      where: { role: { in: [...ADMIN_ROLES] } },
    });

    if (existingOwner) {
      throw new ForbiddenException(
        'Instance already set up. Owner account exists.',
      );
    }

    // Use Better Auth's signup API to create the user with proper password hashing
    const result = await this.authService.auth.api.signUpEmail({
      body: {
        email: createUserDto.email,
        password: createUserDto.password,
        name: createUserDto.name ?? createUserDto.email.split('@')[0],
      },
    });

    if (!result?.user) {
      throw new Error('Failed to create user');
    }

    // Update the user to be the instance owner
    const user = await this.prisma.user.update({
      where: { id: result.user.id },
      data: { role: 'owner' satisfies AppRole },
    });

    return user;
  }
}
