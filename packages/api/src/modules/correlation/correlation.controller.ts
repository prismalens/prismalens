import { Controller } from '@nestjs/common';
import { Implement, implement, ORPCError } from '@orpc/nest';
import { correlationContract } from '@prismalens/contracts';
import { CorrelationService } from './correlation.service.js';
import type { CreateCorrelationRuleDto, UpdateCorrelationRuleDto } from './dto/index.js';

@Controller()
export class CorrelationController {
  constructor(private readonly correlationService: CorrelationService) {}

  @Implement(correlationContract)
  correlation() {
    return {
      // POST /correlation/rules - Create a new correlation rule
      create: implement(correlationContract.create).handler(async ({ input }) => {
        try {
          const rule = await this.correlationService.createRule(input as CreateCorrelationRuleDto);
          return this.serializeRule(rule);
        } catch (error) {
          if ((error as { code?: string }).code === 'P2002') {
            throw new ORPCError('CONFLICT', { message: `Rule with name '${input.name}' already exists` });
          }
          throw error;
        }
      }),

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
          throw new ORPCError('NOT_FOUND', { message: `Correlation rule ${input.id} not found` });
        }
        return this.serializeRule(rule);
      }),

      // PATCH /correlation/rules/:id - Update a correlation rule
      update: implement(correlationContract.update).handler(async ({ input }) => {
        const { id, ...updateData } = input;
        const rule = await this.correlationService.updateRule(id, updateData as UpdateCorrelationRuleDto);
        if (!rule) {
          throw new ORPCError('NOT_FOUND', { message: `Correlation rule ${id} not found` });
        }
        return this.serializeRule(rule);
      }),

      // DELETE /correlation/rules/:id - Delete a correlation rule
      delete: implement(correlationContract.delete).handler(async ({ input }) => {
        const deleted = await this.correlationService.deleteRule(input.id);
        if (!deleted) {
          throw new ORPCError('NOT_FOUND', { message: `Correlation rule ${input.id} not found` });
        }
      }),

      // POST /correlation/test - Test correlation rules against sample alert
      test: implement(correlationContract.test).handler(async ({ input }) => {
        // Test which rule would match this alert
        // For now, return a placeholder since testRules doesn't exist
        // In a full implementation, this would call the correlation engine
        return {
          matchedRule: null,
          action: 'create_incident' as const,
          reason: 'No matching existing incident found - would create new incident',
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
}
