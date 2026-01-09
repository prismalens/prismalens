import type * as runtime from "@prisma/client/runtime/client";
import type * as Prisma from "../internal/prismaNamespace.js";
export type ToolExecutionModel =
	runtime.Types.Result.DefaultSelection<Prisma.$ToolExecutionPayload>;
export type AggregateToolExecution = {
	_count: ToolExecutionCountAggregateOutputType | null;
	_avg: ToolExecutionAvgAggregateOutputType | null;
	_sum: ToolExecutionSumAggregateOutputType | null;
	_min: ToolExecutionMinAggregateOutputType | null;
	_max: ToolExecutionMaxAggregateOutputType | null;
};
export type ToolExecutionAvgAggregateOutputType = {
	executionTimeMs: number | null;
	confidence: number | null;
};
export type ToolExecutionSumAggregateOutputType = {
	executionTimeMs: number | null;
	confidence: number | null;
};
export type ToolExecutionMinAggregateOutputType = {
	id: string | null;
	agentExecutionId: string | null;
	toolName: string | null;
	toolCategory: string | null;
	arguments: string | null;
	result: string | null;
	status: string | null;
	executionTimeMs: number | null;
	confidence: number | null;
	dataQuality: string | null;
	error: string | null;
	executedAt: Date | null;
};
export type ToolExecutionMaxAggregateOutputType = {
	id: string | null;
	agentExecutionId: string | null;
	toolName: string | null;
	toolCategory: string | null;
	arguments: string | null;
	result: string | null;
	status: string | null;
	executionTimeMs: number | null;
	confidence: number | null;
	dataQuality: string | null;
	error: string | null;
	executedAt: Date | null;
};
export type ToolExecutionCountAggregateOutputType = {
	id: number;
	agentExecutionId: number;
	toolName: number;
	toolCategory: number;
	arguments: number;
	result: number;
	status: number;
	executionTimeMs: number;
	confidence: number;
	dataQuality: number;
	error: number;
	executedAt: number;
	_all: number;
};
export type ToolExecutionAvgAggregateInputType = {
	executionTimeMs?: true;
	confidence?: true;
};
export type ToolExecutionSumAggregateInputType = {
	executionTimeMs?: true;
	confidence?: true;
};
export type ToolExecutionMinAggregateInputType = {
	id?: true;
	agentExecutionId?: true;
	toolName?: true;
	toolCategory?: true;
	arguments?: true;
	result?: true;
	status?: true;
	executionTimeMs?: true;
	confidence?: true;
	dataQuality?: true;
	error?: true;
	executedAt?: true;
};
export type ToolExecutionMaxAggregateInputType = {
	id?: true;
	agentExecutionId?: true;
	toolName?: true;
	toolCategory?: true;
	arguments?: true;
	result?: true;
	status?: true;
	executionTimeMs?: true;
	confidence?: true;
	dataQuality?: true;
	error?: true;
	executedAt?: true;
};
export type ToolExecutionCountAggregateInputType = {
	id?: true;
	agentExecutionId?: true;
	toolName?: true;
	toolCategory?: true;
	arguments?: true;
	result?: true;
	status?: true;
	executionTimeMs?: true;
	confidence?: true;
	dataQuality?: true;
	error?: true;
	executedAt?: true;
	_all?: true;
};
export type ToolExecutionAggregateArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	where?: Prisma.ToolExecutionWhereInput;
	orderBy?:
		| Prisma.ToolExecutionOrderByWithRelationInput
		| Prisma.ToolExecutionOrderByWithRelationInput[];
	cursor?: Prisma.ToolExecutionWhereUniqueInput;
	take?: number;
	skip?: number;
	_count?: true | ToolExecutionCountAggregateInputType;
	_avg?: ToolExecutionAvgAggregateInputType;
	_sum?: ToolExecutionSumAggregateInputType;
	_min?: ToolExecutionMinAggregateInputType;
	_max?: ToolExecutionMaxAggregateInputType;
};
export type GetToolExecutionAggregateType<
	T extends ToolExecutionAggregateArgs,
> = {
	[P in keyof T & keyof AggregateToolExecution]: P extends "_count" | "count"
		? T[P] extends true
			? number
			: Prisma.GetScalarType<T[P], AggregateToolExecution[P]>
		: Prisma.GetScalarType<T[P], AggregateToolExecution[P]>;
};
export type ToolExecutionGroupByArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	where?: Prisma.ToolExecutionWhereInput;
	orderBy?:
		| Prisma.ToolExecutionOrderByWithAggregationInput
		| Prisma.ToolExecutionOrderByWithAggregationInput[];
	by:
		| Prisma.ToolExecutionScalarFieldEnum[]
		| Prisma.ToolExecutionScalarFieldEnum;
	having?: Prisma.ToolExecutionScalarWhereWithAggregatesInput;
	take?: number;
	skip?: number;
	_count?: ToolExecutionCountAggregateInputType | true;
	_avg?: ToolExecutionAvgAggregateInputType;
	_sum?: ToolExecutionSumAggregateInputType;
	_min?: ToolExecutionMinAggregateInputType;
	_max?: ToolExecutionMaxAggregateInputType;
};
export type ToolExecutionGroupByOutputType = {
	id: string;
	agentExecutionId: string;
	toolName: string;
	toolCategory: string | null;
	arguments: string | null;
	result: string | null;
	status: string;
	executionTimeMs: number | null;
	confidence: number | null;
	dataQuality: string | null;
	error: string | null;
	executedAt: Date;
	_count: ToolExecutionCountAggregateOutputType | null;
	_avg: ToolExecutionAvgAggregateOutputType | null;
	_sum: ToolExecutionSumAggregateOutputType | null;
	_min: ToolExecutionMinAggregateOutputType | null;
	_max: ToolExecutionMaxAggregateOutputType | null;
};
type GetToolExecutionGroupByPayload<T extends ToolExecutionGroupByArgs> =
	Prisma.PrismaPromise<
		Array<
			Prisma.PickEnumerable<ToolExecutionGroupByOutputType, T["by"]> & {
				[P in keyof T &
					keyof ToolExecutionGroupByOutputType]: P extends "_count"
					? T[P] extends boolean
						? number
						: Prisma.GetScalarType<T[P], ToolExecutionGroupByOutputType[P]>
					: Prisma.GetScalarType<T[P], ToolExecutionGroupByOutputType[P]>;
			}
		>
	>;
