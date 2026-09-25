// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Opt-in product telemetry (#602). Off until the owner says yes in Settings;
 * the CLI never prompts.
 *
 * The rule that shapes everything below: **every property is an enum, a bucket
 * or a boolean.** There is no free-text property anywhere in the taxonomy, and
 * {@link sanitize} drops any value that is not a declared member before a
 * request is built, so a future call site cannot widen the payload by accident.
 * `telemetry.service.spec.ts` asserts that over the whole taxonomy.
 *
 * Never sent: alert payloads, repository names or URLs, prompts, model output,
 * keys, hostnames, workspace paths, emails, names, raw error strings, or a
 * timestamp per alert. Low-entropy values are not hashed — hashing `linux` to
 * look careful would only make the payload harder to read.
 *
 * The install id is a random UUID kept in the workspace database. It is stable
 * per install and therefore pseudonymous, i.e. personal data under GDPR Recital
 * 26; the Settings disclosure says so, and the toggle is the Art 7(3)
 * withdrawal. A factory reset deletes the row, so the id does not survive it.
 *
 * PostHog ingest is a raw `fetch` (no `posthog-node`, and never `posthog-js` in
 * the frontend). That costs us the wrapper's defaults, so they are set by hand:
 * `$geoip_disable` — without it PostHog attaches `$ip` and city-level
 * `$geoip_*` to every server-side event at ingest — plus `$lib`/`$lib_version`
 * and `$process_person_profile: false`.
 */
import { randomUUID } from "node:crypto";
import {
	Injectable,
	Logger,
	type OnApplicationBootstrap,
	type OnModuleDestroy,
} from "@nestjs/common";
import {
	INSTALL_CHANNELS,
	type InstallChannel,
	installChannel,
} from "@prismalens/config";
import { HARNESS_IDS } from "@prismalens/config/harness";
import type { TelemetrySettings } from "@prismalens/contracts";
import { resolveServiceVersion } from "../../shared/utils/service-version.js";
import { PrismaService } from "../prisma/prisma.service.js";

const SETTING_KEY = "TELEMETRY";
/** PostHog project key: a public, ingest-only key meant to ship in clients. */
const POSTHOG_KEY = "phc_pCgmw347sL5wFdtsf5eTG4NEki5DyyFwHNXiyUjT5UcW";
const POSTHOG_CAPTURE_URL = "https://eu.i.posthog.com/i/v0/e/";
const SEND_TIMEOUT_MS = 3_000;
/** How long a per-entity "already reported" marker is remembered in memory. */
const DEDUP_TTL_MS = 60 * 60_000;

/** Identifies this client to PostHog in place of an SDK's own value. */
const LIB_NAME = "prismalens-api";

/** How this copy was installed; the same closed set `pl doctor` names (#717). */
export const RUN_MODES = INSTALL_CHANNELS;
export type RunMode = InstallChannel;

export function runMode(
	env: NodeJS.ProcessEnv = process.env,
	execPath: string = process.execPath,
): RunMode {
	return installChannel(env, execPath);
}

export const BUILD_MODES = ["release", "dev"] as const;
export type BuildMode = (typeof BUILD_MODES)[number];

export function build(env: NodeJS.ProcessEnv = process.env): BuildMode {
	return env.NODE_ENV === "production" ? "release" : "dev";
}

export function utcDayString(date: Date): string {
	return date.toISOString().slice(0, 10);
}

export function utcMidnightTimestamp(date: Date): string {
	return `${utcDayString(date)}T00:00:00.000Z`;
}

export const SERVICE_SOURCES = ["local", "git"] as const;
export const INTEGRATION_KINDS = [
	"github",
	"slack",
	"render",
	"other",
] as const;
export const WEBHOOK_PROVIDERS = ["prometheus", "generic", "render"] as const;
export const INVESTIGATION_TRIGGERS = ["manual", "webhook", "other"] as const;
export const INVESTIGATION_STATES = [
	"completed",
	"failed",
	"cancelled",
] as const;
export const DURATION_BUCKETS = ["<1m", "1-5m", "5-15m", ">15m"] as const;
export const EXPORT_TARGETS = ["markdown", "slack", "github"] as const;
/**
 * A closed vocabulary for why a run ended badly. Derived from the error by
 * {@link classifyError}, which matches shapes and returns one of these — the
 * error text itself never leaves the process.
 */
export const ERROR_CLASSES = [
	"none",
	"cancelled",
	"harness_unavailable",
	"harness_exited",
	"timeout",
	"repo_unavailable",
	"auth",
	"network",
	"other",
] as const;

