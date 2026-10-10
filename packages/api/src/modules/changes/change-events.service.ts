// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * What changed around an incident (#811): the default-branch history of each repository
 * linked to the incident's services, read with the credential the resolver picks (#810),
 * kept as ChangeEvents so the overlay and later reads see the same rows.
 */
import { Injectable, Logger } from "@nestjs/common";
import type {
	ChangeSource,
	ChangeSourceProblemCode,
	IncidentChange,
	IncidentChanges,
	RunCredential,
} from "@prismalens/contracts/schemas";
import { urlHost } from "../../core/harness/git-credential.js";
import {
	GitFailure,
	type GitFailureCode,
} from "../../core/harness/git-failure.js";
import { RepoSourceService } from "../../core/harness/repo-source.service.js";
import { PrismaService } from "../../core/prisma/prisma.service.js";
import { safeParseJsonObject } from "../../shared/utils/json-utils.js";
import {
	GitCredentialService,
	pickOf,
} from "../integrations/git-credential.service.js";
import {
	commitUrl,
	describeChange,
	type GitChange,
	readHistory,
} from "./git-history.js";

const DAY_MS = 24 * 60 * 60_000;
/** How far before the start to look: a Friday deploy that breaks on Monday is still in view. */
export const LOOKBACK_MS = 7 * DAY_MS;
/** A read younger than this is reused: the overview refetches on focus, and the host should not see a fetch each time. */
export const FRESH_MS = 5 * 60_000;
/** How long a request waits on a read before answering with what is stored and `refreshing`. */
export const WAIT_MS = 10_000;
const MAX_PER_REPO = 100;
const MAX_ROWS = 500;
const FILES_KEPT = 3;

const PROBLEM_BY_CODE: Record<GitFailureCode, ChangeSourceProblemCode> = {
	"no-credential": "no-credential",
	"machine-rejected": "credential-rejected",
	"token-rejected": "credential-rejected",
	"token-expired": "credential-rejected",
	"no-access": "no-access",
	"not-found": "no-access",
	ambiguous: "pick-credential",
	unreachable: "unreachable",
	"ssh-host-key": "ssh",
	"ssh-key-refused": "ssh",
	other: "error",
};
const RATE_LIMITED = /\b429\b|rate limit/i;
const DEPLOY_KINDS = new Set<IncidentChange["kind"]>([
	"deployment",
	"rollback",
	"release",
	"merge",
]);

interface Link {
	key: string;
	serviceId: string;
	serviceName: string;
	subPath: string | null;
	repository: {
		id: string;
		sourceKind: string;
		fullName: string;
		url: string;
		defaultBranch: string;
		connectionId: string | null;
		metadata: string | null;
	};
}

interface Scope {
	incidentId: string;
	startedAt: Date;
	window: { start: Date; end: Date };
	services: Map<string, string>;
	links: Link[];
}

interface Sync {
	at: number;
	done: boolean;
	run: Promise<void>;
}

@Injectable()
export class ChangeEventsService {
	private readonly logger = new Logger(ChangeEventsService.name);
	private readonly syncs = new Map<string, Sync>();
	private readonly sources = new Map<string, ChangeSource>();

	constructor(
		private readonly prisma: PrismaService,
		private readonly repoSource: RepoSourceService,
		private readonly gitCredentials: GitCredentialService,
	) {}

	/** Null when the incident does not exist. Never throws for a git failure: it lands in `sources`. */
	async forIncident(
		incidentId: string,
		opts: { limit?: number; refresh?: boolean } = {},
	): Promise<IncidentChanges | null> {
		const scope = await this.scope(incidentId);
		if (!scope) return null;
		const sync = this.sync(scope, opts.refresh === true);
		let timer: NodeJS.Timeout | undefined;
		await Promise.race([
			sync.run,
			new Promise<void>((r) => {
				timer = setTimeout(r, WAIT_MS);
			}),
		]);
		clearTimeout(timer);
		return this.read(scope, opts.limit ?? 6, !sync.done);
	}

	/** Stored deploys, releases and merges of these services in the window, oldest first; no git read. */
	async deploysIn(
		serviceIds: string[],
		window: { start: Date; end: Date },
	): Promise<IncidentChange[]> {
		if (serviceIds.length === 0) return [];
		const [rows, services] = await Promise.all([
			this.prisma.changeEvent.findMany({
				where: {
					serviceId: { in: serviceIds },
					timestamp: { gte: window.start, lte: window.end },
				},
				orderBy: { timestamp: "asc" },
				take: MAX_ROWS,
			}),
			this.prisma.service.findMany({
				where: { id: { in: serviceIds } },
				select: { id: true, name: true },
			}),
		]);
		const names = new Map(services.map((s) => [s.id, s.name]));
		return rows
			.map((r) => toChange(r, names))
			.filter((c) => DEPLOY_KINDS.has(c.kind));
	}

