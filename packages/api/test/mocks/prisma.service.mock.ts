import type { PrismaService } from '../../src/core/prisma/prisma.service.js';

/**
 * Creates a mock PrismaService for testing.
 * Provides Prisma model mocks that can be configured with jest.spyOn()
 */
export function createPrismaMock(): jest.Mocked<PrismaService> {
  const mockPrisma = {
    alert: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
    analysisRun: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
    recommendation: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
    $disconnect: jest.fn(),
  } as unknown as jest.Mocked<PrismaService>;

  return mockPrisma;
}
