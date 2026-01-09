import { Controller, Logger } from "@nestjs/common";
import { Implement, implement, ORPCError } from "@orpc/nest";
import { alertMappingContract } from "@prismalens/contracts";
import { AlertMappingService } from "./alert-mapping.service.js";
import type {
	CreateMappingRuleDto,
	UpdateMappingRuleDto,
} from "./dto/index.js";

@Controller()
export class AlertMappingController {
	private readonly logger = new Logger(AlertMappingController.name);

	constructor(private readonly alertMappingService: AlertMappingService) {}

	@Implement(alertMappingContract)
	alertMapping() {
		return {
			// POST /alert-mapping/rules - Create a new alert mapping rule
			create: implement(alertMappingContract.create).handler(
				async ({ input }) => {
					this.logger.log(`Creating alert mapping rule: ${input.name}`);
					const rule = await this.alertMappingService.create(
						input as CreateMappingRuleDto,
					);
					return this.serializeRule(rule);
				},
			),

			// GET /alert-mapping/rules - List alert mapping rules
			list: implement(alertMappingContract.list).handler(async () => {
				const rules = await this.alertMappingService.findAll();
				return rules.map((r) => this.serializeRuleWithService(r));
			}),

			// GET /alert-mapping/rules/:id - Get a single alert mapping rule
			get: implement(alertMappingContract.get).handler(async ({ input }) => {
				const rule = await this.alertMappingService.findById(input.id);
				if (!rule) {
					throw new ORPCError("NOT_FOUND", {
						message: `Alert mapping rule ${input.id} not found`,
					});
				}
				return this.serializeRuleWithService(rule);
			}),

			// PATCH /alert-mapping/rules/:id - Update an alert mapping rule
			update: implement(alertMappingContract.update).handler(
				async ({ input }) => {
					const { id, ...updateData } = input;
					this.logger.log(`Updating alert mapping rule: ${id}`);
					const rule = await this.alertMappingService.update(
						id,
						updateData as UpdateMappingRuleDto,
					);
					if (!rule) {
						throw new ORPCError("NOT_FOUND", {
							message: `Alert mapping rule ${id} not found`,
						});
					}
					return this.serializeRule(rule);
				},
			),

			// DELETE /alert-mapping/rules/:id - Delete an alert mapping rule
			delete: implement(alertMappingContract.delete).handler(
				async ({ input }) => {
					this.logger.log(`Deleting alert mapping rule: ${input.id}`);
					await this.alertMappingService.delete(input.id);
				},
			),

			// POST /alert-mapping/test - Test mapping rules against sample data
			test: implement(alertMappingContract.test).handler(async ({ input }) => {
				const alertData = input.alertData as Record<string, unknown>;
				this.logger.log(
					`Testing mapping for alert: "${alertData.title || "unknown"}"`,
				);
				const service = await this.alertMappingService.resolveServiceForAlert({
					source: alertData.source as string | undefined,
					labels: alertData.labels as Record<string, string> | undefined,
					tags: alertData.tags as string[] | undefined,
					title: (alertData.title as string) || "",
					description: alertData.description as string | undefined,
				});

				return {
					matchedRule: null, // Service doesn't return the matched rule
					serviceId: service?.id ?? null,
					serviceName: service?.name ?? null,
				};
			}),
		};
	}

	private serializeRule(rule: any): any {
		return {
			...rule,
			conditions: rule.conditions ? JSON.parse(rule.conditions) : null,
			createdAt: rule.createdAt?.toISOString(),
			updatedAt: rule.updatedAt?.toISOString(),
		};
	}

	private serializeRuleWithService(rule: any): any {
		const serialized = this.serializeRule(rule);

		if (rule.service) {
			serialized.service = {
				id: rule.service.id,
				name: rule.service.name,
				type: rule.service.type,
				tier: rule.service.tier,
			};
		}

		return serialized;
	}
}
