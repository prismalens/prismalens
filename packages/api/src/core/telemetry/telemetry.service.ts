// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Opt-in product telemetry (#602): how many installs reach a completed
 * investigation, and nothing else. Off until the owner says yes. Sends a random
 * install id, the version, OS and architecture, the event name, and the event's
 * own fields listed in {@link TelemetryEventProps}. Never a payload, a repo, a
 * title, a hostname or an error message. A failed send is dropped silently.
 */
import { randomUUID } from "node:crypto";
import { Injectable, Logger } from "@nestjs/common";
import type { TelemetrySettings } from "@prismalens/contracts";
import { resolveServiceVersion } from "../../shared/utils/service-version.js";
import { PrismaService } from "../prisma/prisma.service.js";

const SETTING_KEY = "TELEMETRY";
/** PostHog project key: a public, ingest-only key meant to ship in clients. */
const POSTHOG_KEY = "phc_nhC5zGT87zGtNR7VCZUw9gKRdtRJmBfZMYaXNZM7sgy2";
const POSTHOG_CAPTURE_URL = "https://us.i.posthog.com/i/v0/e/";
const SEND_TIMEOUT_MS = 3_000;
/** How long a terminal state is remembered, so one run reports once. */
const DEDUP_TTL_MS = 60 * 60_000;

export interface TelemetryEventProps {
	setup_completed: Record<string, never>;
	service_added: Record<string, never>;
	investigation_started: { harness: string | null };
	investigation_finished: { state: "completed" | "failed" | "cancelled" };
}
export type TelemetryEvent = keyof TelemetryEventProps;

interface StoredTelemetry {
	enabled: boolean;
	installId: string;
	setupReported?: boolean;
}

export function telemetryForcedOff(
	env: NodeJS.ProcessEnv = process.env,
): boolean {
	const value = env.PRISMALENS_TELEMETRY?.trim().toLowerCase();
	return value === "off" || value === "0" || value === "false";
}

@Injectable()
export class TelemetryService {
	private readonly logger = new Logger(TelemetryService.name);
	private readonly version = resolveServiceVersion();
	/**
	 * Investigations already reported terminal (a run can report failure through
	 * two ports), with the time each was recorded. Pruned by age so a long-lived
	 * install does not accumulate one entry per investigation forever.
	 */
	private readonly finished = new Map<string, number>();

	constructor(
		private readonly prisma: PrismaService,
		private readonly fetchImpl: typeof fetch = fetch,
	) {}

	private async read(): Promise<StoredTelemetry | null> {
		const row = await this.prisma.setting.findUnique({
			where: { key: SETTING_KEY },
		});
		if (!row) return null;
		try {
			const parsed = JSON.parse(row.value) as Partial<StoredTelemetry>;
			if (typeof parsed.enabled !== "boolean" || !parsed.installId) return null;
			return parsed as StoredTelemetry;
		} catch {
			return null;
		}
	}

	private async write(value: StoredTelemetry): Promise<void> {
		await this.prisma.setting.upsert({
			where: { key: SETTING_KEY },
			update: { value: JSON.stringify(value), type: "json" },
			create: {
				key: SETTING_KEY,
				value: JSON.stringify(value),
				type: "json",
				category: "general",
			},
		});
	}

	/** Whether anything would be sent, so a caller can skip gathering properties. */
	async isEnabled(): Promise<boolean> {
		if (telemetryForcedOff()) return false;
		return (await this.read())?.enabled === true;
	}

	async getSettings(): Promise<TelemetrySettings> {
		const stored = await this.read();
		const forcedOff = telemetryForcedOff();
		return {
			enabled: !forcedOff && (stored?.enabled ?? false),
			decided: stored !== null,
			forcedOff,
		};
	}

	async setEnabled(enabled: boolean): Promise<TelemetrySettings> {
		const stored = await this.read();
		const next: StoredTelemetry = {
			enabled,
			installId: stored?.installId ?? randomUUID(),
			setupReported: stored?.setupReported ?? false,
		};
		await this.write(next);
		// Setup finishes before anyone can be asked, so it is reported once, at opt-in.
		if (enabled && !next.setupReported && !telemetryForcedOff()) {
			await this.write({ ...next, setupReported: true });
			await this.capture("setup_completed", {});
		}
		return this.getSettings();
	}

	/** Report a terminal state once per investigation. */
	async captureFinished(
		investigationId: string,
		state: TelemetryEventProps["investigation_finished"]["state"],
	): Promise<void> {
		const now = Date.now();
		for (const [id, at] of this.finished) {
			if (now - at > DEDUP_TTL_MS) this.finished.delete(id);
		}
		if (this.finished.has(investigationId)) return;
		this.finished.set(investigationId, now);
		await this.capture("investigation_finished", { state });
	}

	/** Never throws and never delays the caller by more than one settings read. */
	async capture<E extends TelemetryEvent>(
		event: E,
		props: TelemetryEventProps[E],
	): Promise<void> {
		try {
			if (telemetryForcedOff()) return;
			const stored = await this.read();
			if (!stored?.enabled) return;
			void this.fetchImpl(POSTHOG_CAPTURE_URL, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					api_key: POSTHOG_KEY,
					event,
					distinct_id: stored.installId,
					properties: {
						...props,
						version: this.version,
						os: process.platform,
						arch: process.arch,
						$process_person_profile: false,
					},
				}),
				signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
			}).catch(() => undefined);
		} catch (e) {
			this.logger.debug(`telemetry skipped: ${String(e)}`);
		}
	}
}