export type ToolExecutionWhereInput = {
	AND?: Prisma.ToolExecutionWhereInput | Prisma.ToolExecutionWhereInput[];
	OR?: Prisma.ToolExecutionWhereInput[];
	NOT?: Prisma.ToolExecutionWhereInput | Prisma.ToolExecutionWhereInput[];
	id?: Prisma.StringFilter<"ToolExecution"> | string;
	agentExecutionId?: Prisma.StringFilter<"ToolExecution"> | string;
	toolName?: Prisma.StringFilter<"ToolExecution"> | string;
	toolCategory?: Prisma.StringNullableFilter<"ToolExecution"> | string | null;
	arguments?: Prisma.StringNullableFilter<"ToolExecution"> | string | null;
	result?: Prisma.StringNullableFilter<"ToolExecution"> | string | null;
	status?: Prisma.StringFilter<"ToolExecution"> | string;
	executionTimeMs?: Prisma.IntNullableFilter<"ToolExecution"> | number | null;
	confidence?: Prisma.FloatNullableFilter<"ToolExecution"> | number | null;
	dataQuality?: Prisma.StringNullableFilter<"ToolExecution"> | string | null;
	error?: Prisma.StringNullableFilter<"ToolExecution"> | string | null;
	executedAt?: Prisma.DateTimeFilter<"ToolExecution"> | Date | string;
	agentExecution?: Prisma.XOR<
		Prisma.AgentExecutionScalarRelationFilter,
		Prisma.AgentExecutionWhereInput
	>;
};
export type ToolExecutionOrderByWithRelationInput = {
	id?: Prisma.SortOrder;
	agentExecutionId?: Prisma.SortOrder;
	toolName?: Prisma.SortOrder;
	toolCategory?: Prisma.SortOrderInput | Prisma.SortOrder;
	arguments?: Prisma.SortOrderInput | Prisma.SortOrder;
	result?: Prisma.SortOrderInput | Prisma.SortOrder;
	status?: Prisma.SortOrder;
	executionTimeMs?: Prisma.SortOrderInput | Prisma.SortOrder;
	confidence?: Prisma.SortOrderInput | Prisma.SortOrder;
	dataQuality?: Prisma.SortOrderInput | Prisma.SortOrder;
	error?: Prisma.SortOrderInput | Prisma.SortOrder;
	executedAt?: Prisma.SortOrder;
	agentExecution?: Prisma.AgentExecutionOrderByWithRelationInput;
};
export type ToolExecutionWhereUniqueInput = Prisma.AtLeast<
	{
		id?: string;
		AND?: Prisma.ToolExecutionWhereInput | Prisma.ToolExecutionWhereInput[];
		OR?: Prisma.ToolExecutionWhereInput[];
		NOT?: Prisma.ToolExecutionWhereInput | Prisma.ToolExecutionWhereInput[];
		agentExecutionId?: Prisma.StringFilter<"ToolExecution"> | string;
		toolName?: Prisma.StringFilter<"ToolExecution"> | string;
		toolCategory?: Prisma.StringNullableFilter<"ToolExecution"> | string | null;
		arguments?: Prisma.StringNullableFilter<"ToolExecution"> | string | null;
		result?: Prisma.StringNullableFilter<"ToolExecution"> | string | null;
		status?: Prisma.StringFilter<"ToolExecution"> | string;
		executionTimeMs?: Prisma.IntNullableFilter<"ToolExecution"> | number | null;
		confidence?: Prisma.FloatNullableFilter<"ToolExecution"> | number | null;
		dataQuality?: Prisma.StringNullableFilter<"ToolExecution"> | string | null;
		error?: Prisma.StringNullableFilter<"ToolExecution"> | string | null;
		executedAt?: Prisma.DateTimeFilter<"ToolExecution"> | Date | string;
		agentExecution?: Prisma.XOR<
			Prisma.AgentExecutionScalarRelationFilter,
			Prisma.AgentExecutionWhereInput
		>;
	},
	"id"
