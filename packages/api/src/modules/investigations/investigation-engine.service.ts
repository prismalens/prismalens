import { Injectable, Logger } from "@nestjs/common";
import type { LLMProviderId } from "@prismalens/config/llm";
import {
	createBackend,
	defaultTools,
	investigate,
	type Report,
	type StepEvent,
} from "@prismalens/engine";
import { PrismaService } from "../../core/prisma/prisma.service.js";
import { LlmSettingsService } from "../../core/settings/llm-settings.service.js";
import { DEFAULT_ENGINE_ALLOWLIST } from "./engine-allowlist.js";
import { InvestigationsService } from "./investigations.service.js";
import { StreamRelayService } from "./stream-relay.service.js";

/**
 * Runs the @prismalens/engine investigation loop IN-PROCESS (no Redis/worker).
 *
 * This is the local-first investigation path (ADR-0006): the loop runs inside the API,
 * streams its StepEvents through the (reused, untouched) StreamRelayService — so the
 * existing SSE endpoint serves them — and persists the final ordered-evidence Report
 * (ADR-0002) to `rawOutput`. The legacy worker/Redis path is left intact (its removal
 * is M4); this service is purely additive.
 */
@Injectable()
export class InvestigationEngineService {
	private readonly logger = new Logger(InvestigationEngineService.name);
	/** Investigation ids with an in-flight engine run (single-flight guard). */
	private readonly running = new Set<string>();

	constructor(
		private readonly prisma: PrismaService,
		private readonly streamRelay: StreamRelayService,
		private readonly investigations: InvestigationsService,
		private readonly llmSettings: LlmSettingsService,
	) {}

	/** True if an engine run is currently in flight for this investigation. */
	isRunning(investigationId: string): boolean {
		return this.running.has(investigationId);
	}

	/**
	 * Start an in-process investigation.
	 *
	 * Resolves the incident, validates LLM config, and builds the backend SYNCHRONOUSLY
	 * (so config errors — e.g. no provider configured — surface to the HTTP caller), marks
	 * the investigation `running`, then drives the engine loop in the background. The SSE
	 * stream and the DB are the channels the client observes.
	 */
	async start(investigationId: string): Promise<void> {
		if (this.running.has(investigationId)) {
			throw new Error(`Investigation ${investigationId} is already running`);
		}

		const incident = await this.buildIncidentPrompt(investigationId);
		const backend = await this.buildBackend();
		const tools = defaultTools(DEFAULT_ENGINE_ALLOWLIST);

		this.running.add(investigationId);
		await this.investigations.updateStatus(investigationId, "running");

		// Fire-and-forget: progress is observed via the SSE stream and DB, not the return.
		void this.consume(
			investigationId,
			investigate({ backend, tools, incident }),
		);
	}

	/**
	 * Drain a StepEvent stream: relay every event to subscribers and persist the final
	 * Report. Separated from {@link start} so it can be exercised with any event source.
	 */
	async consume(
		investigationId: string,
		events: AsyncIterable<StepEvent>,
	): Promise<void> {
		let report: Report | null = null;
		try {
			for await (const event of events) {
				// Reuse the relay verbatim — it carries [tag, payload] tuples (StreamTuple).
				this.streamRelay.emit(investigationId, [event.kind, event]);
				if (event.kind === "report") report = event.report;
			}

			if (report) {
				await this.investigations.writeEngineResult(investigationId, {
					summary: report.summary,
					rootCause: report.rootCause,
					rawOutput: report,
				});
			} else {
				await this.investigations.updateStatusInternal(
					investigationId,
					"failed",
					undefined,
					"Investigation ended without a report",
				);
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.logger.error(
				`Engine investigation ${investigationId} failed: ${message}`,
			);
			this.streamRelay.emit(investigationId, ["error", { message }]);
			await this.investigations.updateStatusInternal(
				investigationId,
				"failed",
				undefined,
				message,
			);
		} finally {
			this.running.delete(investigationId);
			this.streamRelay.complete(investigationId);
		}
	}

	/** Build a ModelBackend from the app's configured LLM provider (Settings → LLM). */
	private async buildBackend(): Promise<ReturnType<typeof createBackend>> {
		const settings = await this.llmSettings.getLlmSettings();
		const provider = settings.activeProvider as LLMProviderId | null;
		if (!provider) {
			throw new Error(
				"No active LLM provider configured. Configure one in Settings → LLM.",
			);
		}
		const providerCfg = settings.providers[provider];
		const model = providerCfg?.model;
		if (!model) {
			throw new Error(`No model configured for provider "${provider}".`);
		}
		const apiKey = this.llmSettings.resolveApiKey(provider) ?? undefined;
		return createBackend({
			provider,
			model,
			apiKey,
			baseUrl: providerCfg?.baseUrl,
		});
	}

	/** Compose the incident description the engine investigates. */
	private async buildIncidentPrompt(investigationId: string): Promise<string> {
		const investigation = await this.prisma.investigation.findUnique({
			where: { id: investigationId },
			select: { incidentId: true },
		});
		if (!investigation)
			throw new Error(`Investigation ${investigationId} not found`);

		const incident = await this.prisma.incident.findUnique({
			where: { id: investigation.incidentId },
			select: {
				number: true,
				title: true,
				description: true,
				severity: true,
				customerImpact: true,
				affectedSystems: true,
				alertCount: true,
				service: { select: { name: true } },
			},
		});
		if (!incident)
			throw new Error(`Incident ${investigation.incidentId} not found`);

		const lines = [
			`Incident INC-${incident.number}: ${incident.title}`,
			`Severity: ${incident.severity}`,
		];
		if (incident.service?.name)
			lines.push(`Affected service: ${incident.service.name}`);
		if (incident.alertCount)
			lines.push(`Correlated alerts: ${incident.alertCount}`);
		if (incident.description)
			lines.push(`Description: ${incident.description}`);
		if (incident.customerImpact)
			lines.push(`Customer impact: ${incident.customerImpact}`);
		if (incident.affectedSystems)
			lines.push(`Affected systems: ${incident.affectedSystems}`);
		lines.push(
			"",
			"Investigate the root cause using read-only commands, then submit a report.",
		);
		return lines.join("\n");
	}
}
