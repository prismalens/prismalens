// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Settings, Sources (#848 C17): the telemetry connections with their state, a draft's
 * probe that saves nothing, and its save. The UI shows words; the API names the facts.
 */
import { BadRequestException, Injectable } from "@nestjs/common";
import {
	ALERT_PULL_TEMPLATES,
	type ProbeReport,
	parseSourceCredential,
	type SourceCredential,
	type SourceDraft,
	type SourceProblem,
	type SourceRow,
	type SourcesOverview,
	sourceType,
} from "@prismalens/contracts/schemas";
import { getTemplate } from "@prismalens/integrations";
import { normalizeGitHost } from "../../core/harness/git-credential.js";
import { PrismaService } from "../../core/prisma/prisma.service.js";
import { GitCredentialService } from "./git-credential.service.js";
import type { HostToken } from "./host-token.js";
import { IntegrationsService } from "./integrations.service.js";
import { mappingConfig, QUERY_KINDS, type QueryKind } from "./source-query.js";
import { sourceRequestFn } from "./source-request.js";
import { writeStored } from "./stored-credential.js";
import { envVars, originOf } from "./telemetry-snapshot.service.js";

type Env = Record<string, string | undefined>;

const GIT_TOKEN_TYPE = "git-host-token";
const PROBE_TIMEOUT_MS = 10_000;
const REACH_FAILURE =
	/fetch failed|ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|ENETUNREACH|ETIMEDOUT|ECONNRESET|EAI_AGAIN|getaddrinfo|timed? ?out|aborted|could not reach|unreachable/i;
const REFUSED_ANSWER = /answered 40[13]\b/;

/** The problem a row's state word comes from, by status and last error (#848, gap 2). */
export function sourceProblem(
	status: string,
	lastErrorMessage: string | null,
	credential: SourceRow["credential"],
): SourceProblem | null {
	if (status === "CREDENTIALS_INVALID" || status === "REFRESH_FAILED")
		return "credential-refused";
	if (status !== "ERROR" || !lastErrorMessage) return null;
	if (REFUSED_ANSWER.test(lastErrorMessage))
		return credential === "none" ? "needs-credential" : "credential-refused";
	return REACH_FAILURE.test(lastErrorMessage) ? "cant-reach" : null;
}

const isQueryKind = (t: string): t is QueryKind =>
	(QUERY_KINDS as readonly string[]).includes(t);

function errorText(err: unknown): string {
	if (!(err instanceof Error)) return String(err);
	const code = (err.cause as { code?: unknown } | undefined)?.code;
	return typeof code === "string" ? `${err.message} (${code})` : err.message;
}

/** What a draft saves: its template, config, the stored credential blob, and the host it reaches. */
interface Plan {
	templateId: string;
	name: string;
	host: string;
	connectionConfig: Record<string, string>;
	credentials: Record<string, string>;
	credential: SourceCredential;
}

@Injectable()
export class SourcesService {
	constructor(
		private readonly prisma: PrismaService,
		private readonly integrations: IntegrationsService,
		private readonly gitCredentials: GitCredentialService,
	) {}

	/** `GET /sources`: one row per telemetry connection but a revoked one, and the git hosts. */
	async overview(env: Env = process.env): Promise<SourcesOverview> {
		const rows = await this.prisma.connection.findMany({
			where: {
				status: { not: "REVOKED" },
				integration: { templateId: { in: [...QUERY_KINDS] } },
			},
			include: {
				integration: true,
				serviceMappings: {
					select: {
						isEnabled: true,
						config: true,
						service: { select: { id: true, name: true } },
					},
				},
			},
			orderBy: { createdAt: "asc" },
		});
		const sources = await Promise.all(
			rows.map(async (row): Promise<SourceRow> => {
				const kind = row.integration.templateId as QueryKind;
				const address = this.integrations.baseUrlOf(row);
				const read = await this.integrations.sourceCredential(row.id);
				const vars = envVars(kind);
				const sameOriginToken =
					!!env[vars.token]?.trim() &&
					!!address &&
					originOf(env[vars.url]?.trim()) === originOf(address);
				const credential: SourceRow["credential"] =
					read.state !== "absent" ? "stored" : sameOriginToken ? "env" : "none";
				const expired =
					row.status === "ACTIVE" &&
					!!row.tokenExpiresAt &&
					row.tokenExpiresAt < new Date();
				return {
					connectionId: row.id,
					label: row.label || row.integration.label,
					kind,
					address,
					status: expired ? "TOKEN_EXPIRED" : row.status,
					testedAt: row.testedAt?.toISOString() ?? null,
					credential,
					...(read.state === "set" && read.ok
						? { credentialKind: read.credential.kind }
						: {}),
					...(read.state === "set" && sameOriginToken
						? { overridesEnv: vars.token }
						: {}),
					problem: sourceProblem(row.status, row.lastErrorMessage, credential),
					lastErrorMessage: row.lastErrorMessage ?? null,
					usedBy: row.serviceMappings
						.filter(
							(m) => m.isEnabled && mappingConfig(m.config).enabled !== false,
						)
						.map((m) => ({ serviceId: m.service.id, name: m.service.name })),
					alsoInAlertIntake: ALERT_PULL_TEMPLATES.includes(kind),
				};
			}),
		);
		return { sources, gitHosts: await this.gitCredentials.hosts(env) };
	}

