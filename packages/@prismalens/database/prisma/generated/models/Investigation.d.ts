import type * as runtime from "@prisma/client/runtime/client";
import type * as Prisma from "../internal/prismaNamespace.js";
export type InvestigationModel =
	runtime.Types.Result.DefaultSelection<Prisma.$InvestigationPayload>;
export type AggregateInvestigation = {
	_count: InvestigationCountAggregateOutputType | null;
	_avg: InvestigationAvgAggregateOutputType | null;
	_sum: InvestigationSumAggregateOutputType | null;
	_min: InvestigationMinAggregateOutputType | null;
	_max: InvestigationMaxAggregateOutputType | null;
};
export type InvestigationAvgAggregateOutputType = {
	confidence: number | null;
};
export type InvestigationSumAggregateOutputType = {
	confidence: number | null;
};
export type InvestigationMinAggregateOutputType = {
	id: string | null;
	incidentId: string | null;
	status: string | null;
	startedAt: Date | null;
	completedAt: Date | null;
	summary: string | null;
	rootCause: string | null;
	rootCauseCategory: string | null;
	confidence: number | null;
	dataQuality: string | null;
	analysisMethod: string | null;
	dataSourcesUsed: string | null;
	rawOutput: string | null;
	error: string | null;
	agentProgression: string | null;
	createdAt: Date | null;
	updatedAt: Date | null;
};
export type InvestigationMaxAggregateOutputType = {
	id: string | null;
	incidentId: string | null;
	status: string | null;
	startedAt: Date | null;
	completedAt: Date | null;
	summary: string | null;
	rootCause: string | null;
	rootCauseCategory: string | null;
	confidence: number | null;
	dataQuality: string | null;
	analysisMethod: string | null;
	dataSourcesUsed: string | null;
	rawOutput: string | null;
	error: string | null;
	agentProgression: string | null;
	createdAt: Date | null;
	updatedAt: Date | null;
};
export type InvestigationCountAggregateOutputType = {
	id: number;
	incidentId: number;
	status: number;
	startedAt: number;
	completedAt: number;
	summary: number;
	rootCause: number;
	rootCauseCategory: number;
	confidence: number;
	dataQuality: number;
	analysisMethod: number;
	dataSourcesUsed: number;
	rawOutput: number;
	error: number;
	agentProgression: number;
	createdAt: number;
	updatedAt: number;
	_all: number;
};
export type InvestigationAvgAggregateInputType = {
	confidence?: true;
};
export type InvestigationSumAggregateInputType = {
	confidence?: true;
};
export type InvestigationMinAggregateInputType = {
	id?: true;
	incidentId?: true;
	status?: true;
	startedAt?: true;
	completedAt?: true;
	summary?: true;
	rootCause?: true;
	rootCauseCategory?: true;
	confidence?: true;
	dataQuality?: true;
	analysisMethod?: true;
	dataSourcesUsed?: true;
	rawOutput?: true;
	error?: true;
	agentProgression?: true;
	createdAt?: true;
	updatedAt?: true;
};
export type InvestigationMaxAggregateInputType = {
	id?: true;
	incidentId?: true;
	status?: true;
	startedAt?: true;
	completedAt?: true;
	summary?: true;
	rootCause?: true;
	rootCauseCategory?: true;
	confidence?: true;
	dataQuality?: true;
	analysisMethod?: true;
	dataSourcesUsed?: true;
	rawOutput?: true;
	error?: true;
	agentProgression?: true;
	createdAt?: true;
	updatedAt?: true;
};
export type InvestigationCountAggregateInputType = {
	id?: true;
	incidentId?: true;
	status?: true;
	startedAt?: true;
	completedAt?: true;
	summary?: true;
	rootCause?: true;
	rootCauseCategory?: true;
	confidence?: true;
	dataQuality?: true;
	analysisMethod?: true;
	dataSourcesUsed?: true;
	rawOutput?: true;
	error?: true;
	agentProgression?: true;
	createdAt?: true;
	updatedAt?: true;
	_all?: true;
};
export type InvestigationAggregateArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	where?: Prisma.InvestigationWhereInput;
	orderBy?:
		| Prisma.InvestigationOrderByWithRelationInput
		| Prisma.InvestigationOrderByWithRelationInput[];
	cursor?: Prisma.InvestigationWhereUniqueInput;
	take?: number;
	skip?: number;
	_count?: true | InvestigationCountAggregateInputType;
	_avg?: InvestigationAvgAggregateInputType;
	_sum?: InvestigationSumAggregateInputType;
	_min?: InvestigationMinAggregateInputType;
	_max?: InvestigationMaxAggregateInputType;
};
export type GetInvestigationAggregateType<
	T extends InvestigationAggregateArgs,
> = {
	[P in keyof T & keyof AggregateInvestigation]: P extends "_count" | "count"
		? T[P] extends true
			? number
			: Prisma.GetScalarType<T[P], AggregateInvestigation[P]>
		: Prisma.GetScalarType<T[P], AggregateInvestigation[P]>;
};
export type InvestigationGroupByArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	where?: Prisma.InvestigationWhereInput;
	orderBy?:
		| Prisma.InvestigationOrderByWithAggregationInput
		| Prisma.InvestigationOrderByWithAggregationInput[];
	by:
		| Prisma.InvestigationScalarFieldEnum[]
		| Prisma.InvestigationScalarFieldEnum;
	having?: Prisma.InvestigationScalarWhereWithAggregatesInput;
	take?: number;
	skip?: number;
	_count?: InvestigationCountAggregateInputType | true;
	_avg?: InvestigationAvgAggregateInputType;
	_sum?: InvestigationSumAggregateInputType;
	_min?: InvestigationMinAggregateInputType;
	_max?: InvestigationMaxAggregateInputType;
};
export type InvestigationGroupByOutputType = {
	id: string;
	incidentId: string;
	status: string;
	startedAt: Date | null;
	completedAt: Date | null;
	summary: string | null;
	rootCause: string | null;
	rootCauseCategory: string | null;
	confidence: number | null;
	dataQuality: string | null;
	analysisMethod: string | null;
	dataSourcesUsed: string | null;
	rawOutput: string | null;
	error: string | null;
	agentProgression: string | null;
	createdAt: Date;
	updatedAt: Date;
	_count: InvestigationCountAggregateOutputType | null;
	_avg: InvestigationAvgAggregateOutputType | null;
	_sum: InvestigationSumAggregateOutputType | null;
	_min: InvestigationMinAggregateOutputType | null;
	_max: InvestigationMaxAggregateOutputType | null;
};
type GetInvestigationGroupByPayload<T extends InvestigationGroupByArgs> =
	Prisma.PrismaPromise<
		Array<
			Prisma.PickEnumerable<InvestigationGroupByOutputType, T["by"]> & {
				[P in keyof T &
					keyof InvestigationGroupByOutputType]: P extends "_count"
					? T[P] extends boolean
						? number
						: Prisma.GetScalarType<T[P], InvestigationGroupByOutputType[P]>
					: Prisma.GetScalarType<T[P], InvestigationGroupByOutputType[P]>;
			}
		>
	>;