>;
export type ToolExecutionOrderByWithAggregationInput = {
	id?: Prisma.SortOrder;
	agentExecutionId?: Prisma.SortOrder;
	toolName?: Prisma.SortOrder;
	toolCategory?: Prisma.SortOrderInput | Prisma.SortOrder;
	arguments?: Prisma.SortOrderInput | Prisma.SortOrder;
	result?: Prisma.SortOrderInput | Prisma.SortOrder;
	status?: Prisma.SortOrder;
	executionTimeMs?: Prisma.SortOrderInput | Prisma.SortOrder;
	confidence?: Prisma.SortOrderInput | Prisma.SortOrder;
	dataQuality?: Prisma.SortOrderInput | Prisma.SortOrder;
	error?: Prisma.SortOrderInput | Prisma.SortOrder;
	executedAt?: Prisma.SortOrder;
	_count?: Prisma.ToolExecutionCountOrderByAggregateInput;
	_avg?: Prisma.ToolExecutionAvgOrderByAggregateInput;
	_max?: Prisma.ToolExecutionMaxOrderByAggregateInput;
	_min?: Prisma.ToolExecutionMinOrderByAggregateInput;
	_sum?: Prisma.ToolExecutionSumOrderByAggregateInput;
};
export type ToolExecutionScalarWhereWithAggregatesInput = {
	AND?:
		| Prisma.ToolExecutionScalarWhereWithAggregatesInput
		| Prisma.ToolExecutionScalarWhereWithAggregatesInput[];
	OR?: Prisma.ToolExecutionScalarWhereWithAggregatesInput[];
	NOT?:
		| Prisma.ToolExecutionScalarWhereWithAggregatesInput
		| Prisma.ToolExecutionScalarWhereWithAggregatesInput[];
	id?: Prisma.StringWithAggregatesFilter<"ToolExecution"> | string;
	agentExecutionId?:
		| Prisma.StringWithAggregatesFilter<"ToolExecution">
		| string;
	toolName?: Prisma.StringWithAggregatesFilter<"ToolExecution"> | string;
	toolCategory?:
		| Prisma.StringNullableWithAggregatesFilter<"ToolExecution">
		| string
		| null;
	arguments?:
		| Prisma.StringNullableWithAggregatesFilter<"ToolExecution">
		| string
		| null;
	result?:
		| Prisma.StringNullableWithAggregatesFilter<"ToolExecution">
		| string
		| null;
	status?: Prisma.StringWithAggregatesFilter<"ToolExecution"> | string;
	executionTimeMs?:
		| Prisma.IntNullableWithAggregatesFilter<"ToolExecution">
		| number
		| null;
	confidence?:
		| Prisma.FloatNullableWithAggregatesFilter<"ToolExecution">
		| number
		| null;
	dataQuality?:
		| Prisma.StringNullableWithAggregatesFilter<"ToolExecution">
		| string
		| null;
	error?:
		| Prisma.StringNullableWithAggregatesFilter<"ToolExecution">
		| string
		| null;
	executedAt?:
		| Prisma.DateTimeWithAggregatesFilter<"ToolExecution">
		| Date
		| string;
};
export type ToolExecutionCreateInput = {
	id?: string;
	toolName: string;
	toolCategory?: string | null;
	arguments?: string | null;
	result?: string | null;
	status?: string;
	executionTimeMs?: number | null;
	confidence?: number | null;
	dataQuality?: string | null;
	error?: string | null;
	executedAt?: Date | string;
	agentExecution: Prisma.AgentExecutionCreateNestedOneWithoutToolExecutionsInput;
};
export type ToolExecutionUncheckedCreateInput = {
	id?: string;
	agentExecutionId: string;
	toolName: string;
	toolCategory?: string | null;
	arguments?: string | null;
	result?: string | null;
	status?: string;
	executionTimeMs?: number | null;
	confidence?: number | null;
	dataQuality?: string | null;
	error?: string | null;
	executedAt?: Date | string;
};
export type ToolExecutionUpdateInput = {
	id?: Prisma.StringFieldUpdateOperationsInput | string;
	toolName?: Prisma.StringFieldUpdateOperationsInput | string;
	toolCategory?:
		| Prisma.NullableStringFieldUpdateOperationsInput
		| string
		| null;
	arguments?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	result?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	status?: Prisma.StringFieldUpdateOperationsInput | string;
	executionTimeMs?:
		| Prisma.NullableIntFieldUpdateOperationsInput
		| number
		| null;
	confidence?: Prisma.NullableFloatFieldUpdateOperationsInput | number | null;
	dataQuality?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	error?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	executedAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
	agentExecution?: Prisma.AgentExecutionUpdateOneRequiredWithoutToolExecutionsNestedInput;
};
export type ToolExecutionUncheckedUpdateInput = {
	id?: Prisma.StringFieldUpdateOperationsInput | string;
	agentExecutionId?: Prisma.StringFieldUpdateOperationsInput | string;
	toolName?: Prisma.StringFieldUpdateOperationsInput | string;
	toolCategory?:
		| Prisma.NullableStringFieldUpdateOperationsInput
		| string
		| null;
	arguments?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	result?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	status?: Prisma.StringFieldUpdateOperationsInput | string;
	executionTimeMs?:
		| Prisma.NullableIntFieldUpdateOperationsInput
		| number
		| null;
	confidence?: Prisma.NullableFloatFieldUpdateOperationsInput | number | null;
	dataQuality?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	error?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	executedAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
};
export type ToolExecutionCreateManyInput = {
	id?: string;
	agentExecutionId: string;
	toolName: string;
	toolCategory?: string | null;
	arguments?: string | null;
	result?: string | null;
	status?: string;
	executionTimeMs?: number | null;
	confidence?: number | null;
	dataQuality?: string | null;
	error?: string | null;
	executedAt?: Date | string;
};
export type ToolExecutionUpdateManyMutationInput = {
	id?: Prisma.StringFieldUpdateOperationsInput | string;
	toolName?: Prisma.StringFieldUpdateOperationsInput | string;
	toolCategory?:
		| Prisma.NullableStringFieldUpdateOperationsInput
		| string
		| null;
	arguments?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	result?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	status?: Prisma.StringFieldUpdateOperationsInput | string;
	executionTimeMs?:
		| Prisma.NullableIntFieldUpdateOperationsInput
		| number
		| null;
	confidence?: Prisma.NullableFloatFieldUpdateOperationsInput | number | null;
	dataQuality?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	error?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	executedAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
};
export type ToolExecutionUncheckedUpdateManyInput = {
	id?: Prisma.StringFieldUpdateOperationsInput | string;
	agentExecutionId?: Prisma.StringFieldUpdateOperationsInput | string;
	toolName?: Prisma.StringFieldUpdateOperationsInput | string;
	toolCategory?:
		| Prisma.NullableStringFieldUpdateOperationsInput
		| string
		| null;
	arguments?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	result?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	status?: Prisma.StringFieldUpdateOperationsInput | string;
	executionTimeMs?:
		| Prisma.NullableIntFieldUpdateOperationsInput
		| number
		| null;
	confidence?: Prisma.NullableFloatFieldUpdateOperationsInput | number | null;
	dataQuality?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	error?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	executedAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
};
export type ToolExecutionListRelationFilter = {
	every?: Prisma.ToolExecutionWhereInput;
	some?: Prisma.ToolExecutionWhereInput;
	none?: Prisma.ToolExecutionWhereInput;
};
export type ToolExecutionOrderByRelationAggregateInput = {
	_count?: Prisma.SortOrder;
};
export type ToolExecutionCountOrderByAggregateInput = {
	id?: Prisma.SortOrder;
	agentExecutionId?: Prisma.SortOrder;
	toolName?: Prisma.SortOrder;
	toolCategory?: Prisma.SortOrder;
	arguments?: Prisma.SortOrder;
	result?: Prisma.SortOrder;
	status?: Prisma.SortOrder;
	executionTimeMs?: Prisma.SortOrder;
	confidence?: Prisma.SortOrder;
	dataQuality?: Prisma.SortOrder;
	error?: Prisma.SortOrder;
	executedAt?: Prisma.SortOrder;
};
export type ToolExecutionAvgOrderByAggregateInput = {
	executionTimeMs?: Prisma.SortOrder;
	confidence?: Prisma.SortOrder;
};
export type ToolExecutionMaxOrderByAggregateInput = {
	id?: Prisma.SortOrder;
	agentExecutionId?: Prisma.SortOrder;
	toolName?: Prisma.SortOrder;
	toolCategory?: Prisma.SortOrder;
	arguments?: Prisma.SortOrder;
	result?: Prisma.SortOrder;
	status?: Prisma.SortOrder;
	executionTimeMs?: Prisma.SortOrder;
	confidence?: Prisma.SortOrder;
	dataQuality?: Prisma.SortOrder;
	error?: Prisma.SortOrder;
	executedAt?: Prisma.SortOrder;
};
export type ToolExecutionMinOrderByAggregateInput = {
	id?: Prisma.SortOrder;
	agentExecutionId?: Prisma.SortOrder;
	toolName?: Prisma.SortOrder;
	toolCategory?: Prisma.SortOrder;
	arguments?: Prisma.SortOrder;
	result?: Prisma.SortOrder;
	status?: Prisma.SortOrder;
	executionTimeMs?: Prisma.SortOrder;
	confidence?: Prisma.SortOrder;
	dataQuality?: Prisma.SortOrder;
	error?: Prisma.SortOrder;
	executedAt?: Prisma.SortOrder;
};
export type ToolExecutionSumOrderByAggregateInput = {
	executionTimeMs?: Prisma.SortOrder;
	confidence?: Prisma.SortOrder;
};
export type ToolExecutionCreateNestedManyWithoutAgentExecutionInput = {
	create?:
		| Prisma.XOR<
				Prisma.ToolExecutionCreateWithoutAgentExecutionInput,
				Prisma.ToolExecutionUncheckedCreateWithoutAgentExecutionInput
		  >
		| Prisma.ToolExecutionCreateWithoutAgentExecutionInput[]
		| Prisma.ToolExecutionUncheckedCreateWithoutAgentExecutionInput[];
	connectOrCreate?:
		| Prisma.ToolExecutionCreateOrConnectWithoutAgentExecutionInput
		| Prisma.ToolExecutionCreateOrConnectWithoutAgentExecutionInput[];
	createMany?: Prisma.ToolExecutionCreateManyAgentExecutionInputEnvelope;
	connect?:
		| Prisma.ToolExecutionWhereUniqueInput
		| Prisma.ToolExecutionWhereUniqueInput[];
};
export type ToolExecutionUncheckedCreateNestedManyWithoutAgentExecutionInput = {
	create?:
		| Prisma.XOR<
				Prisma.ToolExecutionCreateWithoutAgentExecutionInput,
				Prisma.ToolExecutionUncheckedCreateWithoutAgentExecutionInput
		  >
		| Prisma.ToolExecutionCreateWithoutAgentExecutionInput[]
		| Prisma.ToolExecutionUncheckedCreateWithoutAgentExecutionInput[];
	connectOrCreate?:
		| Prisma.ToolExecutionCreateOrConnectWithoutAgentExecutionInput
		| Prisma.ToolExecutionCreateOrConnectWithoutAgentExecutionInput[];
	createMany?: Prisma.ToolExecutionCreateManyAgentExecutionInputEnvelope;
	connect?:
		| Prisma.ToolExecutionWhereUniqueInput
		| Prisma.ToolExecutionWhereUniqueInput[];
};
export type ToolExecutionUpdateManyWithoutAgentExecutionNestedInput = {
	create?:
		| Prisma.XOR<
				Prisma.ToolExecutionCreateWithoutAgentExecutionInput,
				Prisma.ToolExecutionUncheckedCreateWithoutAgentExecutionInput
		  >
		| Prisma.ToolExecutionCreateWithoutAgentExecutionInput[]
		| Prisma.ToolExecutionUncheckedCreateWithoutAgentExecutionInput[];
	connectOrCreate?:
		| Prisma.ToolExecutionCreateOrConnectWithoutAgentExecutionInput
		| Prisma.ToolExecutionCreateOrConnectWithoutAgentExecutionInput[];
	upsert?:
		| Prisma.ToolExecutionUpsertWithWhereUniqueWithoutAgentExecutionInput
		| Prisma.ToolExecutionUpsertWithWhereUniqueWithoutAgentExecutionInput[];
	createMany?: Prisma.ToolExecutionCreateManyAgentExecutionInputEnvelope;
	set?:
		| Prisma.ToolExecutionWhereUniqueInput
		| Prisma.ToolExecutionWhereUniqueInput[];
	disconnect?:
		| Prisma.ToolExecutionWhereUniqueInput
		| Prisma.ToolExecutionWhereUniqueInput[];
	delete?:
		| Prisma.ToolExecutionWhereUniqueInput
		| Prisma.ToolExecutionWhereUniqueInput[];
	connect?:
		| Prisma.ToolExecutionWhereUniqueInput
		| Prisma.ToolExecutionWhereUniqueInput[];
	update?:
		| Prisma.ToolExecutionUpdateWithWhereUniqueWithoutAgentExecutionInput
		| Prisma.ToolExecutionUpdateWithWhereUniqueWithoutAgentExecutionInput[];
	updateMany?:
		| Prisma.ToolExecutionUpdateManyWithWhereWithoutAgentExecutionInput
		| Prisma.ToolExecutionUpdateManyWithWhereWithoutAgentExecutionInput[];
	deleteMany?:
		| Prisma.ToolExecutionScalarWhereInput
		| Prisma.ToolExecutionScalarWhereInput[];
};
export type ToolExecutionUncheckedUpdateManyWithoutAgentExecutionNestedInput = {
	create?:
		| Prisma.XOR<
				Prisma.ToolExecutionCreateWithoutAgentExecutionInput,
				Prisma.ToolExecutionUncheckedCreateWithoutAgentExecutionInput
		  >
		| Prisma.ToolExecutionCreateWithoutAgentExecutionInput[]
		| Prisma.ToolExecutionUncheckedCreateWithoutAgentExecutionInput[];
	connectOrCreate?:
		| Prisma.ToolExecutionCreateOrConnectWithoutAgentExecutionInput
		| Prisma.ToolExecutionCreateOrConnectWithoutAgentExecutionInput[];
	upsert?:
		| Prisma.ToolExecutionUpsertWithWhereUniqueWithoutAgentExecutionInput
		| Prisma.ToolExecutionUpsertWithWhereUniqueWithoutAgentExecutionInput[];
	createMany?: Prisma.ToolExecutionCreateManyAgentExecutionInputEnvelope;
	set?:
		| Prisma.ToolExecutionWhereUniqueInput
		| Prisma.ToolExecutionWhereUniqueInput[];
	disconnect?:
		| Prisma.ToolExecutionWhereUniqueInput
		| Prisma.ToolExecutionWhereUniqueInput[];
	delete?:
		| Prisma.ToolExecutionWhereUniqueInput
		| Prisma.ToolExecutionWhereUniqueInput[];
	connect?:
		| Prisma.ToolExecutionWhereUniqueInput
		| Prisma.ToolExecutionWhereUniqueInput[];
	update?:
		| Prisma.ToolExecutionUpdateWithWhereUniqueWithoutAgentExecutionInput
		| Prisma.ToolExecutionUpdateWithWhereUniqueWithoutAgentExecutionInput[];
	updateMany?:
		| Prisma.ToolExecutionUpdateManyWithWhereWithoutAgentExecutionInput
		| Prisma.ToolExecutionUpdateManyWithWhereWithoutAgentExecutionInput[];
	deleteMany?:
		| Prisma.ToolExecutionScalarWhereInput
		| Prisma.ToolExecutionScalarWhereInput[];
};
export type ToolExecutionCreateWithoutAgentExecutionInput = {
	id?: string;
	toolName: string;
	toolCategory?: string | null;
	arguments?: string | null;
	result?: string | null;
	status?: string;
	executionTimeMs?: number | null;
	confidence?: number | null;
	dataQuality?: string | null;
	error?: string | null;
	executedAt?: Date | string;
};
export type ToolExecutionUncheckedCreateWithoutAgentExecutionInput = {
	id?: string;
	toolName: string;
	toolCategory?: string | null;
	arguments?: string | null;
	result?: string | null;
	status?: string;
	executionTimeMs?: number | null;
	confidence?: number | null;
	dataQuality?: string | null;
	error?: string | null;
	executedAt?: Date | string;
};
export type ToolExecutionCreateOrConnectWithoutAgentExecutionInput = {
	where: Prisma.ToolExecutionWhereUniqueInput;
	create: Prisma.XOR<
		Prisma.ToolExecutionCreateWithoutAgentExecutionInput,
		Prisma.ToolExecutionUncheckedCreateWithoutAgentExecutionInput
	>;
};
export type ToolExecutionCreateManyAgentExecutionInputEnvelope = {
	data:
		| Prisma.ToolExecutionCreateManyAgentExecutionInput
		| Prisma.ToolExecutionCreateManyAgentExecutionInput[];
};
export type ToolExecutionUpsertWithWhereUniqueWithoutAgentExecutionInput = {
	where: Prisma.ToolExecutionWhereUniqueInput;
	update: Prisma.XOR<
		Prisma.ToolExecutionUpdateWithoutAgentExecutionInput,
		Prisma.ToolExecutionUncheckedUpdateWithoutAgentExecutionInput
	>;
	create: Prisma.XOR<
		Prisma.ToolExecutionCreateWithoutAgentExecutionInput,
		Prisma.ToolExecutionUncheckedCreateWithoutAgentExecutionInput
	>;
};
export type ToolExecutionUpdateWithWhereUniqueWithoutAgentExecutionInput = {
	where: Prisma.ToolExecutionWhereUniqueInput;
	data: Prisma.XOR<
		Prisma.ToolExecutionUpdateWithoutAgentExecutionInput,
		Prisma.ToolExecutionUncheckedUpdateWithoutAgentExecutionInput
	>;
};
export type ToolExecutionUpdateManyWithWhereWithoutAgentExecutionInput = {
	where: Prisma.ToolExecutionScalarWhereInput;
	data: Prisma.XOR<
		Prisma.ToolExecutionUpdateManyMutationInput,
		Prisma.ToolExecutionUncheckedUpdateManyWithoutAgentExecutionInput
	>;
};
export type ToolExecutionScalarWhereInput = {
	AND?:
		| Prisma.ToolExecutionScalarWhereInput
		| Prisma.ToolExecutionScalarWhereInput[];
	OR?: Prisma.ToolExecutionScalarWhereInput[];
	NOT?:
		| Prisma.ToolExecutionScalarWhereInput
		| Prisma.ToolExecutionScalarWhereInput[];
	id?: Prisma.StringFilter<"ToolExecution"> | string;
	agentExecutionId?: Prisma.StringFilter<"ToolExecution"> | string;
	toolName?: Prisma.StringFilter<"ToolExecution"> | string;
	toolCategory?: Prisma.StringNullableFilter<"ToolExecution"> | string | null;
	arguments?: Prisma.StringNullableFilter<"ToolExecution"> | string | null;
	result?: Prisma.StringNullableFilter<"ToolExecution"> | string | null;
	status?: Prisma.StringFilter<"ToolExecution"> | string;
	executionTimeMs?: Prisma.IntNullableFilter<"ToolExecution"> | number | null;
	confidence?: Prisma.FloatNullableFilter<"ToolExecution"> | number | null;
	dataQuality?: Prisma.StringNullableFilter<"ToolExecution"> | string | null;
	error?: Prisma.StringNullableFilter<"ToolExecution"> | string | null;
	executedAt?: Prisma.DateTimeFilter<"ToolExecution"> | Date | string;
};
export type ToolExecutionCreateManyAgentExecutionInput = {
	id?: string;
	toolName: string;
	toolCategory?: string | null;
	arguments?: string | null;
	result?: string | null;
	status?: string;
	executionTimeMs?: number | null;
	confidence?: number | null;
	dataQuality?: string | null;
	error?: string | null;
	executedAt?: Date | string;
};
export type ToolExecutionUpdateWithoutAgentExecutionInput = {
	id?: Prisma.StringFieldUpdateOperationsInput | string;
	toolName?: Prisma.StringFieldUpdateOperationsInput | string;
	toolCategory?:
		| Prisma.NullableStringFieldUpdateOperationsInput
		| string
		| null;
	arguments?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	result?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	status?: Prisma.StringFieldUpdateOperationsInput | string;
	executionTimeMs?:
		| Prisma.NullableIntFieldUpdateOperationsInput
		| number
		| null;
	confidence?: Prisma.NullableFloatFieldUpdateOperationsInput | number | null;
	dataQuality?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	error?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	executedAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
};
export type ToolExecutionUncheckedUpdateWithoutAgentExecutionInput = {
	id?: Prisma.StringFieldUpdateOperationsInput | string;
	toolName?: Prisma.StringFieldUpdateOperationsInput | string;
	toolCategory?:
		| Prisma.NullableStringFieldUpdateOperationsInput
		| string
		| null;
	arguments?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	result?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	status?: Prisma.StringFieldUpdateOperationsInput | string;
	executionTimeMs?:
		| Prisma.NullableIntFieldUpdateOperationsInput
		| number
		| null;
	confidence?: Prisma.NullableFloatFieldUpdateOperationsInput | number | null;
	dataQuality?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	error?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	executedAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
};
export type ToolExecutionUncheckedUpdateManyWithoutAgentExecutionInput = {
	id?: Prisma.StringFieldUpdateOperationsInput | string;
	toolName?: Prisma.StringFieldUpdateOperationsInput | string;
	toolCategory?:
		| Prisma.NullableStringFieldUpdateOperationsInput
		| string
		| null;
	arguments?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	result?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	status?: Prisma.StringFieldUpdateOperationsInput | string;
	executionTimeMs?:
		| Prisma.NullableIntFieldUpdateOperationsInput
		| number
		| null;
	confidence?: Prisma.NullableFloatFieldUpdateOperationsInput | number | null;
	dataQuality?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	error?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	executedAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
};
export type ToolExecutionSelect<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = runtime.Types.Extensions.GetSelect<
	{
		id?: boolean;
		agentExecutionId?: boolean;
		toolName?: boolean;
		toolCategory?: boolean;
		arguments?: boolean;
		result?: boolean;
		status?: boolean;
		executionTimeMs?: boolean;
		confidence?: boolean;
		dataQuality?: boolean;
		error?: boolean;
		executedAt?: boolean;
		agentExecution?: boolean | Prisma.AgentExecutionDefaultArgs<ExtArgs>;
	},
	ExtArgs["result"]["toolExecution"]