/**
 * `Investigation.triggerType` reduced to how the run was asked for. The stored
 * vocabulary is wider than the two cases that matter, and `other` keeps this a
 * closed enum rather than labelling an unmapped trigger as a webhook.
 */
export function triggerFor(triggerType?: string | null): InvestigationTrigger {
	if (triggerType === "manual") return "manual";
	if (
		triggerType === "auto_critical" ||
		triggerType === "auto_tier" ||
		triggerType === "alert_threshold"
	) {
		return "webhook";
	}
	return "other";
}

/**
 * An integration template id reduced to its vendor. `other` keeps the property
 * a closed enum when a template this build does not know about is configured —
 * the id itself is never sent.
 */
export function integrationKindFor(templateId: string): IntegrationKind {
	const id = templateId.toLowerCase();
	if (id.startsWith("github")) return "github";
	if (id.startsWith("slack")) return "slack";
	if (id.startsWith("render")) return "render";
	return "other";
}

export type ServiceSource = (typeof SERVICE_SOURCES)[number];
export type IntegrationKind = (typeof INTEGRATION_KINDS)[number];
export type WebhookProvider = (typeof WEBHOOK_PROVIDERS)[number];
export type InvestigationTrigger = (typeof INVESTIGATION_TRIGGERS)[number];
export type InvestigationState = (typeof INVESTIGATION_STATES)[number];
export type DurationBucket = (typeof DURATION_BUCKETS)[number];
export type ExportTarget = (typeof EXPORT_TARGETS)[number];
export type ErrorClass = (typeof ERROR_CLASSES)[number];

export interface TelemetryEventProps {
	setup_completed: Record<string, never>;
	service_added: { source: ServiceSource };
	integration_configured: { kind: IntegrationKind };
	/** The first inbound alert only, ever. Cadence per alert is content. */
	first_webhook_received: { provider: WebhookProvider };
	investigation_started: {
		harness: (typeof HARNESS_IDS)[number] | null;
		trigger: InvestigationTrigger;
	};
	investigation_finished: {
		state: InvestigationState;
		duration_bucket: DurationBucket;
		error_class: ErrorClass;
	};
	report_viewed: Record<string, never>;
	report_exported: { target: ExportTarget };
	incident_closed: Record<string, never>;
	install_active: Record<string, never>;
}
export type TelemetryEvent = keyof TelemetryEventProps;

/**
 * Every property name the taxonomy may carry, and the closed set of values it
 * may take. `"number"` marks a bounded integer (`node_major`). Anything absent
 * from this table, or carrying a value outside it, is dropped before sending.
 */
export const ALLOWED_PROPERTY_VALUES: Record<
	string,
	readonly (string | number | boolean | null)[] | "number"
> = {
	source: SERVICE_SOURCES,
	kind: INTEGRATION_KINDS,
	provider: WEBHOOK_PROVIDERS,
	harness: [...HARNESS_IDS, null],
	trigger: INVESTIGATION_TRIGGERS,
	state: INVESTIGATION_STATES,
	duration_bucket: DURATION_BUCKETS,
	error_class: ERROR_CLASSES,
	target: EXPORT_TARGETS,
	run_mode: RUN_MODES,
	build: BUILD_MODES,
	os: ["aix", "darwin", "freebsd", "linux", "openbsd", "sunos", "win32"],
	arch: [
		"arm",
		"arm64",
		"ia32",
		"loong64",
		"mips",
		"mipsel",
		"ppc",
		"ppc64",
		"riscv64",
		"s390",
		"s390x",
		"x64",
	],
	node_major: "number",
};

/** The one place the outbound property set is narrowed. */
export function sanitize(
	props: Record<string, unknown>,
): Record<string, string | number | boolean | null> {
	const out: Record<string, string | number | boolean | null> = {};
	for (const [key, value] of Object.entries(props)) {
		const allowed = ALLOWED_PROPERTY_VALUES[key];
		if (allowed === "number") {
			if (typeof value === "number" && Number.isInteger(value))
				out[key] = value;
			continue;
		}
		if (!allowed) continue;
		if (
			typeof value === "string" ||
			typeof value === "number" ||
			typeof value === "boolean" ||
			value === null
		) {
			if ((allowed as readonly unknown[]).includes(value)) out[key] = value;
		}
	}
	return out;
}

