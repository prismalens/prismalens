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
import type { Request } from "express";
import { isHost } from "../../core/settings/settings.controller.js";
import { browseFolders } from "./folder-browser.js";
import { RepositoriesService } from "./repositories.service.js";
import { serializeRepository } from "./serialize-repository.js";

/** The host's folders and git calls in them are for the host's own session only (#1020). */
function hostOnly(request: unknown): void {
	if (!isHost(request as Request))
		throw new ORPCError("FORBIDDEN", {
			message: "Only the computer PrismaLens runs on can do this.",
		});
}

@Controller()
export class RepositoriesController {
	constructor(private readonly repositoriesService: RepositoriesService) {}

	private serialize(repo: PrismaRepository): Promise<Repository> {
		return serializeRepository(repo, (r) =>
			this.repositoriesService.credentialFor(r),
		);
	}

	private async serializeWithServices(
		repo: PrismaRepository & {
			services?: Array<{ createdAt: Date; [key: string]: unknown }>;
		},
	): Promise<RepositoryWithServices> {
		return {
			...(await this.serialize(repo)),
			services: repo.services?.map((s) => ({
				...s,
				createdAt: s.createdAt.toISOString(),
			})) as ServiceRepository[] | undefined,
		} as RepositoryWithServices;
	}

	@Implement(repositoriesContract)
	repositories() {
		return {
			// POST /repositories/source - Folder or URL from the service form
			addSource: implement(repositoriesContract.addSource).handler(
				async ({ input, context }) => {
					const repo = await this.repositoriesService.addSource(input);
					return this.serialize(repo);
				},
			),

			// POST /fs/folders - The host's folders, for the Add project browser
			browseFolders: implement(repositoriesContract.browseFolders).handler(
				async ({ input, context }) => {
					hostOnly(context.request);
					return browseFolders(input.path);
				},
			),

			// POST /repositories/:id/git - Start git in a plain folder project
			startGit: implement(repositoriesContract.startGit).handler(
				async ({ input, context }) => {
					hostOnly(context.request);
					return this.serialize(
						await this.repositoriesService.startGit(input.id),
					);
				},
			),

			// PATCH /repositories/:id/credential - Pin a saved token, or Auto
			setCredential: implement(repositoriesContract.setCredential).handler(
				async ({ input }) => {
					const repo = await this.repositoriesService.setCredential(
						input.id,
						input.connectionId,
					);
					return this.serialize(repo);
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
					data: await Promise.all(
						data.map((r) => this.serializeWithServices(r)),
					),
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
				return this.serializeWithServices(repo);
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
