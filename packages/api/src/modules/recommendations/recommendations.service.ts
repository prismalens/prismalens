// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Injectable, Logger } from "@nestjs/common";
import { Recommendation } from "@prismalens/database";
import { PrismaService } from "../../core/prisma/prisma.service.js";
import { RecommendationStatus } from "../../shared/enums/index.js";
import { UpdateRecommendationDto } from "./dto/index.js";

export type { Recommendation };

export type RecommendationWithRelations = Recommendation & {
	investigation?: {
		id: string;
		status: string;
		incident: {
			id: string;
			number: number;
			title: string;
		};
	} | null;
};

@Injectable()
export class RecommendationsService {
	private readonly logger = new Logger(RecommendationsService.name);

	constructor(private readonly prisma: PrismaService) {}

	async findById(id: string): Promise<RecommendationWithRelations | null> {
		return this.prisma.recommendation.findUnique({
			where: { id },
			include: {
				investigation: {
					select: {
						id: true,
						status: true,
						incident: {
							select: {
								id: true,
								number: true,
								title: true,
							},
						},
					},
				},
			},
		});
	}

	async findByInvestigationId(
		investigationId: string,
	): Promise<Recommendation[]> {
		return this.prisma.recommendation.findMany({
			where: { investigationId },
			orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
		});
	}

	async findAll(options?: {
		status?: string;
		priority?: string;
		urgency?: string;
		investigationId?: string;
		limit?: number;
		offset?: number;
	}): Promise<RecommendationWithRelations[]> {
		return this.prisma.recommendation.findMany({
			where: {
				...(options?.status && { status: options.status }),
				...(options?.priority && { priority: options.priority }),
				...(options?.urgency && { urgency: options.urgency }),
				...(options?.investigationId && {
					investigationId: options.investigationId,
				}),
			},
			include: {
				investigation: {
					select: {
						id: true,
						status: true,
						incident: {
							select: {
								id: true,
								number: true,
								title: true,
							},
						},
					},
				},
			},
			orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
			take: options?.limit,
			skip: options?.offset,
		});
	}

	async update(
		id: string,
		dto: UpdateRecommendationDto,
	): Promise<Recommendation | null> {
		try {
			const updateData: Record<string, unknown> = {
				...dto,
				updatedAt: new Date(),
			};

			// Track completion
			if (dto.status === RecommendationStatus.completed) {
				updateData.completedAt = new Date();
			}

			const recommendation = await this.prisma.recommendation.update({
				where: { id },
				data: updateData,
			});

			this.logger.log(`Updated recommendation ${id}`);
			return recommendation;
		} catch {
			return null;
		}
	}

	async complete(id: string): Promise<Recommendation | null> {
		return this.update(id, { status: RecommendationStatus.completed });
	}

	async dismiss(id: string): Promise<Recommendation | null> {
		return this.update(id, { status: RecommendationStatus.rejected });
	}

	async count(options?: {
		status?: string;
		priority?: string;
	}): Promise<number> {
		return this.prisma.recommendation.count({
			where: {
				...(options?.status && { status: options.status }),
				...(options?.priority && { priority: options.priority }),
			},
		});
	}

	async getStatsByStatus(): Promise<Record<string, number>> {
		const results = await this.prisma.recommendation.groupBy({
			by: ["status"],
			_count: true,
		});

		return results.reduce(
			(acc, item) => {
				acc[item.status] = item._count;
				return acc;
			},
			{} as Record<string, number>,
		);
	}

	async getStatsByPriority(): Promise<Record<string, number>> {
		const results = await this.prisma.recommendation.groupBy({
			by: ["priority"],
			_count: true,
		});

		return results.reduce(
			(acc, item) => {
				acc[item.priority] = item._count;
				return acc;
			},
			{} as Record<string, number>,
		);
	}
}