export type InvestigationWhereInput = {
	AND?: Prisma.InvestigationWhereInput | Prisma.InvestigationWhereInput[];
	OR?: Prisma.InvestigationWhereInput[];
	NOT?: Prisma.InvestigationWhereInput | Prisma.InvestigationWhereInput[];
	id?: Prisma.StringFilter<"Investigation"> | string;
	incidentId?: Prisma.StringFilter<"Investigation"> | string;
	status?: Prisma.StringFilter<"Investigation"> | string;
	startedAt?:
		| Prisma.DateTimeNullableFilter<"Investigation">
		| Date
		| string
		| null;
	completedAt?:
		| Prisma.DateTimeNullableFilter<"Investigation">
		| Date
		| string
		| null;
	summary?: Prisma.StringNullableFilter<"Investigation"> | string | null;
	rootCause?: Prisma.StringNullableFilter<"Investigation"> | string | null;
	rootCauseCategory?:
		| Prisma.StringNullableFilter<"Investigation">
		| string
		| null;
	confidence?: Prisma.FloatNullableFilter<"Investigation"> | number | null;
	dataQuality?: Prisma.StringNullableFilter<"Investigation"> | string | null;
	analysisMethod?: Prisma.StringNullableFilter<"Investigation"> | string | null;
	dataSourcesUsed?:
		| Prisma.StringNullableFilter<"Investigation">
		| string
		| null;
	rawOutput?: Prisma.StringNullableFilter<"Investigation"> | string | null;
	error?: Prisma.StringNullableFilter<"Investigation"> | string | null;
	agentProgression?:
		| Prisma.StringNullableFilter<"Investigation">
		| string
		| null;
	createdAt?: Prisma.DateTimeFilter<"Investigation"> | Date | string;
	updatedAt?: Prisma.DateTimeFilter<"Investigation"> | Date | string;
	incident?: Prisma.XOR<
		Prisma.IncidentScalarRelationFilter,
		Prisma.IncidentWhereInput
	>;
	agentExecutions?: Prisma.AgentExecutionListRelationFilter;
	recommendations?: Prisma.RecommendationListRelationFilter;
};
export type InvestigationOrderByWithRelationInput = {
	id?: Prisma.SortOrder;
	incidentId?: Prisma.SortOrder;
	status?: Prisma.SortOrder;
	startedAt?: Prisma.SortOrderInput | Prisma.SortOrder;
	completedAt?: Prisma.SortOrderInput | Prisma.SortOrder;
	summary?: Prisma.SortOrderInput | Prisma.SortOrder;
	rootCause?: Prisma.SortOrderInput | Prisma.SortOrder;
	rootCauseCategory?: Prisma.SortOrderInput | Prisma.SortOrder;
	confidence?: Prisma.SortOrderInput | Prisma.SortOrder;
	dataQuality?: Prisma.SortOrderInput | Prisma.SortOrder;
	analysisMethod?: Prisma.SortOrderInput | Prisma.SortOrder;
	dataSourcesUsed?: Prisma.SortOrderInput | Prisma.SortOrder;
	rawOutput?: Prisma.SortOrderInput | Prisma.SortOrder;
	error?: Prisma.SortOrderInput | Prisma.SortOrder;
	agentProgression?: Prisma.SortOrderInput | Prisma.SortOrder;
	createdAt?: Prisma.SortOrder;
	updatedAt?: Prisma.SortOrder;
	incident?: Prisma.IncidentOrderByWithRelationInput;
	agentExecutions?: Prisma.AgentExecutionOrderByRelationAggregateInput;
	recommendations?: Prisma.RecommendationOrderByRelationAggregateInput;
};
export type InvestigationWhereUniqueInput = Prisma.AtLeast<
	{
		id?: string;
		AND?: Prisma.InvestigationWhereInput | Prisma.InvestigationWhereInput[];
		OR?: Prisma.InvestigationWhereInput[];
		NOT?: Prisma.InvestigationWhereInput | Prisma.InvestigationWhereInput[];
		incidentId?: Prisma.StringFilter<"Investigation"> | string;
		status?: Prisma.StringFilter<"Investigation"> | string;
		startedAt?:
			| Prisma.DateTimeNullableFilter<"Investigation">
			| Date
			| string
			| null;
		completedAt?:
			| Prisma.DateTimeNullableFilter<"Investigation">
			| Date
			| string
			| null;
		summary?: Prisma.StringNullableFilter<"Investigation"> | string | null;
		rootCause?: Prisma.StringNullableFilter<"Investigation"> | string | null;
		rootCauseCategory?:
			| Prisma.StringNullableFilter<"Investigation">
			| string
			| null;
		confidence?: Prisma.FloatNullableFilter<"Investigation"> | number | null;
		dataQuality?: Prisma.StringNullableFilter<"Investigation"> | string | null;
		analysisMethod?:
			| Prisma.StringNullableFilter<"Investigation">
			| string
			| null;
		dataSourcesUsed?:
			| Prisma.StringNullableFilter<"Investigation">
			| string
			| null;
		rawOutput?: Prisma.StringNullableFilter<"Investigation"> | string | null;
		error?: Prisma.StringNullableFilter<"Investigation"> | string | null;
		agentProgression?:
			| Prisma.StringNullableFilter<"Investigation">
			| string
			| null;
		createdAt?: Prisma.DateTimeFilter<"Investigation"> | Date | string;
		updatedAt?: Prisma.DateTimeFilter<"Investigation"> | Date | string;
		incident?: Prisma.XOR<
			Prisma.IncidentScalarRelationFilter,
			Prisma.IncidentWhereInput
		>;
		agentExecutions?: Prisma.AgentExecutionListRelationFilter;
		recommendations?: Prisma.RecommendationListRelationFilter;
	},
	"id"
