// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	BadRequestException,
	Injectable,
	NotFoundException,
} from "@nestjs/common";
import {
	CONNECTION_NAME_MAX,
	type DetectedSource,
	type McpPreview,
	needsDisclosure,
	oauthEndpoints,
	type ParsedSourceCredential,
	type ProbeReport,
	type ProbeResult,
	parseSourceCredential,
	SOURCE_TYPES,
	type SourceCredential,
	type SourceDraft,
	type SourcesOverview,
	type SourceTypeDescriptor,
	shippedAppFor,
	sourceType,
	validateConnectionName,
} from "@prismalens/contracts/schemas";
import {
	beginSignIn,
	completeSignIn,
	type OAuthHttp,
	primeOAuthCache,
	type SignInResult,
} from "@prismalens/integrations";
import { PrismaService } from "../../core/prisma/prisma.service.js";
import { CredentialsService } from "../integrations/crypto/credentials.service.js";
import { IntegrationsService } from "../integrations/integrations.service.js";
import {
	type SourceRequestOptions,
	sourceRequestFn,
} from "../integrations/source-request.js";
import { writeStored } from "../integrations/stored-credential.js";
import { GatewayService } from "./gateway.service.js";
import { MCP_TEMPLATE, McpProxy } from "./proxy/proxy.service.js";
import { type SignInOutcome, SignIns } from "./sign-in.js";
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
	/** Test seam: a mock authorization server. */
	oauthHttp: OAuthHttp = {};

	constructor(
		private readonly prisma: PrismaService,
		private readonly integrations: IntegrationsService,
		private readonly credentials: CredentialsService,
		private readonly gateway: GatewayService,
		private readonly signIns: SignIns,
		private readonly proxy: McpProxy,
	) {}

	async overview(): Promise<SourcesOverview> {
		const categories = await this.gateway.sources();
		const connected = new Set(
			categories.flatMap((c) => c.sources.map((s) => s.kind)),
		);
		return {
			categories,
			detected: detectSources(this.env).filter((d) => !connected.has(d.type)),
			disclosed: await this.disclosed(),
		};
	}

	/** Connections whose grant reaches past what PrismaLens reads, for the row's disclosure line (OBJ-013). */
	private async disclosed(): Promise<string[]> {
		const rows = await this.prisma.connection.findMany({
			where: {
				status: { not: "REVOKED" },
				integration: {
					templateId: {
						in: SOURCE_TYPES.filter(
							(t) => t.oauth || t.id === MCP_TEMPLATE,
						).map((t) => t.id),
					},
				},
			},
			select: {
				id: true,
				grantedScopes: true,
				integration: { select: { templateId: true } },
			},
		});
		const out: string[] = [];
		for (const r of rows) {
			const type = sourceType(r.integration.templateId);
			const stored = await this.integrations.storedRow(r.id);
			const c = stored?.stored.credential.ok
				? stored.stored.credential.credential
				: null;
			if (!type || !c || c.kind === "none") continue;
			// A pasted token's or an MCP server's scope can't be read, so it is disclosed.
			const granted =
				c.kind === "oauth" && type.oauth ? grantedOf(r.grantedScopes) : null;
			if (needsDisclosure(type, granted)) out.push(r.id);
		}
		return out;
	}

	async setRunbooks(enabled: boolean): Promise<{ enabled: boolean }> {
		await this.gateway.setRunbooksEnabled(enabled);
		return { enabled };
	}

	async test(draft: SourceDraft): Promise<ProbeReport> {
		const target = this.draftTarget(draft);
		if (target.type.id === MCP_TEMPLATE) return this.mcpReport(draft, target);
		return runProbes(target);
	}

	/** An MCP server's test is `tools/list` through the proxy, not a probe (06). */
	private async mcpReport(
		draft: SourceDraft,
		target: Target,
		savedName?: string,
	): Promise<ProbeReport> {
		const preview = await this.mcpPreview(draft, target, savedName);
		return {
			type: MCP_TEMPLATE,
			host: new URL(target.url).host,
			ok: preview.ok,
			probes: [
				{
					id: "tools",
					capability: "List tools",
					need: "required",
					why: "PrismaLens forwards the tools this server lists.",
					ok: preview.ok,
					detail: preview.detail,
				},
			],
			discovered: {},
		};
	}

	async mcpPreview(
		draft: SourceDraft,
		target = this.draftTarget(draft),
		savedName?: string,
	): Promise<McpPreview> {
		if (target.type.id !== MCP_TEMPLATE)
			throw new BadRequestException("Only an MCP server lists tools");
		const name = savedName ?? (await this.mcpName(draft));
		if (!target.credential.ok)
			throw new BadRequestException(target.credential.message);
		return this.proxy.preview({
			url: target.url,
			name,
			credential: target.credential.credential,
		});
	}

	/** The draft's connection name, defaulted and checked against the other MCP connections. */
	private async mcpName(
		draft: SourceDraft,
		exceptId?: string,
	): Promise<string> {
		const host = new URL(draft.url).hostname.split(".")[0] ?? "mcp";
		const fallback = `mcp_${host.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`
			.replace(/_+$/, "")
			.slice(0, CONNECTION_NAME_MAX);
		const name = draft.name || fallback;
		const taken = (await this.proxy.connections())
			.filter((c) => c.id !== exceptId)
			.map((c) => c.name);
		const problem = validateConnectionName(name, taken);
		if (problem) throw new BadRequestException(problem);
		return name;
	}

	async rename(
		id: string,
		name: string,
		description: string,
	): Promise<{ ok: true }> {
		const row = await this.prisma.connection.findUnique({
			where: { id },
			select: {
				connectionConfigEnc: true,
				integration: { select: { templateId: true } },
			},
		});
		if (!row || row.integration.templateId !== MCP_TEMPLATE)
			throw new NotFoundException("No MCP connection with that id");
		const problem = validateConnectionName(
			name,
			(await this.proxy.connections())
				.filter((c) => c.id !== id)
				.map((c) => c.name),
		);
		if (problem) throw new BadRequestException(problem);
		let config: Record<string, string> = {};
		try {
			if (row.connectionConfigEnc)
				config = this.credentials.decrypt(Buffer.from(row.connectionConfigEnc));
		} catch {
			config = {};
		}
		await this.integrations.updateConnectionConfig(id, {
			...config,
			name,
			description,
		});
		return { ok: true };
	}

	/** Saves the draft only once every required probe passes, so a saved source is one that answered. */
	async connect(
		draft: SourceDraft,
	): Promise<{ connectionId: string; report: ProbeReport }> {
		const target = this.draftTarget(draft);
		const mcp = target.type.id === MCP_TEMPLATE;
		if (mcp && !draft.description)
			throw new BadRequestException("Describe this MCP server in one line");
		const name = mcp ? await this.mcpName(draft) : undefined;
		const report = mcp
			? await this.mcpReport({ ...draft, name }, target)
			: await runProbes(target);
		if (!report.ok) {
			const failed = report.probes.find((p) => p.need === "required" && !p.ok);
			throw new BadRequestException(
				`Not connected: ${failed?.capability ?? "a required probe"} failed (${failed?.detail ?? "no answer"}).`,
			);
		}
		const credential = target.credential.ok
			? target.credential.credential
			: { kind: "none" as const };
		const connectionId = await this.saveSource({
			type: target.type,
			url: target.url,
			credential,
			label: draft.label,
			serviceLabel:
				draft.serviceLabel ?? report.discovered.serviceLabel ?? undefined,
			...(name && draft.description
				? { config: { name, description: draft.description } }
				: {}),
		});
		return { connectionId, report };
	}

	async retest(connectionId: string): Promise<ProbeReport> {
		const row = await this.prisma.connection.findUnique({
			where: { id: connectionId },
			select: { connectionConfigEnc: true, grantedScopes: true },
		});
		const stored = row && (await this.integrations.storedRow(connectionId));
		const type = stored && sourceType(stored.templateId);
		if (!row || !stored || !type)
			throw new NotFoundException("No source with that id can be probed");
		let config: Record<string, string> = {};
		try {
			if (row.connectionConfigEnc)
				config = this.credentials.decrypt(Buffer.from(row.connectionConfigEnc));
		} catch {
			config = {};
		}
		const url =
			type.url.in === "config"
				? config.baseUrl
				: (stored.stored.baseUrl ?? type.url.default);
		if (!url) throw new BadRequestException("The source has no URL saved");
		const target = {
			type,
			url,
			credential: stored.stored.credential,
			serviceLabel: config.serviceLabel,
		};
		const report =
			type.id === MCP_TEMPLATE
				? await this.mcpReport({ type: type.id, url }, target, config.name)
				: await runProbes(target, {
						...PROBE_OPTS,
						connection: this.integrations.sourceConnection(connectionId),
					});
		const kind = stored.stored.credential.ok
			? stored.stored.credential.credential.kind
			: null;
		if (kind === "oauth" || kind === "mcp-oauth")
			report.discovered.grantedScopes = grantedOf(row.grantedScopes);
		return report;
	}

	/** One write path for every connect flow: the credential goes through `writeStored` (OBJ-009). */
	async saveSource(p: {
		type: SourceTypeDescriptor;
		url: string;
		credential: SourceCredential;
		label?: string;
		serviceLabel?: string;
		config?: Record<string, string>;
		grantedScopes?: string[] | null;
	}): Promise<string> {
		const { type, url } = p;
		const integration =
			(await this.prisma.integration.findFirst({
				where: { templateId: type.id },
			})) ??
			(await this.integrations.createIntegration({
				templateId: type.id,
				label: type.vendor,
			}));
		const config: Record<string, string> = {
			...(type.url.in === "config" ? { baseUrl: url } : {}),
			...(p.serviceLabel && type.serviceLabel
				? { serviceLabel: p.serviceLabel }
				: {}),
			...p.config,
		};
		let label = p.label ?? `${type.vendor} ${new URL(url).host}`;
		if (!p.label) {
			const taken = new Set(
				(
					await this.prisma.connection.findMany({
						where: { integrationId: integration.id },
						select: { label: true },
					})
				).map((c) => c.label),
			);
			for (let n = 2; taken.has(label); n++)
				label = `${type.vendor} ${new URL(url).host} (${n})`;
		}
		const connection = await this.integrations.createConnection({
			integrationId: integration.id,
			label,
			credentials: writeStored(
				type.id,
				p.credential,
				type.url.in === "credentials" ? url : undefined,
			),
			connectionConfig: Object.keys(config).length ? config : undefined,
		});
		if (p.grantedScopes)
			await this.prisma.connection.update({
				where: { id: connection.id },
				data: { grantedScopes: JSON.stringify(p.grantedScopes) },
			});
		return connection.id;
	}

	/**
	 * Starts a sign-in (#848, 04): the PrismaLens-owned app on the vendor's cloud origin
	 * when this build ships one, else the draft's own client.
	 */
	async oauthStart(
		input: { draft: SourceDraft; redirectUri?: string },
		origin: string | undefined,
	): Promise<{ authorizationUrl: string }> {
		const { draft } = input;
		const type = sourceType(draft.type);
		if (type?.id === MCP_TEMPLATE) return this.mcpSignIn(input, origin, type);
		if (!type?.oauth)
			throw new BadRequestException(
				`${type?.vendor ?? draft.type} has no sign-in`,
			);
		const endpoints = oauthEndpoints(type, draft.url);
		if (!endpoints?.tokenUrl.startsWith("https:"))
			throw new BadRequestException("Sign-in needs an https source URL");
		const { redirectUri, loopback } = this.signIns.redirectFor(
			origin,
			input.redirectUri,
		);
		// A shipped app registers the loopback callback only.
		const shipped = loopback ? shippedAppFor(type, draft.url) : null;
		const own = draft.credential?.clientId
			? {
					clientId: draft.credential.clientId,
					clientSecret: draft.credential.clientSecret || undefined,
				}
			: null;
		const client = shipped ?? own;
		if (!client)
			throw new BadRequestException(
				type.oauth.shippedApp && !shippedAppFor(type, draft.url) && loopback
					? `PrismaLens has no app for ${type.vendor} in this build; register your own or use a token.`
					: "Register your own app for this server, or use a token.",
			);
		const scopes = draft.scopes ?? [...type.oauth.scopes];
		const start = await beginSignIn({
			authorizationUrl: endpoints.authorizationUrl,
			clientId: client.clientId,
			redirectUri,
			scopes,
		});
		await this.signIns.register(
			start.state,
			{
				complete: (params) =>
					this.finishSignIn(params, {
						type,
						draft,
						...endpoints,
						redirectUri,
						client,
						scopes,
						verifier: start.verifier,
						state: start.state,
					}),
			},
			loopback,
		);
		return { authorizationUrl: start.authorizationUrl };
	}

	/** 06: discovery and registration run now; the shared callback finishes by `state`. */
	private async mcpSignIn(
		input: { draft: SourceDraft; redirectUri?: string },
		origin: string | undefined,
		type: SourceTypeDescriptor,
	): Promise<{ authorizationUrl: string }> {
		const { draft } = input;
		if (new URL(draft.url).protocol !== "https:")
			throw new BadRequestException("Sign-in needs an https MCP server URL");
		if (!draft.description)
			throw new BadRequestException("Describe this MCP server in one line");
		const name = await this.mcpName(draft);
		const { redirectUri, loopback } = this.signIns.redirectFor(
			origin,
			input.redirectUri,
		);
		let flow: Awaited<ReturnType<McpProxy["startSignIn"]>>;
		try {
			flow = await this.proxy.startSignIn({
				serverUrl: draft.url,
				redirectUri,
				scopeOverride: draft.scopes?.join(" "),
				...(draft.credential?.clientId
					? {
							client: {
								client_id: draft.credential.clientId,
								...(draft.credential.clientSecret
									? { client_secret: draft.credential.clientSecret }
									: {}),
							},
						}
					: {}),
				onSignedIn: (credential) =>
					this.saveSource({
						type,
						url: draft.url,
						credential,
						label: draft.label ?? name,
						config: { name, description: draft.description ?? "" },
						grantedScopes: credential.scope
							? credential.scope.split(" ")
							: null,
					}),
			});
		} catch {
			throw new BadRequestException(
				"The MCP server offers no sign-in PrismaLens can use; paste a token instead.",
			);
		}
		await this.signIns.register(flow.state, flow, loopback);
		return { authorizationUrl: flow.authorizationUrl };
	}

	private async finishSignIn(
		params: URLSearchParams,
		f: {
			type: SourceTypeDescriptor;
			draft: SourceDraft;
			authorizationUrl: string;
			tokenUrl: string;
			redirectUri: string;
			client: { clientId: string; clientSecret?: string };
			scopes: string[];
			verifier: string;
			state: string;
		},
	): Promise<SignInOutcome> {
		let result: SignInResult;
		try {
			result = await completeSignIn(
				{
					authorizationUrl: f.authorizationUrl,
					tokenUrl: f.tokenUrl,
					redirectUri: f.redirectUri,
					clientId: f.client.clientId,
					clientSecret: f.client.clientSecret,
					scopes: f.scopes,
					verifier: f.verifier,
					state: f.state,
					callback: params,
				},
				this.oauthHttp,
			);
		} catch {
			return { error: "exchange" };
		}
		const connectionId = await this.saveSource({
			type: f.type,
			url: f.draft.url,
			credential: result.credential,
			label: f.draft.label,
			grantedScopes: result.grantedScopes,
		});
		primeOAuthCache(connectionId, result);
		// Reload and retest through readStored (OBJ-009); a source that does not answer is not kept.
		const report = await this.retest(connectionId).catch(() => null);
		if (!report?.ok) {
			await this.integrations.deleteConnection(connectionId).catch(() => false);
			return { error: "probe" };
		}
		return { connectionId };
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
		if (
			credential.credential.kind === "oauth" ||
			credential.credential.kind === "mcp-oauth"
		)
			throw new BadRequestException(`Sign in to ${type.vendor} instead`);
		return {
			type,
			url: draft.url,
			credential,
			serviceLabel: draft.serviceLabel,
		};
	}
}

function grantedOf(json: string): string[] | null {
	try {
		const v: unknown = JSON.parse(json);
		return Array.isArray(v) && v.length ? v.map(String) : null;
	} catch {
		return null;
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
		(body as { values?: unknown } | null)?.values,
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
			const who = body as Record<string, unknown> | null;
			const login = who?.login ?? who?.username ?? who?.nickname;
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
