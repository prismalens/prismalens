import { BullModule } from "@nestjs/bullmq";
import { type DynamicModule, Global, Logger, Module, forwardRef } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { getConfig, buildRedisOptions } from "@prismalens/config";
import * as IORedis from "ioredis";
import { ChangeEventsModule } from "../../modules/change-events/change-events.module.js";
import { InvestigationsModule } from "../../modules/investigations/investigations.module.js";
import { QueueService } from "./queue.service.js";

const config = getConfig();
const logger = new Logger("QueueModule");

/**
 * Build Redis connection for queue mode.
 * Only called when PRISMALENS_WORKER_MODE === 'queue'.
 */
function buildRedisConnection(): IORedis.Redis | IORedis.Cluster {
	if (config.PRISMALENS_REDIS_CLUSTER_NODES) {
		const nodes = config.PRISMALENS_REDIS_CLUSTER_NODES.split(",").map(
			(node) => {
				const [host, port] = node.split(":");
				return { host, port: parseInt(port, 10) };
			},
		);
		const opts = buildRedisOptions(config);
		return new IORedis.Cluster(nodes, { redisOptions: opts });
	}
	return new IORedis.Redis(buildRedisOptions(config));
}

/**
 * Queue module with conditional BullMQ import based on worker mode.
 *
 * - regular mode: Direct execution via @prismalens/agents (no Redis)
 * - queue mode: Uses BullMQ with Redis for job queuing
 */
@Global()
@Module({})
export class QueueModule {
	static forRoot(): DynamicModule {
		const workerMode = config.PRISMALENS_MODE;
		const imports: any[] = [
			ConfigModule,
			forwardRef(() => InvestigationsModule),
			ChangeEventsModule,
		];

		if (workerMode === "queue") {
			logger.log("Queue mode: Initializing BullMQ with Redis connection");
			const redisConnection = buildRedisConnection();
			imports.push(
				BullModule.forRoot({
					connection: redisConnection,
				}),
			);
		} else {
			logger.log(
				"Regular mode: Using @prismalens/agents directly (no Redis required)",
			);
		}

		return {
			module: QueueModule,
			imports,
			providers: [QueueService],
			exports: [QueueService],
		};
	}
}
