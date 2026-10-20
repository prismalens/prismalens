// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	BadRequestException,
	Injectable,
	NotFoundException,
} from "@nestjs/common";
import {
	type DetectedSource,
	type ParsedSourceCredential,
	type ProbeReport,
	type ProbeResult,
	parseSourceCredential,
	SOURCE_TYPES,
	type SourceDraft,
	type SourcesOverview,
	type SourceTypeDescriptor,
	sourceType,
} from "@prismalens/contracts/schemas";
import { PrismaService } from "../../core/prisma/prisma.service.js";
import { CredentialsService } from "../integrations/crypto/credentials.service.js";
import { IntegrationsService } from "../integrations/integrations.service.js";
import {
	type SourceRequestOptions,
	sourceRequestFn,
} from "../integrations/source-request.js";
import { GatewayService } from "./gateway.service.js";
import { failureReason } from "./source-tools.js";

const PROBE_OPTS: SourceRequestOptions = {
	timeoutMs: 8_000,
	maxBytes: 2 * 1024 * 1024,
};

type Env = Readonly<Record<string, string | undefined>>;

interface Target {
	type: SourceTypeDescriptor;
	url: string;
	credential: ParsedSourceCredential;
	serviceLabel?: string;
}

/** The connect flow's server half (#848): detect, probe read-only, save. */
@Injectable()
export class SourcesService {
	/** Where detection looks; a test swaps it. */
	env: Env = process.env;

	constructor(
		private readonly prisma: PrismaService,
		private readonly integrations: IntegrationsService,
		private readonly credentials: CredentialsService,
		private readonly gateway: GatewayService,
	) {}

	async overview(): Promise<SourcesOverview> {
		const categories = await this.gateway.sources();
		const connected = new Set(
			categories.flatMap((c) => c.sources.map((s) => s.kind)),
		);
		return {
			categories,
			detected: detectSources(this.env).filter((d) => !connected.has(d.type)),
		};
	}

	async test(draft: SourceDraft): Promise<ProbeReport> {
		return runProbes(this.draftTarget(draft));
	}

	/** Saves the draft only once every required probe passes, so a saved source is one that answered. */
	async connect(
		draft: SourceDraft,
	): Promise<{ connectionId: string; report: ProbeReport }> {
		const target = this.draftTarget(draft);
		const report = await runProbes(target);
		if (!report.ok) {
			const failed = report.probes.find((p) => p.need === "required" && !p.ok);
			throw new BadRequestException(
				`Not connected: ${failed?.capability ?? "a required probe"} failed (${failed?.detail ?? "no answer"}).`,
			);
		}
		const { type, url } = target;
		const credential = target.credential.ok
			? target.credential.credential
			: { kind: "none" as const };
		const integration =
			(await this.prisma.integration.findFirst({
				where: { templateId: type.id },
			})) ??
			(await this.integrations.createIntegration({
				templateId: type.id,
				label: type.vendor,
			}));
		const serviceLabel =
			draft.serviceLabel ?? report.discovered.serviceLabel ?? undefined;
		const credentials: Record<string, string> = type.tokenField
			? {
					[type.tokenField]:
						credential.kind === "bearer" ? credential.token : "",
					...(type.url.in === "credentials" ? { baseUrl: url } : {}),
				}
			: (Object.fromEntries(
					Object.entries(credential).filter(([, v]) => v !== undefined),
				) as Record<string, string>);
		const config: Record<string, string> = {
			...(type.url.in === "config" ? { baseUrl: url } : {}),
			...(serviceLabel && type.serviceLabel ? { serviceLabel } : {}),
		};
		const connection = await this.integrations.createConnection({
			integrationId: integration.id,
			label: draft.label ?? `${type.vendor} ${new URL(url).host}`,
			credentials,
			connectionConfig: Object.keys(config).length ? config : undefined,
		});
		return { connectionId: connection.id, report };
	}

	async retest(connectionId: string): Promise<ProbeReport> {
		const row = await this.prisma.connection.findUnique({
			where: { id: connectionId },
			select: {
				credentialsEnc: true,
				connectionConfigEnc: true,
				integration: { select: { templateId: true } },
			},
		});
		const type = row && sourceType(row.integration.templateId);
		if (!row || !type)
			throw new NotFoundException("No source with that id can be probed");
		const read = (enc: Uint8Array | null): Record<string, string> => {
			if (!enc) return {};
			try {
				return this.credentials.decrypt(Buffer.from(enc));
			} catch {
				return {};
			}
		};
		const config = read(row.connectionConfigEnc);
		const saved = read(row.credentialsEnc);
		const url =
			type.url.in === "config"
				? config.baseUrl
				: (saved.baseUrl ?? type.url.default);
		if (!url) throw new BadRequestException("The source has no URL saved");
		const credential = type.tokenField
			? parseSourceCredential({ kind: "bearer", token: saved[type.tokenField] })
			: parseSourceCredential(saved);
		return runProbes({
			type,
			url,
			credential,
			serviceLabel: config.serviceLabel,
		});
	}