	/** Reads every linked repository unless a read of this incident is running or fresh. */
	private sync(scope: Scope, refresh = false): Sync {
		const now = Date.now();
		for (const [id, s] of this.syncs)
			if (s.done && now - s.at > FRESH_MS) this.syncs.delete(id);
		const current = this.syncs.get(scope.incidentId);
		if (current && (!current.done || (!refresh && now - current.at < FRESH_MS)))
			return current;
		const sync: Sync = { at: now, done: false, run: Promise.resolve() };
		sync.run = Promise.all(
			scope.links.map((l) => this.syncLink(l, scope.window)),
		).then(
			() => {
				sync.done = true;
			},
			(err: unknown) => {
				sync.done = true;
				this.logger.warn(
					`What changed for ${scope.incidentId}: ${message(err)}`,
				);
			},
		);
		this.syncs.set(scope.incidentId, sync);
		return sync;
	}

	private async scope(incidentId: string): Promise<Scope | null> {
		const incident = await this.prisma.incident.findUnique({
			where: { id: incidentId },
			select: {
				id: true,
				serviceId: true,
				triggeredAt: true,
				closedAt: true,
				alerts: { select: { serviceId: true } },
			},
		});
		if (!incident) return null;
		const ids = new Set<string>();
		if (incident.serviceId) ids.add(incident.serviceId);
		for (const a of incident.alerts) if (a.serviceId) ids.add(a.serviceId);
		const services = await this.prisma.service.findMany({
			where: { id: { in: [...ids] } },
			select: {
				id: true,
				name: true,
				repositories: {
					select: { id: true, subPath: true, repository: true },
					orderBy: { createdAt: "asc" },
				},
			},
		});
		const start = incident.triggeredAt;
		return {
			incidentId: incident.id,
			startedAt: start,
			window: {
				start: new Date(start.getTime() - LOOKBACK_MS),
				end: incident.closedAt ?? new Date(),
			},
			services: new Map(services.map((s) => [s.id, s.name])),
			links: services.flatMap((s) =>
				s.repositories.map((r) => ({
					key: r.id,
					serviceId: s.id,
					serviceName: s.name,
					subPath: r.subPath,
					repository: r.repository,
				})),
			),
		};
	}

	/** One repository for one service: read its history, keep it, and record how the read went. */
	private async syncLink(
		link: Link,
		window: { start: Date; end: Date },
	): Promise<void> {
		const repo = link.repository;
		const base = this.sourceOf(link);
		try {
			const folder = repo.sourceKind === "folder";
			let gitDir = repo.url;
			let credential: RunCredential = {
				source: "none",
				label: "folder",
				via: "none",
			};
			if (!folder) {
				const read = await this.gitCredentials.withCredential(
					{
						sourceKind: "url",
						url: repo.url,
						connectionId: repo.connectionId,
						pick: pickOf(repo.metadata),
					},
					(cred) =>
						this.repoSource.gitDir({
							kind: "url",
							source: repo.url,
							defaultBranch: repo.defaultBranch,
							credential: cred,
						}),
				);
				gitDir = read.result;
				const { problem: _problem, ...shown } = read.credential;
				credential = shown;
			}
			const branch = repo.defaultBranch.trim();
			const changes = await readHistory({
				gitDir,
				ref: folder || !branch ? "HEAD" : `refs/heads/${branch}`,
				since: window.start,
				until: window.end,
				subPath: link.subPath,
				max: MAX_PER_REPO,
			});
			await this.keep(link, changes);
			this.sources.set(link.key, {
				...base,
				status: "ok",
				credential,
				problem: null,
				checkedAt: new Date().toISOString(),
			});
		} catch (err) {
			this.logger.warn(`What changed: ${repo.url}: ${message(err)}`);
			this.sources.set(link.key, {
				...base,
				status: "failed",
				problem: problemOf(err),
				checkedAt: new Date().toISOString(),
			});
		}
	}

	/** Upsert by host, repository, commit and service: a re-read or an overlapping window never doubles a row. */
	private async keep(link: Link, changes: GitChange[]): Promise<void> {
		if (changes.length === 0) return;
		const repo = link.repository;
		const folder = repo.sourceKind === "folder";
		const host = folder ? "local" : (urlHost(repo.url) ?? "unknown");
		const writes = changes.map((c) => {
			const { merge, pr, title } = describeChange(c);
			const metadata = JSON.stringify({
				sha: c.sha,
				repo: repo.fullName,
				repositoryId: repo.id,
				host,
				author: c.author,
				merge,
				pr,
				tag: c.tag,
				fileCount: c.files.length,
				files: c.files.slice(0, FILES_KEPT),
				url: folder ? null : commitUrl(repo.url, c.sha),
			});
			const row = {
				type: "commit",
				source: "git",
				timestamp: c.committedAt,
				serviceId: link.serviceId,
				description: title,
				metadata,
			};
			return this.prisma.changeEvent.upsert({
				where: {
					dedupeKey: `${host}/${repo.fullName}@${c.sha}#${link.serviceId}`,
				},
				create: {
					...row,
					dedupeKey: `${host}/${repo.fullName}@${c.sha}#${link.serviceId}`,
				},
				update: row,
			});
		});
		await this.prisma.$transaction(writes);
	}

