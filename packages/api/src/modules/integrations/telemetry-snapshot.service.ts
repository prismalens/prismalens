// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Injectable, Optional } from "@nestjs/common";
import {
	type PreRunSelection,
	type SourceCredential,
	sourceType,
} from "@prismalens/contracts/schemas";
import type { ResolvedConnector } from "@prismalens/engine";
import { PrismaService } from "../../core/prisma/prisma.service.js";
import { safeParseJsonObject } from "../../shared/utils/json-utils.js";
import {
	IntegrationsService,
	type SourceCredentialRead,
} from "./integrations.service.js";
import type { OpenedSource } from "./open-source.js";
import {
	failureReason,
	LIMITS,
	mappingConfig,
	QUERY_KINDS,
	QueryFailed,
	type QueryKind,
	SNAPSHOT_QUERIES,
	type SnapshotPart,
	type SnapshotWindow,
} from "./source-query.js";
import { credentialSecrets, sourceRequestFn } from "./source-request.js";

/** Each source's own limit; a slow one is skipped, never waited on (#848 ruling 2026-10-24). */
export const SOURCE_TIMEOUT_MS = 10_000;

/** How a unit was picked and what it sends (#848); absent on a source built by hand. */
export interface UnitFacts {
	connectionId?: string;
	envVar?: string;
	credentialFrom: "stored" | "env" | "none";
	overridesEnv?: string;
	services: string[];
	/** The connection's own deployment tag. */
	deployment?: string;
	/** The mapping's selector; "" for the kind's default. */
	selector: string;
	selection: PreRunSelection;
	selectedBy: string;
}

export interface SnapshotSource {
	kind: QueryKind;
	label: string;
	/** The user's env, or the entry saved in PrismaLens (#907's states). */
	from: "env" | "set";
	/** The mapping's label-matcher list; the kind's default when absent. */
	selector?: string;
	facts?: UnitFacts;
	open(timeoutMs: number): Promise<OpenedSource>;
}

interface OutcomeBase {
	kind: QueryKind;
	label: string;
	from: "env" | "set";
	facts?: UnitFacts;
}

export type SourceOutcome =
	| (OutcomeBase & {
			status: "found" | "empty";
			part: SnapshotPart;
			secrets: string[];
	  })
	| (OutcomeBase & { status: "skipped" | "not-read"; reason: string });

/** The pre-run telemetry: every unit's outcome, the kinds nothing serves, and what the prompt may name. */
export interface TelemetrySnapshot {
	sources: SourceOutcome[];
	notConfigured: { kind: QueryKind; services: string[] }[];
	/** The selected units as the prompt's telemetry endpoints. */
	endpoints: ResolvedConnector[];
}

type Env = Record<string, string | undefined>;

/** The source of `kind` named in the env, or null; a URL without a token sends none. */
export function envSource(kind: QueryKind, env: Env): SnapshotSource | null {
	const detect = sourceType(kind)?.detect;
	const urlVar = detect?.urlEnv?.find((v) => env[v]?.trim());
	if (!urlVar) return null;
	const url = (env[urlVar] as string).trim();
	const token = detect?.tokenEnv?.map((v) => env[v]?.trim()).find(Boolean);
	return {
		kind,
		label: urlVar,
		from: "env",
		open: async (timeoutMs) => {
			const base = { id: `env:${urlVar}`, label: urlVar, kind };
			try {
				new URL(url);
			} catch {
				return { ...base, secrets: [], unusable: `${urlVar} is not a URL` };
			}
			return {
				...base,
				secrets: token ? [token] : [],
				request: sourceRequestFn(
					url,
					{
						ok: true,
						credential: token ? { kind: "bearer", token } : { kind: "none" },
					},
					{ timeoutMs, maxBytes: LIMITS.responseBytes },
				),
			};
		},
	};
}

/** Rejects when `ms` passes, so a source that ignores the signal still ends. */
function within<T>(ms: number, work: Promise<T>): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const late = new Promise<never>((_, reject) => {
		timer = setTimeout(
			() => reject(new DOMException("timed out", "TimeoutError")),
			ms,
		);
	});
	return Promise.race([work, late]).finally(() => clearTimeout(timer));
}

