import { faker } from "@faker-js/faker";
import type { Alert } from "@prismalens/database";

export class AlertFactory {
	static create(overrides?: Partial<Alert>): Alert {
		const id = faker.string.uuid();
		return {
			id,
			tenantId: null,
			source: faker.helpers.arrayElement([
				"prometheus",
				"github",
				"render",
				"datadog",
			]),
			externalId: faker.string.hexadecimal({ length: 16 }),
			dedupKey: faker.string.hexadecimal({ length: 32 }),
			fingerprint: faker.string.hexadecimal({ length: 32 }),
			severity: faker.helpers.arrayElement([
				"low",
				"medium",
				"high",
				"critical",
				"info",
			]),
			title: faker.lorem.sentence(),
			description: faker.lorem.paragraph(),
			sourceUrl: faker.internet.url(),
			rawPayload: null,
			tags: null,
			labels: null,
			status: "triggered",
			triggeredAt: faker.date.recent(),
			acknowledgedAt: null,
			resolvedAt: null,
			occurrenceCount: 1,
			lastOccurrence: faker.date.recent(),
			createdAt: faker.date.recent(),
			updatedAt: faker.date.recent(),
			serviceId: null,
			incidentId: null,
			...overrides,
		};
	}

	static createMany(count: number, overrides?: Partial<Alert>): Alert[] {
		return Array.from({ length: count }, () => AlertFactory.create(overrides));
	}
}
