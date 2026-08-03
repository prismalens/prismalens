// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type {
	AgentType,
	EffortEstimate,
	ExecutionStatus,
	InvestigationJobData,
	RecommendationCategory,
	RecommendationPriority,
	ToolCategory,
	ToolExecutionStatus,
	Urgency,
} from "@prismalens/contracts/schemas";

export type { InvestigationJobData };

export interface InvestigationResult {
	success: boolean;
	investigationId: string;
	incidentId: string;
	findings: {
		rootCause?: string;
		summary?: string;
	};
	recommendations: Array<{
		title: string;
		description?: string;
		priority?: RecommendationPriority;
		category?: RecommendationCategory;
		urgency?: Urgency;
		actionable?: boolean;
		estimatedEffort?: EffortEstimate;
	}>;
	agentExecutions: Array<{
		agentName: string;
		agentType?: AgentType;
		status: ExecutionStatus;
		startedAt?: string;
		completedAt?: string;
		executionTimeMs?: number;
		toolExecutions: Array<{
			toolName: string;
			toolCategory?: ToolCategory;
			arguments?: unknown;
			result?: unknown;
			status?: ToolExecutionStatus;
			executionTimeMs?: number;
		}>;
	}>;
	error?: string;
	errorType?: string;
}