>;
export type ToolExecutionSelectCreateManyAndReturn<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = runtime.Types.Extensions.GetSelect<
	{
		id?: boolean;
		agentExecutionId?: boolean;
		toolName?: boolean;
		toolCategory?: boolean;
		arguments?: boolean;
		result?: boolean;
		status?: boolean;
		executionTimeMs?: boolean;
		confidence?: boolean;
		dataQuality?: boolean;
		error?: boolean;
		executedAt?: boolean;
		agentExecution?: boolean | Prisma.AgentExecutionDefaultArgs<ExtArgs>;
	},
	ExtArgs["result"]["toolExecution"]
>;
export type ToolExecutionSelectUpdateManyAndReturn<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = runtime.Types.Extensions.GetSelect<
	{
		id?: boolean;
		agentExecutionId?: boolean;
		toolName?: boolean;
		toolCategory?: boolean;
		arguments?: boolean;
		result?: boolean;
		status?: boolean;
		executionTimeMs?: boolean;
		confidence?: boolean;
		dataQuality?: boolean;
		error?: boolean;
		executedAt?: boolean;
		agentExecution?: boolean | Prisma.AgentExecutionDefaultArgs<ExtArgs>;
	},
	ExtArgs["result"]["toolExecution"]
>;
export type ToolExecutionSelectScalar = {
	id?: boolean;
	agentExecutionId?: boolean;
	toolName?: boolean;
	toolCategory?: boolean;
	arguments?: boolean;
	result?: boolean;
	status?: boolean;
	executionTimeMs?: boolean;
	confidence?: boolean;
	dataQuality?: boolean;
	error?: boolean;
	executedAt?: boolean;
};
export type ToolExecutionOmit<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = runtime.Types.Extensions.GetOmit<
	| "id"
	| "agentExecutionId"
	| "toolName"
	| "toolCategory"
	| "arguments"
	| "result"
	| "status"
	| "executionTimeMs"
	| "confidence"
	| "dataQuality"
	| "error"
	| "executedAt",
	ExtArgs["result"]["toolExecution"]