/** Every source in parallel, each under its own limit; one that fails is skipped with its reason. */
export async function fetchSnapshot(
	sources: readonly SnapshotSource[],
	window: SnapshotWindow,
	opts: { timeoutMs?: number; signal?: AbortSignal } = {},
	queries = SNAPSHOT_QUERIES,
): Promise<SourceOutcome[]> {
	const ms = opts.timeoutMs ?? SOURCE_TIMEOUT_MS;
	return Promise.all(
		sources.map(async (s): Promise<SourceOutcome> => {
			const who = {
				kind: s.kind,
				label: s.label,
				from: s.from,
				...(s.facts ? { facts: s.facts } : {}),
			};
			const timeout = AbortSignal.timeout(ms);
			const signal = opts.signal
				? AbortSignal.any([timeout, opts.signal])
				: timeout;
			try {
				const opened = await within(ms, s.open(ms));
				if (!opened.request)
					return {
						...who,
						status: "skipped",
						reason: opened.unusable ?? "it cannot be opened here",
					};
				// Shorter than 4 characters, a secret cannot be scrubbed from the snapshot (#848).
				if (opened.secrets.some((x) => x.length < 4))
					return {
						...who,
						status: "skipped",
						reason:
							"its credential has a secret shorter than 4 characters, which PrismaLens will not send",
					};
				const part = await within(
					ms,
					queries[s.kind](opened, window, signal, s.selector),
				);
				return {
					...who,
					status: part.count > 0 ? "found" : "empty",
					part,
					secrets: opened.secrets,
				};
			} catch (e) {
				return {
					...who,
					status: "skipped",
					reason: e instanceof QueryFailed ? e.message : failureReason(e),
				};
			}
		}),
	);
}

/** Units read per run; the rest are recorded and never attempted (#848). */
export const SOURCE_UNIT_LIMIT = 6;

/** Labels that name a deployment on an alert, tried in this order (#848). */
const DEPLOYMENT_LABELS = [
	"deployment_environment",
	"deployment.environment.name",
	"deployment.environment",
	"environment",
	"env",
] as const;

const norm = (v: string | undefined) => v?.trim().toLowerCase() || undefined;
const KIND_LABEL: Record<QueryKind, string> = {
	prometheus: "Prometheus",
	alertmanager: "Alertmanager",
	loki: "Loki",
};
export const envVars = (kind: QueryKind) => ({
	url: `${kind.toUpperCase()}_URL`,
	token: `${kind.toUpperCase()}_TOKEN`,
});
export const originOf = (url: string | undefined): string | null => {
	if (!url) return null;
	try {
		return new URL(url).origin;
	} catch {
		return null;
	}
};

/** The fixed sentence for a selection, for the report, logs and `pl doctor` only (#848). */
export function selectionText(
	sel: PreRunSelection,
	unit: {
		kind: string;
		deployment?: string;
		envVar?: string;
		services?: string[];
	},
): string {
	const mapped = `mapped to ${sel.service}, priority ${sel.priority ?? 0}`;
	const services = unit.services?.join(", ") || sel.service;
	switch (sel.rule) {
		case "tag-match":
			return sel.tagFrom
				? `${mapped}, deployment ${sel.deployment} named by the ${sel.tagFrom === "deploy-event" ? "latest deploy event" : "alert"}`
				: `${mapped}, deployment ${sel.deployment}`;
		case "untagged":
			return sel.deployment
				? `${mapped}; no connection is tagged ${sel.deployment}, so the untagged one is used`
				: mapped;
		case "other-tag":
			return sel.deployment
				? `${mapped}; no connection is tagged ${sel.deployment} and none is untagged, so ${unit.deployment} is used`
				: `${mapped}; the incident names no deployment and no connection is untagged, so ${unit.deployment} is used`;
		case "only-unmapped":
			return `the only ${unit.kind} connection; not mapped to a service`;
		case "env":
			return sel.mappedOff
				? `env ${unit.envVar}; every connection mapped to ${services} is turned off`
				: `env ${unit.envVar}; no connection is mapped to ${services}`;
	}
}

