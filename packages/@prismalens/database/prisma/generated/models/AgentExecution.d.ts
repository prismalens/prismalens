import type * as runtime from "@prisma/client/runtime/client";
import type * as Prisma from "../internal/prismaNamespace.js";
export type AgentExecutionModel =
	runtime.Types.Result.DefaultSelection<Prisma.$AgentExecutionPayload>;
export type AggregateAgentExecution = {
	_count: AgentExecutionCountAggregateOutputType | null;
	_avg: AgentExecutionAvgAggregateOutputType | null;
	_sum: AgentExecutionSumAggregateOutputType | null;
	_min: AgentExecutionMinAggregateOutputType | null;
	_max: AgentExecutionMaxAggregateOutputType | null;
};
export type AgentExecutionAvgAggregateOutputType = {
	executionTimeMs: number | null;
	confidence: number | null;
	inputTokens: number | null;
	outputTokens: number | null;
};
export type AgentExecutionSumAggregateOutputType = {
	executionTimeMs: number | null;
	confidence: number | null;
	inputTokens: number | null;
	outputTokens: number | null;
};
export type AgentExecutionMinAggregateOutputType = {
	id: string | null;
	investigationId: string | null;
	agentName: string | null;
	agentType: string | null;
	status: string | null;
	startedAt: Date | null;
	completedAt: Date | null;
	executionTimeMs: number | null;
	output: string | null;
	confidence: number | null;
	inputTokens: number | null;
	outputTokens: number | null;
	error: string | null;
	createdAt: Date | null;
};
export type AgentExecutionMaxAggregateOutputType = {
	id: string | null;
	investigationId: string | null;
	agentName: string | null;
	agentType: string | null;
	status: string | null;
	startedAt: Date | null;
	completedAt: Date | null;
	executionTimeMs: number | null;
	output: string | null;
	confidence: number | null;
	inputTokens: number | null;
	outputTokens: number | null;
	error: string | null;
	createdAt: Date | null;
};
export type AgentExecutionCountAggregateOutputType = {
	id: number;
	investigationId: number;
	agentName: number;
	agentType: number;
	status: number;
	startedAt: number;
	completedAt: number;
	executionTimeMs: number;
	output: number;
	confidence: number;
	inputTokens: number;
	outputTokens: number;
	error: number;
	createdAt: number;
	_all: number;
};
export type AgentExecutionAvgAggregateInputType = {
	executionTimeMs?: true;
	confidence?: true;
	inputTokens?: true;
	outputTokens?: true;
};
export type AgentExecutionSumAggregateInputType = {
	executionTimeMs?: true;
	confidence?: true;
	inputTokens?: true;
	outputTokens?: true;
};
export type AgentExecutionMinAggregateInputType = {
	id?: true;
	investigationId?: true;
	agentName?: true;
	agentType?: true;
	status?: true;
	startedAt?: true;
	completedAt?: true;
	executionTimeMs?: true;
	output?: true;
	confidence?: true;
	inputTokens?: true;
	outputTokens?: true;
	error?: true;
	createdAt?: true;
};
export type AgentExecutionMaxAggregateInputType = {
	id?: true;
	investigationId?: true;
	agentName?: true;
	agentType?: true;
	status?: true;
	startedAt?: true;
	completedAt?: true;
	executionTimeMs?: true;
	output?: true;
	confidence?: true;
	inputTokens?: true;
	outputTokens?: true;
	error?: true;
	createdAt?: true;
};
export type AgentExecutionCountAggregateInputType = {
	id?: true;
	investigationId?: true;
	agentName?: true;
	agentType?: true;
	status?: true;
	startedAt?: true;
	completedAt?: true;
	executionTimeMs?: true;
	output?: true;
	confidence?: true;
	inputTokens?: true;
	outputTokens?: true;
	error?: true;
	createdAt?: true;
	_all?: true;
};
export type AgentExecutionAggregateArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	where?: Prisma.AgentExecutionWhereInput;
	orderBy?:
		| Prisma.AgentExecutionOrderByWithRelationInput
		| Prisma.AgentExecutionOrderByWithRelationInput[];
	cursor?: Prisma.AgentExecutionWhereUniqueInput;
	take?: number;
	skip?: number;
	_count?: true | AgentExecutionCountAggregateInputType;
	_avg?: AgentExecutionAvgAggregateInputType;
	_sum?: AgentExecutionSumAggregateInputType;
	_min?: AgentExecutionMinAggregateInputType;
	_max?: AgentExecutionMaxAggregateInputType;
};
export type GetAgentExecutionAggregateType<
	T extends AgentExecutionAggregateArgs,
> = {
	[P in keyof T & keyof AggregateAgentExecution]: P extends "_count" | "count"
		? T[P] extends true
			? number
			: Prisma.GetScalarType<T[P], AggregateAgentExecution[P]>
		: Prisma.GetScalarType<T[P], AggregateAgentExecution[P]>;
};
export type AgentExecutionGroupByArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	where?: Prisma.AgentExecutionWhereInput;
	orderBy?:
		| Prisma.AgentExecutionOrderByWithAggregationInput
		| Prisma.AgentExecutionOrderByWithAggregationInput[];
	by:
		| Prisma.AgentExecutionScalarFieldEnum[]
		| Prisma.AgentExecutionScalarFieldEnum;
	having?: Prisma.AgentExecutionScalarWhereWithAggregatesInput;
	take?: number;
	skip?: number;
	_count?: AgentExecutionCountAggregateInputType | true;
	_avg?: AgentExecutionAvgAggregateInputType;
	_sum?: AgentExecutionSumAggregateInputType;
	_min?: AgentExecutionMinAggregateInputType;
	_max?: AgentExecutionMaxAggregateInputType;
};
export type AgentExecutionGroupByOutputType = {
	id: string;
	investigationId: string;
	agentName: string;
	agentType: string;
	status: string;
	startedAt: Date | null;
	completedAt: Date | null;
	executionTimeMs: number | null;
	output: string | null;
	confidence: number | null;
	inputTokens: number | null;
	outputTokens: number | null;
	error: string | null;
	createdAt: Date;
	_count: AgentExecutionCountAggregateOutputType | null;
	_avg: AgentExecutionAvgAggregateOutputType | null;
	_sum: AgentExecutionSumAggregateOutputType | null;
	_min: AgentExecutionMinAggregateOutputType | null;
	_max: AgentExecutionMaxAggregateOutputType | null;
};
type GetAgentExecutionGroupByPayload<T extends AgentExecutionGroupByArgs> =
	Prisma.PrismaPromise<
		Array<
			Prisma.PickEnumerable<AgentExecutionGroupByOutputType, T["by"]> & {
				[P in keyof T &
					keyof AgentExecutionGroupByOutputType]: P extends "_count"
					? T[P] extends boolean
						? number
						: Prisma.GetScalarType<T[P], AgentExecutionGroupByOutputType[P]>
					: Prisma.GetScalarType<T[P], AgentExecutionGroupByOutputType[P]>;
			}
		>
	>;