>;
export type ToolExecutionInclude<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	agentExecution?: boolean | Prisma.AgentExecutionDefaultArgs<ExtArgs>;
};
export type ToolExecutionIncludeCreateManyAndReturn<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	agentExecution?: boolean | Prisma.AgentExecutionDefaultArgs<ExtArgs>;
};
export type ToolExecutionIncludeUpdateManyAndReturn<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	agentExecution?: boolean | Prisma.AgentExecutionDefaultArgs<ExtArgs>;
};
export type $ToolExecutionPayload<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	name: "ToolExecution";
	objects: {
		agentExecution: Prisma.$AgentExecutionPayload<ExtArgs>;
	};
	scalars: runtime.Types.Extensions.GetPayloadResult<
		{
			id: string;
			agentExecutionId: string;
			toolName: string;
			toolCategory: string | null;
			arguments: string | null;
			result: string | null;
			status: string;
			executionTimeMs: number | null;
			confidence: number | null;
			dataQuality: string | null;
			error: string | null;
			executedAt: Date;
		},
		ExtArgs["result"]["toolExecution"]
	>;
	composites: {};
};
export type ToolExecutionGetPayload<
	S extends boolean | null | undefined | ToolExecutionDefaultArgs,
> = runtime.Types.Result.GetResult<Prisma.$ToolExecutionPayload, S>;
export type ToolExecutionCountArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = Omit<
	ToolExecutionFindManyArgs,
	"select" | "include" | "distinct" | "omit"
