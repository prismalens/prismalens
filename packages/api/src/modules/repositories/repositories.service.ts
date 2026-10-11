// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	BadRequestException,
	ConflictException,
	Injectable,
	Logger,
	NotFoundException,
} from "@nestjs/common";
import type {
	AddRepositorySourceInput,
	GitCredentialDisplay,
} from "@prismalens/contracts";
import type { Repository, ServiceRepository } from "@prismalens/database";
import {
	classifySource,
	displayNameFor,
	RepoSourceService,
} from "../../core/harness/repo-source.service.js";
import { PrismaService } from "../../core/prisma/prisma.service.js";
import { TelemetryService } from "../../core/telemetry/telemetry.service.js";
import {
	GitCredentialService,
	pickOf,
} from "../integrations/git-credential.service.js";
import type { LinkRepositoryDto } from "./dto/index.js";

export type { Repository, ServiceRepository };

interface SyncFields {
	syncBranch: string | null;
	syncHead: string | null;
	syncError: string | null;
	defaultBranch?: string;
}

function parseMetadata(metadata: string | null): Record<string, unknown> {
	if (!metadata) return {};
	try {
		const value: unknown = JSON.parse(metadata);
		return value && typeof value === "object" && !Array.isArray(value)
			? (value as Record<string, unknown>)
			: {};
	} catch {
		return {};
	}
}

@Injectable()
export class RepositoriesService {
	private readonly logger = new Logger(RepositoriesService.name);

	constructor(
		private readonly prisma: PrismaService,
		private readonly repoSource: RepoSourceService,
		private readonly gitCredentials: GitCredentialService,
		private readonly telemetry: TelemetryService,
	) {}

	/**
	 * The service form's Repository field (ADR 0004 §2, #629): classify the input,
	 * validate it with git under the credential the resolver picks (#673), store what
	 * git answered or why it could not, and make it the service's primary repo. A
	 * failed validation still saves, so the card can show why.
	 */
	async addSource(input: AddRepositorySourceInput): Promise<Repository> {
		const service = await this.prisma.service.findUnique({
			where: { id: input.serviceId },
			select: { id: true },
		});
		if (!service) throw new NotFoundException("Service not found");

		let classified: ReturnType<typeof classifySource>;
		try {
			classified = classifySource(input.source);
		} catch (err) {
			throw new BadRequestException((err as Error).message);
		}
		let { kind, source } = classified;
		let subPath = input.subPath ?? null;

		const existing =
			kind === "url"
				? await this.prisma.repository.findFirst({ where: { url: source } })
				: null;

		let sync: SyncFields;
		if (kind === "folder") {
			sync = { syncBranch: null, syncHead: null, syncError: null };
			try {
				const check = await this.repoSource.checkFolder(source);
				source = check.root;
				subPath = [check.prefix, subPath].filter(Boolean).join("/") || null;
				Object.assign(sync, { syncBranch: check.branch, syncHead: check.head });
			} catch (err) {
				sync.syncError = (err as Error).message;
			}
		} else {
			sync = await this.validateUrl(
				source,
				existing?.connectionId ?? null,
				pickOf(existing?.metadata),
			);
		}

		const fields = {
			sourceKind: kind,
			url: source,
			...sync,
			syncedAt: new Date(),
		};
		const repository = await this.prisma.$transaction(async (tx) => {
			const sameRoot = await tx.repository.findFirst({
				where: { url: source },
			});
			const repo = sameRoot
				? await tx.repository.update({
						where: { id: sameRoot.id },
						data: fields,
					})
				: await tx.repository.create({
						data: { ...fields, fullName: displayNameFor(kind, source) },
					});
			await tx.serviceRepository.updateMany({
				where: { serviceId: input.serviceId },
				data: { isPrimary: false },
			});
			const link = await tx.serviceRepository.findFirst({
				where: { serviceId: input.serviceId, repositoryId: repo.id, subPath },
			});
			if (link) {
				await tx.serviceRepository.update({
					where: { id: link.id },
					data: { isPrimary: true },
				});
			} else {
				await tx.serviceRepository.create({
					data: {
						serviceId: input.serviceId,
						repositoryId: repo.id,
						subPath,
						isPrimary: true,
					},
				});
			}
			return repo;
		});
		this.logger.log(
			`Service ${input.serviceId} repository → ${kind} ${source}${sync.syncError ? ` (git: ${sync.syncError})` : ""}`,
		);
		// A service only becomes investigable once it has code behind it, so this
		// is where "a service was added" is true. `folder`/`url` is the whole of
		// what is sent — never the path or the repository name.
		await this.telemetry.capture("service_added", {
			source: kind === "folder" ? "local" : "git",
		});
		return repository;
	}

