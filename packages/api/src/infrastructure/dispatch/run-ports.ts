// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The in-process boundary between the dispatch loop and the API's own Nest
 * services (0005 §2). This replaces the internal HTTP surface the forked
 * worker used to call — same operations, direct method calls instead of
 * fetch + X-Internal-Secret.
 */

import type { CanonicalEvent } from "@prismalens/contracts";
import type { InternalInvestigationResultDto } from "../../modules/investigations/dto/index.js";
import type { CreateTimelineEntryDto } from "../../modules/timeline/dto/index.js";

export interface RunPorts {
	findInvestigation(id: string): Promise<{ id: string; status: string } | null>;
	updateStatus(
		id: string,
		dto: {
			status: "running" | "failed" | "completed" | "cancelled";
			error?: string;
			harnessThreadId?: string;
			startedAt?: Date;
		},
	): Promise<void>;
	appendEvents(id: string, events: CanonicalEvent[]): Promise<void>;
	clearEvents(id: string): Promise<void>;
	writeResult(id: string, dto: InternalInvestigationResultDto): Promise<void>;
	createTimelineEntry(dto: CreateTimelineEntryDto): Promise<void>;
	resolveLlm(): Promise<{
		provider: string | null;
		model: string | null;
		baseUrl: string | null;
		credentials: Record<string, string>;
		harness: string;
	}>;
	integrationCredentials(connectionIds: string[]): Promise<
		Array<{
			type: string;
			connectionId: string;
			credentials: Record<string, unknown>;
			config: Record<string, unknown>;
			specUrl?: string | null;
		}>
	>;
	getIncident(id: string): Promise<Record<string, unknown> | null>;
	listServices(search: string): Promise<Array<Record<string, unknown>>>;
}
