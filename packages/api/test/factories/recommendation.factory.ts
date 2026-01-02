import { faker } from '@faker-js/faker';
import type { Recommendation } from '../../prisma/generated/client.js';

export class RecommendationFactory {
  static create(overrides?: Partial<Recommendation>): Recommendation {
    return {
      id: faker.string.uuid(),
      investigationId: faker.string.uuid(),
      title: faker.lorem.sentence(),
      description: faker.lorem.paragraph(),
      priority: faker.helpers.arrayElement(['low', 'medium', 'high', 'critical']),
      category: faker.helpers.arrayElement(['performance', 'security', 'reliability', 'code', 'config']),
      urgency: faker.helpers.arrayElement(['immediate', 'short_term', 'long_term']),
      actionable: true,
      estimatedEffort: faker.helpers.arrayElement(['minutes', 'hours', 'days', 'weeks']),
      status: faker.helpers.arrayElement(['pending', 'in_progress', 'completed', 'dismissed']),
      implementedAt: null,
      implementedBy: null,
      createdAt: faker.date.recent(),
      updatedAt: faker.date.recent(),
      ...overrides,
    };
  }

  static createMany(count: number, overrides?: Partial<Recommendation>): Recommendation[] {
    return Array.from({ length: count }, () => this.create(overrides));
  }
}