>;
export type InvestigationOrderByWithAggregationInput = {
	id?: Prisma.SortOrder;
	incidentId?: Prisma.SortOrder;
	status?: Prisma.SortOrder;
	startedAt?: Prisma.SortOrderInput | Prisma.SortOrder;
	completedAt?: Prisma.SortOrderInput | Prisma.SortOrder;
	summary?: Prisma.SortOrderInput | Prisma.SortOrder;
	rootCause?: Prisma.SortOrderInput | Prisma.SortOrder;
	rootCauseCategory?: Prisma.SortOrderInput | Prisma.SortOrder;
	confidence?: Prisma.SortOrderInput | Prisma.SortOrder;
	dataQuality?: Prisma.SortOrderInput | Prisma.SortOrder;
	analysisMethod?: Prisma.SortOrderInput | Prisma.SortOrder;
	dataSourcesUsed?: Prisma.SortOrderInput | Prisma.SortOrder;
	rawOutput?: Prisma.SortOrderInput | Prisma.SortOrder;
	error?: Prisma.SortOrderInput | Prisma.SortOrder;
	agentProgression?: Prisma.SortOrderInput | Prisma.SortOrder;
	createdAt?: Prisma.SortOrder;
	updatedAt?: Prisma.SortOrder;
	_count?: Prisma.InvestigationCountOrderByAggregateInput;
	_avg?: Prisma.InvestigationAvgOrderByAggregateInput;
	_max?: Prisma.InvestigationMaxOrderByAggregateInput;
	_min?: Prisma.InvestigationMinOrderByAggregateInput;
	_sum?: Prisma.InvestigationSumOrderByAggregateInput;
};
export type InvestigationScalarWhereWithAggregatesInput = {
	AND?:
		| Prisma.InvestigationScalarWhereWithAggregatesInput
		| Prisma.InvestigationScalarWhereWithAggregatesInput[];
	OR?: Prisma.InvestigationScalarWhereWithAggregatesInput[];
	NOT?:
		| Prisma.InvestigationScalarWhereWithAggregatesInput
		| Prisma.InvestigationScalarWhereWithAggregatesInput[];
	id?: Prisma.StringWithAggregatesFilter<"Investigation"> | string;
	incidentId?: Prisma.StringWithAggregatesFilter<"Investigation"> | string;
	status?: Prisma.StringWithAggregatesFilter<"Investigation"> | string;
	startedAt?:
		| Prisma.DateTimeNullableWithAggregatesFilter<"Investigation">
		| Date
		| string
		| null;
	completedAt?:
		| Prisma.DateTimeNullableWithAggregatesFilter<"Investigation">
		| Date
		| string
		| null;
	summary?:
		| Prisma.StringNullableWithAggregatesFilter<"Investigation">
		| string
		| null;
	rootCause?:
		| Prisma.StringNullableWithAggregatesFilter<"Investigation">
		| string
		| null;
	rootCauseCategory?:
		| Prisma.StringNullableWithAggregatesFilter<"Investigation">
		| string
		| null;
	confidence?:
		| Prisma.FloatNullableWithAggregatesFilter<"Investigation">
		| number
		| null;
	dataQuality?:
		| Prisma.StringNullableWithAggregatesFilter<"Investigation">
		| string
		| null;
	analysisMethod?:
		| Prisma.StringNullableWithAggregatesFilter<"Investigation">
		| string
		| null;
	dataSourcesUsed?:
		| Prisma.StringNullableWithAggregatesFilter<"Investigation">
		| string
		| null;
	rawOutput?:
		| Prisma.StringNullableWithAggregatesFilter<"Investigation">
		| string
		| null;
	error?:
		| Prisma.StringNullableWithAggregatesFilter<"Investigation">
		| string
		| null;
	agentProgression?:
		| Prisma.StringNullableWithAggregatesFilter<"Investigation">
		| string
		| null;
	createdAt?:
		| Prisma.DateTimeWithAggregatesFilter<"Investigation">
		| Date
		| string;
	updatedAt?:
		| Prisma.DateTimeWithAggregatesFilter<"Investigation">
		| Date
		| string;
};
export type InvestigationCreateInput = {
	id?: string;
	status?: string;
	startedAt?: Date | string | null;
	completedAt?: Date | string | null;
	summary?: string | null;
	rootCause?: string | null;
	rootCauseCategory?: string | null;
	confidence?: number | null;
	dataQuality?: string | null;
	analysisMethod?: string | null;
	dataSourcesUsed?: string | null;
	rawOutput?: string | null;
	error?: string | null;
	agentProgression?: string | null;
	createdAt?: Date | string;
	updatedAt?: Date | string;
	incident: Prisma.IncidentCreateNestedOneWithoutInvestigationsInput;
	agentExecutions?: Prisma.AgentExecutionCreateNestedManyWithoutInvestigationInput;
	recommendations?: Prisma.RecommendationCreateNestedManyWithoutInvestigationInput;
};
export type InvestigationUncheckedCreateInput = {
	id?: string;
	incidentId: string;
	status?: string;
	startedAt?: Date | string | null;
	completedAt?: Date | string | null;
	summary?: string | null;
	rootCause?: string | null;
	rootCauseCategory?: string | null;
	confidence?: number | null;
	dataQuality?: string | null;
	analysisMethod?: string | null;
	dataSourcesUsed?: string | null;
	rawOutput?: string | null;
	error?: string | null;
	agentProgression?: string | null;
	createdAt?: Date | string;
	updatedAt?: Date | string;
	agentExecutions?: Prisma.AgentExecutionUncheckedCreateNestedManyWithoutInvestigationInput;
	recommendations?: Prisma.RecommendationUncheckedCreateNestedManyWithoutInvestigationInput;
};
export type InvestigationUpdateInput = {
	id?: Prisma.StringFieldUpdateOperationsInput | string;
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
	summary?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	rootCause?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	rootCauseCategory?:
		| Prisma.NullableStringFieldUpdateOperationsInput
		| string
		| null;
	confidence?: Prisma.NullableFloatFieldUpdateOperationsInput | number | null;
	dataQuality?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	analysisMethod?:
		| Prisma.NullableStringFieldUpdateOperationsInput
		| string
		| null;
	dataSourcesUsed?:
		| Prisma.NullableStringFieldUpdateOperationsInput
		| string
		| null;
	rawOutput?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	error?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	agentProgression?:
		| Prisma.NullableStringFieldUpdateOperationsInput
		| string
		| null;
	createdAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
	updatedAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
	incident?: Prisma.IncidentUpdateOneRequiredWithoutInvestigationsNestedInput;
	agentExecutions?: Prisma.AgentExecutionUpdateManyWithoutInvestigationNestedInput;
	recommendations?: Prisma.RecommendationUpdateManyWithoutInvestigationNestedInput;
};
export type InvestigationUncheckedUpdateInput = {
	id?: Prisma.StringFieldUpdateOperationsInput | string;
	incidentId?: Prisma.StringFieldUpdateOperationsInput | string;
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
	summary?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	rootCause?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	rootCauseCategory?:
		| Prisma.NullableStringFieldUpdateOperationsInput
		| string
		| null;
	confidence?: Prisma.NullableFloatFieldUpdateOperationsInput | number | null;
	dataQuality?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	analysisMethod?:
		| Prisma.NullableStringFieldUpdateOperationsInput
		| string
		| null;
	dataSourcesUsed?:
		| Prisma.NullableStringFieldUpdateOperationsInput
		| string
		| null;
	rawOutput?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	error?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	agentProgression?:
		| Prisma.NullableStringFieldUpdateOperationsInput
		| string
		| null;
	createdAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
	updatedAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
	agentExecutions?: Prisma.AgentExecutionUncheckedUpdateManyWithoutInvestigationNestedInput;
	recommendations?: Prisma.RecommendationUncheckedUpdateManyWithoutInvestigationNestedInput;
};
export type InvestigationCreateManyInput = {
	id?: string;
	incidentId: string;
	status?: string;
	startedAt?: Date | string | null;
	completedAt?: Date | string | null;
	summary?: string | null;
	rootCause?: string | null;
	rootCauseCategory?: string | null;
	confidence?: number | null;
	dataQuality?: string | null;
	analysisMethod?: string | null;
	dataSourcesUsed?: string | null;
	rawOutput?: string | null;
	error?: string | null;
	agentProgression?: string | null;
	createdAt?: Date | string;
	updatedAt?: Date | string;
};
export type InvestigationUpdateManyMutationInput = {
	id?: Prisma.StringFieldUpdateOperationsInput | string;
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
	summary?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	rootCause?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	rootCauseCategory?:
		| Prisma.NullableStringFieldUpdateOperationsInput
		| string
		| null;
	confidence?: Prisma.NullableFloatFieldUpdateOperationsInput | number | null;
	dataQuality?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	analysisMethod?:
		| Prisma.NullableStringFieldUpdateOperationsInput
		| string
		| null;
	dataSourcesUsed?:
		| Prisma.NullableStringFieldUpdateOperationsInput
		| string
		| null;
	rawOutput?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	error?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	agentProgression?:
		| Prisma.NullableStringFieldUpdateOperationsInput
		| string
		| null;
	createdAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
	updatedAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
};
export type InvestigationUncheckedUpdateManyInput = {
	id?: Prisma.StringFieldUpdateOperationsInput | string;
	incidentId?: Prisma.StringFieldUpdateOperationsInput | string;
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
	summary?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	rootCause?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	rootCauseCategory?:
		| Prisma.NullableStringFieldUpdateOperationsInput
		| string
		| null;
	confidence?: Prisma.NullableFloatFieldUpdateOperationsInput | number | null;
	dataQuality?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	analysisMethod?:
		| Prisma.NullableStringFieldUpdateOperationsInput
		| string
		| null;
	dataSourcesUsed?:
		| Prisma.NullableStringFieldUpdateOperationsInput
		| string
		| null;
	rawOutput?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	error?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	agentProgression?:
		| Prisma.NullableStringFieldUpdateOperationsInput
		| string
		| null;
	createdAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
	updatedAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
};
export type InvestigationListRelationFilter = {
	every?: Prisma.InvestigationWhereInput;
	some?: Prisma.InvestigationWhereInput;
	none?: Prisma.InvestigationWhereInput;
};
export type InvestigationOrderByRelationAggregateInput = {
	_count?: Prisma.SortOrder;
};
export type InvestigationCountOrderByAggregateInput = {
	id?: Prisma.SortOrder;
	incidentId?: Prisma.SortOrder;
	status?: Prisma.SortOrder;
	startedAt?: Prisma.SortOrder;
	completedAt?: Prisma.SortOrder;
	summary?: Prisma.SortOrder;
	rootCause?: Prisma.SortOrder;
	rootCauseCategory?: Prisma.SortOrder;
	confidence?: Prisma.SortOrder;
	dataQuality?: Prisma.SortOrder;
	analysisMethod?: Prisma.SortOrder;
	dataSourcesUsed?: Prisma.SortOrder;
	rawOutput?: Prisma.SortOrder;
	error?: Prisma.SortOrder;
	agentProgression?: Prisma.SortOrder;
	createdAt?: Prisma.SortOrder;
	updatedAt?: Prisma.SortOrder;
};
export type InvestigationAvgOrderByAggregateInput = {
	confidence?: Prisma.SortOrder;
};
export type InvestigationMaxOrderByAggregateInput = {
	id?: Prisma.SortOrder;
	incidentId?: Prisma.SortOrder;
	status?: Prisma.SortOrder;
	startedAt?: Prisma.SortOrder;
	completedAt?: Prisma.SortOrder;
	summary?: Prisma.SortOrder;
	rootCause?: Prisma.SortOrder;
	rootCauseCategory?: Prisma.SortOrder;
	confidence?: Prisma.SortOrder;
	dataQuality?: Prisma.SortOrder;
	analysisMethod?: Prisma.SortOrder;
	dataSourcesUsed?: Prisma.SortOrder;
	rawOutput?: Prisma.SortOrder;
	error?: Prisma.SortOrder;
	agentProgression?: Prisma.SortOrder;
	createdAt?: Prisma.SortOrder;
	updatedAt?: Prisma.SortOrder;
};
export type InvestigationMinOrderByAggregateInput = {
	id?: Prisma.SortOrder;
	incidentId?: Prisma.SortOrder;
	status?: Prisma.SortOrder;
	startedAt?: Prisma.SortOrder;
	completedAt?: Prisma.SortOrder;
	summary?: Prisma.SortOrder;
	rootCause?: Prisma.SortOrder;
	rootCauseCategory?: Prisma.SortOrder;
	confidence?: Prisma.SortOrder;
	dataQuality?: Prisma.SortOrder;
	analysisMethod?: Prisma.SortOrder;
	dataSourcesUsed?: Prisma.SortOrder;
	rawOutput?: Prisma.SortOrder;
	error?: Prisma.SortOrder;
	agentProgression?: Prisma.SortOrder;
	createdAt?: Prisma.SortOrder;
	updatedAt?: Prisma.SortOrder;
};
export type InvestigationSumOrderByAggregateInput = {
	confidence?: Prisma.SortOrder;
};
export type InvestigationScalarRelationFilter = {
	is?: Prisma.InvestigationWhereInput;
	isNot?: Prisma.InvestigationWhereInput;
};
export type InvestigationCreateNestedManyWithoutIncidentInput = {
	create?:
		| Prisma.XOR<
				Prisma.InvestigationCreateWithoutIncidentInput,
				Prisma.InvestigationUncheckedCreateWithoutIncidentInput
		  >
		| Prisma.InvestigationCreateWithoutIncidentInput[]
		| Prisma.InvestigationUncheckedCreateWithoutIncidentInput[];
	connectOrCreate?:
		| Prisma.InvestigationCreateOrConnectWithoutIncidentInput
		| Prisma.InvestigationCreateOrConnectWithoutIncidentInput[];
	createMany?: Prisma.InvestigationCreateManyIncidentInputEnvelope;
	connect?:
		| Prisma.InvestigationWhereUniqueInput
		| Prisma.InvestigationWhereUniqueInput[];
};
export type InvestigationUncheckedCreateNestedManyWithoutIncidentInput = {
	create?:
		| Prisma.XOR<
				Prisma.InvestigationCreateWithoutIncidentInput,
				Prisma.InvestigationUncheckedCreateWithoutIncidentInput
		  >
		| Prisma.InvestigationCreateWithoutIncidentInput[]
		| Prisma.InvestigationUncheckedCreateWithoutIncidentInput[];
	connectOrCreate?:
		| Prisma.InvestigationCreateOrConnectWithoutIncidentInput
		| Prisma.InvestigationCreateOrConnectWithoutIncidentInput[];
	createMany?: Prisma.InvestigationCreateManyIncidentInputEnvelope;
	connect?:
		| Prisma.InvestigationWhereUniqueInput
		| Prisma.InvestigationWhereUniqueInput[];
};
export type InvestigationUpdateManyWithoutIncidentNestedInput = {
	create?:
		| Prisma.XOR<
				Prisma.InvestigationCreateWithoutIncidentInput,
				Prisma.InvestigationUncheckedCreateWithoutIncidentInput
		  >
		| Prisma.InvestigationCreateWithoutIncidentInput[]
		| Prisma.InvestigationUncheckedCreateWithoutIncidentInput[];
	connectOrCreate?:
		| Prisma.InvestigationCreateOrConnectWithoutIncidentInput
		| Prisma.InvestigationCreateOrConnectWithoutIncidentInput[];
	upsert?:
		| Prisma.InvestigationUpsertWithWhereUniqueWithoutIncidentInput
		| Prisma.InvestigationUpsertWithWhereUniqueWithoutIncidentInput[];
	createMany?: Prisma.InvestigationCreateManyIncidentInputEnvelope;
	set?:
		| Prisma.InvestigationWhereUniqueInput
		| Prisma.InvestigationWhereUniqueInput[];
	disconnect?:
		| Prisma.InvestigationWhereUniqueInput
		| Prisma.InvestigationWhereUniqueInput[];
	delete?:
		| Prisma.InvestigationWhereUniqueInput
		| Prisma.InvestigationWhereUniqueInput[];
	connect?:
		| Prisma.InvestigationWhereUniqueInput
		| Prisma.InvestigationWhereUniqueInput[];
	update?:
		| Prisma.InvestigationUpdateWithWhereUniqueWithoutIncidentInput
		| Prisma.InvestigationUpdateWithWhereUniqueWithoutIncidentInput[];
	updateMany?:
		| Prisma.InvestigationUpdateManyWithWhereWithoutIncidentInput
		| Prisma.InvestigationUpdateManyWithWhereWithoutIncidentInput[];
	deleteMany?:
		| Prisma.InvestigationScalarWhereInput
		| Prisma.InvestigationScalarWhereInput[];
};
export type InvestigationUncheckedUpdateManyWithoutIncidentNestedInput = {
	create?:
		| Prisma.XOR<
				Prisma.InvestigationCreateWithoutIncidentInput,
				Prisma.InvestigationUncheckedCreateWithoutIncidentInput
		  >
		| Prisma.InvestigationCreateWithoutIncidentInput[]
		| Prisma.InvestigationUncheckedCreateWithoutIncidentInput[];
	connectOrCreate?:
		| Prisma.InvestigationCreateOrConnectWithoutIncidentInput
		| Prisma.InvestigationCreateOrConnectWithoutIncidentInput[];
	upsert?:
		| Prisma.InvestigationUpsertWithWhereUniqueWithoutIncidentInput
		| Prisma.InvestigationUpsertWithWhereUniqueWithoutIncidentInput[];
	createMany?: Prisma.InvestigationCreateManyIncidentInputEnvelope;
	set?:
		| Prisma.InvestigationWhereUniqueInput
		| Prisma.InvestigationWhereUniqueInput[];
	disconnect?:
		| Prisma.InvestigationWhereUniqueInput
		| Prisma.InvestigationWhereUniqueInput[];
	delete?:
		| Prisma.InvestigationWhereUniqueInput
		| Prisma.InvestigationWhereUniqueInput[];
	connect?:
		| Prisma.InvestigationWhereUniqueInput
		| Prisma.InvestigationWhereUniqueInput[];
	update?:
		| Prisma.InvestigationUpdateWithWhereUniqueWithoutIncidentInput
		| Prisma.InvestigationUpdateWithWhereUniqueWithoutIncidentInput[];
	updateMany?:
		| Prisma.InvestigationUpdateManyWithWhereWithoutIncidentInput
		| Prisma.InvestigationUpdateManyWithWhereWithoutIncidentInput[];
	deleteMany?:
		| Prisma.InvestigationScalarWhereInput
		| Prisma.InvestigationScalarWhereInput[];
};
export type NullableFloatFieldUpdateOperationsInput = {
	set?: number | null;
	increment?: number;
	decrement?: number;
	multiply?: number;
	divide?: number;
};
export type InvestigationCreateNestedOneWithoutAgentExecutionsInput = {
	create?: Prisma.XOR<
		Prisma.InvestigationCreateWithoutAgentExecutionsInput,
		Prisma.InvestigationUncheckedCreateWithoutAgentExecutionsInput
	>;
	connectOrCreate?: Prisma.InvestigationCreateOrConnectWithoutAgentExecutionsInput;
	connect?: Prisma.InvestigationWhereUniqueInput;
};
export type InvestigationUpdateOneRequiredWithoutAgentExecutionsNestedInput = {
	create?: Prisma.XOR<
		Prisma.InvestigationCreateWithoutAgentExecutionsInput,
		Prisma.InvestigationUncheckedCreateWithoutAgentExecutionsInput
	>;
	connectOrCreate?: Prisma.InvestigationCreateOrConnectWithoutAgentExecutionsInput;
	upsert?: Prisma.InvestigationUpsertWithoutAgentExecutionsInput;
	connect?: Prisma.InvestigationWhereUniqueInput;
	update?: Prisma.XOR<
		Prisma.XOR<
			Prisma.InvestigationUpdateToOneWithWhereWithoutAgentExecutionsInput,
			Prisma.InvestigationUpdateWithoutAgentExecutionsInput
		>,
		Prisma.InvestigationUncheckedUpdateWithoutAgentExecutionsInput
	>;
};
export type InvestigationCreateNestedOneWithoutRecommendationsInput = {
	create?: Prisma.XOR<
		Prisma.InvestigationCreateWithoutRecommendationsInput,
		Prisma.InvestigationUncheckedCreateWithoutRecommendationsInput
	>;
	connectOrCreate?: Prisma.InvestigationCreateOrConnectWithoutRecommendationsInput;
	connect?: Prisma.InvestigationWhereUniqueInput;
};
export type InvestigationUpdateOneRequiredWithoutRecommendationsNestedInput = {
	create?: Prisma.XOR<
		Prisma.InvestigationCreateWithoutRecommendationsInput,
		Prisma.InvestigationUncheckedCreateWithoutRecommendationsInput
	>;
	connectOrCreate?: Prisma.InvestigationCreateOrConnectWithoutRecommendationsInput;
	upsert?: Prisma.InvestigationUpsertWithoutRecommendationsInput;
	connect?: Prisma.InvestigationWhereUniqueInput;
	update?: Prisma.XOR<
		Prisma.XOR<
			Prisma.InvestigationUpdateToOneWithWhereWithoutRecommendationsInput,
			Prisma.InvestigationUpdateWithoutRecommendationsInput
		>,
		Prisma.InvestigationUncheckedUpdateWithoutRecommendationsInput
	>;
};
export type InvestigationCreateWithoutIncidentInput = {
	id?: string;
	status?: string;
	startedAt?: Date | string | null;
	completedAt?: Date | string | null;
	summary?: string | null;
	rootCause?: string | null;
	rootCauseCategory?: string | null;
	confidence?: number | null;
	dataQuality?: string | null;
	analysisMethod?: string | null;
	dataSourcesUsed?: string | null;
	rawOutput?: string | null;
	error?: string | null;
	agentProgression?: string | null;
	createdAt?: Date | string;
	updatedAt?: Date | string;
	agentExecutions?: Prisma.AgentExecutionCreateNestedManyWithoutInvestigationInput;
	recommendations?: Prisma.RecommendationCreateNestedManyWithoutInvestigationInput;
};
export type InvestigationUncheckedCreateWithoutIncidentInput = {
	id?: string;
	status?: string;
	startedAt?: Date | string | null;
	completedAt?: Date | string | null;
	summary?: string | null;
	rootCause?: string | null;
	rootCauseCategory?: string | null;
	confidence?: number | null;
	dataQuality?: string | null;
	analysisMethod?: string | null;
	dataSourcesUsed?: string | null;
	rawOutput?: string | null;
	error?: string | null;
	agentProgression?: string | null;
	createdAt?: Date | string;
	updatedAt?: Date | string;
	agentExecutions?: Prisma.AgentExecutionUncheckedCreateNestedManyWithoutInvestigationInput;
	recommendations?: Prisma.RecommendationUncheckedCreateNestedManyWithoutInvestigationInput;
};
export type InvestigationCreateOrConnectWithoutIncidentInput = {
	where: Prisma.InvestigationWhereUniqueInput;
	create: Prisma.XOR<
		Prisma.InvestigationCreateWithoutIncidentInput,
		Prisma.InvestigationUncheckedCreateWithoutIncidentInput
	>;
};
export type InvestigationCreateManyIncidentInputEnvelope = {
	data:
		| Prisma.InvestigationCreateManyIncidentInput
		| Prisma.InvestigationCreateManyIncidentInput[];
};
export type InvestigationUpsertWithWhereUniqueWithoutIncidentInput = {
	where: Prisma.InvestigationWhereUniqueInput;
	update: Prisma.XOR<
		Prisma.InvestigationUpdateWithoutIncidentInput,
		Prisma.InvestigationUncheckedUpdateWithoutIncidentInput
	>;
	create: Prisma.XOR<
		Prisma.InvestigationCreateWithoutIncidentInput,
		Prisma.InvestigationUncheckedCreateWithoutIncidentInput
	>;
};
export type InvestigationUpdateWithWhereUniqueWithoutIncidentInput = {
	where: Prisma.InvestigationWhereUniqueInput;
	data: Prisma.XOR<
		Prisma.InvestigationUpdateWithoutIncidentInput,
		Prisma.InvestigationUncheckedUpdateWithoutIncidentInput
	>;
};
export type InvestigationUpdateManyWithWhereWithoutIncidentInput = {
	where: Prisma.InvestigationScalarWhereInput;
	data: Prisma.XOR<
		Prisma.InvestigationUpdateManyMutationInput,
		Prisma.InvestigationUncheckedUpdateManyWithoutIncidentInput
	>;
};
export type InvestigationScalarWhereInput = {
	AND?:
		| Prisma.InvestigationScalarWhereInput
		| Prisma.InvestigationScalarWhereInput[];
	OR?: Prisma.InvestigationScalarWhereInput[];
	NOT?:
		| Prisma.InvestigationScalarWhereInput
		| Prisma.InvestigationScalarWhereInput[];
	id?: Prisma.StringFilter<"Investigation"> | string;
	incidentId?: Prisma.StringFilter<"Investigation"> | string;
	status?: Prisma.StringFilter<"Investigation"> | string;
	startedAt?:
		| Prisma.DateTimeNullableFilter<"Investigation">
		| Date
		| string
		| null;
	completedAt?:
		| Prisma.DateTimeNullableFilter<"Investigation">
		| Date
		| string
		| null;
	summary?: Prisma.StringNullableFilter<"Investigation"> | string | null;
	rootCause?: Prisma.StringNullableFilter<"Investigation"> | string | null;
	rootCauseCategory?:
		| Prisma.StringNullableFilter<"Investigation">
		| string
		| null;
	confidence?: Prisma.FloatNullableFilter<"Investigation"> | number | null;
	dataQuality?: Prisma.StringNullableFilter<"Investigation"> | string | null;
	analysisMethod?: Prisma.StringNullableFilter<"Investigation"> | string | null;
	dataSourcesUsed?:
		| Prisma.StringNullableFilter<"Investigation">
		| string
		| null;
	rawOutput?: Prisma.StringNullableFilter<"Investigation"> | string | null;
	error?: Prisma.StringNullableFilter<"Investigation"> | string | null;
	agentProgression?:
		| Prisma.StringNullableFilter<"Investigation">
		| string
		| null;
	createdAt?: Prisma.DateTimeFilter<"Investigation"> | Date | string;
	updatedAt?: Prisma.DateTimeFilter<"Investigation"> | Date | string;
};
export type InvestigationCreateWithoutAgentExecutionsInput = {
	id?: string;
	status?: string;
	startedAt?: Date | string | null;
	completedAt?: Date | string | null;
	summary?: string | null;
	rootCause?: string | null;
	rootCauseCategory?: string | null;
	confidence?: number | null;
	dataQuality?: string | null;
	analysisMethod?: string | null;
	dataSourcesUsed?: string | null;
	rawOutput?: string | null;
	error?: string | null;
	agentProgression?: string | null;
	createdAt?: Date | string;
	updatedAt?: Date | string;
	incident: Prisma.IncidentCreateNestedOneWithoutInvestigationsInput;
	recommendations?: Prisma.RecommendationCreateNestedManyWithoutInvestigationInput;
};
export type InvestigationUncheckedCreateWithoutAgentExecutionsInput = {
	id?: string;
	incidentId: string;
	status?: string;
	startedAt?: Date | string | null;
	completedAt?: Date | string | null;
	summary?: string | null;
	rootCause?: string | null;
	rootCauseCategory?: string | null;
	confidence?: number | null;
	dataQuality?: string | null;
	analysisMethod?: string | null;
	dataSourcesUsed?: string | null;
	rawOutput?: string | null;
	error?: string | null;
	agentProgression?: string | null;
	createdAt?: Date | string;
	updatedAt?: Date | string;
	recommendations?: Prisma.RecommendationUncheckedCreateNestedManyWithoutInvestigationInput;
};
export type InvestigationCreateOrConnectWithoutAgentExecutionsInput = {
	where: Prisma.InvestigationWhereUniqueInput;
	create: Prisma.XOR<
		Prisma.InvestigationCreateWithoutAgentExecutionsInput,
		Prisma.InvestigationUncheckedCreateWithoutAgentExecutionsInput
	>;
};
export type InvestigationUpsertWithoutAgentExecutionsInput = {
	update: Prisma.XOR<
		Prisma.InvestigationUpdateWithoutAgentExecutionsInput,
		Prisma.InvestigationUncheckedUpdateWithoutAgentExecutionsInput
	>;
	create: Prisma.XOR<
		Prisma.InvestigationCreateWithoutAgentExecutionsInput,
		Prisma.InvestigationUncheckedCreateWithoutAgentExecutionsInput
	>;
	where?: Prisma.InvestigationWhereInput;
};
export type InvestigationUpdateToOneWithWhereWithoutAgentExecutionsInput = {
	where?: Prisma.InvestigationWhereInput;
	data: Prisma.XOR<
		Prisma.InvestigationUpdateWithoutAgentExecutionsInput,
		Prisma.InvestigationUncheckedUpdateWithoutAgentExecutionsInput
	>;
};
export type InvestigationUpdateWithoutAgentExecutionsInput = {
	id?: Prisma.StringFieldUpdateOperationsInput | string;
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
	summary?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	rootCause?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	rootCauseCategory?:
		| Prisma.NullableStringFieldUpdateOperationsInput
		| string
		| null;
	confidence?: Prisma.NullableFloatFieldUpdateOperationsInput | number | null;
	dataQuality?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	analysisMethod?:
		| Prisma.NullableStringFieldUpdateOperationsInput
		| string
		| null;
	dataSourcesUsed?:
		| Prisma.NullableStringFieldUpdateOperationsInput
		| string
		| null;
	rawOutput?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	error?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	agentProgression?:
		| Prisma.NullableStringFieldUpdateOperationsInput
		| string
		| null;
	createdAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
	updatedAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
	incident?: Prisma.IncidentUpdateOneRequiredWithoutInvestigationsNestedInput;
	recommendations?: Prisma.RecommendationUpdateManyWithoutInvestigationNestedInput;
};
export type InvestigationUncheckedUpdateWithoutAgentExecutionsInput = {
	id?: Prisma.StringFieldUpdateOperationsInput | string;
	incidentId?: Prisma.StringFieldUpdateOperationsInput | string;
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
	summary?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	rootCause?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	rootCauseCategory?:
		| Prisma.NullableStringFieldUpdateOperationsInput
		| string
		| null;
	confidence?: Prisma.NullableFloatFieldUpdateOperationsInput | number | null;
	dataQuality?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	analysisMethod?:
		| Prisma.NullableStringFieldUpdateOperationsInput
		| string
		| null;
	dataSourcesUsed?:
		| Prisma.NullableStringFieldUpdateOperationsInput
		| string
		| null;
	rawOutput?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	error?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	agentProgression?:
		| Prisma.NullableStringFieldUpdateOperationsInput
		| string
		| null;
	createdAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
	updatedAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
	recommendations?: Prisma.RecommendationUncheckedUpdateManyWithoutInvestigationNestedInput;
};
export type InvestigationCreateWithoutRecommendationsInput = {
	id?: string;
	status?: string;
	startedAt?: Date | string | null;
	completedAt?: Date | string | null;
	summary?: string | null;
	rootCause?: string | null;
	rootCauseCategory?: string | null;
	confidence?: number | null;
	dataQuality?: string | null;
	analysisMethod?: string | null;
	dataSourcesUsed?: string | null;
	rawOutput?: string | null;
	error?: string | null;
	agentProgression?: string | null;
	createdAt?: Date | string;
	updatedAt?: Date | string;
	incident: Prisma.IncidentCreateNestedOneWithoutInvestigationsInput;
	agentExecutions?: Prisma.AgentExecutionCreateNestedManyWithoutInvestigationInput;
};
export type InvestigationUncheckedCreateWithoutRecommendationsInput = {
	id?: string;
	incidentId: string;
	status?: string;
	startedAt?: Date | string | null;
	completedAt?: Date | string | null;
	summary?: string | null;
	rootCause?: string | null;
	rootCauseCategory?: string | null;
	confidence?: number | null;
	dataQuality?: string | null;
	analysisMethod?: string | null;
	dataSourcesUsed?: string | null;
	rawOutput?: string | null;
	error?: string | null;
	agentProgression?: string | null;
	createdAt?: Date | string;
	updatedAt?: Date | string;
	agentExecutions?: Prisma.AgentExecutionUncheckedCreateNestedManyWithoutInvestigationInput;
};
export type InvestigationCreateOrConnectWithoutRecommendationsInput = {
	where: Prisma.InvestigationWhereUniqueInput;
	create: Prisma.XOR<
		Prisma.InvestigationCreateWithoutRecommendationsInput,
		Prisma.InvestigationUncheckedCreateWithoutRecommendationsInput
	>;
};
export type InvestigationUpsertWithoutRecommendationsInput = {
	update: Prisma.XOR<
		Prisma.InvestigationUpdateWithoutRecommendationsInput,
		Prisma.InvestigationUncheckedUpdateWithoutRecommendationsInput
	>;
	create: Prisma.XOR<
		Prisma.InvestigationCreateWithoutRecommendationsInput,
		Prisma.InvestigationUncheckedCreateWithoutRecommendationsInput
	>;
	where?: Prisma.InvestigationWhereInput;
};
export type InvestigationUpdateToOneWithWhereWithoutRecommendationsInput = {
	where?: Prisma.InvestigationWhereInput;
	data: Prisma.XOR<
		Prisma.InvestigationUpdateWithoutRecommendationsInput,
		Prisma.InvestigationUncheckedUpdateWithoutRecommendationsInput
	>;
};
export type InvestigationUpdateWithoutRecommendationsInput = {
	id?: Prisma.StringFieldUpdateOperationsInput | string;
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
	summary?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	rootCause?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	rootCauseCategory?:
		| Prisma.NullableStringFieldUpdateOperationsInput
		| string
		| null;
	confidence?: Prisma.NullableFloatFieldUpdateOperationsInput | number | null;
	dataQuality?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	analysisMethod?:
		| Prisma.NullableStringFieldUpdateOperationsInput
		| string
		| null;
	dataSourcesUsed?:
		| Prisma.NullableStringFieldUpdateOperationsInput
		| string
		| null;
	rawOutput?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	error?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	agentProgression?:
		| Prisma.NullableStringFieldUpdateOperationsInput
		| string
		| null;
	createdAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
	updatedAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
	incident?: Prisma.IncidentUpdateOneRequiredWithoutInvestigationsNestedInput;
	agentExecutions?: Prisma.AgentExecutionUpdateManyWithoutInvestigationNestedInput;
};
export type InvestigationUncheckedUpdateWithoutRecommendationsInput = {
	id?: Prisma.StringFieldUpdateOperationsInput | string;
	incidentId?: Prisma.StringFieldUpdateOperationsInput | string;
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
	summary?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	rootCause?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	rootCauseCategory?:
		| Prisma.NullableStringFieldUpdateOperationsInput
		| string
		| null;
	confidence?: Prisma.NullableFloatFieldUpdateOperationsInput | number | null;
	dataQuality?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	analysisMethod?:
		| Prisma.NullableStringFieldUpdateOperationsInput
		| string
		| null;
	dataSourcesUsed?:
		| Prisma.NullableStringFieldUpdateOperationsInput
		| string
		| null;
	rawOutput?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	error?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	agentProgression?:
		| Prisma.NullableStringFieldUpdateOperationsInput
		| string
		| null;
	createdAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
	updatedAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
	agentExecutions?: Prisma.AgentExecutionUncheckedUpdateManyWithoutInvestigationNestedInput;
};
export type InvestigationCreateManyIncidentInput = {
	id?: string;
	status?: string;
	startedAt?: Date | string | null;
	completedAt?: Date | string | null;
	summary?: string | null;
	rootCause?: string | null;
	rootCauseCategory?: string | null;
	confidence?: number | null;
	dataQuality?: string | null;
	analysisMethod?: string | null;
	dataSourcesUsed?: string | null;
	rawOutput?: string | null;
	error?: string | null;
	agentProgression?: string | null;
	createdAt?: Date | string;
	updatedAt?: Date | string;
};
export type InvestigationUpdateWithoutIncidentInput = {
	id?: Prisma.StringFieldUpdateOperationsInput | string;
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
	summary?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	rootCause?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	rootCauseCategory?:
		| Prisma.NullableStringFieldUpdateOperationsInput
		| string
		| null;
	confidence?: Prisma.NullableFloatFieldUpdateOperationsInput | number | null;
	dataQuality?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	analysisMethod?:
		| Prisma.NullableStringFieldUpdateOperationsInput
		| string
		| null;
	dataSourcesUsed?:
		| Prisma.NullableStringFieldUpdateOperationsInput
		| string
		| null;
	rawOutput?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	error?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	agentProgression?:
		| Prisma.NullableStringFieldUpdateOperationsInput
		| string
		| null;
	createdAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
	updatedAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
	agentExecutions?: Prisma.AgentExecutionUpdateManyWithoutInvestigationNestedInput;
	recommendations?: Prisma.RecommendationUpdateManyWithoutInvestigationNestedInput;
};
export type InvestigationUncheckedUpdateWithoutIncidentInput = {
	id?: Prisma.StringFieldUpdateOperationsInput | string;
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
	summary?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	rootCause?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	rootCauseCategory?:
		| Prisma.NullableStringFieldUpdateOperationsInput
		| string
		| null;
	confidence?: Prisma.NullableFloatFieldUpdateOperationsInput | number | null;
	dataQuality?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	analysisMethod?:
		| Prisma.NullableStringFieldUpdateOperationsInput
		| string
		| null;
	dataSourcesUsed?:
		| Prisma.NullableStringFieldUpdateOperationsInput
		| string
		| null;
	rawOutput?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	error?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	agentProgression?:
		| Prisma.NullableStringFieldUpdateOperationsInput
		| string
		| null;
	createdAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
	updatedAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
	agentExecutions?: Prisma.AgentExecutionUncheckedUpdateManyWithoutInvestigationNestedInput;
	recommendations?: Prisma.RecommendationUncheckedUpdateManyWithoutInvestigationNestedInput;
};
export type InvestigationUncheckedUpdateManyWithoutIncidentInput = {
	id?: Prisma.StringFieldUpdateOperationsInput | string;
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
	summary?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	rootCause?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	rootCauseCategory?:
		| Prisma.NullableStringFieldUpdateOperationsInput
		| string
		| null;
	confidence?: Prisma.NullableFloatFieldUpdateOperationsInput | number | null;
	dataQuality?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	analysisMethod?:
		| Prisma.NullableStringFieldUpdateOperationsInput
		| string
		| null;
	dataSourcesUsed?:
		| Prisma.NullableStringFieldUpdateOperationsInput
		| string
		| null;
	rawOutput?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	error?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	agentProgression?:
		| Prisma.NullableStringFieldUpdateOperationsInput
		| string
		| null;
	createdAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
	updatedAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
};
export type InvestigationCountOutputType = {
	agentExecutions: number;
	recommendations: number;
};
export type InvestigationCountOutputTypeSelect<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	agentExecutions?:
		| boolean
		| InvestigationCountOutputTypeCountAgentExecutionsArgs;
	recommendations?:
		| boolean
		| InvestigationCountOutputTypeCountRecommendationsArgs;
};
export type InvestigationCountOutputTypeDefaultArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	select?: Prisma.InvestigationCountOutputTypeSelect<ExtArgs> | null;
};
export type InvestigationCountOutputTypeCountAgentExecutionsArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	where?: Prisma.AgentExecutionWhereInput;
};
export type InvestigationCountOutputTypeCountRecommendationsArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	where?: Prisma.RecommendationWhereInput;
};
export type InvestigationSelect<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = runtime.Types.Extensions.GetSelect<
	{
		id?: boolean;
		incidentId?: boolean;
		status?: boolean;
		startedAt?: boolean;
		completedAt?: boolean;
		summary?: boolean;
		rootCause?: boolean;
		rootCauseCategory?: boolean;
		confidence?: boolean;
		dataQuality?: boolean;
		analysisMethod?: boolean;
		dataSourcesUsed?: boolean;
		rawOutput?: boolean;
		error?: boolean;
		agentProgression?: boolean;
		createdAt?: boolean;
		updatedAt?: boolean;
		incident?: boolean | Prisma.IncidentDefaultArgs<ExtArgs>;
		agentExecutions?:
			| boolean
			| Prisma.Investigation$agentExecutionsArgs<ExtArgs>;
		recommendations?:
			| boolean
			| Prisma.Investigation$recommendationsArgs<ExtArgs>;
		_count?: boolean | Prisma.InvestigationCountOutputTypeDefaultArgs<ExtArgs>;
	},
	ExtArgs["result"]["investigation"]
