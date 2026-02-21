import { Controller } from "@nestjs/common";
import { Implement, implement, ORPCError } from "@orpc/nest";
import { postmortemsContract } from "@prismalens/contracts";
import type { PostmortemWithRelations } from "@prismalens/contracts/schemas";
import type { CreatePostmortemDto, UpdatePostmortemDto } from "./dto/index.js";
import { PostmortemsService } from "./postmortems.service.js";

@Controller()
export class PostmortemsController {
	constructor(private readonly postmortemsService: PostmortemsService) {}

	@Implement(postmortemsContract)
	postmortems() {
		return {
			// GET /postmortems/incident/:incidentId - Get postmortem by incident ID
			getByIncidentId: implement(
				postmortemsContract.getByIncidentId,
			).handler(async ({ input }) => {
				const postmortem = await this.postmortemsService.getByIncidentId(
					input.incidentId,
				);
				return postmortem ? this.serializePostmortem(postmortem) : null;
			}),

			// GET /postmortems/:id - Get postmortem by ID
			get: implement(postmortemsContract.get).handler(async ({ input }) => {
				const postmortem = await this.postmortemsService.getById(input.id);
				if (!postmortem) {
					throw new ORPCError("NOT_FOUND", {
						message: `Postmortem ${input.id} not found`,
					});
				}
				return this.serializePostmortem(postmortem);
			}),

			// POST /postmortems - Create a new postmortem
			create: implement(postmortemsContract.create).handler(
				async ({ input }) => {
					const postmortem = await this.postmortemsService.create(
						input as CreatePostmortemDto,
					);
					return this.serializePostmortem(postmortem);
				},
			),

			// PATCH /postmortems/:id - Update postmortem
			update: implement(postmortemsContract.update).handler(
				async ({ input }) => {
					const postmortem = await this.postmortemsService.update(
						input.id,
						input.data as UpdatePostmortemDto,
					);
					return this.serializePostmortem(postmortem);
				},
			),

			// POST /postmortems/:id/publish - Publish postmortem
			publish: implement(postmortemsContract.publish).handler(
				async ({ input }) => {
					const postmortem = await this.postmortemsService.publish(input.id);
					return this.serializePostmortem(postmortem);
				},
			),

			// DELETE /postmortems/:id - Delete postmortem
			delete: implement(postmortemsContract.delete).handler(
				async ({ input }) => {
					const deleted = await this.postmortemsService.delete(input.id);
					if (!deleted) {
						throw new ORPCError("NOT_FOUND", {
							message: `Postmortem ${input.id} not found`,
						});
					}
				},
			),
		};
	}

	private serializePostmortem(postmortem: Record<string, any>): PostmortemWithRelations {
		const serialized: any = {
			id: postmortem.id,
			incidentId: postmortem.incidentId,
			title: postmortem.title,
			summary: postmortem.summary,
			timeline: postmortem.timeline,
			whatHappened: postmortem.whatHappened,
			whyItHappened: postmortem.whyItHappened,
			whatWeLearned: postmortem.whatWeLearned,
			actionItems: postmortem.actionItems,
			customerImpact: postmortem.customerImpact,
			financialImpact: postmortem.financialImpact,
			status: postmortem.status,
			authorId: postmortem.authorId,
			createdAt: postmortem.createdAt?.toISOString(),
			updatedAt: postmortem.updatedAt?.toISOString(),
			publishedAt: postmortem.publishedAt?.toISOString() ?? null,
		};

		if (postmortem.author) {
			serialized.author = {
				id: postmortem.author.id,
				email: postmortem.author.email,
				name: postmortem.author.name ?? null,
			};
		}

		return serialized;
	}
}