export type AgentExecutionWhereInput = {
	AND?: Prisma.AgentExecutionWhereInput | Prisma.AgentExecutionWhereInput[];
	OR?: Prisma.AgentExecutionWhereInput[];
	NOT?: Prisma.AgentExecutionWhereInput | Prisma.AgentExecutionWhereInput[];
	id?: Prisma.StringFilter<"AgentExecution"> | string;
	investigationId?: Prisma.StringFilter<"AgentExecution"> | string;
	agentName?: Prisma.StringFilter<"AgentExecution"> | string;
	agentType?: Prisma.StringFilter<"AgentExecution"> | string;
	status?: Prisma.StringFilter<"AgentExecution"> | string;
	startedAt?:
		| Prisma.DateTimeNullableFilter<"AgentExecution">
		| Date
		| string
		| null;
	completedAt?:
		| Prisma.DateTimeNullableFilter<"AgentExecution">
		| Date
		| string
		| null;
	executionTimeMs?: Prisma.IntNullableFilter<"AgentExecution"> | number | null;
	output?: Prisma.StringNullableFilter<"AgentExecution"> | string | null;
	confidence?: Prisma.FloatNullableFilter<"AgentExecution"> | number | null;
	inputTokens?: Prisma.IntNullableFilter<"AgentExecution"> | number | null;
	outputTokens?: Prisma.IntNullableFilter<"AgentExecution"> | number | null;
	error?: Prisma.StringNullableFilter<"AgentExecution"> | string | null;
	createdAt?: Prisma.DateTimeFilter<"AgentExecution"> | Date | string;
	investigation?: Prisma.XOR<
		Prisma.InvestigationScalarRelationFilter,
		Prisma.InvestigationWhereInput
	>;
	toolExecutions?: Prisma.ToolExecutionListRelationFilter;
};
export type AgentExecutionOrderByWithRelationInput = {
	id?: Prisma.SortOrder;
	investigationId?: Prisma.SortOrder;
	agentName?: Prisma.SortOrder;
	agentType?: Prisma.SortOrder;
	status?: Prisma.SortOrder;
	startedAt?: Prisma.SortOrderInput | Prisma.SortOrder;
	completedAt?: Prisma.SortOrderInput | Prisma.SortOrder;
	executionTimeMs?: Prisma.SortOrderInput | Prisma.SortOrder;
	output?: Prisma.SortOrderInput | Prisma.SortOrder;
	confidence?: Prisma.SortOrderInput | Prisma.SortOrder;
	inputTokens?: Prisma.SortOrderInput | Prisma.SortOrder;
	outputTokens?: Prisma.SortOrderInput | Prisma.SortOrder;
	error?: Prisma.SortOrderInput | Prisma.SortOrder;
	createdAt?: Prisma.SortOrder;
	investigation?: Prisma.InvestigationOrderByWithRelationInput;
	toolExecutions?: Prisma.ToolExecutionOrderByRelationAggregateInput;
};
export type AgentExecutionWhereUniqueInput = Prisma.AtLeast<
	{
		id?: string;
		AND?: Prisma.AgentExecutionWhereInput | Prisma.AgentExecutionWhereInput[];
		OR?: Prisma.AgentExecutionWhereInput[];
		NOT?: Prisma.AgentExecutionWhereInput | Prisma.AgentExecutionWhereInput[];
		investigationId?: Prisma.StringFilter<"AgentExecution"> | string;
		agentName?: Prisma.StringFilter<"AgentExecution"> | string;
		agentType?: Prisma.StringFilter<"AgentExecution"> | string;
		status?: Prisma.StringFilter<"AgentExecution"> | string;
		startedAt?:
			| Prisma.DateTimeNullableFilter<"AgentExecution">
			| Date
			| string
			| null;
		completedAt?:
			| Prisma.DateTimeNullableFilter<"AgentExecution">
			| Date
			| string
			| null;
		executionTimeMs?:
			| Prisma.IntNullableFilter<"AgentExecution">
			| number
			| null;
		output?: Prisma.StringNullableFilter<"AgentExecution"> | string | null;
		confidence?: Prisma.FloatNullableFilter<"AgentExecution"> | number | null;
		inputTokens?: Prisma.IntNullableFilter<"AgentExecution"> | number | null;
		outputTokens?: Prisma.IntNullableFilter<"AgentExecution"> | number | null;
		error?: Prisma.StringNullableFilter<"AgentExecution"> | string | null;
		createdAt?: Prisma.DateTimeFilter<"AgentExecution"> | Date | string;
		investigation?: Prisma.XOR<
			Prisma.InvestigationScalarRelationFilter,
			Prisma.InvestigationWhereInput
		>;
		toolExecutions?: Prisma.ToolExecutionListRelationFilter;
	},
	"id"