> & {
	select?: ToolExecutionCountAggregateInputType | true;
};
export interface ToolExecutionDelegate<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
	GlobalOmitOptions = {},
> {
	[K: symbol]: {
		types: Prisma.TypeMap<ExtArgs>["model"]["ToolExecution"];
		meta: {
			name: "ToolExecution";
		};
	};
	findUnique<T extends ToolExecutionFindUniqueArgs>(
		args: Prisma.SelectSubset<T, ToolExecutionFindUniqueArgs<ExtArgs>>,
	): Prisma.Prisma__ToolExecutionClient<
		runtime.Types.Result.GetResult<
			Prisma.$ToolExecutionPayload<ExtArgs>,
			T,
			"findUnique",
			GlobalOmitOptions
		> | null,
		null,
		ExtArgs,
		GlobalOmitOptions
	>;
	findUniqueOrThrow<T extends ToolExecutionFindUniqueOrThrowArgs>(
		args: Prisma.SelectSubset<T, ToolExecutionFindUniqueOrThrowArgs<ExtArgs>>,
	): Prisma.Prisma__ToolExecutionClient<
		runtime.Types.Result.GetResult<
			Prisma.$ToolExecutionPayload<ExtArgs>,
			T,
			"findUniqueOrThrow",
			GlobalOmitOptions
		>,
		never,
		ExtArgs,
		GlobalOmitOptions
	>;
	findFirst<T extends ToolExecutionFindFirstArgs>(
		args?: Prisma.SelectSubset<T, ToolExecutionFindFirstArgs<ExtArgs>>,
	): Prisma.Prisma__ToolExecutionClient<
		runtime.Types.Result.GetResult<
			Prisma.$ToolExecutionPayload<ExtArgs>,
			T,
			"findFirst",
			GlobalOmitOptions
		> | null,
		null,
		ExtArgs,
		GlobalOmitOptions
	>;
	findFirstOrThrow<T extends ToolExecutionFindFirstOrThrowArgs>(
		args?: Prisma.SelectSubset<T, ToolExecutionFindFirstOrThrowArgs<ExtArgs>>,
	): Prisma.Prisma__ToolExecutionClient<
		runtime.Types.Result.GetResult<
			Prisma.$ToolExecutionPayload<ExtArgs>,
			T,
			"findFirstOrThrow",
			GlobalOmitOptions
		>,
		never,
		ExtArgs,
		GlobalOmitOptions
	>;
	findMany<T extends ToolExecutionFindManyArgs>(
		args?: Prisma.SelectSubset<T, ToolExecutionFindManyArgs<ExtArgs>>,
	): Prisma.PrismaPromise<
		runtime.Types.Result.GetResult<
			Prisma.$ToolExecutionPayload<ExtArgs>,
			T,
			"findMany",
			GlobalOmitOptions
		>
	>;
	create<T extends ToolExecutionCreateArgs>(
		args: Prisma.SelectSubset<T, ToolExecutionCreateArgs<ExtArgs>>,
	): Prisma.Prisma__ToolExecutionClient<
		runtime.Types.Result.GetResult<
			Prisma.$ToolExecutionPayload<ExtArgs>,
			T,
			"create",
			GlobalOmitOptions
		>,
		never,
		ExtArgs,
		GlobalOmitOptions
	>;
	createMany<T extends ToolExecutionCreateManyArgs>(
		args?: Prisma.SelectSubset<T, ToolExecutionCreateManyArgs<ExtArgs>>,
	): Prisma.PrismaPromise<Prisma.BatchPayload>;
	createManyAndReturn<T extends ToolExecutionCreateManyAndReturnArgs>(
		args?: Prisma.SelectSubset<
			T,
			ToolExecutionCreateManyAndReturnArgs<ExtArgs>
		>,
	): Prisma.PrismaPromise<
		runtime.Types.Result.GetResult<
			Prisma.$ToolExecutionPayload<ExtArgs>,
			T,
			"createManyAndReturn",
			GlobalOmitOptions
		>
	>;
	delete<T extends ToolExecutionDeleteArgs>(
		args: Prisma.SelectSubset<T, ToolExecutionDeleteArgs<ExtArgs>>,
	): Prisma.Prisma__ToolExecutionClient<
		runtime.Types.Result.GetResult<
			Prisma.$ToolExecutionPayload<ExtArgs>,
			T,
			"delete",
			GlobalOmitOptions
		>,
		never,
		ExtArgs,
		GlobalOmitOptions
	>;
	update<T extends ToolExecutionUpdateArgs>(
		args: Prisma.SelectSubset<T, ToolExecutionUpdateArgs<ExtArgs>>,
	): Prisma.Prisma__ToolExecutionClient<
		runtime.Types.Result.GetResult<
			Prisma.$ToolExecutionPayload<ExtArgs>,
			T,
			"update",
			GlobalOmitOptions
		>,
		never,
		ExtArgs,
		GlobalOmitOptions
	>;
	deleteMany<T extends ToolExecutionDeleteManyArgs>(
		args?: Prisma.SelectSubset<T, ToolExecutionDeleteManyArgs<ExtArgs>>,
	): Prisma.PrismaPromise<Prisma.BatchPayload>;
	updateMany<T extends ToolExecutionUpdateManyArgs>(
		args: Prisma.SelectSubset<T, ToolExecutionUpdateManyArgs<ExtArgs>>,
	): Prisma.PrismaPromise<Prisma.BatchPayload>;
	updateManyAndReturn<T extends ToolExecutionUpdateManyAndReturnArgs>(
		args: Prisma.SelectSubset<T, ToolExecutionUpdateManyAndReturnArgs<ExtArgs>>,
	): Prisma.PrismaPromise<
		runtime.Types.Result.GetResult<
			Prisma.$ToolExecutionPayload<ExtArgs>,
			T,
			"updateManyAndReturn",
			GlobalOmitOptions
		>
	>;
	upsert<T extends ToolExecutionUpsertArgs>(
		args: Prisma.SelectSubset<T, ToolExecutionUpsertArgs<ExtArgs>>,
	): Prisma.Prisma__ToolExecutionClient<
		runtime.Types.Result.GetResult<
			Prisma.$ToolExecutionPayload<ExtArgs>,
			T,
			"upsert",
			GlobalOmitOptions
		>,
		never,
		ExtArgs,
		GlobalOmitOptions
	>;
	count<T extends ToolExecutionCountArgs>(
		args?: Prisma.Subset<T, ToolExecutionCountArgs>,
	): Prisma.PrismaPromise<
		T extends runtime.Types.Utils.Record<"select", any>
			? T["select"] extends true
				? number
				: Prisma.GetScalarType<
						T["select"],
						ToolExecutionCountAggregateOutputType
					>
			: number
	>;
	aggregate<T extends ToolExecutionAggregateArgs>(
		args: Prisma.Subset<T, ToolExecutionAggregateArgs>,
	): Prisma.PrismaPromise<GetToolExecutionAggregateType<T>>;
	groupBy<
		T extends ToolExecutionGroupByArgs,
		HasSelectOrTake extends Prisma.Or<
			Prisma.Extends<"skip", Prisma.Keys<T>>,
			Prisma.Extends<"take", Prisma.Keys<T>>
		>,
		OrderByArg extends Prisma.True extends HasSelectOrTake
			? {
					orderBy: ToolExecutionGroupByArgs["orderBy"];
				}
			: {
					orderBy?: ToolExecutionGroupByArgs["orderBy"];
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
		args: Prisma.SubsetIntersection<T, ToolExecutionGroupByArgs, OrderByArg> &
			InputErrors,
	): {} extends InputErrors
		? GetToolExecutionGroupByPayload<T>
		: Prisma.PrismaPromise<InputErrors>;
	readonly fields: ToolExecutionFieldRefs;
}
export interface Prisma__ToolExecutionClient<
	T,
	Null = never,
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
	GlobalOmitOptions = {},
