// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Deploys as ChangeEvents (#854): pushed from CI or pulled from GitHub, one row shape
 * keyed on service, environment, version and status so a repeat never doubles it.
 */
import { Injectable } from "@nestjs/common";
import type {
	DeployWebhook,
	DeployWebhookResponse,
} from "@prismalens/contracts/schemas";
import { PrismaService } from "../../core/prisma/prisma.service.js";

export interface DeployRecord {
	service: { id: string; name: string };
	version: string;
	environment: string;
	status: "succeeded" | "failed" | "started";
	source: "push" | "github";
	actor?: string | null;
	url?: string | null;
	sha?: string | null;
	repo?: string | null;
	at: Date;
}

const VERB = {
	succeeded: "Deployed",
	failed: "Deploy failed:",
	started: "Deploy started:",
} as const;

export function deployRow(d: DeployRecord) {
	return {
		dedupeKey: `deploy:${d.service.name}:${d.environment}:${d.version}:${d.status}`,
		type: "deployment",
		source: d.source,
		timestamp: d.at,
		serviceId: d.service.id,
		description: `${VERB[d.status]} ${d.service.name} ${d.version} to ${d.environment}`,
		metadata: JSON.stringify({
			version: d.version,
			environment: d.environment,
			status: d.status,
			source: d.source,
			actor: d.actor ?? null,
			url: d.url ?? null,
			sha: d.sha ?? null,
			repo: d.repo ?? null,
		}),
	};
}

@Injectable()
export class DeployEventsService {
	constructor(private readonly prisma: PrismaService) {}

	/** Null when no service has this name. */
	async record(input: DeployWebhook): Promise<DeployWebhookResponse | null> {
		const service = await this.prisma.service.findUnique({
			where: { name: input.service },
			select: { id: true, name: true },
		});
		if (!service) return null;
		const at = input.timestamp ? new Date(input.timestamp) : new Date();
		const row = deployRow({
			service,
			version: input.version,
			environment: input.environment ?? "production",
			status: input.status ?? "succeeded",
			source: "push",
			actor: input.actor,
			url: input.url,
			sha: input.sha,
			at: Number.isNaN(at.getTime()) ? new Date() : at,
		});
		const existing = await this.prisma.changeEvent.findUnique({
			where: { dedupeKey: row.dedupeKey },
			select: { id: true },
		});
		if (existing) return { id: existing.id, created: false };
		const made = await this.prisma.changeEvent.upsert({
			where: { dedupeKey: row.dedupeKey },
			create: row,
			update: {},
			select: { id: true },
		});
		return { id: made.id, created: true };
	}
}