>;
export type AgentExecutionOrderByWithAggregationInput = {
	id?: Prisma.SortOrder;
	investigationId?: Prisma.SortOrder;
	agentName?: Prisma.SortOrder;
	agentType?: Prisma.SortOrder;
	status?: Prisma.SortOrder;
	startedAt?: Prisma.SortOrderInput | Prisma.SortOrder;
	completedAt?: Prisma.SortOrderInput | Prisma.SortOrder;
	executionTimeMs?: Prisma.SortOrderInput | Prisma.SortOrder;
	output?: Prisma.SortOrderInput | Prisma.SortOrder;
	confidence?: Prisma.SortOrderInput | Prisma.SortOrder;
	inputTokens?: Prisma.SortOrderInput | Prisma.SortOrder;
	outputTokens?: Prisma.SortOrderInput | Prisma.SortOrder;
	error?: Prisma.SortOrderInput | Prisma.SortOrder;
	createdAt?: Prisma.SortOrder;
	_count?: Prisma.AgentExecutionCountOrderByAggregateInput;
	_avg?: Prisma.AgentExecutionAvgOrderByAggregateInput;
	_max?: Prisma.AgentExecutionMaxOrderByAggregateInput;
	_min?: Prisma.AgentExecutionMinOrderByAggregateInput;
	_sum?: Prisma.AgentExecutionSumOrderByAggregateInput;
};
export type AgentExecutionScalarWhereWithAggregatesInput = {
	AND?:
		| Prisma.AgentExecutionScalarWhereWithAggregatesInput
		| Prisma.AgentExecutionScalarWhereWithAggregatesInput[];
	OR?: Prisma.AgentExecutionScalarWhereWithAggregatesInput[];
	NOT?:
		| Prisma.AgentExecutionScalarWhereWithAggregatesInput
		| Prisma.AgentExecutionScalarWhereWithAggregatesInput[];
	id?: Prisma.StringWithAggregatesFilter<"AgentExecution"> | string;
	investigationId?:
		| Prisma.StringWithAggregatesFilter<"AgentExecution">
		| string;
	agentName?: Prisma.StringWithAggregatesFilter<"AgentExecution"> | string;
	agentType?: Prisma.StringWithAggregatesFilter<"AgentExecution"> | string;
	status?: Prisma.StringWithAggregatesFilter<"AgentExecution"> | string;
	startedAt?:
		| Prisma.DateTimeNullableWithAggregatesFilter<"AgentExecution">
		| Date
		| string
		| null;
	completedAt?:
		| Prisma.DateTimeNullableWithAggregatesFilter<"AgentExecution">
		| Date
		| string
		| null;
	executionTimeMs?:
		| Prisma.IntNullableWithAggregatesFilter<"AgentExecution">
		| number
		| null;
	output?:
		| Prisma.StringNullableWithAggregatesFilter<"AgentExecution">
		| string
		| null;
	confidence?:
		| Prisma.FloatNullableWithAggregatesFilter<"AgentExecution">
		| number
		| null;
	inputTokens?:
		| Prisma.IntNullableWithAggregatesFilter<"AgentExecution">
		| number
		| null;
	outputTokens?:
		| Prisma.IntNullableWithAggregatesFilter<"AgentExecution">
		| number
		| null;
	error?:
		| Prisma.StringNullableWithAggregatesFilter<"AgentExecution">
		| string
		| null;
	createdAt?:
		| Prisma.DateTimeWithAggregatesFilter<"AgentExecution">
		| Date
		| string;
};
export type AgentExecutionCreateInput = {
	id?: string;
	agentName: string;
	agentType?: string;
	status?: string;
	startedAt?: Date | string | null;
	completedAt?: Date | string | null;
	executionTimeMs?: number | null;
	output?: string | null;
	confidence?: number | null;
	inputTokens?: number | null;
	outputTokens?: number | null;
	error?: string | null;
	createdAt?: Date | string;
	investigation: Prisma.InvestigationCreateNestedOneWithoutAgentExecutionsInput;
	toolExecutions?: Prisma.ToolExecutionCreateNestedManyWithoutAgentExecutionInput;
};
export type AgentExecutionUncheckedCreateInput = {
	id?: string;
	investigationId: string;
	agentName: string;
	agentType?: string;
	status?: string;
	startedAt?: Date | string | null;
	completedAt?: Date | string | null;
	executionTimeMs?: number | null;
	output?: string | null;
	confidence?: number | null;
	inputTokens?: number | null;
	outputTokens?: number | null;
	error?: string | null;
	createdAt?: Date | string;
	toolExecutions?: Prisma.ToolExecutionUncheckedCreateNestedManyWithoutAgentExecutionInput;
};
export type AgentExecutionUpdateInput = {
	id?: Prisma.StringFieldUpdateOperationsInput | string;
	agentName?: Prisma.StringFieldUpdateOperationsInput | string;
	agentType?: Prisma.StringFieldUpdateOperationsInput | string;
	status?: Prisma.StringFieldUpdateOperationsInput | string;
	startedAt?:
		| Prisma.NullableDateTimeFieldUpdateOperationsInput
		| Date
		| string
		| null;
	completedAt?:
		| Prisma.NullableDateTimeFieldUpdateOperationsInput
		| Date
		| string
		| null;
	executionTimeMs?:
		| Prisma.NullableIntFieldUpdateOperationsInput
		| number
		| null;
	output?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	confidence?: Prisma.NullableFloatFieldUpdateOperationsInput | number | null;
	inputTokens?: Prisma.NullableIntFieldUpdateOperationsInput | number | null;
	outputTokens?: Prisma.NullableIntFieldUpdateOperationsInput | number | null;
	error?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	createdAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
	investigation?: Prisma.InvestigationUpdateOneRequiredWithoutAgentExecutionsNestedInput;
	toolExecutions?: Prisma.ToolExecutionUpdateManyWithoutAgentExecutionNestedInput;
};
export type AgentExecutionUncheckedUpdateInput = {
	id?: Prisma.StringFieldUpdateOperationsInput | string;
	investigationId?: Prisma.StringFieldUpdateOperationsInput | string;
	agentName?: Prisma.StringFieldUpdateOperationsInput | string;
	agentType?: Prisma.StringFieldUpdateOperationsInput | string;
	status?: Prisma.StringFieldUpdateOperationsInput | string;
	startedAt?:
		| Prisma.NullableDateTimeFieldUpdateOperationsInput
		| Date
		| string
		| null;
	completedAt?:
		| Prisma.NullableDateTimeFieldUpdateOperationsInput
		| Date
		| string
		| null;
	executionTimeMs?:
		| Prisma.NullableIntFieldUpdateOperationsInput
		| number
		| null;
	output?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	confidence?: Prisma.NullableFloatFieldUpdateOperationsInput | number | null;
	inputTokens?: Prisma.NullableIntFieldUpdateOperationsInput | number | null;
	outputTokens?: Prisma.NullableIntFieldUpdateOperationsInput | number | null;
	error?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	createdAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
	toolExecutions?: Prisma.ToolExecutionUncheckedUpdateManyWithoutAgentExecutionNestedInput;
};
export type AgentExecutionCreateManyInput = {
	id?: string;
	investigationId: string;
	agentName: string;
	agentType?: string;
	status?: string;
	startedAt?: Date | string | null;
	completedAt?: Date | string | null;
	executionTimeMs?: number | null;
	output?: string | null;
	confidence?: number | null;
	inputTokens?: number | null;
	outputTokens?: number | null;
	error?: string | null;
	createdAt?: Date | string;
};
export type AgentExecutionUpdateManyMutationInput = {
	id?: Prisma.StringFieldUpdateOperationsInput | string;
	agentName?: Prisma.StringFieldUpdateOperationsInput | string;
	agentType?: Prisma.StringFieldUpdateOperationsInput | string;
	status?: Prisma.StringFieldUpdateOperationsInput | string;
	startedAt?:
		| Prisma.NullableDateTimeFieldUpdateOperationsInput
		| Date
		| string
		| null;
	completedAt?:
		| Prisma.NullableDateTimeFieldUpdateOperationsInput
		| Date
		| string
		| null;
	executionTimeMs?:
		| Prisma.NullableIntFieldUpdateOperationsInput
		| number
		| null;
	output?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	confidence?: Prisma.NullableFloatFieldUpdateOperationsInput | number | null;
	inputTokens?: Prisma.NullableIntFieldUpdateOperationsInput | number | null;
	outputTokens?: Prisma.NullableIntFieldUpdateOperationsInput | number | null;
	error?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	createdAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
};
export type AgentExecutionUncheckedUpdateManyInput = {
	id?: Prisma.StringFieldUpdateOperationsInput | string;
	investigationId?: Prisma.StringFieldUpdateOperationsInput | string;
	agentName?: Prisma.StringFieldUpdateOperationsInput | string;
	agentType?: Prisma.StringFieldUpdateOperationsInput | string;
	status?: Prisma.StringFieldUpdateOperationsInput | string;
	startedAt?:
		| Prisma.NullableDateTimeFieldUpdateOperationsInput
		| Date
		| string
		| null;
	completedAt?:
		| Prisma.NullableDateTimeFieldUpdateOperationsInput
		| Date
		| string
		| null;
	executionTimeMs?:
		| Prisma.NullableIntFieldUpdateOperationsInput
		| number
		| null;
	output?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	confidence?: Prisma.NullableFloatFieldUpdateOperationsInput | number | null;
	inputTokens?: Prisma.NullableIntFieldUpdateOperationsInput | number | null;
	outputTokens?: Prisma.NullableIntFieldUpdateOperationsInput | number | null;
	error?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	createdAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
};
export type AgentExecutionListRelationFilter = {
	every?: Prisma.AgentExecutionWhereInput;
	some?: Prisma.AgentExecutionWhereInput;
	none?: Prisma.AgentExecutionWhereInput;
};
export type AgentExecutionOrderByRelationAggregateInput = {
	_count?: Prisma.SortOrder;
};
export type AgentExecutionCountOrderByAggregateInput = {
	id?: Prisma.SortOrder;
	investigationId?: Prisma.SortOrder;
	agentName?: Prisma.SortOrder;
	agentType?: Prisma.SortOrder;
	status?: Prisma.SortOrder;
	startedAt?: Prisma.SortOrder;
	completedAt?: Prisma.SortOrder;
	executionTimeMs?: Prisma.SortOrder;
	output?: Prisma.SortOrder;
	confidence?: Prisma.SortOrder;
	inputTokens?: Prisma.SortOrder;
	outputTokens?: Prisma.SortOrder;
	error?: Prisma.SortOrder;
	createdAt?: Prisma.SortOrder;
};
export type AgentExecutionAvgOrderByAggregateInput = {
	executionTimeMs?: Prisma.SortOrder;
	confidence?: Prisma.SortOrder;
	inputTokens?: Prisma.SortOrder;
	outputTokens?: Prisma.SortOrder;
};
export type AgentExecutionMaxOrderByAggregateInput = {
	id?: Prisma.SortOrder;
	investigationId?: Prisma.SortOrder;
	agentName?: Prisma.SortOrder;
	agentType?: Prisma.SortOrder;
	status?: Prisma.SortOrder;
	startedAt?: Prisma.SortOrder;
	completedAt?: Prisma.SortOrder;
	executionTimeMs?: Prisma.SortOrder;
	output?: Prisma.SortOrder;
	confidence?: Prisma.SortOrder;
	inputTokens?: Prisma.SortOrder;
	outputTokens?: Prisma.SortOrder;
	error?: Prisma.SortOrder;
	createdAt?: Prisma.SortOrder;
};
export type AgentExecutionMinOrderByAggregateInput = {
	id?: Prisma.SortOrder;
	investigationId?: Prisma.SortOrder;
	agentName?: Prisma.SortOrder;
	agentType?: Prisma.SortOrder;
	status?: Prisma.SortOrder;
	startedAt?: Prisma.SortOrder;
	completedAt?: Prisma.SortOrder;
	executionTimeMs?: Prisma.SortOrder;
	output?: Prisma.SortOrder;
	confidence?: Prisma.SortOrder;
	inputTokens?: Prisma.SortOrder;
	outputTokens?: Prisma.SortOrder;
	error?: Prisma.SortOrder;
	createdAt?: Prisma.SortOrder;
};
export type AgentExecutionSumOrderByAggregateInput = {
	executionTimeMs?: Prisma.SortOrder;
	confidence?: Prisma.SortOrder;
	inputTokens?: Prisma.SortOrder;
	outputTokens?: Prisma.SortOrder;
};
export type AgentExecutionScalarRelationFilter = {
	is?: Prisma.AgentExecutionWhereInput;
	isNot?: Prisma.AgentExecutionWhereInput;
};
export type AgentExecutionCreateNestedManyWithoutInvestigationInput = {
	create?:
		| Prisma.XOR<
				Prisma.AgentExecutionCreateWithoutInvestigationInput,
				Prisma.AgentExecutionUncheckedCreateWithoutInvestigationInput
		  >
		| Prisma.AgentExecutionCreateWithoutInvestigationInput[]
		| Prisma.AgentExecutionUncheckedCreateWithoutInvestigationInput[];
	connectOrCreate?:
		| Prisma.AgentExecutionCreateOrConnectWithoutInvestigationInput
		| Prisma.AgentExecutionCreateOrConnectWithoutInvestigationInput[];
	createMany?: Prisma.AgentExecutionCreateManyInvestigationInputEnvelope;
	connect?:
		| Prisma.AgentExecutionWhereUniqueInput
		| Prisma.AgentExecutionWhereUniqueInput[];
};
export type AgentExecutionUncheckedCreateNestedManyWithoutInvestigationInput = {
	create?:
		| Prisma.XOR<
				Prisma.AgentExecutionCreateWithoutInvestigationInput,
				Prisma.AgentExecutionUncheckedCreateWithoutInvestigationInput
		  >
		| Prisma.AgentExecutionCreateWithoutInvestigationInput[]
		| Prisma.AgentExecutionUncheckedCreateWithoutInvestigationInput[];
	connectOrCreate?:
		| Prisma.AgentExecutionCreateOrConnectWithoutInvestigationInput
		| Prisma.AgentExecutionCreateOrConnectWithoutInvestigationInput[];
	createMany?: Prisma.AgentExecutionCreateManyInvestigationInputEnvelope;
	connect?:
		| Prisma.AgentExecutionWhereUniqueInput
		| Prisma.AgentExecutionWhereUniqueInput[];
};
export type AgentExecutionUpdateManyWithoutInvestigationNestedInput = {
	create?:
		| Prisma.XOR<
				Prisma.AgentExecutionCreateWithoutInvestigationInput,
				Prisma.AgentExecutionUncheckedCreateWithoutInvestigationInput
		  >
		| Prisma.AgentExecutionCreateWithoutInvestigationInput[]
		| Prisma.AgentExecutionUncheckedCreateWithoutInvestigationInput[];
	connectOrCreate?:
		| Prisma.AgentExecutionCreateOrConnectWithoutInvestigationInput
		| Prisma.AgentExecutionCreateOrConnectWithoutInvestigationInput[];
	upsert?:
		| Prisma.AgentExecutionUpsertWithWhereUniqueWithoutInvestigationInput
		| Prisma.AgentExecutionUpsertWithWhereUniqueWithoutInvestigationInput[];
	createMany?: Prisma.AgentExecutionCreateManyInvestigationInputEnvelope;
	set?:
		| Prisma.AgentExecutionWhereUniqueInput
		| Prisma.AgentExecutionWhereUniqueInput[];
	disconnect?:
		| Prisma.AgentExecutionWhereUniqueInput
		| Prisma.AgentExecutionWhereUniqueInput[];
	delete?:
		| Prisma.AgentExecutionWhereUniqueInput
		| Prisma.AgentExecutionWhereUniqueInput[];
	connect?:
		| Prisma.AgentExecutionWhereUniqueInput
		| Prisma.AgentExecutionWhereUniqueInput[];
	update?:
		| Prisma.AgentExecutionUpdateWithWhereUniqueWithoutInvestigationInput
		| Prisma.AgentExecutionUpdateWithWhereUniqueWithoutInvestigationInput[];
	updateMany?:
		| Prisma.AgentExecutionUpdateManyWithWhereWithoutInvestigationInput
		| Prisma.AgentExecutionUpdateManyWithWhereWithoutInvestigationInput[];
	deleteMany?:
		| Prisma.AgentExecutionScalarWhereInput
		| Prisma.AgentExecutionScalarWhereInput[];
};
export type AgentExecutionUncheckedUpdateManyWithoutInvestigationNestedInput = {
	create?:
		| Prisma.XOR<
				Prisma.AgentExecutionCreateWithoutInvestigationInput,
				Prisma.AgentExecutionUncheckedCreateWithoutInvestigationInput
		  >
		| Prisma.AgentExecutionCreateWithoutInvestigationInput[]
		| Prisma.AgentExecutionUncheckedCreateWithoutInvestigationInput[];
	connectOrCreate?:
		| Prisma.AgentExecutionCreateOrConnectWithoutInvestigationInput
		| Prisma.AgentExecutionCreateOrConnectWithoutInvestigationInput[];
	upsert?:
		| Prisma.AgentExecutionUpsertWithWhereUniqueWithoutInvestigationInput
		| Prisma.AgentExecutionUpsertWithWhereUniqueWithoutInvestigationInput[];
	createMany?: Prisma.AgentExecutionCreateManyInvestigationInputEnvelope;
	set?:
		| Prisma.AgentExecutionWhereUniqueInput
		| Prisma.AgentExecutionWhereUniqueInput[];
	disconnect?:
		| Prisma.AgentExecutionWhereUniqueInput
		| Prisma.AgentExecutionWhereUniqueInput[];
	delete?:
		| Prisma.AgentExecutionWhereUniqueInput
		| Prisma.AgentExecutionWhereUniqueInput[];
	connect?:
		| Prisma.AgentExecutionWhereUniqueInput
		| Prisma.AgentExecutionWhereUniqueInput[];
	update?:
		| Prisma.AgentExecutionUpdateWithWhereUniqueWithoutInvestigationInput
		| Prisma.AgentExecutionUpdateWithWhereUniqueWithoutInvestigationInput[];
	updateMany?:
		| Prisma.AgentExecutionUpdateManyWithWhereWithoutInvestigationInput
		| Prisma.AgentExecutionUpdateManyWithWhereWithoutInvestigationInput[];
	deleteMany?:
		| Prisma.AgentExecutionScalarWhereInput
		| Prisma.AgentExecutionScalarWhereInput[];
};
export type AgentExecutionCreateNestedOneWithoutToolExecutionsInput = {
	create?: Prisma.XOR<
		Prisma.AgentExecutionCreateWithoutToolExecutionsInput,
		Prisma.AgentExecutionUncheckedCreateWithoutToolExecutionsInput
	>;
	connectOrCreate?: Prisma.AgentExecutionCreateOrConnectWithoutToolExecutionsInput;
	connect?: Prisma.AgentExecutionWhereUniqueInput;
};
export type AgentExecutionUpdateOneRequiredWithoutToolExecutionsNestedInput = {
	create?: Prisma.XOR<
		Prisma.AgentExecutionCreateWithoutToolExecutionsInput,
		Prisma.AgentExecutionUncheckedCreateWithoutToolExecutionsInput
	>;
	connectOrCreate?: Prisma.AgentExecutionCreateOrConnectWithoutToolExecutionsInput;
	upsert?: Prisma.AgentExecutionUpsertWithoutToolExecutionsInput;
	connect?: Prisma.AgentExecutionWhereUniqueInput;
	update?: Prisma.XOR<
		Prisma.XOR<
			Prisma.AgentExecutionUpdateToOneWithWhereWithoutToolExecutionsInput,
			Prisma.AgentExecutionUpdateWithoutToolExecutionsInput
		>,
		Prisma.AgentExecutionUncheckedUpdateWithoutToolExecutionsInput
	>;
};
export type AgentExecutionCreateWithoutInvestigationInput = {
	id?: string;
	agentName: string;
	agentType?: string;
	status?: string;
	startedAt?: Date | string | null;
	completedAt?: Date | string | null;
	executionTimeMs?: number | null;
	output?: string | null;
	confidence?: number | null;
	inputTokens?: number | null;
	outputTokens?: number | null;
	error?: string | null;
	createdAt?: Date | string;
	toolExecutions?: Prisma.ToolExecutionCreateNestedManyWithoutAgentExecutionInput;
};
export type AgentExecutionUncheckedCreateWithoutInvestigationInput = {
	id?: string;
	agentName: string;
	agentType?: string;
	status?: string;
	startedAt?: Date | string | null;
	completedAt?: Date | string | null;
	executionTimeMs?: number | null;
	output?: string | null;
	confidence?: number | null;
	inputTokens?: number | null;
	outputTokens?: number | null;
	error?: string | null;
	createdAt?: Date | string;
	toolExecutions?: Prisma.ToolExecutionUncheckedCreateNestedManyWithoutAgentExecutionInput;
};
export type AgentExecutionCreateOrConnectWithoutInvestigationInput = {
	where: Prisma.AgentExecutionWhereUniqueInput;
	create: Prisma.XOR<
		Prisma.AgentExecutionCreateWithoutInvestigationInput,
		Prisma.AgentExecutionUncheckedCreateWithoutInvestigationInput
	>;
};
export type AgentExecutionCreateManyInvestigationInputEnvelope = {
	data:
		| Prisma.AgentExecutionCreateManyInvestigationInput
		| Prisma.AgentExecutionCreateManyInvestigationInput[];
};
export type AgentExecutionUpsertWithWhereUniqueWithoutInvestigationInput = {
	where: Prisma.AgentExecutionWhereUniqueInput;
	update: Prisma.XOR<
		Prisma.AgentExecutionUpdateWithoutInvestigationInput,
		Prisma.AgentExecutionUncheckedUpdateWithoutInvestigationInput
	>;
	create: Prisma.XOR<
		Prisma.AgentExecutionCreateWithoutInvestigationInput,
		Prisma.AgentExecutionUncheckedCreateWithoutInvestigationInput
	>;
};
export type AgentExecutionUpdateWithWhereUniqueWithoutInvestigationInput = {
	where: Prisma.AgentExecutionWhereUniqueInput;
	data: Prisma.XOR<
		Prisma.AgentExecutionUpdateWithoutInvestigationInput,
		Prisma.AgentExecutionUncheckedUpdateWithoutInvestigationInput
	>;
};
export type AgentExecutionUpdateManyWithWhereWithoutInvestigationInput = {
	where: Prisma.AgentExecutionScalarWhereInput;
	data: Prisma.XOR<
		Prisma.AgentExecutionUpdateManyMutationInput,
		Prisma.AgentExecutionUncheckedUpdateManyWithoutInvestigationInput
	>;
};
export type AgentExecutionScalarWhereInput = {
	AND?:
		| Prisma.AgentExecutionScalarWhereInput
		| Prisma.AgentExecutionScalarWhereInput[];
	OR?: Prisma.AgentExecutionScalarWhereInput[];
	NOT?:
		| Prisma.AgentExecutionScalarWhereInput
		| Prisma.AgentExecutionScalarWhereInput[];
	id?: Prisma.StringFilter<"AgentExecution"> | string;
	investigationId?: Prisma.StringFilter<"AgentExecution"> | string;
	agentName?: Prisma.StringFilter<"AgentExecution"> | string;
	agentType?: Prisma.StringFilter<"AgentExecution"> | string;
	status?: Prisma.StringFilter<"AgentExecution"> | string;
	startedAt?:
		| Prisma.DateTimeNullableFilter<"AgentExecution">
		| Date
		| string
		| null;
	completedAt?:
		| Prisma.DateTimeNullableFilter<"AgentExecution">
		| Date
		| string
		| null;
	executionTimeMs?: Prisma.IntNullableFilter<"AgentExecution"> | number | null;
	output?: Prisma.StringNullableFilter<"AgentExecution"> | string | null;
	confidence?: Prisma.FloatNullableFilter<"AgentExecution"> | number | null;
	inputTokens?: Prisma.IntNullableFilter<"AgentExecution"> | number | null;
	outputTokens?: Prisma.IntNullableFilter<"AgentExecution"> | number | null;
	error?: Prisma.StringNullableFilter<"AgentExecution"> | string | null;
	createdAt?: Prisma.DateTimeFilter<"AgentExecution"> | Date | string;
};
export type AgentExecutionCreateWithoutToolExecutionsInput = {
	id?: string;
	agentName: string;
	agentType?: string;
	status?: string;
	startedAt?: Date | string | null;
	completedAt?: Date | string | null;
	executionTimeMs?: number | null;
	output?: string | null;
	confidence?: number | null;
	inputTokens?: number | null;
	outputTokens?: number | null;
	error?: string | null;
	createdAt?: Date | string;
	investigation: Prisma.InvestigationCreateNestedOneWithoutAgentExecutionsInput;
};
export type AgentExecutionUncheckedCreateWithoutToolExecutionsInput = {
	id?: string;
	investigationId: string;
	agentName: string;
	agentType?: string;
	status?: string;
	startedAt?: Date | string | null;
	completedAt?: Date | string | null;
	executionTimeMs?: number | null;
	output?: string | null;
	confidence?: number | null;
	inputTokens?: number | null;
	outputTokens?: number | null;
	error?: string | null;
	createdAt?: Date | string;
};
export type AgentExecutionCreateOrConnectWithoutToolExecutionsInput = {
	where: Prisma.AgentExecutionWhereUniqueInput;
	create: Prisma.XOR<
		Prisma.AgentExecutionCreateWithoutToolExecutionsInput,
		Prisma.AgentExecutionUncheckedCreateWithoutToolExecutionsInput
	>;
};
export type AgentExecutionUpsertWithoutToolExecutionsInput = {
	update: Prisma.XOR<
		Prisma.AgentExecutionUpdateWithoutToolExecutionsInput,
		Prisma.AgentExecutionUncheckedUpdateWithoutToolExecutionsInput
	>;
	create: Prisma.XOR<
		Prisma.AgentExecutionCreateWithoutToolExecutionsInput,
		Prisma.AgentExecutionUncheckedCreateWithoutToolExecutionsInput
	>;
	where?: Prisma.AgentExecutionWhereInput;
};
export type AgentExecutionUpdateToOneWithWhereWithoutToolExecutionsInput = {
	where?: Prisma.AgentExecutionWhereInput;
	data: Prisma.XOR<
		Prisma.AgentExecutionUpdateWithoutToolExecutionsInput,
		Prisma.AgentExecutionUncheckedUpdateWithoutToolExecutionsInput
	>;
};
export type AgentExecutionUpdateWithoutToolExecutionsInput = {
	id?: Prisma.StringFieldUpdateOperationsInput | string;
	agentName?: Prisma.StringFieldUpdateOperationsInput | string;
	agentType?: Prisma.StringFieldUpdateOperationsInput | string;
	status?: Prisma.StringFieldUpdateOperationsInput | string;
	startedAt?:
		| Prisma.NullableDateTimeFieldUpdateOperationsInput
		| Date
		| string
		| null;
	completedAt?:
		| Prisma.NullableDateTimeFieldUpdateOperationsInput
		| Date
		| string
		| null;
	executionTimeMs?:
		| Prisma.NullableIntFieldUpdateOperationsInput
		| number
		| null;
	output?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	confidence?: Prisma.NullableFloatFieldUpdateOperationsInput | number | null;
	inputTokens?: Prisma.NullableIntFieldUpdateOperationsInput | number | null;
	outputTokens?: Prisma.NullableIntFieldUpdateOperationsInput | number | null;
	error?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	createdAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
	investigation?: Prisma.InvestigationUpdateOneRequiredWithoutAgentExecutionsNestedInput;
};
export type AgentExecutionUncheckedUpdateWithoutToolExecutionsInput = {
	id?: Prisma.StringFieldUpdateOperationsInput | string;
	investigationId?: Prisma.StringFieldUpdateOperationsInput | string;
	agentName?: Prisma.StringFieldUpdateOperationsInput | string;
	agentType?: Prisma.StringFieldUpdateOperationsInput | string;
	status?: Prisma.StringFieldUpdateOperationsInput | string;
	startedAt?:
		| Prisma.NullableDateTimeFieldUpdateOperationsInput
		| Date
		| string
		| null;
	completedAt?:
		| Prisma.NullableDateTimeFieldUpdateOperationsInput
		| Date
		| string
		| null;
	executionTimeMs?:
		| Prisma.NullableIntFieldUpdateOperationsInput
		| number
		| null;
	output?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	confidence?: Prisma.NullableFloatFieldUpdateOperationsInput | number | null;
	inputTokens?: Prisma.NullableIntFieldUpdateOperationsInput | number | null;
	outputTokens?: Prisma.NullableIntFieldUpdateOperationsInput | number | null;
	error?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	createdAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
};
export type AgentExecutionCreateManyInvestigationInput = {
	id?: string;
	agentName: string;
	agentType?: string;
	status?: string;
	startedAt?: Date | string | null;
	completedAt?: Date | string | null;
	executionTimeMs?: number | null;
	output?: string | null;
	confidence?: number | null;
	inputTokens?: number | null;
	outputTokens?: number | null;
	error?: string | null;
	createdAt?: Date | string;
};
export type AgentExecutionUpdateWithoutInvestigationInput = {
	id?: Prisma.StringFieldUpdateOperationsInput | string;
	agentName?: Prisma.StringFieldUpdateOperationsInput | string;
	agentType?: Prisma.StringFieldUpdateOperationsInput | string;
	status?: Prisma.StringFieldUpdateOperationsInput | string;
	startedAt?:
		| Prisma.NullableDateTimeFieldUpdateOperationsInput
		| Date
		| string
		| null;
	completedAt?:
		| Prisma.NullableDateTimeFieldUpdateOperationsInput
		| Date
		| string
		| null;
	executionTimeMs?:
		| Prisma.NullableIntFieldUpdateOperationsInput
		| number
		| null;
	output?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	confidence?: Prisma.NullableFloatFieldUpdateOperationsInput | number | null;
	inputTokens?: Prisma.NullableIntFieldUpdateOperationsInput | number | null;
	outputTokens?: Prisma.NullableIntFieldUpdateOperationsInput | number | null;
	error?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	createdAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
	toolExecutions?: Prisma.ToolExecutionUpdateManyWithoutAgentExecutionNestedInput;
};
export type AgentExecutionUncheckedUpdateWithoutInvestigationInput = {
	id?: Prisma.StringFieldUpdateOperationsInput | string;
	agentName?: Prisma.StringFieldUpdateOperationsInput | string;
	agentType?: Prisma.StringFieldUpdateOperationsInput | string;
	status?: Prisma.StringFieldUpdateOperationsInput | string;
	startedAt?:
		| Prisma.NullableDateTimeFieldUpdateOperationsInput
		| Date
		| string
		| null;
	completedAt?:
		| Prisma.NullableDateTimeFieldUpdateOperationsInput
		| Date
		| string
		| null;
	executionTimeMs?:
		| Prisma.NullableIntFieldUpdateOperationsInput
		| number
		| null;
	output?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	confidence?: Prisma.NullableFloatFieldUpdateOperationsInput | number | null;
	inputTokens?: Prisma.NullableIntFieldUpdateOperationsInput | number | null;
	outputTokens?: Prisma.NullableIntFieldUpdateOperationsInput | number | null;
	error?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	createdAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
	toolExecutions?: Prisma.ToolExecutionUncheckedUpdateManyWithoutAgentExecutionNestedInput;
};
export type AgentExecutionUncheckedUpdateManyWithoutInvestigationInput = {
	id?: Prisma.StringFieldUpdateOperationsInput | string;
	agentName?: Prisma.StringFieldUpdateOperationsInput | string;
	agentType?: Prisma.StringFieldUpdateOperationsInput | string;
	status?: Prisma.StringFieldUpdateOperationsInput | string;
	startedAt?:
		| Prisma.NullableDateTimeFieldUpdateOperationsInput
		| Date
		| string
		| null;
	completedAt?:
		| Prisma.NullableDateTimeFieldUpdateOperationsInput
		| Date
		| string
		| null;
	executionTimeMs?:
		| Prisma.NullableIntFieldUpdateOperationsInput
		| number
		| null;
	output?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	confidence?: Prisma.NullableFloatFieldUpdateOperationsInput | number | null;
	inputTokens?: Prisma.NullableIntFieldUpdateOperationsInput | number | null;
	outputTokens?: Prisma.NullableIntFieldUpdateOperationsInput | number | null;
	error?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	createdAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
};
export type AgentExecutionCountOutputType = {
	toolExecutions: number;
};
export type AgentExecutionCountOutputTypeSelect<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	toolExecutions?:
		| boolean
		| AgentExecutionCountOutputTypeCountToolExecutionsArgs;
};
export type AgentExecutionCountOutputTypeDefaultArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	select?: Prisma.AgentExecutionCountOutputTypeSelect<ExtArgs> | null;
};
export type AgentExecutionCountOutputTypeCountToolExecutionsArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	where?: Prisma.ToolExecutionWhereInput;
};
export type AgentExecutionSelect<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = runtime.Types.Extensions.GetSelect<
	{
		id?: boolean;
		investigationId?: boolean;
		agentName?: boolean;
		agentType?: boolean;
		status?: boolean;
		startedAt?: boolean;
		completedAt?: boolean;
		executionTimeMs?: boolean;
		output?: boolean;
		confidence?: boolean;
		inputTokens?: boolean;
		outputTokens?: boolean;
		error?: boolean;
		createdAt?: boolean;
		investigation?: boolean | Prisma.InvestigationDefaultArgs<ExtArgs>;
		toolExecutions?:
			| boolean
			| Prisma.AgentExecution$toolExecutionsArgs<ExtArgs>;
		_count?: boolean | Prisma.AgentExecutionCountOutputTypeDefaultArgs<ExtArgs>;
	},
	ExtArgs["result"]["agentExecution"]