>;
export type InvestigationSelectCreateManyAndReturn<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = runtime.Types.Extensions.GetSelect<
	{
		id?: boolean;
		incidentId?: boolean;
		status?: boolean;
		startedAt?: boolean;
		completedAt?: boolean;
		summary?: boolean;
		rootCause?: boolean;
		rootCauseCategory?: boolean;
		confidence?: boolean;
		dataQuality?: boolean;
		analysisMethod?: boolean;
		dataSourcesUsed?: boolean;
		rawOutput?: boolean;
		error?: boolean;
		agentProgression?: boolean;
		createdAt?: boolean;
		updatedAt?: boolean;
		incident?: boolean | Prisma.IncidentDefaultArgs<ExtArgs>;
	},
	ExtArgs["result"]["investigation"]
>;
export type InvestigationSelectUpdateManyAndReturn<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = runtime.Types.Extensions.GetSelect<
	{
		id?: boolean;
		incidentId?: boolean;
		status?: boolean;
		startedAt?: boolean;
		completedAt?: boolean;
		summary?: boolean;
		rootCause?: boolean;
		rootCauseCategory?: boolean;
		confidence?: boolean;
		dataQuality?: boolean;
		analysisMethod?: boolean;
		dataSourcesUsed?: boolean;
		rawOutput?: boolean;
		error?: boolean;
		agentProgression?: boolean;
		createdAt?: boolean;
		updatedAt?: boolean;
		incident?: boolean | Prisma.IncidentDefaultArgs<ExtArgs>;
	},
	ExtArgs["result"]["investigation"]
