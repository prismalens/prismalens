// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Controller } from "@nestjs/common";
import { Implement, implement, ORPCError } from "@orpc/nest";
import { correlationContract } from "@prismalens/contracts";
import type { CorrelationRule } from "@prismalens/contracts/schemas";
import { CorrelationService } from "./correlation.service.js";
import type {
	CreateCorrelationRuleDto,
	UpdateCorrelationRuleDto,
} from "./dto/index.js";

@Controller()
export class CorrelationController {
	constructor(private readonly correlationService: CorrelationService) {}

	@Implement(correlationContract)
	correlation() {
		return {
			// POST /correlation/rules - Create a new correlation rule
			create: implement(correlationContract.create).handler(
				async ({ input }) => {
					try {
						const rule = await this.correlationService.createRule(
							input as CreateCorrelationRuleDto,
						);
						return this.serializeRule(rule);
					} catch (error) {
						if ((error as { code?: string }).code === "P2002") {
							throw new ORPCError("CONFLICT", {
								message: `Rule with name '${input.name}' already exists`,
							});
						}
						throw error;
					}
				},
			),

			// GET /correlation/rules - List correlation rules
			list: implement(correlationContract.list).handler(async ({ input }) => {
				const rules = await this.correlationService.findAllRules({
					enabled: input.enabled,
				});
				return rules.map((r) => this.serializeRule(r));
			}),

			// GET /correlation/rules/:id - Get a single correlation rule
			get: implement(correlationContract.get).handler(async ({ input }) => {
				const rule = await this.correlationService.findRuleById(input.id);
				if (!rule) {
					throw new ORPCError("NOT_FOUND", {
						message: `Correlation rule ${input.id} not found`,
					});
				}
				return this.serializeRule(rule);
			}),

			// PATCH /correlation/rules/:id - Update a correlation rule
			update: implement(correlationContract.update).handler(
				async ({ input }) => {
					const { id, ...updateData } = input;
					const rule = await this.correlationService.updateRule(
						id,
						updateData as UpdateCorrelationRuleDto,
					);
					if (!rule) {
						throw new ORPCError("NOT_FOUND", {
							message: `Correlation rule ${id} not found`,
						});
					}
					return this.serializeRule(rule);
				},
			),

			// DELETE /correlation/rules/:id - Delete a correlation rule
			delete: implement(correlationContract.delete).handler(
				async ({ input }) => {
					const deleted = await this.correlationService.deleteRule(input.id);
					if (!deleted) {
						throw new ORPCError("NOT_FOUND", {
							message: `Correlation rule ${input.id} not found`,
						});
					}
				},
			),

			// POST /correlation/test - Test correlation rules against sample alert
			test: implement(correlationContract.test).handler(async ({ input }) => {
				const result = await this.correlationService.testCorrelation(
					input.alertData as Record<string, unknown>,
				);
				return {
					matchedRule: result.matchedRule
						? this.serializeRule(result.matchedRule)
						: null,
					action: result.action,
					reason: result.reason,
				};
			}),
		};
	}

	private serializeRule(rule: Record<string, any>): CorrelationRule {
		return {
			...rule,
			matchCriteria:
				typeof rule.matchCriteria === "string"
					? JSON.parse(rule.matchCriteria)
					: typeof rule.conditions === "string"
						? JSON.parse(rule.conditions)
						: (rule.matchCriteria ?? rule.conditions ?? {}),
			createdAt:
				rule.createdAt instanceof Date
					? rule.createdAt.toISOString()
					: rule.createdAt,
			updatedAt:
				rule.updatedAt instanceof Date
					? rule.updatedAt.toISOString()
					: rule.updatedAt,
		} as CorrelationRule;
	}
}