>;
export type AgentExecutionSelectCreateManyAndReturn<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = runtime.Types.Extensions.GetSelect<
	{
		id?: boolean;
		investigationId?: boolean;
		agentName?: boolean;
		agentType?: boolean;
		status?: boolean;
		startedAt?: boolean;
		completedAt?: boolean;
		executionTimeMs?: boolean;
		output?: boolean;
		confidence?: boolean;
		inputTokens?: boolean;
		outputTokens?: boolean;
		error?: boolean;
		createdAt?: boolean;
		investigation?: boolean | Prisma.InvestigationDefaultArgs<ExtArgs>;
	},
	ExtArgs["result"]["agentExecution"]
>;
export type AgentExecutionSelectUpdateManyAndReturn<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = runtime.Types.Extensions.GetSelect<
	{
		id?: boolean;
		investigationId?: boolean;
		agentName?: boolean;
		agentType?: boolean;
		status?: boolean;
		startedAt?: boolean;
		completedAt?: boolean;
		executionTimeMs?: boolean;
		output?: boolean;
		confidence?: boolean;
		inputTokens?: boolean;
		outputTokens?: boolean;
		error?: boolean;
		createdAt?: boolean;
		investigation?: boolean | Prisma.InvestigationDefaultArgs<ExtArgs>;
	},
	ExtArgs["result"]["agentExecution"]
