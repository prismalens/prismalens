// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	Injectable,
	Logger,
	type OnApplicationBootstrap,
} from "@nestjs/common";
import { seedDemoData } from "@prismalens/database";
import { PrismaService } from "../../core/prisma/prisma.service.js";
import { UsersService } from "../../core/users/users.service.js";

@Injectable()
export class DevSeedService implements OnApplicationBootstrap {
	private readonly logger = new Logger(DevSeedService.name);

	constructor(
		private readonly usersService: UsersService,
		private readonly prisma: PrismaService,
	) {}

	async onApplicationBootstrap(): Promise<void> {
		if (
			process.env.NODE_ENV !== "development" &&
			process.env.PRISMALENS_SEED_DEMO !== "1"
		) {
			return;
		}

		try {
			const isSetup = await this.usersService.isSetupComplete();
			if (!isSetup) {
				this.logger.log("Seeding default owner user...");
				await this.usersService.setupOwner({
					email: "admin@prismalens.dev",
					password: "admin123",
					name: "Admin",
				});
				this.logger.log("Default owner user created");
			}

			const alertCount = await this.prisma.alert.count();
			if (alertCount === 0) {
				this.logger.log("Seeding demo data into empty database...");
				await seedDemoData(this.prisma);
				this.logger.log("Demo data seeded successfully");
			}
		} catch (error) {
			this.logger.error(
				`Dev seed failed: ${
					error instanceof Error ? error.message : String(error)
				}`,
			);
		}
	}
}