>;
export type InvestigationSelectScalar = {
	id?: boolean;
	incidentId?: boolean;
	status?: boolean;
	startedAt?: boolean;
	completedAt?: boolean;
	summary?: boolean;
	rootCause?: boolean;
	rootCauseCategory?: boolean;
	confidence?: boolean;
	dataQuality?: boolean;
	analysisMethod?: boolean;
	dataSourcesUsed?: boolean;
	rawOutput?: boolean;
	error?: boolean;
	agentProgression?: boolean;
	createdAt?: boolean;
	updatedAt?: boolean;
};
export type InvestigationOmit<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = runtime.Types.Extensions.GetOmit<
	| "id"
	| "incidentId"
	| "status"
	| "startedAt"
	| "completedAt"
	| "summary"
	| "rootCause"
	| "rootCauseCategory"
	| "confidence"
	| "dataQuality"
	| "analysisMethod"
	| "dataSourcesUsed"
	| "rawOutput"
	| "error"
	| "agentProgression"
	| "createdAt"
	| "updatedAt",
	ExtArgs["result"]["investigation"]
>;
export type InvestigationInclude<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	incident?: boolean | Prisma.IncidentDefaultArgs<ExtArgs>;
	agentExecutions?: boolean | Prisma.Investigation$agentExecutionsArgs<ExtArgs>;
	recommendations?: boolean | Prisma.Investigation$recommendationsArgs<ExtArgs>;
	_count?: boolean | Prisma.InvestigationCountOutputTypeDefaultArgs<ExtArgs>;
};
export type InvestigationIncludeCreateManyAndReturn<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	incident?: boolean | Prisma.IncidentDefaultArgs<ExtArgs>;
};
export type InvestigationIncludeUpdateManyAndReturn<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	incident?: boolean | Prisma.IncidentDefaultArgs<ExtArgs>;
};
export type $InvestigationPayload<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	name: "Investigation";
	objects: {
		incident: Prisma.$IncidentPayload<ExtArgs>;
		agentExecutions: Prisma.$AgentExecutionPayload<ExtArgs>[];
		recommendations: Prisma.$RecommendationPayload<ExtArgs>[];
	};
	scalars: runtime.Types.Extensions.GetPayloadResult<
		{
			id: string;
			incidentId: string;
			status: string;
			startedAt: Date | null;
			completedAt: Date | null;
			summary: string | null;
			rootCause: string | null;
			rootCauseCategory: string | null;
			confidence: number | null;
			dataQuality: string | null;
			analysisMethod: string | null;
			dataSourcesUsed: string | null;
			rawOutput: string | null;
			error: string | null;
			agentProgression: string | null;
			createdAt: Date;
			updatedAt: Date;
		},
		ExtArgs["result"]["investigation"]
	>;
	composites: {};
};
export type InvestigationGetPayload<
	S extends boolean | null | undefined | InvestigationDefaultArgs,