>;
export type AgentExecutionSelectScalar = {
	id?: boolean;
	investigationId?: boolean;
	agentName?: boolean;
	agentType?: boolean;
	status?: boolean;
	startedAt?: boolean;
	completedAt?: boolean;
	executionTimeMs?: boolean;
	output?: boolean;
	confidence?: boolean;
	inputTokens?: boolean;
	outputTokens?: boolean;
	error?: boolean;
	createdAt?: boolean;
};
export type AgentExecutionOmit<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = runtime.Types.Extensions.GetOmit<
	| "id"
	| "investigationId"
	| "agentName"
	| "agentType"
	| "status"
	| "startedAt"
	| "completedAt"
	| "executionTimeMs"
	| "output"
	| "confidence"
	| "inputTokens"
	| "outputTokens"
	| "error"
	| "createdAt",
	ExtArgs["result"]["agentExecution"]
>;
export type AgentExecutionInclude<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	investigation?: boolean | Prisma.InvestigationDefaultArgs<ExtArgs>;
	toolExecutions?: boolean | Prisma.AgentExecution$toolExecutionsArgs<ExtArgs>;
	_count?: boolean | Prisma.AgentExecutionCountOutputTypeDefaultArgs<ExtArgs>;
};
export type AgentExecutionIncludeCreateManyAndReturn<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	investigation?: boolean | Prisma.InvestigationDefaultArgs<ExtArgs>;
};
export type AgentExecutionIncludeUpdateManyAndReturn<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	investigation?: boolean | Prisma.InvestigationDefaultArgs<ExtArgs>;
};
export type $AgentExecutionPayload<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	name: "AgentExecution";
	objects: {
		investigation: Prisma.$InvestigationPayload<ExtArgs>;
		toolExecutions: Prisma.$ToolExecutionPayload<ExtArgs>[];
	};
	scalars: runtime.Types.Extensions.GetPayloadResult<
		{
			id: string;
			investigationId: string;
			agentName: string;
			agentType: string;
			status: string;
			startedAt: Date | null;
			completedAt: Date | null;
			executionTimeMs: number | null;
			output: string | null;
			confidence: number | null;
			inputTokens: number | null;
			outputTokens: number | null;
			error: string | null;
			createdAt: Date;
		},
		ExtArgs["result"]["agentExecution"]
	>;
	composites: {};
};
export type AgentExecutionGetPayload<
	S extends boolean | null | undefined | AgentExecutionDefaultArgs,