/** Buckets rather than a duration: the exact number is a fingerprint. */
export function durationBucket(ms: number): DurationBucket {
	if (!Number.isFinite(ms) || ms < 60_000) return "<1m";
	if (ms < 5 * 60_000) return "1-5m";
	if (ms < 15 * 60_000) return "5-15m";
	return ">15m";
}

/**
 * Shape-match an error to one of {@link ERROR_CLASSES}. The text is read here
 * and discarded; only the class is ever sent.
 */
export function classifyError(
	state: InvestigationState,
	error?: string | null,
): ErrorClass {
	if (state === "cancelled") return "cancelled";
	if (state === "completed" || !error) return "none";
	const text = error.toLowerCase();
	if (/not found on path|no harness|not installed|enoent/.test(text)) {
		return "harness_unavailable";
	}
	if (/timed out|timeout|etimedout|deadline/.test(text)) return "timeout";
	if (/abort|cancel/.test(text)) return "cancelled";
	if (/clone|checkout|repository|git /.test(text)) return "repo_unavailable";
	if (/unauthor|forbidden|401|403|credential|api key|token/.test(text)) {
		return "auth";
	}
	if (/econnrefused|enotfound|econnreset|network|socket|dns/.test(text)) {
		return "network";
	}
	if (/exit(ed)? (with )?(code|status)|signal|crashed|epipe/.test(text)) {
		return "harness_exited";
	}
	return "other";
}

interface StoredTelemetry {
	enabled: boolean;
	installId: string;
	setupReported?: boolean;
	/** `first_webhook_received` is once per install, so it outlives the process. */
	firstWebhookReported?: boolean;
	/** The UTC day `install_active` was last reported ("YYYY-MM-DD"). */
	lastActiveDay?: string;
}

/** `DO_NOT_TRACK` counts as set for anything but empty, `0`, `false`, `off`. */
function doNotTrack(env: NodeJS.ProcessEnv): boolean {
	const value = env.DO_NOT_TRACK?.trim().toLowerCase();
	return (
		value !== undefined &&
		value !== "" &&
		!["0", "false", "off"].includes(value)
	);
}

/**
 * Three ways to force telemetry off regardless of the stored answer:
 * `PRISMALENS_TELEMETRY=off`, the cross-vendor `DO_NOT_TRACK`, and `CI` —
 * an automated run cannot give consent, so it is never counted as an install.
 */
export function telemetryForcedOff(
	env: NodeJS.ProcessEnv = process.env,
): boolean {
	const value = env.PRISMALENS_TELEMETRY?.trim().toLowerCase();
	if (value === "off" || value === "0" || value === "false") return true;
	if (doNotTrack(env)) return true;
	return env.CI !== undefined && env.CI !== "";
}