> extends Prisma.PrismaPromise<T> {
	readonly [Symbol.toStringTag]: "PrismaPromise";
	agentExecution<T extends Prisma.AgentExecutionDefaultArgs<ExtArgs> = {}>(
		args?: Prisma.Subset<T, Prisma.AgentExecutionDefaultArgs<ExtArgs>>,
	): Prisma.Prisma__AgentExecutionClient<
		| runtime.Types.Result.GetResult<
				Prisma.$AgentExecutionPayload<ExtArgs>,
				T,
				"findUniqueOrThrow",
				GlobalOmitOptions
		  >
		| Null,
		Null,
		ExtArgs,
		GlobalOmitOptions
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
export interface ToolExecutionFieldRefs {
	readonly id: Prisma.FieldRef<"ToolExecution", "String">;
	readonly agentExecutionId: Prisma.FieldRef<"ToolExecution", "String">;
	readonly toolName: Prisma.FieldRef<"ToolExecution", "String">;
	readonly toolCategory: Prisma.FieldRef<"ToolExecution", "String">;
	readonly arguments: Prisma.FieldRef<"ToolExecution", "String">;
	readonly result: Prisma.FieldRef<"ToolExecution", "String">;
	readonly status: Prisma.FieldRef<"ToolExecution", "String">;
	readonly executionTimeMs: Prisma.FieldRef<"ToolExecution", "Int">;
	readonly confidence: Prisma.FieldRef<"ToolExecution", "Float">;
	readonly dataQuality: Prisma.FieldRef<"ToolExecution", "String">;
	readonly error: Prisma.FieldRef<"ToolExecution", "String">;
	readonly executedAt: Prisma.FieldRef<"ToolExecution", "DateTime">;
}
export type ToolExecutionFindUniqueArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	select?: Prisma.ToolExecutionSelect<ExtArgs> | null;
	omit?: Prisma.ToolExecutionOmit<ExtArgs> | null;
	include?: Prisma.ToolExecutionInclude<ExtArgs> | null;
	where: Prisma.ToolExecutionWhereUniqueInput;
};
export type ToolExecutionFindUniqueOrThrowArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	select?: Prisma.ToolExecutionSelect<ExtArgs> | null;
	omit?: Prisma.ToolExecutionOmit<ExtArgs> | null;
	include?: Prisma.ToolExecutionInclude<ExtArgs> | null;
	where: Prisma.ToolExecutionWhereUniqueInput;
};
export type ToolExecutionFindFirstArgs<
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
export type ToolExecutionFindFirstOrThrowArgs<
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
export type ToolExecutionFindManyArgs<
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
export type ToolExecutionCreateArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	select?: Prisma.ToolExecutionSelect<ExtArgs> | null;
	omit?: Prisma.ToolExecutionOmit<ExtArgs> | null;
	include?: Prisma.ToolExecutionInclude<ExtArgs> | null;
	data: Prisma.XOR<
		Prisma.ToolExecutionCreateInput,
		Prisma.ToolExecutionUncheckedCreateInput
	>;
};
export type ToolExecutionCreateManyArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	data:
		| Prisma.ToolExecutionCreateManyInput
		| Prisma.ToolExecutionCreateManyInput[];
};
export type ToolExecutionCreateManyAndReturnArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	select?: Prisma.ToolExecutionSelectCreateManyAndReturn<ExtArgs> | null;
	omit?: Prisma.ToolExecutionOmit<ExtArgs> | null;
	data:
		| Prisma.ToolExecutionCreateManyInput
		| Prisma.ToolExecutionCreateManyInput[];
	include?: Prisma.ToolExecutionIncludeCreateManyAndReturn<ExtArgs> | null;
};
export type ToolExecutionUpdateArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	select?: Prisma.ToolExecutionSelect<ExtArgs> | null;
	omit?: Prisma.ToolExecutionOmit<ExtArgs> | null;
	include?: Prisma.ToolExecutionInclude<ExtArgs> | null;
	data: Prisma.XOR<
		Prisma.ToolExecutionUpdateInput,
		Prisma.ToolExecutionUncheckedUpdateInput
	>;
	where: Prisma.ToolExecutionWhereUniqueInput;
};
export type ToolExecutionUpdateManyArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	data: Prisma.XOR<
		Prisma.ToolExecutionUpdateManyMutationInput,
		Prisma.ToolExecutionUncheckedUpdateManyInput
	>;
	where?: Prisma.ToolExecutionWhereInput;
	limit?: number;
};
export type ToolExecutionUpdateManyAndReturnArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	select?: Prisma.ToolExecutionSelectUpdateManyAndReturn<ExtArgs> | null;
	omit?: Prisma.ToolExecutionOmit<ExtArgs> | null;
	data: Prisma.XOR<
		Prisma.ToolExecutionUpdateManyMutationInput,
		Prisma.ToolExecutionUncheckedUpdateManyInput
	>;
	where?: Prisma.ToolExecutionWhereInput;
	limit?: number;
	include?: Prisma.ToolExecutionIncludeUpdateManyAndReturn<ExtArgs> | null;
};
export type ToolExecutionUpsertArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	select?: Prisma.ToolExecutionSelect<ExtArgs> | null;
	omit?: Prisma.ToolExecutionOmit<ExtArgs> | null;
	include?: Prisma.ToolExecutionInclude<ExtArgs> | null;
	where: Prisma.ToolExecutionWhereUniqueInput;
	create: Prisma.XOR<
		Prisma.ToolExecutionCreateInput,
		Prisma.ToolExecutionUncheckedCreateInput
	>;
	update: Prisma.XOR<
		Prisma.ToolExecutionUpdateInput,
		Prisma.ToolExecutionUncheckedUpdateInput
	>;
};
export type ToolExecutionDeleteArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	select?: Prisma.ToolExecutionSelect<ExtArgs> | null;
	omit?: Prisma.ToolExecutionOmit<ExtArgs> | null;
	include?: Prisma.ToolExecutionInclude<ExtArgs> | null;
	where: Prisma.ToolExecutionWhereUniqueInput;
};
export type ToolExecutionDeleteManyArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	where?: Prisma.ToolExecutionWhereInput;
	limit?: number;
};
export type ToolExecutionDefaultArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	select?: Prisma.ToolExecutionSelect<ExtArgs> | null;
	omit?: Prisma.ToolExecutionOmit<ExtArgs> | null;
	include?: Prisma.ToolExecutionInclude<ExtArgs> | null;
};
