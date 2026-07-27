// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	Injectable,
	Logger,
	OnModuleDestroy,
	OnModuleInit,
} from "@nestjs/common";
import { prisma } from "@prismalens/database";

@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
	private readonly logger = new Logger(PrismaService.name);

	// Expose the prisma instance methods
	get $connect() {
		return prisma.$connect.bind(prisma);
	}

	get $disconnect() {
		return prisma.$disconnect.bind(prisma);
	}

	get $transaction() {
		return prisma.$transaction.bind(prisma);
	}

	// Forward all Prisma model access
	get user(): (typeof prisma)["user"] {
		return prisma.user;
	}

	get alert(): (typeof prisma)["alert"] {
		return prisma.alert;
	}

	get recommendation(): (typeof prisma)["recommendation"] {
		return prisma.recommendation;
	}

	get investigation(): (typeof prisma)["investigation"] {
		return prisma.investigation;
	}

	get investigationEvent(): (typeof prisma)["investigationEvent"] {
		return prisma.investigationEvent;
	}

	get incident(): (typeof prisma)["incident"] {
		return prisma.incident;
	}

	get service(): (typeof prisma)["service"] {
		return prisma.service;
	}

	get integration(): (typeof prisma)["integration"] {
		return prisma.integration;
	}

	get connection(): (typeof prisma)["connection"] {
		return prisma.connection;
	}

	get oAuthState(): (typeof prisma)["oAuthState"] {
		return prisma.oAuthState;
	}

	get serviceIntegration(): (typeof prisma)["serviceIntegration"] {
		return prisma.serviceIntegration;
	}

	get agentExecution(): (typeof prisma)["agentExecution"] {
		return prisma.agentExecution;
	}

	get toolExecution(): (typeof prisma)["toolExecution"] {
		return prisma.toolExecution;
	}

	get event(): (typeof prisma)["event"] {
		return prisma.event;
	}

	get timelineEntry(): (typeof prisma)["timelineEntry"] {
		return prisma.timelineEntry;
	}

	get correlationRule(): (typeof prisma)["correlationRule"] {
		return prisma.correlationRule;
	}

	get alertMappingRule(): (typeof prisma)["alertMappingRule"] {
		return prisma.alertMappingRule;
	}

	get serviceDependency(): (typeof prisma)["serviceDependency"] {
		return prisma.serviceDependency;
	}

	get serviceSuggestion(): (typeof prisma)["serviceSuggestion"] {
		return prisma.serviceSuggestion;
	}

	get setting(): (typeof prisma)["setting"] {
		return prisma.setting;
	}

	get postmortem(): (typeof prisma)["postmortem"] {
		return prisma.postmortem;
	}

	get changeEvent(): (typeof prisma)["changeEvent"] {
		return prisma.changeEvent;
	}

	get repository(): (typeof prisma)["repository"] {
		return prisma.repository;
	}

	get serviceRepository(): (typeof prisma)["serviceRepository"] {
		return prisma.serviceRepository;
	}

	get deployment(): (typeof prisma)["deployment"] {
		return prisma.deployment;
	}

	get incidentSimilarity(): (typeof prisma)["incidentSimilarity"] {
		return prisma.incidentSimilarity;
	}

	// Better Auth models
	get session(): (typeof prisma)["session"] {
		return prisma.session;
	}

	get account(): (typeof prisma)["account"] {
		return prisma.account;
	}

	get verification(): (typeof prisma)["verification"] {
		return prisma.verification;
	}

	get organization(): (typeof prisma)["organization"] {
		return prisma.organization;
	}

	get member(): (typeof prisma)["member"] {
		return prisma.member;
	}

	get invitation(): (typeof prisma)["invitation"] {
		return prisma.invitation;
	}

	async onModuleInit(): Promise<void> {
		try {
			await prisma.$connect();
			this.logger.log("Database connection established");
		} catch (error) {
			this.logger.error("Database connection failed!");
			this.logger.error('Run "pnpm db:init" to initialize the database');
			throw error;
		}
	}

	async onModuleDestroy(): Promise<void> {
		await prisma.$disconnect();
		this.logger.log("Database connection closed");
	}
}
