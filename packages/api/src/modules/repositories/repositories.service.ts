// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	BadRequestException,
	ConflictException,
	Injectable,
	Logger,
	NotFoundException,
} from "@nestjs/common";
import type { AddRepositorySourceInput } from "@prismalens/contracts";
import type { Repository, ServiceRepository } from "@prismalens/database";
import {
	classifySource,
	displayNameFor,
	RepoSourceService,
} from "../../core/harness/repo-source.service.js";
import { PrismaService } from "../../core/prisma/prisma.service.js";
import { TelemetryService } from "../../core/telemetry/telemetry.service.js";
import { IntegrationsService } from "../integrations/integrations.service.js";
import type {
	BatchCreateRepositoriesDto,
	LinkRepositoryDto,
} from "./dto/index.js";

export type { Repository, ServiceRepository };

@Injectable()
export class RepositoriesService {
	private readonly logger = new Logger(RepositoriesService.name);

	constructor(
		private readonly prisma: PrismaService,
		private readonly repoSource: RepoSourceService,
		private readonly integrations: IntegrationsService,
		private readonly telemetry: TelemetryService,
	) {}

	/**
	 * The service form's Repository field (ADR 0004 §2, #629): classify the input,
	 * validate it with git, store what git answered or its error verbatim, and make
	 * it the service's primary repo. A failed validation still saves, so the card
	 * can show why.
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

		const discovered =
			kind === "url"
				? await this.prisma.repository.findFirst({
						where: { url: source, connectionId: { not: null } },
					})
				: null;
		const token = discovered?.connectionId
			? await this.integrations.gitToken(discovered.connectionId)
			: null;

		const sync: {
			syncBranch: string | null;
			syncHead: string | null;
			syncError: string | null;
			defaultBranch?: string;
		} = { syncBranch: null, syncHead: null, syncError: null };
		try {
			if (kind === "folder") {
				const check = await this.repoSource.checkFolder(source);
				source = check.root;
				subPath = [check.prefix, subPath].filter(Boolean).join("/") || null;
				Object.assign(sync, { syncBranch: check.branch, syncHead: check.head });
			} else {
				const check = await this.repoSource.validate({ kind, source, token });
				Object.assign(sync, {
					syncBranch: check.branch,
					syncHead: check.head,
					...(check.branch ? { defaultBranch: check.branch } : {}),
				});
			}
		} catch (err) {
			sync.syncError = (err as Error).message;
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
	 * Batch create repositories (upsert by connectionId + fullName)
	 */
	async batchCreate(
		dto: BatchCreateRepositoriesDto,
	): Promise<{ created: number; repositories: Repository[] }> {
		const results = await this.prisma.$transaction(async (tx) => {
			const repos: Repository[] = [];
			for (const repo of dto.repositories) {
				const repository = await tx.repository.upsert({
					where: {
						connectionId_fullName: {
							connectionId: repo.connectionId,
							fullName: repo.fullName,
						},
					},
					update: {
						url: repo.url,
						description: repo.description ?? null,
						language: repo.language ?? null,
						defaultBranch: repo.defaultBranch ?? "main",
						isPrivate: repo.isPrivate ?? false,
						metadata: repo.metadata ? JSON.stringify(repo.metadata) : null,
					},
					create: {
						connectionId: repo.connectionId,
						fullName: repo.fullName,
						url: repo.url,
						description: repo.description ?? null,
						language: repo.language ?? null,
						defaultBranch: repo.defaultBranch ?? "main",
						isPrivate: repo.isPrivate ?? false,
						metadata: repo.metadata ? JSON.stringify(repo.metadata) : null,
					},
				});
				repos.push(repository);
			}
			return repos;
		});

		this.logger.log(`Batch created/updated ${results.length} repositories`);
		return { created: results.length, repositories: results };
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
				{ fullName: { contains: options.search, mode: "insensitive" } },
				{ description: { contains: options.search, mode: "insensitive" } },
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