	/** `POST /sources/test`: the draft's address and credential only; nothing is saved. */
	async test(draft: SourceDraft): Promise<ProbeReport> {
		const plan = this.planOf(draft);
		if (plan.templateId === GIT_TOKEN_TYPE)
			return this.testGitToken(draft, plan);
		const verify = getTemplate(plan.templateId)?.verify;
		const report = (ok: boolean, detail: string): ProbeReport => ({
			type: plan.templateId,
			host: plan.host,
			ok,
			probes: [
				{
					id: "verify",
					capability: "Answer at this address",
					need: "required",
					why: "Checks the address and the credential only.",
					ok,
					detail,
				},
			],
			discovered: {},
		});
		if (!verify) return report(false, `${plan.name} has no check to run`);
		try {
			const res = await sourceRequestFn(
				plan.connectionConfig.baseUrl as string,
				{ ok: true, credential: plan.credential },
				{ timeoutMs: PROBE_TIMEOUT_MS },
			)(verify.method, verify.path);
			return report(res.ok, `${plan.name} answered ${res.status}`);
		} catch (err) {
			return report(false, `Could not reach ${plan.host}: ${errorText(err)}`);
		}
	}

	/**
	 * `POST /sources/connect`: probe, then save. A failed required probe saves nothing;
	 * `testedAt` is set only when this save's probe passed (#848, OBJ-007).
	 */
	async connect(
		draft: SourceDraft,
	): Promise<{ connectionId: string | null; report: ProbeReport }> {
		const plan = this.planOf(draft);
		const report: ProbeReport = draft.saveUntested
			? {
					type: plan.templateId,
					host: plan.host,
					ok: false,
					probes: [],
					discovered: {},
					untested: true,
				}
			: await this.test(draft);
		if (!report.ok && !report.untested) return { connectionId: null, report };
		const integrationId = await this.integrationFor(plan);
		const connection = await this.integrations.createConnection({
			integrationId,
			label: draft.label ?? plan.host,
			credentials: plan.credentials,
			connectionConfig: plan.connectionConfig,
		});
		if (report.ok)
			await this.prisma.connection.update({
				where: { id: connection.id },
				data: { testedAt: new Date() },
			});
		return { connectionId: connection.id, report };
	}

	private planOf(draft: SourceDraft): Plan {
		const parsed = parseSourceCredential(draft.credential ?? { kind: "none" });
		if (!parsed.ok) throw new BadRequestException(parsed.message);
		const credential = parsed.credential;
		if (draft.type === GIT_TOKEN_TYPE) {
			const host = normalizeGitHost(draft.url);
			if (!host) throw new BadRequestException("The address names no git host");
			if (credential.kind !== "bearer")
				throw new BadRequestException("A git host takes a token");
			return {
				templateId: GIT_TOKEN_TYPE,
				name: "Git host token",
				host,
				connectionConfig: { host },
				credentials: { token: credential.token },
				credential,
			};
		}
		const descriptor = sourceType(draft.type);
		if (!descriptor || !isQueryKind(draft.type))
			throw new BadRequestException(
				`${draft.type} cannot be added from Sources`,
			);
		if (!descriptor.credentialKinds.includes(credential.kind))
			throw new BadRequestException(
				`${descriptor.vendor} does not take ${credential.kind} credentials`,
			);
		const stored = writeStored(draft.type, credential);
		return {
			templateId: draft.type,
			name: descriptor.vendor,
			host: new URL(draft.url).host,
			connectionConfig: { baseUrl: draft.url },
			credentials: Object.fromEntries(
				Object.entries(stored).filter(
					(e): e is [string, string] => typeof e[1] === "string",
				),
			),
			credential,
		};
	}

	/** The draft token against the saved repositories on its host; none there reads untested. */
	private async testGitToken(
		draft: SourceDraft,
		plan: Plan,
	): Promise<ProbeReport> {
		const token = plan.credentials.token as string;
		const draftToken: HostToken = {
			connectionId: "",
			label: draft.label ?? plan.host,
			templateId: GIT_TOKEN_TYPE,
			host: plan.host,
			token,
			fingerprint: this.gitCredentials.fingerprint(plan.host, token),
			status: "ACTIVE",
			tokenExpiresAt: null,
			lastErrorMessage: null,
		};
		const result = await this.integrations.probeHostToken(draftToken);
		const lines = result.details ?? (result.error ? [result.error] : []);
		return {
			type: GIT_TOKEN_TYPE,
			host: plan.host,
			ok: result.success,
			probes: lines.map((detail, i) => ({
				id: `repository-${i + 1}`,
				capability: "Read a repository on this host",
				need: "required",
				why: "Checks the token against the repositories your services name.",
				ok: detail.startsWith("ok "),
				detail,
			})),
			discovered: {},
			...(result.untested ? { untested: true } : {}),
		};
	}

	/** The one integration a key-based template keeps its connections under, made on first use. */
	private async integrationFor(plan: Plan): Promise<string> {
		const existing = await this.prisma.integration.findFirst({
			where: { templateId: plan.templateId },
			orderBy: { createdAt: "asc" },
			select: { id: true },
		});
		if (existing) return existing.id;
		const created = await this.integrations.createIntegration({
			templateId: plan.templateId,
			label: plan.name,
		});
		return created.id;
	}
}