	/**
	 * Pin a saved git host token to a repository, or set Auto (null), then validate
	 * again so the row never shows a new credential beside an old error (#673).
	 * The pick lives in `metadata`: `connectionId` cascades and is unique per name.
	 */
	async setCredential(
		id: string,
		connectionId: string | null,
	): Promise<Repository> {
		const repo = await this.prisma.repository.findUnique({ where: { id } });
		if (!repo) throw new NotFoundException("Repository not found");
		if (repo.sourceKind !== "url")
			throw new BadRequestException("A folder needs no credential");
		if (
			connectionId &&
			!(await this.gitCredentials.tokenFor(repo.url, connectionId))
		)
			throw new BadRequestException(
				"That connection is not a git host token for this repository's host",
			);
		const meta = parseMetadata(repo.metadata);
		if (connectionId) meta.credentialConnectionId = connectionId;
		else delete meta.credentialConnectionId;
		await this.prisma.repository.update({
			where: { id },
			data: { metadata: JSON.stringify(meta) },
		});
		this.gitCredentials.invalidate();
		const sync = await this.validateUrl(
			repo.url,
			repo.connectionId,
			connectionId,
		);
		return this.prisma.repository.update({
			where: { id },
			data: { ...sync, syncedAt: new Date() },
		});
	}

	/** What the credential the resolver picks lets git see: branch and head, or why not. */
	private async validateUrl(
		url: string,
		connectionId: string | null,
		pick: string | null,
	): Promise<SyncFields> {
		const sync: SyncFields = {
			syncBranch: null,
			syncHead: null,
			syncError: null,
		};
		try {
			const { result: check } = await this.gitCredentials.withCredential(
				{ sourceKind: "url", url, connectionId, pick },
				(credential) =>
					this.repoSource.validate({ kind: "url", source: url, credential }),
			);
			Object.assign(sync, {
				syncBranch: check.branch,
				syncHead: check.head,
				...(check.branch ? { defaultBranch: check.branch } : {}),
			});
		} catch (err) {
			sync.syncError = (err as Error).message;
		}
		return sync;
	}

	/** The credential a row would use now, for display. */
	credentialFor(repo: {
		sourceKind: string;
		url: string;
		connectionId: string | null;
		metadata: string | null;
	}): Promise<GitCredentialDisplay> {
		return this.gitCredentials.preview({
			sourceKind: repo.sourceKind === "folder" ? "folder" : "url",
			url: repo.url,
			connectionId: repo.connectionId,
			pick: pickOf(repo.metadata),
		});
	}

	/**
	 * Count repositories not linked to any service
	 */
	async countUnlinked(): Promise<number> {
		const repos = await this.prisma.repository.findMany({
			include: { services: { select: { id: true }, take: 1 } },
		});
		return repos.filter((r) => r.services.length === 0).length;
	}

	/**
	 * List all repositories with optional filters
	 */
	async findAll(options?: {
		connectionId?: string;
		search?: string;
		limit?: number;
		offset?: number;
	}): Promise<{ data: Repository[]; total: number }> {
		const where: Record<string, unknown> = {
			...(options?.connectionId && { connectionId: options.connectionId }),
		};

		if (options?.search) {
			where.OR = [
				// SQLite takes no `mode`; its LIKE ignores ASCII case already.
				{ fullName: { contains: options.search } },
				{ description: { contains: options.search } },
			];
		}

		const [data, total] = await this.prisma.$transaction([
			this.prisma.repository.findMany({
				where,
				include: { services: true },
				orderBy: { fullName: "asc" },
				take: options?.limit,
				skip: options?.offset,
			}),
			this.prisma.repository.count({ where }),
		]);

		return { data, total };
	}

	/**
	 * Find repository by ID with linked services
	 */
	async findById(id: string) {
		return this.prisma.repository.findUnique({
			where: { id },
			include: { services: true },
		});
	}

	/**
	 * Link a repository to a service
	 */
	async linkToService(
		repositoryId: string,
		dto: LinkRepositoryDto,
	): Promise<ServiceRepository> {
		const repo = await this.prisma.repository.findUnique({
			where: { id: repositoryId },
		});
		if (!repo) throw new NotFoundException("Repository not found");

		return this.prisma.serviceRepository.create({
			data: {
				serviceId: dto.serviceId,
				repositoryId,
				subPath: dto.subPath ?? null,
				isPrimary: dto.isPrimary ?? true,
			},
		});
	}

	/**
	 * Unlink a repository from a service
	 */
	async unlinkFromService(
		repositoryId: string,
		serviceId: string,
	): Promise<void> {
		await this.prisma.serviceRepository.deleteMany({
			where: { repositoryId, serviceId },
		});
	}

	/**
	 * Delete an unlinked repository
	 */
	async delete(id: string): Promise<void> {
		const repo = await this.prisma.repository.findUnique({
			where: { id },
			include: { services: true },
		});
		if (!repo) throw new NotFoundException("Repository not found");
		if (repo.services.length > 0) {
			throw new ConflictException(
				"Repository is linked to services. Unlink before deleting.",
			);
		}
		await this.prisma.repository.delete({ where: { id } });
		this.logger.log(`Deleted repository ${repo.fullName} (${id})`);
	}
}