> = runtime.Types.Result.GetResult<Prisma.$InvestigationPayload, S>;
export type InvestigationCountArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = Omit<
	InvestigationFindManyArgs,
	"select" | "include" | "distinct" | "omit"
> & {
	select?: InvestigationCountAggregateInputType | true;
};
export interface InvestigationDelegate<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
	GlobalOmitOptions = {},
> {
	[K: symbol]: {
		types: Prisma.TypeMap<ExtArgs>["model"]["Investigation"];
		meta: {
			name: "Investigation";
		};
	};
	findUnique<T extends InvestigationFindUniqueArgs>(
		args: Prisma.SelectSubset<T, InvestigationFindUniqueArgs<ExtArgs>>,
	): Prisma.Prisma__InvestigationClient<
		runtime.Types.Result.GetResult<
			Prisma.$InvestigationPayload<ExtArgs>,
			T,
			"findUnique",
			GlobalOmitOptions
		> | null,
		null,
		ExtArgs,
		GlobalOmitOptions
	>;
	findUniqueOrThrow<T extends InvestigationFindUniqueOrThrowArgs>(
		args: Prisma.SelectSubset<T, InvestigationFindUniqueOrThrowArgs<ExtArgs>>,
	): Prisma.Prisma__InvestigationClient<
		runtime.Types.Result.GetResult<
			Prisma.$InvestigationPayload<ExtArgs>,
			T,
			"findUniqueOrThrow",
			GlobalOmitOptions
		>,
		never,
		ExtArgs,
		GlobalOmitOptions
	>;
	findFirst<T extends InvestigationFindFirstArgs>(
		args?: Prisma.SelectSubset<T, InvestigationFindFirstArgs<ExtArgs>>,
	): Prisma.Prisma__InvestigationClient<
		runtime.Types.Result.GetResult<
			Prisma.$InvestigationPayload<ExtArgs>,
			T,
			"findFirst",
			GlobalOmitOptions
		> | null,
		null,
		ExtArgs,
		GlobalOmitOptions
	>;
	findFirstOrThrow<T extends InvestigationFindFirstOrThrowArgs>(
		args?: Prisma.SelectSubset<T, InvestigationFindFirstOrThrowArgs<ExtArgs>>,
	): Prisma.Prisma__InvestigationClient<
		runtime.Types.Result.GetResult<
			Prisma.$InvestigationPayload<ExtArgs>,
			T,
			"findFirstOrThrow",
			GlobalOmitOptions
		>,
		never,
		ExtArgs,
		GlobalOmitOptions
	>;
	findMany<T extends InvestigationFindManyArgs>(
		args?: Prisma.SelectSubset<T, InvestigationFindManyArgs<ExtArgs>>,
	): Prisma.PrismaPromise<
		runtime.Types.Result.GetResult<
			Prisma.$InvestigationPayload<ExtArgs>,
			T,
			"findMany",
			GlobalOmitOptions
		>
	>;
	create<T extends InvestigationCreateArgs>(
		args: Prisma.SelectSubset<T, InvestigationCreateArgs<ExtArgs>>,
	): Prisma.Prisma__InvestigationClient<
		runtime.Types.Result.GetResult<
			Prisma.$InvestigationPayload<ExtArgs>,
			T,
			"create",
			GlobalOmitOptions
		>,
		never,
		ExtArgs,
		GlobalOmitOptions
	>;
	createMany<T extends InvestigationCreateManyArgs>(
		args?: Prisma.SelectSubset<T, InvestigationCreateManyArgs<ExtArgs>>,
	): Prisma.PrismaPromise<Prisma.BatchPayload>;
	createManyAndReturn<T extends InvestigationCreateManyAndReturnArgs>(
		args?: Prisma.SelectSubset<
			T,
			InvestigationCreateManyAndReturnArgs<ExtArgs>
		>,
	): Prisma.PrismaPromise<
		runtime.Types.Result.GetResult<
			Prisma.$InvestigationPayload<ExtArgs>,
			T,
			"createManyAndReturn",
			GlobalOmitOptions
		>
	>;
	delete<T extends InvestigationDeleteArgs>(
		args: Prisma.SelectSubset<T, InvestigationDeleteArgs<ExtArgs>>,
	): Prisma.Prisma__InvestigationClient<
		runtime.Types.Result.GetResult<
			Prisma.$InvestigationPayload<ExtArgs>,
			T,
			"delete",
			GlobalOmitOptions
		>,
		never,
		ExtArgs,
		GlobalOmitOptions
	>;
	update<T extends InvestigationUpdateArgs>(
		args: Prisma.SelectSubset<T, InvestigationUpdateArgs<ExtArgs>>,
	): Prisma.Prisma__InvestigationClient<
		runtime.Types.Result.GetResult<
			Prisma.$InvestigationPayload<ExtArgs>,
			T,
			"update",
			GlobalOmitOptions
		>,
		never,
		ExtArgs,
		GlobalOmitOptions
	>;
	deleteMany<T extends InvestigationDeleteManyArgs>(
		args?: Prisma.SelectSubset<T, InvestigationDeleteManyArgs<ExtArgs>>,
	): Prisma.PrismaPromise<Prisma.BatchPayload>;
	updateMany<T extends InvestigationUpdateManyArgs>(
		args: Prisma.SelectSubset<T, InvestigationUpdateManyArgs<ExtArgs>>,
	): Prisma.PrismaPromise<Prisma.BatchPayload>;
	updateManyAndReturn<T extends InvestigationUpdateManyAndReturnArgs>(
		args: Prisma.SelectSubset<T, InvestigationUpdateManyAndReturnArgs<ExtArgs>>,
	): Prisma.PrismaPromise<
		runtime.Types.Result.GetResult<
			Prisma.$InvestigationPayload<ExtArgs>,
			T,
			"updateManyAndReturn",
			GlobalOmitOptions
		>
	>;
	upsert<T extends InvestigationUpsertArgs>(
		args: Prisma.SelectSubset<T, InvestigationUpsertArgs<ExtArgs>>,
	): Prisma.Prisma__InvestigationClient<
		runtime.Types.Result.GetResult<
			Prisma.$InvestigationPayload<ExtArgs>,
			T,
			"upsert",
			GlobalOmitOptions
		>,
		never,
		ExtArgs,
		GlobalOmitOptions
	>;
	count<T extends InvestigationCountArgs>(
		args?: Prisma.Subset<T, InvestigationCountArgs>,
	): Prisma.PrismaPromise<
		T extends runtime.Types.Utils.Record<"select", any>
			? T["select"] extends true
				? number
				: Prisma.GetScalarType<
						T["select"],
						InvestigationCountAggregateOutputType
					>
			: number
	>;
	aggregate<T extends InvestigationAggregateArgs>(
		args: Prisma.Subset<T, InvestigationAggregateArgs>,
	): Prisma.PrismaPromise<GetInvestigationAggregateType<T>>;
	groupBy<
		T extends InvestigationGroupByArgs,
		HasSelectOrTake extends Prisma.Or<
			Prisma.Extends<"skip", Prisma.Keys<T>>,
			Prisma.Extends<"take", Prisma.Keys<T>>
		>,
		OrderByArg extends Prisma.True extends HasSelectOrTake
			? {
					orderBy: InvestigationGroupByArgs["orderBy"];
				}
			: {
					orderBy?: InvestigationGroupByArgs["orderBy"];
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
		args: Prisma.SubsetIntersection<T, InvestigationGroupByArgs, OrderByArg> &
			InputErrors,
	): {} extends InputErrors
		? GetInvestigationGroupByPayload<T>
		: Prisma.PrismaPromise<InputErrors>;
	readonly fields: InvestigationFieldRefs;
}
export interface Prisma__InvestigationClient<
	T,
	Null = never,
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
	GlobalOmitOptions = {},