interface Selected {
	units: SnapshotSource[];
	notRead: SnapshotSource[];
	skipped: SourceOutcome[];
	notConfigured: TelemetrySnapshot["notConfigured"];
}

/** One kind of `GET /sources/pre-run`: what a service's runs would read, from the same resolver (#848). */
export interface PreRunKindPreview {
	kind: QueryKind;
	units: (UnitFacts & {
		kind: QueryKind;
		label: string;
		from: "env" | "set";
	})[];
	notConfigured: boolean;
	/** Why nothing is read for this kind, e.g. several connections and none mapped. */
	skipped: string | null;
	envFallback: { variable: string; origin: string; tokenSet: boolean } | null;
}

interface IncidentScope {
	services: { id: string; name: string }[];
	deployment?: string;
	tagFrom?: "alert" | "deploy-event";
}

interface ConnRow {
	id: string;
	label: string;
	status?: string;
	integration: { templateId: string; label: string };
}

interface Candidate {
	conn: ConnRow;
	service: string;
	priority: number;
	deployment?: string;
	selector: string;
	rule: PreRunSelection["rule"];
}

/**
 * The pre-run telemetry fetch (#848): per kind, the connections mapped to the incident's
 * services, picked by deployment tag and priority; with none mapped, the only saved
 * connection, then the env. Inside a stored connection its own credential wins.
 */
@Injectable()
export class TelemetrySnapshotService {
	constructor(
		private readonly prisma: PrismaService,
		@Optional() private readonly integrations?: IntegrationsService,
	) {}

	/** The incident's services (its own, then each alert's by time) and its deployment tag. */
	async scope(incidentId: string | undefined): Promise<IncidentScope> {
		if (!incidentId) return { services: [] };
		const [incident, alerts] = await Promise.all([
			this.prisma.incident.findUnique({
				where: { id: incidentId },
				select: { service: { select: { id: true, name: true } } },
			}),
			this.prisma.alert.findMany({
				where: { incidentId },
				orderBy: { createdAt: "asc" },
				select: {
					labels: true,
					service: { select: { id: true, name: true } },
				},
			}),
		]);
		const services = new Map<string, { id: string; name: string }>();
		for (const svc of [incident?.service, ...alerts.map((a) => a.service)])
			if (svc && !services.has(svc.id)) services.set(svc.id, svc);
		const list = [...services.values()];
		for (const a of alerts) {
			const labels = safeParseJsonObject(a.labels) ?? {};
			for (const key of DEPLOYMENT_LABELS) {
				const v = labels[key];
				if (typeof v === "string" && v.trim())
					return { services: list, deployment: v.trim(), tagFrom: "alert" };
			}
		}
		if (!list.length) return { services: list };
		const deploy = await this.prisma.changeEvent.findFirst({
			where: {
				serviceId: { in: list.map((x) => x.id) },
				type: { in: ["deploy", "deployment"] },
			},
			orderBy: { timestamp: "desc" },
			select: { metadata: true },
		});
		const meta = safeParseJsonObject(deploy?.metadata ?? null) ?? {};
		const env = meta.environment ?? meta.env;
		return typeof env === "string" && env.trim()
			? { services: list, deployment: env.trim(), tagFrom: "deploy-event" }
			: { services: list };
	}

	/** Every unit to read, the kinds nothing serves, and the units over the limit. */
	async select(incidentId?: string, env: Env = process.env): Promise<Selected> {
		return this.selectIn(await this.scope(incidentId), env);
	}