> = runtime.Types.Result.GetResult<Prisma.$AgentExecutionPayload, S>;
export type AgentExecutionCountArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = Omit<
	AgentExecutionFindManyArgs,
	"select" | "include" | "distinct" | "omit"
> & {
	select?: AgentExecutionCountAggregateInputType | true;
};
export interface AgentExecutionDelegate<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
	GlobalOmitOptions = {},
> {
	[K: symbol]: {
		types: Prisma.TypeMap<ExtArgs>["model"]["AgentExecution"];
		meta: {
			name: "AgentExecution";
		};
	};
	findUnique<T extends AgentExecutionFindUniqueArgs>(
		args: Prisma.SelectSubset<T, AgentExecutionFindUniqueArgs<ExtArgs>>,
	): Prisma.Prisma__AgentExecutionClient<
		runtime.Types.Result.GetResult<
			Prisma.$AgentExecutionPayload<ExtArgs>,
			T,
			"findUnique",
			GlobalOmitOptions
		> | null,
		null,
		ExtArgs,
		GlobalOmitOptions
	>;
	findUniqueOrThrow<T extends AgentExecutionFindUniqueOrThrowArgs>(
		args: Prisma.SelectSubset<T, AgentExecutionFindUniqueOrThrowArgs<ExtArgs>>,
	): Prisma.Prisma__AgentExecutionClient<
		runtime.Types.Result.GetResult<
			Prisma.$AgentExecutionPayload<ExtArgs>,
			T,
			"findUniqueOrThrow",
			GlobalOmitOptions
		>,
		never,
		ExtArgs,
		GlobalOmitOptions
	>;
	findFirst<T extends AgentExecutionFindFirstArgs>(
		args?: Prisma.SelectSubset<T, AgentExecutionFindFirstArgs<ExtArgs>>,
	): Prisma.Prisma__AgentExecutionClient<
		runtime.Types.Result.GetResult<
			Prisma.$AgentExecutionPayload<ExtArgs>,
			T,
			"findFirst",
			GlobalOmitOptions
		> | null,
		null,
		ExtArgs,
		GlobalOmitOptions
	>;
	findFirstOrThrow<T extends AgentExecutionFindFirstOrThrowArgs>(
		args?: Prisma.SelectSubset<T, AgentExecutionFindFirstOrThrowArgs<ExtArgs>>,
	): Prisma.Prisma__AgentExecutionClient<
		runtime.Types.Result.GetResult<
			Prisma.$AgentExecutionPayload<ExtArgs>,
			T,
			"findFirstOrThrow",
			GlobalOmitOptions
		>,
		never,
		ExtArgs,
		GlobalOmitOptions
	>;
	findMany<T extends AgentExecutionFindManyArgs>(
		args?: Prisma.SelectSubset<T, AgentExecutionFindManyArgs<ExtArgs>>,
	): Prisma.PrismaPromise<
		runtime.Types.Result.GetResult<
			Prisma.$AgentExecutionPayload<ExtArgs>,
			T,
			"findMany",
			GlobalOmitOptions
		>
	>;
	create<T extends AgentExecutionCreateArgs>(
		args: Prisma.SelectSubset<T, AgentExecutionCreateArgs<ExtArgs>>,
	): Prisma.Prisma__AgentExecutionClient<
		runtime.Types.Result.GetResult<
			Prisma.$AgentExecutionPayload<ExtArgs>,
			T,
			"create",
			GlobalOmitOptions
		>,
		never,
		ExtArgs,
		GlobalOmitOptions
	>;
	createMany<T extends AgentExecutionCreateManyArgs>(
		args?: Prisma.SelectSubset<T, AgentExecutionCreateManyArgs<ExtArgs>>,
	): Prisma.PrismaPromise<Prisma.BatchPayload>;
	createManyAndReturn<T extends AgentExecutionCreateManyAndReturnArgs>(
		args?: Prisma.SelectSubset<
			T,
			AgentExecutionCreateManyAndReturnArgs<ExtArgs>
		>,
	): Prisma.PrismaPromise<
		runtime.Types.Result.GetResult<
			Prisma.$AgentExecutionPayload<ExtArgs>,
			T,
			"createManyAndReturn",
			GlobalOmitOptions
		>
	>;
	delete<T extends AgentExecutionDeleteArgs>(
		args: Prisma.SelectSubset<T, AgentExecutionDeleteArgs<ExtArgs>>,
	): Prisma.Prisma__AgentExecutionClient<
		runtime.Types.Result.GetResult<
			Prisma.$AgentExecutionPayload<ExtArgs>,
			T,
			"delete",
			GlobalOmitOptions
		>,
		never,
		ExtArgs,
		GlobalOmitOptions
	>;
	update<T extends AgentExecutionUpdateArgs>(
		args: Prisma.SelectSubset<T, AgentExecutionUpdateArgs<ExtArgs>>,
	): Prisma.Prisma__AgentExecutionClient<
		runtime.Types.Result.GetResult<
			Prisma.$AgentExecutionPayload<ExtArgs>,
			T,
			"update",
			GlobalOmitOptions
		>,
		never,
		ExtArgs,
		GlobalOmitOptions
	>;
	deleteMany<T extends AgentExecutionDeleteManyArgs>(
		args?: Prisma.SelectSubset<T, AgentExecutionDeleteManyArgs<ExtArgs>>,
	): Prisma.PrismaPromise<Prisma.BatchPayload>;
	updateMany<T extends AgentExecutionUpdateManyArgs>(
		args: Prisma.SelectSubset<T, AgentExecutionUpdateManyArgs<ExtArgs>>,
	): Prisma.PrismaPromise<Prisma.BatchPayload>;
	updateManyAndReturn<T extends AgentExecutionUpdateManyAndReturnArgs>(
		args: Prisma.SelectSubset<
			T,
			AgentExecutionUpdateManyAndReturnArgs<ExtArgs>
		>,
	): Prisma.PrismaPromise<
		runtime.Types.Result.GetResult<
			Prisma.$AgentExecutionPayload<ExtArgs>,
			T,
			"updateManyAndReturn",
			GlobalOmitOptions
		>
	>;
	upsert<T extends AgentExecutionUpsertArgs>(
		args: Prisma.SelectSubset<T, AgentExecutionUpsertArgs<ExtArgs>>,
	): Prisma.Prisma__AgentExecutionClient<
		runtime.Types.Result.GetResult<
			Prisma.$AgentExecutionPayload<ExtArgs>,
			T,
			"upsert",
			GlobalOmitOptions
		>,
		never,
		ExtArgs,
		GlobalOmitOptions
	>;
	count<T extends AgentExecutionCountArgs>(
		args?: Prisma.Subset<T, AgentExecutionCountArgs>,
	): Prisma.PrismaPromise<
		T extends runtime.Types.Utils.Record<"select", any>
			? T["select"] extends true
				? number
				: Prisma.GetScalarType<
						T["select"],
						AgentExecutionCountAggregateOutputType
					>
			: number
	>;
	aggregate<T extends AgentExecutionAggregateArgs>(
		args: Prisma.Subset<T, AgentExecutionAggregateArgs>,
	): Prisma.PrismaPromise<GetAgentExecutionAggregateType<T>>;
	groupBy<
		T extends AgentExecutionGroupByArgs,
		HasSelectOrTake extends Prisma.Or<
			Prisma.Extends<"skip", Prisma.Keys<T>>,
			Prisma.Extends<"take", Prisma.Keys<T>>
		>,
		OrderByArg extends Prisma.True extends HasSelectOrTake
			? {
					orderBy: AgentExecutionGroupByArgs["orderBy"];
				}
			: {
					orderBy?: AgentExecutionGroupByArgs["orderBy"];
				},
		OrderFields extends Prisma.ExcludeUnderscoreKeys<
			Prisma.Keys<Prisma.MaybeTupleToUnion<T["orderBy"]>>
		>,
		ByFields extends Prisma.MaybeTupleToUnion<T["by"]>,
		ByValid extends Prisma.Has<ByFields, OrderFields>,
		HavingFields extends Prisma.GetHavingFields<T["having"]>,
		HavingValid extends Prisma.Has<ByFields, HavingFields>,
		ByEmpty extends T["by"] extends never[] ? Prisma.True : Prisma.False,
		InputErrors extends ByEmpty extends Prisma.True
			? `Error: "by" must not be empty.`
			: HavingValid extends Prisma.False
				? {
						[P in HavingFields]: P extends ByFields
							? never
							: P extends string
								? `Error: Field "${P}" used in "having" needs to be provided in "by".`
								: [
										Error,
										"Field ",
										P,
										` in "having" needs to be provided in "by"`,
									];
					}[HavingFields]
				: "take" extends Prisma.Keys<T>
					? "orderBy" extends Prisma.Keys<T>
						? ByValid extends Prisma.True
							? {}
							: {
									[P in OrderFields]: P extends ByFields
										? never
										: `Error: Field "${P}" in "orderBy" needs to be provided in "by"`;
								}[OrderFields]
						: 'Error: If you provide "take", you also need to provide "orderBy"'
					: "skip" extends Prisma.Keys<T>
						? "orderBy" extends Prisma.Keys<T>
							? ByValid extends Prisma.True
								? {}
								: {
										[P in OrderFields]: P extends ByFields
											? never
											: `Error: Field "${P}" in "orderBy" needs to be provided in "by"`;
									}[OrderFields]
							: 'Error: If you provide "skip", you also need to provide "orderBy"'
						: ByValid extends Prisma.True
							? {}
							: {
									[P in OrderFields]: P extends ByFields
										? never
										: `Error: Field "${P}" in "orderBy" needs to be provided in "by"`;
								}[OrderFields],
	>(
		args: Prisma.SubsetIntersection<T, AgentExecutionGroupByArgs, OrderByArg> &
			InputErrors,
	): {} extends InputErrors
		? GetAgentExecutionGroupByPayload<T>
		: Prisma.PrismaPromise<InputErrors>;
	readonly fields: AgentExecutionFieldRefs;
}
export interface Prisma__AgentExecutionClient<
	T,
	Null = never,
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
	GlobalOmitOptions = {},