> extends Prisma.PrismaPromise<T> {
	readonly [Symbol.toStringTag]: "PrismaPromise";
	incident<T extends Prisma.IncidentDefaultArgs<ExtArgs> = {}>(
		args?: Prisma.Subset<T, Prisma.IncidentDefaultArgs<ExtArgs>>,
	): Prisma.Prisma__IncidentClient<
		| runtime.Types.Result.GetResult<
				Prisma.$IncidentPayload<ExtArgs>,
				T,
				"findUniqueOrThrow",
				GlobalOmitOptions
		  >
		| Null,
		Null,
		ExtArgs,
		GlobalOmitOptions
	>;
	agentExecutions<
		T extends Prisma.Investigation$agentExecutionsArgs<ExtArgs> = {},
	>(
		args?: Prisma.Subset<T, Prisma.Investigation$agentExecutionsArgs<ExtArgs>>,
	): Prisma.PrismaPromise<
		| runtime.Types.Result.GetResult<
				Prisma.$AgentExecutionPayload<ExtArgs>,
				T,
				"findMany",
				GlobalOmitOptions
		  >
		| Null
	>;
	recommendations<
		T extends Prisma.Investigation$recommendationsArgs<ExtArgs> = {},
	>(
		args?: Prisma.Subset<T, Prisma.Investigation$recommendationsArgs<ExtArgs>>,
	): Prisma.PrismaPromise<
		| runtime.Types.Result.GetResult<
				Prisma.$RecommendationPayload<ExtArgs>,
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
export interface InvestigationFieldRefs {
	readonly id: Prisma.FieldRef<"Investigation", "String">;
	readonly incidentId: Prisma.FieldRef<"Investigation", "String">;
	readonly status: Prisma.FieldRef<"Investigation", "String">;
	readonly startedAt: Prisma.FieldRef<"Investigation", "DateTime">;
	readonly completedAt: Prisma.FieldRef<"Investigation", "DateTime">;
	readonly summary: Prisma.FieldRef<"Investigation", "String">;
	readonly rootCause: Prisma.FieldRef<"Investigation", "String">;
	readonly rootCauseCategory: Prisma.FieldRef<"Investigation", "String">;
	readonly confidence: Prisma.FieldRef<"Investigation", "Float">;
	readonly dataQuality: Prisma.FieldRef<"Investigation", "String">;
	readonly analysisMethod: Prisma.FieldRef<"Investigation", "String">;
	readonly dataSourcesUsed: Prisma.FieldRef<"Investigation", "String">;
	readonly rawOutput: Prisma.FieldRef<"Investigation", "String">;
	readonly error: Prisma.FieldRef<"Investigation", "String">;
	readonly agentProgression: Prisma.FieldRef<"Investigation", "String">;
	readonly createdAt: Prisma.FieldRef<"Investigation", "DateTime">;
	readonly updatedAt: Prisma.FieldRef<"Investigation", "DateTime">;
}
export type InvestigationFindUniqueArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	select?: Prisma.InvestigationSelect<ExtArgs> | null;
	omit?: Prisma.InvestigationOmit<ExtArgs> | null;
	include?: Prisma.InvestigationInclude<ExtArgs> | null;
	where: Prisma.InvestigationWhereUniqueInput;
};
export type InvestigationFindUniqueOrThrowArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	select?: Prisma.InvestigationSelect<ExtArgs> | null;
	omit?: Prisma.InvestigationOmit<ExtArgs> | null;
	include?: Prisma.InvestigationInclude<ExtArgs> | null;
	where: Prisma.InvestigationWhereUniqueInput;
};
export type InvestigationFindFirstArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	select?: Prisma.InvestigationSelect<ExtArgs> | null;
	omit?: Prisma.InvestigationOmit<ExtArgs> | null;
	include?: Prisma.InvestigationInclude<ExtArgs> | null;
	where?: Prisma.InvestigationWhereInput;
	orderBy?:
		| Prisma.InvestigationOrderByWithRelationInput
		| Prisma.InvestigationOrderByWithRelationInput[];
	cursor?: Prisma.InvestigationWhereUniqueInput;
	take?: number;
	skip?: number;
	distinct?:
		| Prisma.InvestigationScalarFieldEnum
		| Prisma.InvestigationScalarFieldEnum[];
};
export type InvestigationFindFirstOrThrowArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	select?: Prisma.InvestigationSelect<ExtArgs> | null;
	omit?: Prisma.InvestigationOmit<ExtArgs> | null;
	include?: Prisma.InvestigationInclude<ExtArgs> | null;
	where?: Prisma.InvestigationWhereInput;
	orderBy?:
		| Prisma.InvestigationOrderByWithRelationInput
		| Prisma.InvestigationOrderByWithRelationInput[];
	cursor?: Prisma.InvestigationWhereUniqueInput;
	take?: number;
	skip?: number;
	distinct?:
		| Prisma.InvestigationScalarFieldEnum
		| Prisma.InvestigationScalarFieldEnum[];
};
export type InvestigationFindManyArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	select?: Prisma.InvestigationSelect<ExtArgs> | null;
	omit?: Prisma.InvestigationOmit<ExtArgs> | null;
	include?: Prisma.InvestigationInclude<ExtArgs> | null;
	where?: Prisma.InvestigationWhereInput;
	orderBy?:
		| Prisma.InvestigationOrderByWithRelationInput
		| Prisma.InvestigationOrderByWithRelationInput[];
	cursor?: Prisma.InvestigationWhereUniqueInput;
	take?: number;
	skip?: number;
	distinct?:
		| Prisma.InvestigationScalarFieldEnum
		| Prisma.InvestigationScalarFieldEnum[];
};
export type InvestigationCreateArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	select?: Prisma.InvestigationSelect<ExtArgs> | null;
	omit?: Prisma.InvestigationOmit<ExtArgs> | null;
	include?: Prisma.InvestigationInclude<ExtArgs> | null;
	data: Prisma.XOR<
		Prisma.InvestigationCreateInput,
		Prisma.InvestigationUncheckedCreateInput
	>;
};
export type InvestigationCreateManyArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	data:
		| Prisma.InvestigationCreateManyInput
		| Prisma.InvestigationCreateManyInput[];
};
export type InvestigationCreateManyAndReturnArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	select?: Prisma.InvestigationSelectCreateManyAndReturn<ExtArgs> | null;
	omit?: Prisma.InvestigationOmit<ExtArgs> | null;
	data:
		| Prisma.InvestigationCreateManyInput
		| Prisma.InvestigationCreateManyInput[];
	include?: Prisma.InvestigationIncludeCreateManyAndReturn<ExtArgs> | null;
};
export type InvestigationUpdateArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	select?: Prisma.InvestigationSelect<ExtArgs> | null;
	omit?: Prisma.InvestigationOmit<ExtArgs> | null;
	include?: Prisma.InvestigationInclude<ExtArgs> | null;
	data: Prisma.XOR<
		Prisma.InvestigationUpdateInput,
		Prisma.InvestigationUncheckedUpdateInput
	>;
	where: Prisma.InvestigationWhereUniqueInput;
};
export type InvestigationUpdateManyArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	data: Prisma.XOR<
		Prisma.InvestigationUpdateManyMutationInput,
		Prisma.InvestigationUncheckedUpdateManyInput
	>;
	where?: Prisma.InvestigationWhereInput;
	limit?: number;
};
export type InvestigationUpdateManyAndReturnArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	select?: Prisma.InvestigationSelectUpdateManyAndReturn<ExtArgs> | null;
	omit?: Prisma.InvestigationOmit<ExtArgs> | null;
	data: Prisma.XOR<
		Prisma.InvestigationUpdateManyMutationInput,
		Prisma.InvestigationUncheckedUpdateManyInput
	>;
	where?: Prisma.InvestigationWhereInput;
	limit?: number;
	include?: Prisma.InvestigationIncludeUpdateManyAndReturn<ExtArgs> | null;
};
export type InvestigationUpsertArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	select?: Prisma.InvestigationSelect<ExtArgs> | null;
	omit?: Prisma.InvestigationOmit<ExtArgs> | null;
	include?: Prisma.InvestigationInclude<ExtArgs> | null;
	where: Prisma.InvestigationWhereUniqueInput;
	create: Prisma.XOR<
		Prisma.InvestigationCreateInput,
		Prisma.InvestigationUncheckedCreateInput
	>;
	update: Prisma.XOR<
		Prisma.InvestigationUpdateInput,
		Prisma.InvestigationUncheckedUpdateInput
	>;
};
export type InvestigationDeleteArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	select?: Prisma.InvestigationSelect<ExtArgs> | null;
	omit?: Prisma.InvestigationOmit<ExtArgs> | null;
	include?: Prisma.InvestigationInclude<ExtArgs> | null;
	where: Prisma.InvestigationWhereUniqueInput;
};
export type InvestigationDeleteManyArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	where?: Prisma.InvestigationWhereInput;
	limit?: number;
};
export type Investigation$agentExecutionsArgs<
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
export type Investigation$recommendationsArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	select?: Prisma.RecommendationSelect<ExtArgs> | null;
	omit?: Prisma.RecommendationOmit<ExtArgs> | null;
	include?: Prisma.RecommendationInclude<ExtArgs> | null;
	where?: Prisma.RecommendationWhereInput;
	orderBy?:
		| Prisma.RecommendationOrderByWithRelationInput
		| Prisma.RecommendationOrderByWithRelationInput[];
	cursor?: Prisma.RecommendationWhereUniqueInput;
	take?: number;
	skip?: number;
	distinct?:
		| Prisma.RecommendationScalarFieldEnum
		| Prisma.RecommendationScalarFieldEnum[];
};
export type InvestigationDefaultArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	select?: Prisma.InvestigationSelect<ExtArgs> | null;
	omit?: Prisma.InvestigationOmit<ExtArgs> | null;
	include?: Prisma.InvestigationInclude<ExtArgs> | null;
};