	private async selectIn(scope: IncidentScope, env: Env): Promise<Selected> {
		const serviceIds = scope.services.map((x) => x.id);
		const nameOf = new Map(scope.services.map((x) => [x.id, x.name]));
		const mappings = serviceIds.length
			? await this.prisma.serviceIntegration.findMany({
					where: { serviceId: { in: serviceIds } },
					select: {
						serviceId: true,
						connectionId: true,
						priority: true,
						config: true,
						isEnabled: true,
						connection: {
							select: {
								id: true,
								label: true,
								status: true,
								integration: { select: { templateId: true, label: true } },
							},
						},
					},
				})
			: [];
		const [active, saved] = await Promise.all([
			this.prisma.connection.findMany({
				where: {
					status: "ACTIVE",
					integration: { templateId: { in: [...QUERY_KINDS] } },
				},
				select: {
					id: true,
					label: true,
					integration: { select: { templateId: true, label: true } },
				},
				orderBy: { id: "asc" },
			}),
			this.prisma.connection.findMany({
				where: {
					status: { not: "REVOKED" },
					integration: { templateId: { in: [...QUERY_KINDS] } },
				},
				select: { id: true, integration: { select: { templateId: true } } },
			}),
		]);
		const tag = norm(scope.deployment);
		const units: SnapshotSource[] = [];
		const skipped: SourceOutcome[] = [];
		const notConfigured: TelemetrySnapshot["notConfigured"] = [];
		const names = scope.services.map((x) => x.name);
		for (const kind of QUERY_KINDS) {
			const ofKind = mappings.filter(
				(m) => m.connection.integration.templateId === kind,
			);
			const off = ofKind.filter(
				(m) => mappingConfig(m.config).enabled === false,
			);
			const excluded = new Set(off.map((m) => m.connectionId));
			const picks: Candidate[] = [];
			for (const svc of scope.services) {
				const rows = ofKind
					.filter(
						(m) =>
							m.serviceId === svc.id &&
							m.isEnabled &&
							m.connection.status === "ACTIVE" &&
							mappingConfig(m.config).enabled !== false,
					)
					.map((m) => {
						const cfg = mappingConfig(m.config);
						const dep = cfg.deployment?.trim() || undefined;
						const group = !dep ? 1 : tag && norm(dep) === tag ? 0 : 2;
						return { m, cfg, dep, group };
					})
					.sort(
						(a, b) =>
							a.group - b.group ||
							b.m.priority - a.m.priority ||
							a.m.connectionId.localeCompare(b.m.connectionId),
					);
				const best = rows[0];
				if (!best) continue;
				picks.push({
					conn: best.m.connection,
					service: svc.name,
					priority: best.m.priority,
					...(best.dep ? { deployment: best.dep } : {}),
					selector: best.cfg.selector?.trim() ?? "",
					rule:
						best.group === 0
							? "tag-match"
							: best.group === 1
								? "untagged"
								: "other-tag",
				});
			}
			if (picks.length) {
				const byUnit = new Map<string, Candidate & { services: string[] }>();
				for (const c of picks) {
					const key = `${c.conn.id}\0${c.selector}`;
					const seen = byUnit.get(key);
					if (seen) seen.services.push(c.service);
					else byUnit.set(key, { ...c, services: [c.service] });
				}
				for (const c of byUnit.values()) {
					const selection: PreRunSelection = {
						rule: c.rule,
						service: c.service,
						priority: c.priority,
						...(scope.deployment ? { deployment: scope.deployment } : {}),
						...(scope.tagFrom && c.rule === "tag-match"
							? { tagFrom: scope.tagFrom }
							: {}),
					};
					units.push(
						this.storedUnit(kind, c.conn, env, {
							services: c.services,
							selector: c.selector,
							selection,
							...(c.deployment ? { deployment: c.deployment } : {}),
						}),
					);
				}
				continue;
			}
			const usable = active.filter(
				(c) => c.integration.templateId === kind && !excluded.has(c.id),
			);
			const savedCount = saved.filter(
				(c) => c.integration.templateId === kind && !excluded.has(c.id),
			).length;
			const only = usable.length === 1 ? usable[0] : undefined;
			if (only) {
				units.push(
					this.storedUnit(kind, only, env, {
						services: names,
						selector: "",
						selection: {
							rule: "only-unmapped",
							service: names[0] ?? "",
						},
					}),
				);
				continue;
			}
			const fromEnv = envSource(kind, env);
			if (fromEnv) {
				const selection: PreRunSelection = {
					rule: "env",
					service: names[0] ?? "",
					...(off.length ? { mappedOff: true } : {}),
				};
				const facts: UnitFacts = {
					envVar: fromEnv.label,
					credentialFrom: env[envVars(kind).token]?.trim() ? "env" : "none",
					services: names,
					selector: "",
					selection,
					selectedBy: "",
				};
				facts.selectedBy = selectionText(selection, { kind, ...facts });
				units.push({ ...fromEnv, facts });
				continue;
			}
			if (savedCount > 1) {
				skipped.push({
					kind,
					label: KIND_LABEL[kind],
					from: "set",
					status: "skipped",
					reason: `${savedCount} ${kind} connections, none mapped to ${names.join(", ") || "the incident's services"}: map one on the service`,
				});
				continue;
			}
			notConfigured.push({ kind, services: names });
		}
		return {
			units: units.slice(0, SOURCE_UNIT_LIMIT),
			notRead: units.slice(SOURCE_UNIT_LIMIT),
			skipped,
			notConfigured,
		};
	}