> extends Prisma.PrismaPromise<T> {
	readonly [Symbol.toStringTag]: "PrismaPromise";
	investigation<T extends Prisma.InvestigationDefaultArgs<ExtArgs> = {}>(
		args?: Prisma.Subset<T, Prisma.InvestigationDefaultArgs<ExtArgs>>,
	): Prisma.Prisma__InvestigationClient<
		| runtime.Types.Result.GetResult<
				Prisma.$InvestigationPayload<ExtArgs>,
				T,
				"findUniqueOrThrow",
				GlobalOmitOptions
		  >
		| Null,
		Null,
		ExtArgs,
		GlobalOmitOptions
	>;
	toolExecutions<
		T extends Prisma.AgentExecution$toolExecutionsArgs<ExtArgs> = {},
	>(
		args?: Prisma.Subset<T, Prisma.AgentExecution$toolExecutionsArgs<ExtArgs>>,
	): Prisma.PrismaPromise<
		| runtime.Types.Result.GetResult<
				Prisma.$ToolExecutionPayload<ExtArgs>,
				T,
				"findMany",
				GlobalOmitOptions
		  >
		| Null
	>;
	then<TResult1 = T, TResult2 = never>(
		onfulfilled?:
			| ((value: T) => TResult1 | PromiseLike<TResult1>)
			| undefined
			| null,
		onrejected?:
			| ((reason: any) => TResult2 | PromiseLike<TResult2>)
			| undefined
			| null,
	): runtime.Types.Utils.JsPromise<TResult1 | TResult2>;
	catch<TResult = never>(
		onrejected?:
			| ((reason: any) => TResult | PromiseLike<TResult>)
			| undefined
			| null,
	): runtime.Types.Utils.JsPromise<T | TResult>;
	finally(
		onfinally?: (() => void) | undefined | null,
	): runtime.Types.Utils.JsPromise<T>;
}
export interface AgentExecutionFieldRefs {
	readonly id: Prisma.FieldRef<"AgentExecution", "String">;
	readonly investigationId: Prisma.FieldRef<"AgentExecution", "String">;
	readonly agentName: Prisma.FieldRef<"AgentExecution", "String">;
	readonly agentType: Prisma.FieldRef<"AgentExecution", "String">;
	readonly status: Prisma.FieldRef<"AgentExecution", "String">;
	readonly startedAt: Prisma.FieldRef<"AgentExecution", "DateTime">;
	readonly completedAt: Prisma.FieldRef<"AgentExecution", "DateTime">;
	readonly executionTimeMs: Prisma.FieldRef<"AgentExecution", "Int">;
	readonly output: Prisma.FieldRef<"AgentExecution", "String">;
	readonly confidence: Prisma.FieldRef<"AgentExecution", "Float">;
	readonly inputTokens: Prisma.FieldRef<"AgentExecution", "Int">;
	readonly outputTokens: Prisma.FieldRef<"AgentExecution", "Int">;
	readonly error: Prisma.FieldRef<"AgentExecution", "String">;
	readonly createdAt: Prisma.FieldRef<"AgentExecution", "DateTime">;
}
export type AgentExecutionFindUniqueArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	select?: Prisma.AgentExecutionSelect<ExtArgs> | null;
	omit?: Prisma.AgentExecutionOmit<ExtArgs> | null;
	include?: Prisma.AgentExecutionInclude<ExtArgs> | null;
	where: Prisma.AgentExecutionWhereUniqueInput;
};
export type AgentExecutionFindUniqueOrThrowArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	select?: Prisma.AgentExecutionSelect<ExtArgs> | null;
	omit?: Prisma.AgentExecutionOmit<ExtArgs> | null;
	include?: Prisma.AgentExecutionInclude<ExtArgs> | null;
	where: Prisma.AgentExecutionWhereUniqueInput;
};
export type AgentExecutionFindFirstArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	select?: Prisma.AgentExecutionSelect<ExtArgs> | null;
	omit?: Prisma.AgentExecutionOmit<ExtArgs> | null;
	include?: Prisma.AgentExecutionInclude<ExtArgs> | null;
	where?: Prisma.AgentExecutionWhereInput;
	orderBy?:
		| Prisma.AgentExecutionOrderByWithRelationInput
		| Prisma.AgentExecutionOrderByWithRelationInput[];
	cursor?: Prisma.AgentExecutionWhereUniqueInput;
	take?: number;
	skip?: number;
	distinct?:
		| Prisma.AgentExecutionScalarFieldEnum
		| Prisma.AgentExecutionScalarFieldEnum[];
};
export type AgentExecutionFindFirstOrThrowArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	select?: Prisma.AgentExecutionSelect<ExtArgs> | null;
	omit?: Prisma.AgentExecutionOmit<ExtArgs> | null;
	include?: Prisma.AgentExecutionInclude<ExtArgs> | null;
	where?: Prisma.AgentExecutionWhereInput;
	orderBy?:
		| Prisma.AgentExecutionOrderByWithRelationInput
		| Prisma.AgentExecutionOrderByWithRelationInput[];
	cursor?: Prisma.AgentExecutionWhereUniqueInput;
	take?: number;
	skip?: number;
	distinct?:
		| Prisma.AgentExecutionScalarFieldEnum
		| Prisma.AgentExecutionScalarFieldEnum[];
};
export type AgentExecutionFindManyArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	select?: Prisma.AgentExecutionSelect<ExtArgs> | null;
	omit?: Prisma.AgentExecutionOmit<ExtArgs> | null;
	include?: Prisma.AgentExecutionInclude<ExtArgs> | null;
	where?: Prisma.AgentExecutionWhereInput;
	orderBy?:
		| Prisma.AgentExecutionOrderByWithRelationInput
		| Prisma.AgentExecutionOrderByWithRelationInput[];
	cursor?: Prisma.AgentExecutionWhereUniqueInput;
	take?: number;
	skip?: number;
	distinct?:
		| Prisma.AgentExecutionScalarFieldEnum
		| Prisma.AgentExecutionScalarFieldEnum[];
};
export type AgentExecutionCreateArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	select?: Prisma.AgentExecutionSelect<ExtArgs> | null;
	omit?: Prisma.AgentExecutionOmit<ExtArgs> | null;
	include?: Prisma.AgentExecutionInclude<ExtArgs> | null;
	data: Prisma.XOR<
		Prisma.AgentExecutionCreateInput,
		Prisma.AgentExecutionUncheckedCreateInput
	>;
};
export type AgentExecutionCreateManyArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	data:
		| Prisma.AgentExecutionCreateManyInput
		| Prisma.AgentExecutionCreateManyInput[];
};
export type AgentExecutionCreateManyAndReturnArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	select?: Prisma.AgentExecutionSelectCreateManyAndReturn<ExtArgs> | null;
	omit?: Prisma.AgentExecutionOmit<ExtArgs> | null;
	data:
		| Prisma.AgentExecutionCreateManyInput
		| Prisma.AgentExecutionCreateManyInput[];
	include?: Prisma.AgentExecutionIncludeCreateManyAndReturn<ExtArgs> | null;
};
export type AgentExecutionUpdateArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	select?: Prisma.AgentExecutionSelect<ExtArgs> | null;
	omit?: Prisma.AgentExecutionOmit<ExtArgs> | null;
	include?: Prisma.AgentExecutionInclude<ExtArgs> | null;
	data: Prisma.XOR<
		Prisma.AgentExecutionUpdateInput,
		Prisma.AgentExecutionUncheckedUpdateInput
	>;
	where: Prisma.AgentExecutionWhereUniqueInput;
};
export type AgentExecutionUpdateManyArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	data: Prisma.XOR<
		Prisma.AgentExecutionUpdateManyMutationInput,
		Prisma.AgentExecutionUncheckedUpdateManyInput
	>;
	where?: Prisma.AgentExecutionWhereInput;
	limit?: number;
};
export type AgentExecutionUpdateManyAndReturnArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	select?: Prisma.AgentExecutionSelectUpdateManyAndReturn<ExtArgs> | null;
	omit?: Prisma.AgentExecutionOmit<ExtArgs> | null;
	data: Prisma.XOR<
		Prisma.AgentExecutionUpdateManyMutationInput,
		Prisma.AgentExecutionUncheckedUpdateManyInput
	>;
	where?: Prisma.AgentExecutionWhereInput;
	limit?: number;
	include?: Prisma.AgentExecutionIncludeUpdateManyAndReturn<ExtArgs> | null;
};
export type AgentExecutionUpsertArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	select?: Prisma.AgentExecutionSelect<ExtArgs> | null;
	omit?: Prisma.AgentExecutionOmit<ExtArgs> | null;
	include?: Prisma.AgentExecutionInclude<ExtArgs> | null;
	where: Prisma.AgentExecutionWhereUniqueInput;
	create: Prisma.XOR<
		Prisma.AgentExecutionCreateInput,
		Prisma.AgentExecutionUncheckedCreateInput
	>;
	update: Prisma.XOR<
		Prisma.AgentExecutionUpdateInput,
		Prisma.AgentExecutionUncheckedUpdateInput
	>;
};
export type AgentExecutionDeleteArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	select?: Prisma.AgentExecutionSelect<ExtArgs> | null;
	omit?: Prisma.AgentExecutionOmit<ExtArgs> | null;
	include?: Prisma.AgentExecutionInclude<ExtArgs> | null;
	where: Prisma.AgentExecutionWhereUniqueInput;
};
export type AgentExecutionDeleteManyArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	where?: Prisma.AgentExecutionWhereInput;
	limit?: number;
};
export type AgentExecution$toolExecutionsArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	select?: Prisma.ToolExecutionSelect<ExtArgs> | null;
	omit?: Prisma.ToolExecutionOmit<ExtArgs> | null;
	include?: Prisma.ToolExecutionInclude<ExtArgs> | null;
	where?: Prisma.ToolExecutionWhereInput;
	orderBy?:
		| Prisma.ToolExecutionOrderByWithRelationInput
		| Prisma.ToolExecutionOrderByWithRelationInput[];
	cursor?: Prisma.ToolExecutionWhereUniqueInput;
	take?: number;
	skip?: number;
	distinct?:
		| Prisma.ToolExecutionScalarFieldEnum
		| Prisma.ToolExecutionScalarFieldEnum[];
};
export type AgentExecutionDefaultArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	select?: Prisma.AgentExecutionSelect<ExtArgs> | null;
	omit?: Prisma.AgentExecutionOmit<ExtArgs> | null;
	include?: Prisma.AgentExecutionInclude<ExtArgs> | null;
};
