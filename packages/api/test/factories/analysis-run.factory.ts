import { faker } from '@faker-js/faker';
import type { Investigation } from '../../prisma/generated/client.js';

/**
 * Factory for Investigation (replaces AnalysisRun)
 */
export class InvestigationFactory {
  static create(overrides?: Partial<Investigation>): Investigation {
    return {
      id: faker.string.uuid(),
      incidentId: faker.string.uuid(),
      status: faker.helpers.arrayElement(['pending', 'running', 'completed', 'failed']),
      summary: faker.lorem.paragraph(),
      rootCause: faker.lorem.sentence(),
      rootCauseCategory: faker.helpers.arrayElement(['code', 'config', 'infrastructure', 'external', 'unknown']),
      confidence: faker.number.float({ min: 0.5, max: 1.0, fractionDigits: 2 }),
      dataQuality: null,
      agentProgression: null,
      dataSourcesUsed: null,
      analysisMethod: faker.helpers.arrayElement(['multi-agent', 'single-agent', 'rule-based']),
      startedAt: null,
      completedAt: null,
      rawOutput: null,
      error: null,
      createdAt: faker.date.recent(),
      updatedAt: faker.date.recent(),
      ...overrides,
    };
  }

  static createMany(count: number, overrides?: Partial<Investigation>): Investigation[] {
    return Array.from({ length: count }, () => this.create(overrides));
  }
}

// Backwards compatibility alias
export { InvestigationFactory as AnalysisRunFactory };