	/** Kept for callers that only want the units to read. */
	async sources(
		env: Env = process.env,
		incidentId?: string,
	): Promise<SnapshotSource[]> {
		return (await this.select(incidentId, env)).units;
	}

	private storedUnit(
		kind: QueryKind,
		conn: { id: string; label: string; integration: { label: string } },
		env: Env,
		facts: Omit<UnitFacts, "credentialFrom" | "selectedBy">,
	): SnapshotSource {
		const label = conn.label || conn.integration.label;
		const unit: UnitFacts = {
			...facts,
			connectionId: conn.id,
			credentialFrom: "stored",
			selectedBy: "",
		};
		unit.selectedBy = selectionText(unit.selection, { kind, ...unit });
		return {
			kind,
			label,
			from: "set",
			...(facts.selector ? { selector: facts.selector } : {}),
			facts: unit,
			open: (timeoutMs) =>
				this.openStored(kind, conn.id, label, env, unit, timeoutMs),
		};
	}

	/** The stored URL and credential; a same-origin env token only fills a credential never saved. */
	private async openStored(
		kind: QueryKind,
		id: string,
		label: string,
		env: Env,
		unit: UnitFacts,
		timeoutMs: number,
	): Promise<OpenedSource> {
		const base = { id, label, kind };
		const unusable = (why: string): OpenedSource => ({
			...base,
			secrets: [],
			unusable: why,
		});
		const got = await this.credentialFor(kind, id, env, unit);
		if ("unusable" in got) return unusable(got.unusable);
		const { url, credential } = got;
		return {
			...base,
			secrets: credentialSecrets(credential),
			request: sourceRequestFn(
				url,
				{ ok: true, credential },
				{
					timeoutMs,
					maxBytes: LIMITS.responseBytes,
				},
			),
		};
	}

	/** The URL and the credential a stored unit sends; fills the unit's credential facts. */
	private async credentialFor(
		kind: QueryKind,
		id: string,
		env: Env,
		unit: UnitFacts,
	): Promise<
		{ url: string; credential: SourceCredential } | { unusable: string }
	> {
		if (!this.integrations)
			return { unusable: "PrismaLens cannot open this source here" };
		const url = await this.integrations.connectionBaseUrl(id);
		if (!url) return { unusable: "the connection has no URL" };
		const read: SourceCredentialRead =
			await this.integrations.sourceCredential(id);
		const vars = envVars(kind);
		const envToken = env[vars.token]?.trim();
		const sameOrigin =
			!!envToken && originOf(env[vars.url]?.trim()) === originOf(url);
		if (read.state === "invalid" || !read.ok)
			return {
				unusable: read.ok
					? "the saved credential cannot be read"
					: read.message,
			};
		if (read.state === "set") {
			if (sameOrigin) unit.overridesEnv = vars.token;
			return { url, credential: read.credential };
		}
		if (sameOrigin && envToken) {
			unit.credentialFrom = "env";
			unit.envVar = vars.token;
			return { url, credential: { kind: "bearer", token: envToken } };
		}
		unit.credentialFrom = "none";
		return { url, credential: { kind: "none" } };
	}