	private draftTarget(draft: SourceDraft): Target {
		const type = sourceType(draft.type);
		if (!type)
			throw new BadRequestException(`Unknown source type "${draft.type}"`);
		if (!/^https?:$/.test(new URL(draft.url).protocol))
			throw new BadRequestException("The URL must be http or https");
		let credential: ParsedSourceCredential;
		if (draft.useDetected) {
			const env = type.detect.tokenEnv?.find((n) => this.env[n]?.trim());
			if (!env)
				throw new BadRequestException(
					`Nothing was detected for ${type.vendor}`,
				);
			// A detected token only goes to the vendor's own default host, never a URL typed beside it.
			if (!type.url.default || !sameOrigin(draft.url, type.url.default))
				throw new BadRequestException(
					`The detected ${env} is only sent to ${type.url.default ?? "its own host"}`,
				);
			credential = parseSourceCredential({
				kind: "bearer",
				token: this.env[env]?.trim(),
			});
		} else {
			credential = parseSourceCredential(draft.credential ?? {});
		}
		if (
			credential.ok &&
			!type.credentialKinds.includes(credential.credential.kind)
		)
			throw new BadRequestException(
				`${type.vendor} does not take ${credential.credential.kind} credentials`,
			);
		if (!credential.ok) throw new BadRequestException(credential.message);
		return {
			type,
			url: draft.url,
			credential,
			serviceLabel: draft.serviceLabel,
		};
	}
}

function sameOrigin(a: string, b: string): boolean {
	try {
		return new URL(a).origin === new URL(b).origin;
	} catch {
		return false;
	}
}

/** What the api's environment points at; a token's value never leaves the api. */
export function detectSources(env: Env): DetectedSource[] {
	const found: DetectedSource[] = [];
	for (const t of SOURCE_TYPES) {
		for (const name of t.detect.urlEnv ?? []) {
			const url = env[name]?.trim();
			if (url && /^https?:\/\//.test(url)) {
				found.push({ type: t.id, env: name, url });
				break;
			}
		}
		for (const name of t.detect.tokenEnv ?? []) {
			if (env[name]?.trim()) {
				found.push({ type: t.id, env: name, url: t.url.default });
				break;
			}
		}
	}
	return found;
}

/** Runs each probe in order; a label probe feeds the service label to the probes after it. */
export async function runProbes(
	target: Target,
	opts: SourceRequestOptions = PROBE_OPTS,
): Promise<ProbeReport> {
	const { type, url } = target;
	const request = sourceRequestFn(url, target.credential, opts);
	const discovered: ProbeReport["discovered"] = {};
	let serviceLabel = target.serviceLabel;
	const probes: ProbeResult[] = [];
	for (const p of type.probes) {
		const base = {
			id: p.id,
			capability: p.capability,
			need: p.need,
			why: p.why,
		};
		if (p.path.includes("$LABEL") && !serviceLabel) {
			probes.push({
				...base,
				ok: false,
				detail: "no service label to query by",
			});
			continue;
		}
		const path = p.path.replace(
			"$LABEL",
			encodeURIComponent(serviceLabel ?? ""),
		);
		try {
			const res = await request("GET", path, {
				headers: { accept: "application/json" },
			});
			if (!res.ok) {
				await res.body?.cancel();
				probes.push({ ...base, ok: false, detail: httpReason(res.status) });
				continue;
			}
			const body: unknown = p.read === "status" ? null : await res.json();
			if (p.read === "status") await res.body?.cancel();
			const read = readProbe(p.read, body);
			if (read.labels) {
				discovered.labels = read.labels;
				const preferred = type.serviceLabel?.preferred ?? [];
				const pick =
					serviceLabel && read.labels.includes(serviceLabel)
						? serviceLabel
						: (preferred.find((l) => read.labels?.includes(l)) ?? null);
				discovered.serviceLabel = pick;
				serviceLabel = pick ?? undefined;
			}
			if (read.identity) discovered.identity = read.identity;
			probes.push({ ...base, ok: true, detail: read.detail });
		} catch (e) {
			probes.push({
				...base,
				ok: false,
				detail:
					e instanceof SyntaxError
						? "the answer was not JSON"
						: failureReason(e),
			});
		}
	}
	return {
		type: type.id,
		host: new URL(url).host,
		ok: probes.every((p) => p.need === "optional" || p.ok),
		probes,
		discovered,
	};
}

function httpReason(status: number): string {
	if (status === 401)
		return "401: the source wants a credential, or this one is wrong";
	if (status === 403) return "403: the credential cannot read this";
	if (status === 404) return "404: nothing at this path; check the URL";
	return `the source answered HTTP ${status}`;
}

function firstArray(body: unknown): unknown[] | null {
	const o = body as { data?: unknown } | null;
	const candidates = [
		body,
		o?.data,
		(o?.data as { alerts?: unknown } | undefined)?.alerts,
		(o?.data as { result?: unknown } | undefined)?.result,
	];
	return (candidates.find(Array.isArray) as unknown[] | undefined) ?? null;
}

export function readProbe(
	read: SourceTypeDescriptor["probes"][number]["read"],
	body: unknown,
): { detail: string; labels?: string[]; identity?: string } {
	switch (read) {
		case "status":
			return { detail: "answered" };
		case "count": {
			const n = firstArray(body)?.length ?? 0;
			return { detail: `${n} found` };
		}
		case "labels": {
			const labels = (firstArray(body) ?? []).filter(
				(l): l is string => typeof l === "string",
			);
			return { detail: `${labels.length} labels`, labels };
		}
		case "login": {
			const login = (body as { login?: unknown } | null)?.login;
			return typeof login === "string"
				? { detail: `as @${login}`, identity: login }
				: { detail: "answered" };
		}
		case "volume": {
			const result = firstArray(body) as Array<{
				value?: [unknown, string];
			}> | null;
			const n = Math.round(Number(result?.[0]?.value?.[1] ?? 0));
			return { detail: `${n.toLocaleString("en-US")} lines in 5m` };
		}
	}
}
