// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import type { Postmortem } from "@prismalens/database";
import { PrismaService } from "../../core/prisma/prisma.service.js";
import type { CreatePostmortemDto, UpdatePostmortemDto } from "./dto/index.js";

export type PostmortemWithAuthor = Postmortem & {
	author?: {
		id: string;
		email: string;
		name: string | null;
	} | null;
};

@Injectable()
export class PostmortemsService {
	private readonly logger = new Logger(PostmortemsService.name);

	constructor(private readonly prisma: PrismaService) {}

	/**
	 * Get postmortem by incident ID
	 */
	async getByIncidentId(
		incidentId: string,
	): Promise<PostmortemWithAuthor | null> {
		return this.prisma.postmortem.findUnique({
			where: { incidentId },
			include: {
				author: {
					select: {
						id: true,
						email: true,
						name: true,
					},
				},
			},
		});
	}

	/**
	 * Get postmortem by ID
	 */
	async getById(id: string): Promise<PostmortemWithAuthor | null> {
		return this.prisma.postmortem.findUnique({
			where: { id },
			include: {
				author: {
					select: {
						id: true,
						email: true,
						name: true,
					},
				},
			},
		});
	}

	/**
	 * Create a new postmortem
	 * If autoPopulate is true, pre-fill from AI investigation results
	 */
	async create(dto: CreatePostmortemDto): Promise<Postmortem> {
		// Check if postmortem already exists
		const existing = await this.prisma.postmortem.findUnique({
			where: { incidentId: dto.incidentId },
		});

		if (existing) {
			this.logger.warn(
				`Postmortem already exists for incident ${dto.incidentId}`,
			);
			return existing;
		}

		// Get incident with relations for auto-population
		const incident = await this.prisma.incident.findUnique({
			where: { id: dto.incidentId },
			include: {
				investigations: {
					orderBy: { createdAt: "desc" },
					take: 1,
					include: {
						agentExecutions: true,
						recommendations: true,
					},
				},
				timeline: {
					orderBy: { occurredAt: "asc" },
				},
			},
		});

		if (!incident) {
			throw new NotFoundException(`Incident ${dto.incidentId} not found`);
		}

		let postmortemData: {
			incidentId: string;
			title: string;
			summary?: string;
			whatHappened?: string;
			whyItHappened?: string;
			whatWeLearned?: string;
			actionItems?: string;
			timeline?: string;
			customerImpact?: string;
			status: string;
		} = {
			incidentId: dto.incidentId,
			title: dto.title || `Postmortem: ${incident.title}`,
			status: "draft",
		};

		// Auto-populate from AI investigation if requested
		if (dto.autoPopulate) {
			const investigation = incident.investigations[0];

			postmortemData = {
				...postmortemData,
				summary: incident.description ?? undefined,
				whatHappened: investigation?.summary ?? undefined,
				whyItHappened: investigation?.rootCause ?? undefined,
				whatWeLearned: this.formatLessonsLearned(investigation),
				actionItems: this.formatActionItems(investigation?.recommendations),
				timeline: this.formatTimelineEntries(incident.timeline),
				customerImpact: incident.customerImpact ?? undefined,
			};
		}

		const postmortem = await this.prisma.postmortem.create({
			data: postmortemData,
		});

		this.logger.log(
			`Created postmortem ${postmortem.id} for incident ${dto.incidentId}`,
		);
		return postmortem;
	}

	/**
	 * Update a postmortem
	 */
	async update(id: string, dto: UpdatePostmortemDto): Promise<Postmortem> {
		const existing = await this.prisma.postmortem.findUnique({
			where: { id },
		});

		if (!existing) {
			throw new NotFoundException(`Postmortem ${id} not found`);
		}

		const postmortem = await this.prisma.postmortem.update({
			where: { id },
			data: {
				...dto,
				updatedAt: new Date(),
			},
		});

		this.logger.debug(`Updated postmortem ${id}`);
		return postmortem;
	}

	/**
	 * Publish a postmortem
	 */
	async publish(id: string): Promise<Postmortem> {
		const existing = await this.prisma.postmortem.findUnique({
			where: { id },
		});

		if (!existing) {
			throw new NotFoundException(`Postmortem ${id} not found`);
		}

		const postmortem = await this.prisma.postmortem.update({
			where: { id },
			data: {
				status: "published",
				publishedAt: new Date(),
				updatedAt: new Date(),
			},
		});

		this.logger.log(`Published postmortem ${id}`);
		return postmortem;
	}

	/**
	 * Delete a postmortem
	 */
	async delete(id: string): Promise<boolean> {
		try {
			await this.prisma.postmortem.delete({
				where: { id },
			});
			this.logger.log(`Deleted postmortem ${id}`);
			return true;
		} catch {
			return false;
		}
	}

	/**
	 * Format lessons learned from investigation
	 */
	private formatLessonsLearned(investigation: any): string | undefined {
		if (!investigation) return undefined;

		const lessons: string[] = [];

		if (investigation.summary) {
			lessons.push(`Investigation Summary: ${investigation.summary}`);
		}

		if (investigation.rootCause) {
			lessons.push(`Root Cause Identified: ${investigation.rootCause}`);
		}

		// Extract key findings from agent executions
		if (investigation.agentExecutions?.length > 0) {
			const completedAgents = investigation.agentExecutions.filter(
				(e: any) => e.status === "completed",
			);
			if (completedAgents.length > 0) {
				lessons.push(
					`AI Analysis: ${completedAgents.length} agents completed analysis`,
				);
			}
		}

		return lessons.length > 0 ? lessons.join("\n\n") : undefined;
	}

	/**
	 * Format action items from recommendations
	 */
	private formatActionItems(
		recommendations: any[] | undefined,
	): string | undefined {
		if (!recommendations?.length) return undefined;

		const actionItems = recommendations.map((r, index) => ({
			id: `action-${index + 1}`,
			title: r.title,
			description: r.description,
			priority: r.priority,
			completed: false,
		}));

		return JSON.stringify(actionItems);
	}

	/**
	 * Format timeline entries for postmortem
	 */
	private formatTimelineEntries(entries: any[]): string | undefined {
		if (!entries?.length) return undefined;

		const formatted = entries.map((e) => ({
			time: e.occurredAt,
			title: e.title,
			description: e.description,
			type: e.type,
		}));

		return JSON.stringify(formatted);
	}
}