	/** What a service's runs would read per kind, for a deployment, through the run's own resolver. */
	async preview(
		serviceId: string,
		deployment?: string,
		env: Env = process.env,
	): Promise<{ kinds: PreRunKindPreview[]; deploymentsSeen: string[] }> {
		const svc = await this.prisma.service.findUnique({
			where: { id: serviceId },
			select: { id: true, name: true },
		});
		const tag = deployment?.trim();
		const picked = await this.selectIn(
			{ services: svc ? [svc] : [], ...(tag ? { deployment: tag } : {}) },
			env,
		);
		const all = [...picked.units, ...picked.notRead];
		for (const u of all)
			if (u.facts?.connectionId)
				await this.credentialFor(u.kind, u.facts.connectionId, env, u.facts);
		const kinds = QUERY_KINDS.map((kind): PreRunKindPreview => {
			const vars = envVars(kind);
			const origin = originOf(env[vars.url]?.trim());
			const skip = picked.skipped.find((x) => x.kind === kind);
			return {
				kind,
				units: all
					.filter((u) => u.kind === kind && u.facts)
					.map((u) => ({
						kind,
						label: u.label,
						from: u.from,
						...(u.facts as UnitFacts),
					})),
				notConfigured: picked.notConfigured.some((n) => n.kind === kind),
				skipped: skip && "reason" in skip ? skip.reason : null,
				envFallback: origin
					? {
							variable: vars.url,
							origin,
							tokenSet: !!env[vars.token]?.trim(),
						}
					: null,
			};
		});
		return {
			kinds,
			deploymentsSeen: svc ? await this.deploymentsSeen(svc.id) : [],
		};
	}

	/** Every deployment tag the service's mappings, alerts and deploy events name, first spelling kept. */
	private async deploymentsSeen(serviceId: string): Promise<string[]> {
		const [mappings, alerts, deploys] = await Promise.all([
			this.prisma.serviceIntegration.findMany({
				where: { serviceId },
				select: { config: true },
			}),
			this.prisma.alert.findMany({
				where: { serviceId },
				orderBy: { createdAt: "desc" },
				take: 200,
				select: { labels: true },
			}),
			this.prisma.changeEvent.findMany({
				where: { serviceId, type: { in: ["deploy", "deployment"] } },
				orderBy: { timestamp: "desc" },
				take: 50,
				select: { metadata: true },
			}),
		]);
		const seen = new Map<string, string>();
		const add = (v: unknown) => {
			if (typeof v !== "string" || !v.trim()) return;
			const key = norm(v) as string;
			if (!seen.has(key)) seen.set(key, v.trim());
		};
		for (const m of mappings) add(mappingConfig(m.config).deployment);
		for (const a of alerts) {
			const labels = safeParseJsonObject(a.labels) ?? {};
			add(
				DEPLOYMENT_LABELS.map((k) => labels[k]).find(
					(v) => typeof v === "string" && v.trim(),
				),
			);
		}
		for (const d of deploys) {
			const meta = safeParseJsonObject(d.metadata) ?? {};
			add(meta.environment ?? meta.env);
		}
		return [...seen.values()];
	}

	private async endpointOf(u: SnapshotSource): Promise<ResolvedConnector> {
		const id = u.facts?.connectionId;
		const baseUrl = id
			? ((await this.integrations?.connectionBaseUrl(id)) ?? "")
			: (process.env[envVars(u.kind).url]?.trim() ?? "");
		return {
			templateId: u.kind,
			connectionId: id ?? `env:${u.label}`,
			label: u.label,
			baseUrl,
			segments: [],
			...(u.facts?.credentialFrom !== "none" ? { authenticated: true } : {}),
		};
	}

	async fetch(
		incidentId: string | undefined,
		window: SnapshotWindow,
		signal?: AbortSignal,
	): Promise<TelemetrySnapshot> {
		const picked = await this.select(incidentId);
		const read = await fetchSnapshot(picked.units, window, {
			...(signal ? { signal } : {}),
		});
		const notRead: SourceOutcome[] = picked.notRead.map((u) => ({
			kind: u.kind,
			label: u.label,
			from: u.from,
			...(u.facts ? { facts: u.facts } : {}),
			status: "not-read",
			reason: `over the ${SOURCE_UNIT_LIMIT}-source limit`,
		}));
		return {
			sources: [...read, ...picked.skipped, ...notRead],
			notConfigured: picked.notConfigured,
			endpoints: await Promise.all(picked.units.map((u) => this.endpointOf(u))),
		};
	}
}