@Injectable()
export class TelemetryService
	implements OnApplicationBootstrap, OnModuleDestroy
{
	private readonly logger = new Logger(TelemetryService.name);
	private readonly version = resolveServiceVersion();
	/**
	 * Per-entity "already reported" markers, with the time each was recorded, so
	 * a long-lived install does not accumulate one entry per run forever. A run
	 * can report failure through two ports, and the report view is polled.
	 */
	private readonly reported = new Map<string, number>();

	/**
	 * In-memory ring buffer of the last 20 posted payloads, newest first,
	 * with api_key removed. Cleared on restart; nothing persisted.
	 */
	private readonly recentlySentBuffer: Array<{
		payload: Record<string, unknown>;
	}> = [];

	private activeInterval?: NodeJS.Timeout;

	constructor(
		private readonly prisma: PrismaService,
		private readonly fetchImpl: typeof fetch = fetch,
		private readonly now: () => Date = () => new Date(),
		private readonly env: NodeJS.ProcessEnv = process.env,
	) {}

	async onApplicationBootstrap(): Promise<void> {
		await this.checkInstallActive();
		this.activeInterval = setInterval(() => {
			void this.checkInstallActive();
		}, 60 * 60_000);
		this.activeInterval.unref();
	}

	onModuleDestroy(): void {
		if (this.activeInterval) {
			clearInterval(this.activeInterval);
			this.activeInterval = undefined;
		}
	}

	async checkInstallActive(): Promise<void> {
		try {
			if (telemetryForcedOff(this.env)) return;
			const stored = await this.read();
			if (!stored?.enabled) return;
			const today = utcDayString(this.now());
			if (stored.lastActiveDay === today) return;
			await this.write({ ...stored, lastActiveDay: today });
			await this.capture("install_active", {});
		} catch (e) {
			this.logger.debug(`telemetry skipped: ${String(e)}`);
		}
	}

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
		if (telemetryForcedOff(this.env)) return false;
		return (await this.read())?.enabled === true;
	}

	async getSettings(): Promise<TelemetrySettings> {
		const stored = await this.read();
		const forcedOff = telemetryForcedOff(this.env);
		return {
			enabled: !forcedOff && (stored?.enabled ?? false),
			decided: stored !== null,
			forcedOff,
			recentlySent: [...this.recentlySentBuffer],
		};
	}

	async setEnabled(enabled: boolean): Promise<TelemetrySettings> {
		const stored = await this.read();
		const next: StoredTelemetry = {
			enabled,
			installId: stored?.installId ?? randomUUID(),
			setupReported: stored?.setupReported ?? false,
			firstWebhookReported: stored?.firstWebhookReported ?? false,
			lastActiveDay: stored?.lastActiveDay,
		};
		await this.write(next);
		// Setup finishes before anyone can be asked, so it is reported once, at opt-in.
		if (enabled && !next.setupReported && !telemetryForcedOff(this.env)) {
			await this.write({ ...next, setupReported: true });
			await this.capture("setup_completed", {});
		}
		return this.getSettings();
	}

	/** Report a terminal state once per investigation. */
	async captureFinished(
		investigationId: string,
		state: InvestigationState,
		options: { startedAt?: Date | null; error?: string | null } = {},
	): Promise<void> {
		if (!this.once(`finished:${investigationId}`)) return;
		const startedAt = options.startedAt?.getTime();
		await this.capture("investigation_finished", {
			state,
			duration_bucket: durationBucket(
				startedAt ? Date.now() - startedAt : Number.NaN,
			),
			error_class: classifyError(state, options.error),
		});
	}

	/** Report a report being looked at once per investigation, not once per poll. */
	async captureReportViewed(investigationId: string): Promise<void> {
		if (!this.once(`viewed:${investigationId}`)) return;
		await this.capture("report_viewed", {});
	}

	/**
	 * The first inbound alert this install ever received. Persisted, because the
	 * point is "this install is wired to a real alert source", asked once — not
	 * once per process, and never once per alert.
	 */
	async captureFirstWebhook(provider: WebhookProvider): Promise<void> {
		try {
			if (telemetryForcedOff(this.env)) return;
			const stored = await this.read();
			if (!stored?.enabled || stored.firstWebhookReported) return;
			await this.write({ ...stored, firstWebhookReported: true });
			await this.capture("first_webhook_received", { provider });
		} catch (e) {
			this.logger.debug(`telemetry skipped: ${String(e)}`);
		}
	}

	/** True the first time a key is seen; prunes by age on the way through. */
	private once(key: string): boolean {
		const now = Date.now();
		for (const [seen, at] of this.reported) {
			if (now - at > DEDUP_TTL_MS) this.reported.delete(seen);
		}
		if (this.reported.has(key)) return false;
		this.reported.set(key, now);
		return true;
	}

	/** Never throws and never delays the caller by more than one settings read. */
	async capture<E extends TelemetryEvent>(
		event: E,
		props: TelemetryEventProps[E],
	): Promise<void> {
		try {
			if (telemetryForcedOff(this.env)) return;
			const stored = await this.read();
			if (!stored?.enabled) return;
			const body = {
				api_key: POSTHOG_KEY,
				event,
				distinct_id: stored.installId,
				timestamp: utcMidnightTimestamp(this.now()),
				properties: {
					...sanitize({
						...props,
						run_mode: runMode(this.env),
						build: build(this.env),
						os: process.platform,
						arch: process.arch,
						node_major: Number.parseInt(process.versions.node, 10),
					}),
					app_version: this.version,
					// Without this PostHog resolves the sender's IP to a city and
					// attaches `$geoip_*` at ingest. The SDKs set it; raw fetch must.
					$geoip_disable: true,
					$process_person_profile: false,
					$lib: LIB_NAME,
					$lib_version: this.version,
				},
			};
			const { api_key: _dropped, ...payloadWithoutKey } = body;
			this.recentlySentBuffer.unshift({ payload: payloadWithoutKey });
			if (this.recentlySentBuffer.length > 20) {
				this.recentlySentBuffer.pop();
			}
			void this.fetchImpl(POSTHOG_CAPTURE_URL, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(body),
				signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
			}).catch(() => undefined);
		} catch (e) {
			this.logger.debug(`telemetry skipped: ${String(e)}`);
		}
	}
}