	private async read(
		scope: Scope,
		limit: number,
		refreshing: boolean,
	): Promise<IncidentChanges> {
		const serviceIds = [...scope.services.keys()];
		const where = {
			serviceId: { in: serviceIds },
			timestamp: { gte: scope.window.start, lte: scope.window.end },
		};
		const [rows, total] = serviceIds.length
			? await Promise.all([
					this.prisma.changeEvent.findMany({
						where,
						orderBy: [{ timestamp: "desc" }, { id: "desc" }],
						take: MAX_ROWS,
					}),
					this.prisma.changeEvent.count({ where }),
				])
			: [[], 0];
		const changes = rows.map((r) => toChange(r, scope.services));
		const before = changes.filter(
			(c) => new Date(c.at).getTime() <= scope.startedAt.getTime(),
		);
		const sources = scope.links.map(
			(l) => this.sources.get(l.key) ?? this.sourceOf(l),
		);
		return {
			incidentId: scope.incidentId,
			startedAt: scope.startedAt.toISOString(),
			window: {
				start: scope.window.start.toISOString(),
				end: scope.window.end.toISOString(),
			},
			deploy: before.find((c) => DEPLOY_KINDS.has(c.kind)) ?? before[0] ?? null,
			timeline: changes.slice(0, limit),
			total,
			state: stateOf(sources),
			refreshing,
			sources,
		};
	}

	private sourceOf(link: Link): ChangeSource {
		return {
			repositoryId: link.repository.id,
			repo: link.repository.fullName,
			serviceId: link.serviceId,
			serviceName: link.serviceName,
			status: "pending",
			credential: null,
			problem: null,
			checkedAt: null,
		};
	}
}

function stateOf(sources: ChangeSource[]): IncidentChanges["state"] {
	if (sources.length === 0) return "no-repos";
	const failed = sources.filter((s) => s.status === "failed").length;
	const ok = sources.filter((s) => s.status === "ok").length;
	if (failed === 0 && ok === 0) return "pending";
	if (failed === 0) return "ok";
	return ok === 0 ? "failed" : "partial";
}

export function problemOf(err: unknown): NonNullable<ChangeSource["problem"]> {
	if (err instanceof GitFailure)
		return {
			code: RATE_LIMITED.test(`${err.message}\n${err.stderr ?? ""}`)
				? "rate-limited"
				: PROBLEM_BY_CODE[err.code],
			message: err.message,
			action: err.action ?? null,
		};
	return { code: "error", message: message(err).slice(0, 300), action: null };
}

function message(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

function str(v: unknown): string | null {
	return typeof v === "string" && v ? v : null;
}

function toChange(
	row: {
		id: string;
		type: string;
		source: string;
		timestamp: Date;
		serviceId: string | null;
		description: string | null;
		metadata: string | null;
	},
	services: Map<string, string>,
): IncidentChange {
	const meta = safeParseJsonObject(row.metadata) ?? {};
	const kind: IncidentChange["kind"] =
		row.type === "commit"
			? str(meta.tag)
				? "release"
				: meta.merge === true
					? "merge"
					: "commit"
			: ((["deployment", "rollback", "config", "migration"] as const).find(
					(k) => k === row.type,
				) ?? "commit");
	const files = Array.isArray(meta.files)
		? meta.files.filter((f): f is string => typeof f === "string")
		: null;
	const serviceName = row.serviceId ? services.get(row.serviceId) : undefined;
	return {
		id: row.id,
		kind,
		at: row.timestamp.toISOString(),
		title: row.description ?? row.type,
		sha: str(meta.sha) ?? str(meta.commit),
		tag: str(meta.tag) ?? str(meta.version),
		pr: typeof meta.pr === "number" ? meta.pr : null,
		author: str(meta.author),
		files:
			files && typeof meta.fileCount === "number"
				? { count: meta.fileCount, paths: files }
				: null,
		url: str(meta.url),
		repo: str(meta.repo),
		service:
			row.serviceId && serviceName
				? { id: row.serviceId, name: serviceName }
				: null,
		source: row.source,
	};
}
