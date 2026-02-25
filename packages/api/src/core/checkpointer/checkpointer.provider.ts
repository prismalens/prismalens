import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { createCheckpointer } from "@prismalens/agents";
import {
	buildCheckpointerUrl,
	getCheckpointerSchema,
	getConfig,
} from "@prismalens/config";

/**
 * Shared checkpointer provider for the API process.
 *
 * Creates a single checkpointer instance used by both QueueService (regular mode)
 * and ProgressService, avoiding duplicate connections to the same database.
 */
@Injectable()
export class CheckpointerProvider implements OnModuleInit {
	private readonly logger = new Logger(CheckpointerProvider.name);
	private checkpointer: Awaited<ReturnType<typeof createCheckpointer>> | null =
		null;

	async onModuleInit() {
		try {
			const config = getConfig();
			const connectionString = buildCheckpointerUrl(config);
			const schema =
				config.PRISMALENS_DB_TYPE === "postgresql"
					? getCheckpointerSchema(config)
					: undefined;
			this.checkpointer = await createCheckpointer({
				dbType: config.PRISMALENS_DB_TYPE,
				connectionString,
				schema,
			});
			this.logger.log(
				`Checkpointer initialized (${config.PRISMALENS_DB_TYPE})`,
			);
		} catch (error) {
			this.logger.warn(
				`Failed to initialize checkpointer: ${(error as Error).message}`,
			);
		}
	}

	/**
	 * Get the shared checkpointer instance.
	 * Returns null if initialization failed.
	 */
	get(): Awaited<ReturnType<typeof createCheckpointer>> | null {
		return this.checkpointer;
	}
}
