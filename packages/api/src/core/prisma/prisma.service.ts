// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	Injectable,
	Logger,
	OnModuleDestroy,
	OnModuleInit,
} from "@nestjs/common";
import { prisma } from "@prismalens/database";
import { liveChanges } from "../live/live-changes.js";

/** Every write is noted for the live change stream after it succeeds, a transaction's after it commits (walk f27). */
const db = prisma.$extends({
	query: {
		$allModels: {
			async $allOperations({ model, operation, args, query }) {
				const result = await query(args);
				liveChanges.noteWrite(model, operation);
				return result;
			},
		},
	},
});

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
		const bound = db.$transaction.bind(db);
		const run = bound as (...args: unknown[]) => Promise<unknown>;
		return ((...args: unknown[]) =>
			liveChanges.afterCommit(() => run(...args))) as typeof bound;
	}

	// Forward all Prisma model access
	get user() {
		return db.user;
	}

	get alert() {
		return db.alert;
	}

	get alertSourceAlert() {
		return db.alertSourceAlert;
	}

	get recommendation() {
		return db.recommendation;
	}

	get investigation() {
		return db.investigation;
	}

	get investigationEvent() {
		return db.investigationEvent;
	}

	/** The dispatch JobStore's table (claim / heartbeat / reclaim). */
	get job() {
		return db.job;
	}

	get incident() {
		return db.incident;
	}

	get service() {
		return db.service;
	}

	get integration() {
		return db.integration;
	}

	get connection() {
		return db.connection;
	}

	get serviceIntegration() {
		return db.serviceIntegration;
	}

	get event() {
		return db.event;
	}

	get timelineEntry() {
		return db.timelineEntry;
	}

	get serviceDependency() {
		return db.serviceDependency;
	}

	get setting() {
		return db.setting;
	}

	get changeEvent() {
		return db.changeEvent;
	}

	get repository() {
		return db.repository;
	}

	get serviceRepository() {
		return db.serviceRepository;
	}

	get incidentSimilarity() {
		return db.incidentSimilarity;
	}

	// Device pairing (ADR 0004 §8)
	get pairingLink() {
		return db.pairingLink;
	}

	get deviceSession() {
		return db.deviceSession;
	}

	get verification() {
		return db.verification;
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
