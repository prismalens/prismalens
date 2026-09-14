// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Controller } from "@nestjs/common";
import { Implement, implement, ORPCError } from "@orpc/nest";
import { repositoriesContract } from "@prismalens/contracts";
import type {
	Repository,
	RepositoryWithServices,
	ServiceRepository,
} from "@prismalens/contracts/schemas";
import type { Repository as PrismaRepository } from "@prismalens/database";
import { RepositoriesService } from "./repositories.service.js";
import { serializeRepository } from "./serialize-repository.js";

function serializeRepositoryWithServices(
	repo: PrismaRepository & {
		services?: Array<{ createdAt: Date; [key: string]: unknown }>;
	},
): RepositoryWithServices {
	return {
		...serializeRepository(repo),
		services: repo.services?.map((s) => ({
			...s,
			createdAt: s.createdAt.toISOString(),
		})) as ServiceRepository[] | undefined,
	} as RepositoryWithServices;
}

@Controller()
export class RepositoriesController {
	constructor(private readonly repositoriesService: RepositoriesService) {}

	@Implement(repositoriesContract)
	repositories() {
		return {
			// POST /repositories/source - Folder or URL from the service form
			addSource: implement(repositoriesContract.addSource).handler(
				async ({ input, context }) => {
					const repo = await this.repositoriesService.addSource(input);
					return serializeRepository(repo);
				},
			),

			// POST /repositories/batch - Batch create repositories
			batchCreate: implement(repositoriesContract.batchCreate).handler(
				async ({ input, context }) => {
					const result = await this.repositoriesService.batchCreate(input);
					return {
						created: result.created,
						repositories: result.repositories.map(serializeRepository),
					};
				},
			),

			// GET /repositories/unlinked-count - Count unlinked repositories
			unlinkedCount: implement(repositoriesContract.unlinkedCount).handler(
				async () => {
					const count = await this.repositoriesService.countUnlinked();
					return { count };
				},
			),

			// GET /repositories - List all repositories
			list: implement(repositoriesContract.list).handler(async ({ input }) => {
				const { data, total } = await this.repositoriesService.findAll({
					connectionId: input.connectionId,
					search: input.search,
					limit: input.limit,
					offset: input.offset,
				});
				return {
					data: data.map(serializeRepositoryWithServices),
					total,
				};
			}),

			// GET /repositories/:id - Get repository by ID
			get: implement(repositoriesContract.get).handler(async ({ input }) => {
				const repo = await this.repositoriesService.findById(input.id);
				if (!repo) {
					throw new ORPCError("NOT_FOUND", {
						message: "Repository not found",
					});
				}
				return serializeRepositoryWithServices(repo);
			}),

			// POST /repositories/:id/link - Link repository to service
			link: implement(repositoriesContract.link).handler(
				async ({ input, context }) => {
					const { id, ...linkData } = input;
					const result = await this.repositoriesService.linkToService(
						id,
						linkData,
					);
					return {
						...result,
						createdAt: result.createdAt.toISOString(),
					};
				},
			),

			// DELETE /repositories/:id/unlink/:serviceId - Unlink repository
			unlink: implement(repositoriesContract.unlink).handler(
				async ({ input, context }) => {
					await this.repositoriesService.unlinkFromService(
						input.id,
						input.serviceId,
					);
				},
			),

			// DELETE /repositories/:id - Delete an unlinked repository
			delete: implement(repositoriesContract.delete).handler(
				async ({ input, context }) => {
					await this.repositoriesService.delete(input.id);
				},
			),
		};
	}
}
