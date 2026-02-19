import {
	BadRequestException,
	Controller,
	Get,
	HttpCode,
	HttpStatus,
	Query,
	UseGuards,
} from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import { Public } from "../../core/auth/public.decorator.js";
import { IntegrationsService } from "../../modules/integrations/integrations.service.js";
import { InternalGuard } from "./guards/internal.guard.js";

const MAX_CONNECTION_IDS = 50;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Internal API for integration credential retrieval.
 * Used by the worker to fetch decrypted credentials on-demand.
 * Protected by InternalGuard (requires X-Internal-Secret header).
 *
 * SECURITY: This endpoint returns decrypted credentials.
 * Only accessible via X-Internal-Secret — never exposed publicly.
 * @Public() skips AuthGuard (session-based) — InternalGuard handles auth via X-Internal-Secret.
 */
@Public()
@ApiExcludeController()
@Controller("internal/integrations")
@UseGuards(InternalGuard)
export class InternalIntegrationsController {
	constructor(
		private readonly integrationsService: IntegrationsService,
	) {}

	/**
	 * Fetch integration contexts by connection IDs.
	 * Worker passes connectionIds from job data → API decrypts and returns.
	 *
	 * GET /internal/integrations/credentials?connectionIds=id1,id2
	 */
	@Get("credentials")
	@HttpCode(HttpStatus.OK)
	async getCredentials(
		@Query("connectionIds") connectionIdsParam?: string,
	): Promise<
		Array<{
			type: string;
			connectionId: string;
			credentials: Record<string, unknown>;
			config: Record<string, unknown>;
		}>
	> {
		if (!connectionIdsParam) {
			return [];
		}

		const connectionIds = connectionIdsParam
			.split(",")
			.map((id) => id.trim())
			.filter(Boolean);

		if (connectionIds.length > MAX_CONNECTION_IDS) {
			throw new BadRequestException(
				`Too many connection IDs (max ${MAX_CONNECTION_IDS})`,
			);
		}

		// Validate each ID is a valid UUID format
		for (const id of connectionIds) {
			if (!UUID_PATTERN.test(id)) {
				throw new BadRequestException(
					`Invalid connection ID format: ${id.slice(0, 10)}...`,
				);
			}
		}

		return this.integrationsService.getIntegrationsByConnectionIds(
			connectionIds,
		);
	}
}
