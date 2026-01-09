import type * as runtime from "@prisma/client/runtime/client";
import type * as Prisma from "../internal/prismaNamespace.js";
export type RecommendationModel =
	runtime.Types.Result.DefaultSelection<Prisma.$RecommendationPayload>;
export type AggregateRecommendation = {
	_count: RecommendationCountAggregateOutputType | null;
	_min: RecommendationMinAggregateOutputType | null;
	_max: RecommendationMaxAggregateOutputType | null;
};
export type RecommendationMinAggregateOutputType = {
	id: string | null;
	investigationId: string | null;
	title: string | null;
	description: string | null;
	priority: string | null;
	category: string | null;
	urgency: string | null;
	actionable: boolean | null;
	estimatedEffort: string | null;
	status: string | null;
	implementedAt: Date | null;
	implementedBy: string | null;
	createdAt: Date | null;
	updatedAt: Date | null;
};
export type RecommendationMaxAggregateOutputType = {
	id: string | null;
	investigationId: string | null;
	title: string | null;
	description: string | null;
	priority: string | null;
	category: string | null;
	urgency: string | null;
	actionable: boolean | null;
	estimatedEffort: string | null;
	status: string | null;
	implementedAt: Date | null;
	implementedBy: string | null;
	createdAt: Date | null;
	updatedAt: Date | null;
};
export type RecommendationCountAggregateOutputType = {
	id: number;
	investigationId: number;
	title: number;
	description: number;
	priority: number;
	category: number;
	urgency: number;
	actionable: number;
	estimatedEffort: number;
	status: number;
	implementedAt: number;
	implementedBy: number;
	createdAt: number;
	updatedAt: number;
	_all: number;
};
export type RecommendationMinAggregateInputType = {
	id?: true;
	investigationId?: true;
	title?: true;
	description?: true;
	priority?: true;
	category?: true;
	urgency?: true;
	actionable?: true;
	estimatedEffort?: true;
	status?: true;
	implementedAt?: true;
	implementedBy?: true;
	createdAt?: true;
	updatedAt?: true;
};
export type RecommendationMaxAggregateInputType = {
	id?: true;
	investigationId?: true;
	title?: true;
	description?: true;
	priority?: true;
	category?: true;
	urgency?: true;
	actionable?: true;
	estimatedEffort?: true;
	status?: true;
	implementedAt?: true;
	implementedBy?: true;
	createdAt?: true;
	updatedAt?: true;
};
export type RecommendationCountAggregateInputType = {
	id?: true;
	investigationId?: true;
	title?: true;
	description?: true;
	priority?: true;
	category?: true;
	urgency?: true;
	actionable?: true;
	estimatedEffort?: true;
	status?: true;
	implementedAt?: true;
	implementedBy?: true;
	createdAt?: true;
	updatedAt?: true;
	_all?: true;
};
export type RecommendationAggregateArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	where?: Prisma.RecommendationWhereInput;
	orderBy?:
		| Prisma.RecommendationOrderByWithRelationInput
		| Prisma.RecommendationOrderByWithRelationInput[];
	cursor?: Prisma.RecommendationWhereUniqueInput;
	take?: number;
	skip?: number;
	_count?: true | RecommendationCountAggregateInputType;
	_min?: RecommendationMinAggregateInputType;
	_max?: RecommendationMaxAggregateInputType;
};
export type GetRecommendationAggregateType<
	T extends RecommendationAggregateArgs,
> = {
	[P in keyof T & keyof AggregateRecommendation]: P extends "_count" | "count"
		? T[P] extends true
			? number
			: Prisma.GetScalarType<T[P], AggregateRecommendation[P]>
		: Prisma.GetScalarType<T[P], AggregateRecommendation[P]>;
};
export type RecommendationGroupByArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	where?: Prisma.RecommendationWhereInput;
	orderBy?:
		| Prisma.RecommendationOrderByWithAggregationInput
		| Prisma.RecommendationOrderByWithAggregationInput[];
	by:
		| Prisma.RecommendationScalarFieldEnum[]
		| Prisma.RecommendationScalarFieldEnum;
	having?: Prisma.RecommendationScalarWhereWithAggregatesInput;
	take?: number;
	skip?: number;
	_count?: RecommendationCountAggregateInputType | true;
	_min?: RecommendationMinAggregateInputType;
	_max?: RecommendationMaxAggregateInputType;
};
export type RecommendationGroupByOutputType = {
	id: string;
	investigationId: string;
	title: string;
	description: string | null;
	priority: string;
	category: string | null;
	urgency: string | null;
	actionable: boolean;
	estimatedEffort: string | null;
	status: string;
	implementedAt: Date | null;
	implementedBy: string | null;
	createdAt: Date;
	updatedAt: Date;
	_count: RecommendationCountAggregateOutputType | null;
	_min: RecommendationMinAggregateOutputType | null;
	_max: RecommendationMaxAggregateOutputType | null;
};
type GetRecommendationGroupByPayload<T extends RecommendationGroupByArgs> =
	Prisma.PrismaPromise<
		Array<
			Prisma.PickEnumerable<RecommendationGroupByOutputType, T["by"]> & {
				[P in keyof T &
					keyof RecommendationGroupByOutputType]: P extends "_count"
					? T[P] extends boolean
						? number
						: Prisma.GetScalarType<T[P], RecommendationGroupByOutputType[P]>
					: Prisma.GetScalarType<T[P], RecommendationGroupByOutputType[P]>;
			}
		>
	>;
export type RecommendationWhereInput = {
	AND?: Prisma.RecommendationWhereInput | Prisma.RecommendationWhereInput[];
	OR?: Prisma.RecommendationWhereInput[];
	NOT?: Prisma.RecommendationWhereInput | Prisma.RecommendationWhereInput[];
	id?: Prisma.StringFilter<"Recommendation"> | string;
	investigationId?: Prisma.StringFilter<"Recommendation"> | string;
	title?: Prisma.StringFilter<"Recommendation"> | string;
	description?: Prisma.StringNullableFilter<"Recommendation"> | string | null;
	priority?: Prisma.StringFilter<"Recommendation"> | string;
	category?: Prisma.StringNullableFilter<"Recommendation"> | string | null;
	urgency?: Prisma.StringNullableFilter<"Recommendation"> | string | null;
	actionable?: Prisma.BoolFilter<"Recommendation"> | boolean;
	estimatedEffort?:
		| Prisma.StringNullableFilter<"Recommendation">
		| string
		| null;
	status?: Prisma.StringFilter<"Recommendation"> | string;
	implementedAt?:
		| Prisma.DateTimeNullableFilter<"Recommendation">
		| Date
		| string
		| null;
	implementedBy?: Prisma.StringNullableFilter<"Recommendation"> | string | null;
	createdAt?: Prisma.DateTimeFilter<"Recommendation"> | Date | string;
	updatedAt?: Prisma.DateTimeFilter<"Recommendation"> | Date | string;
	investigation?: Prisma.XOR<
		Prisma.InvestigationScalarRelationFilter,
		Prisma.InvestigationWhereInput
	>;
};
export type RecommendationOrderByWithRelationInput = {
	id?: Prisma.SortOrder;
	investigationId?: Prisma.SortOrder;
	title?: Prisma.SortOrder;
	description?: Prisma.SortOrderInput | Prisma.SortOrder;
	priority?: Prisma.SortOrder;
	category?: Prisma.SortOrderInput | Prisma.SortOrder;
	urgency?: Prisma.SortOrderInput | Prisma.SortOrder;
	actionable?: Prisma.SortOrder;
	estimatedEffort?: Prisma.SortOrderInput | Prisma.SortOrder;
	status?: Prisma.SortOrder;
	implementedAt?: Prisma.SortOrderInput | Prisma.SortOrder;
	implementedBy?: Prisma.SortOrderInput | Prisma.SortOrder;
	createdAt?: Prisma.SortOrder;
	updatedAt?: Prisma.SortOrder;
	investigation?: Prisma.InvestigationOrderByWithRelationInput;
};
export type RecommendationWhereUniqueInput = Prisma.AtLeast<
	{
		id?: string;
		AND?: Prisma.RecommendationWhereInput | Prisma.RecommendationWhereInput[];
		OR?: Prisma.RecommendationWhereInput[];
		NOT?: Prisma.RecommendationWhereInput | Prisma.RecommendationWhereInput[];
		investigationId?: Prisma.StringFilter<"Recommendation"> | string;
		title?: Prisma.StringFilter<"Recommendation"> | string;
		description?: Prisma.StringNullableFilter<"Recommendation"> | string | null;
		priority?: Prisma.StringFilter<"Recommendation"> | string;
		category?: Prisma.StringNullableFilter<"Recommendation"> | string | null;
		urgency?: Prisma.StringNullableFilter<"Recommendation"> | string | null;
		actionable?: Prisma.BoolFilter<"Recommendation"> | boolean;
		estimatedEffort?:
			| Prisma.StringNullableFilter<"Recommendation">
			| string
			| null;
		status?: Prisma.StringFilter<"Recommendation"> | string;
		implementedAt?:
			| Prisma.DateTimeNullableFilter<"Recommendation">
			| Date
			| string
			| null;
		implementedBy?:
			| Prisma.StringNullableFilter<"Recommendation">
			| string
			| null;
		createdAt?: Prisma.DateTimeFilter<"Recommendation"> | Date | string;
		updatedAt?: Prisma.DateTimeFilter<"Recommendation"> | Date | string;
		investigation?: Prisma.XOR<
			Prisma.InvestigationScalarRelationFilter,
			Prisma.InvestigationWhereInput
		>;
	},
	"id"
>;
export type RecommendationOrderByWithAggregationInput = {
	id?: Prisma.SortOrder;
	investigationId?: Prisma.SortOrder;
	title?: Prisma.SortOrder;
	description?: Prisma.SortOrderInput | Prisma.SortOrder;
	priority?: Prisma.SortOrder;
	category?: Prisma.SortOrderInput | Prisma.SortOrder;
	urgency?: Prisma.SortOrderInput | Prisma.SortOrder;
	actionable?: Prisma.SortOrder;
	estimatedEffort?: Prisma.SortOrderInput | Prisma.SortOrder;
	status?: Prisma.SortOrder;
	implementedAt?: Prisma.SortOrderInput | Prisma.SortOrder;
	implementedBy?: Prisma.SortOrderInput | Prisma.SortOrder;
	createdAt?: Prisma.SortOrder;
	updatedAt?: Prisma.SortOrder;
	_count?: Prisma.RecommendationCountOrderByAggregateInput;
	_max?: Prisma.RecommendationMaxOrderByAggregateInput;
	_min?: Prisma.RecommendationMinOrderByAggregateInput;
};
export type RecommendationScalarWhereWithAggregatesInput = {
	AND?:
		| Prisma.RecommendationScalarWhereWithAggregatesInput
		| Prisma.RecommendationScalarWhereWithAggregatesInput[];
	OR?: Prisma.RecommendationScalarWhereWithAggregatesInput[];
	NOT?:
		| Prisma.RecommendationScalarWhereWithAggregatesInput
		| Prisma.RecommendationScalarWhereWithAggregatesInput[];
	id?: Prisma.StringWithAggregatesFilter<"Recommendation"> | string;
	investigationId?:
		| Prisma.StringWithAggregatesFilter<"Recommendation">
		| string;
	title?: Prisma.StringWithAggregatesFilter<"Recommendation"> | string;
	description?:
		| Prisma.StringNullableWithAggregatesFilter<"Recommendation">
		| string
		| null;
	priority?: Prisma.StringWithAggregatesFilter<"Recommendation"> | string;
	category?:
		| Prisma.StringNullableWithAggregatesFilter<"Recommendation">
		| string
		| null;
	urgency?:
		| Prisma.StringNullableWithAggregatesFilter<"Recommendation">
		| string
		| null;
	actionable?: Prisma.BoolWithAggregatesFilter<"Recommendation"> | boolean;
	estimatedEffort?:
		| Prisma.StringNullableWithAggregatesFilter<"Recommendation">
		| string
		| null;
	status?: Prisma.StringWithAggregatesFilter<"Recommendation"> | string;
	implementedAt?:
		| Prisma.DateTimeNullableWithAggregatesFilter<"Recommendation">
		| Date
		| string
		| null;
	implementedBy?:
		| Prisma.StringNullableWithAggregatesFilter<"Recommendation">
		| string
		| null;
	createdAt?:
		| Prisma.DateTimeWithAggregatesFilter<"Recommendation">
		| Date
		| string;
	updatedAt?:
		| Prisma.DateTimeWithAggregatesFilter<"Recommendation">
		| Date
		| string;
};
export type RecommendationCreateInput = {
	id?: string;
	title: string;
	description?: string | null;
	priority?: string;
	category?: string | null;
	urgency?: string | null;
	actionable?: boolean;
	estimatedEffort?: string | null;
	status?: string;
	implementedAt?: Date | string | null;
	implementedBy?: string | null;
	createdAt?: Date | string;
	updatedAt?: Date | string;
	investigation: Prisma.InvestigationCreateNestedOneWithoutRecommendationsInput;
};
export type RecommendationUncheckedCreateInput = {
	id?: string;
	investigationId: string;
	title: string;
	description?: string | null;
	priority?: string;
	category?: string | null;
	urgency?: string | null;
	actionable?: boolean;
	estimatedEffort?: string | null;
	status?: string;
	implementedAt?: Date | string | null;
	implementedBy?: string | null;
	createdAt?: Date | string;
	updatedAt?: Date | string;
};
export type RecommendationUpdateInput = {
	id?: Prisma.StringFieldUpdateOperationsInput | string;
	title?: Prisma.StringFieldUpdateOperationsInput | string;
	description?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	priority?: Prisma.StringFieldUpdateOperationsInput | string;
	category?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	urgency?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	actionable?: Prisma.BoolFieldUpdateOperationsInput | boolean;
	estimatedEffort?:
		| Prisma.NullableStringFieldUpdateOperationsInput
		| string
		| null;
	status?: Prisma.StringFieldUpdateOperationsInput | string;
	implementedAt?:
		| Prisma.NullableDateTimeFieldUpdateOperationsInput
		| Date
		| string
		| null;
	implementedBy?:
		| Prisma.NullableStringFieldUpdateOperationsInput
		| string
		| null;
	createdAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
	updatedAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
	investigation?: Prisma.InvestigationUpdateOneRequiredWithoutRecommendationsNestedInput;
};
export type RecommendationUncheckedUpdateInput = {
	id?: Prisma.StringFieldUpdateOperationsInput | string;
	investigationId?: Prisma.StringFieldUpdateOperationsInput | string;
	title?: Prisma.StringFieldUpdateOperationsInput | string;
	description?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	priority?: Prisma.StringFieldUpdateOperationsInput | string;
	category?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	urgency?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	actionable?: Prisma.BoolFieldUpdateOperationsInput | boolean;
	estimatedEffort?:
		| Prisma.NullableStringFieldUpdateOperationsInput
		| string
		| null;
	status?: Prisma.StringFieldUpdateOperationsInput | string;
	implementedAt?:
		| Prisma.NullableDateTimeFieldUpdateOperationsInput
		| Date
		| string
		| null;
	implementedBy?:
		| Prisma.NullableStringFieldUpdateOperationsInput
		| string
		| null;
	createdAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
	updatedAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
};
export type RecommendationCreateManyInput = {
	id?: string;
	investigationId: string;
	title: string;
	description?: string | null;
	priority?: string;
	category?: string | null;
	urgency?: string | null;
	actionable?: boolean;
	estimatedEffort?: string | null;
	status?: string;
	implementedAt?: Date | string | null;
	implementedBy?: string | null;
	createdAt?: Date | string;
	updatedAt?: Date | string;
};
export type RecommendationUpdateManyMutationInput = {
	id?: Prisma.StringFieldUpdateOperationsInput | string;
	title?: Prisma.StringFieldUpdateOperationsInput | string;
	description?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	priority?: Prisma.StringFieldUpdateOperationsInput | string;
	category?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	urgency?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	actionable?: Prisma.BoolFieldUpdateOperationsInput | boolean;
	estimatedEffort?:
		| Prisma.NullableStringFieldUpdateOperationsInput
		| string
		| null;
	status?: Prisma.StringFieldUpdateOperationsInput | string;
	implementedAt?:
		| Prisma.NullableDateTimeFieldUpdateOperationsInput
		| Date
		| string
		| null;
	implementedBy?:
		| Prisma.NullableStringFieldUpdateOperationsInput
		| string
		| null;
	createdAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
	updatedAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
};
export type RecommendationUncheckedUpdateManyInput = {
	id?: Prisma.StringFieldUpdateOperationsInput | string;
	investigationId?: Prisma.StringFieldUpdateOperationsInput | string;
	title?: Prisma.StringFieldUpdateOperationsInput | string;
	description?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	priority?: Prisma.StringFieldUpdateOperationsInput | string;
	category?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	urgency?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	actionable?: Prisma.BoolFieldUpdateOperationsInput | boolean;
	estimatedEffort?:
		| Prisma.NullableStringFieldUpdateOperationsInput
		| string
		| null;
	status?: Prisma.StringFieldUpdateOperationsInput | string;
	implementedAt?:
		| Prisma.NullableDateTimeFieldUpdateOperationsInput
		| Date
		| string
		| null;
	implementedBy?:
		| Prisma.NullableStringFieldUpdateOperationsInput
		| string
		| null;
	createdAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
	updatedAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
};
export type RecommendationListRelationFilter = {
	every?: Prisma.RecommendationWhereInput;
	some?: Prisma.RecommendationWhereInput;
	none?: Prisma.RecommendationWhereInput;
};
export type RecommendationOrderByRelationAggregateInput = {
	_count?: Prisma.SortOrder;
};
export type RecommendationCountOrderByAggregateInput = {
	id?: Prisma.SortOrder;
	investigationId?: Prisma.SortOrder;
	title?: Prisma.SortOrder;
	description?: Prisma.SortOrder;
	priority?: Prisma.SortOrder;
	category?: Prisma.SortOrder;
	urgency?: Prisma.SortOrder;
	actionable?: Prisma.SortOrder;
	estimatedEffort?: Prisma.SortOrder;
	status?: Prisma.SortOrder;
	implementedAt?: Prisma.SortOrder;
	implementedBy?: Prisma.SortOrder;
	createdAt?: Prisma.SortOrder;
	updatedAt?: Prisma.SortOrder;
};
export type RecommendationMaxOrderByAggregateInput = {
	id?: Prisma.SortOrder;
	investigationId?: Prisma.SortOrder;
	title?: Prisma.SortOrder;
	description?: Prisma.SortOrder;
	priority?: Prisma.SortOrder;
	category?: Prisma.SortOrder;
	urgency?: Prisma.SortOrder;
	actionable?: Prisma.SortOrder;
	estimatedEffort?: Prisma.SortOrder;
	status?: Prisma.SortOrder;
	implementedAt?: Prisma.SortOrder;
	implementedBy?: Prisma.SortOrder;
	createdAt?: Prisma.SortOrder;
	updatedAt?: Prisma.SortOrder;
};
export type RecommendationMinOrderByAggregateInput = {
	id?: Prisma.SortOrder;
	investigationId?: Prisma.SortOrder;
	title?: Prisma.SortOrder;
	description?: Prisma.SortOrder;
	priority?: Prisma.SortOrder;
	category?: Prisma.SortOrder;
	urgency?: Prisma.SortOrder;
	actionable?: Prisma.SortOrder;
	estimatedEffort?: Prisma.SortOrder;
	status?: Prisma.SortOrder;
	implementedAt?: Prisma.SortOrder;
	implementedBy?: Prisma.SortOrder;
	createdAt?: Prisma.SortOrder;
	updatedAt?: Prisma.SortOrder;
};
export type RecommendationCreateNestedManyWithoutInvestigationInput = {
	create?:
		| Prisma.XOR<
				Prisma.RecommendationCreateWithoutInvestigationInput,
				Prisma.RecommendationUncheckedCreateWithoutInvestigationInput
		  >
		| Prisma.RecommendationCreateWithoutInvestigationInput[]
		| Prisma.RecommendationUncheckedCreateWithoutInvestigationInput[];
	connectOrCreate?:
		| Prisma.RecommendationCreateOrConnectWithoutInvestigationInput
		| Prisma.RecommendationCreateOrConnectWithoutInvestigationInput[];
	createMany?: Prisma.RecommendationCreateManyInvestigationInputEnvelope;
	connect?:
		| Prisma.RecommendationWhereUniqueInput
		| Prisma.RecommendationWhereUniqueInput[];
};
export type RecommendationUncheckedCreateNestedManyWithoutInvestigationInput = {
	create?:
		| Prisma.XOR<
				Prisma.RecommendationCreateWithoutInvestigationInput,
				Prisma.RecommendationUncheckedCreateWithoutInvestigationInput
		  >
		| Prisma.RecommendationCreateWithoutInvestigationInput[]
		| Prisma.RecommendationUncheckedCreateWithoutInvestigationInput[];
	connectOrCreate?:
		| Prisma.RecommendationCreateOrConnectWithoutInvestigationInput
		| Prisma.RecommendationCreateOrConnectWithoutInvestigationInput[];
	createMany?: Prisma.RecommendationCreateManyInvestigationInputEnvelope;
	connect?:
		| Prisma.RecommendationWhereUniqueInput
		| Prisma.RecommendationWhereUniqueInput[];
};
export type RecommendationUpdateManyWithoutInvestigationNestedInput = {
	create?:
		| Prisma.XOR<
				Prisma.RecommendationCreateWithoutInvestigationInput,
				Prisma.RecommendationUncheckedCreateWithoutInvestigationInput
		  >
		| Prisma.RecommendationCreateWithoutInvestigationInput[]
		| Prisma.RecommendationUncheckedCreateWithoutInvestigationInput[];
	connectOrCreate?:
		| Prisma.RecommendationCreateOrConnectWithoutInvestigationInput
		| Prisma.RecommendationCreateOrConnectWithoutInvestigationInput[];
	upsert?:
		| Prisma.RecommendationUpsertWithWhereUniqueWithoutInvestigationInput
		| Prisma.RecommendationUpsertWithWhereUniqueWithoutInvestigationInput[];
	createMany?: Prisma.RecommendationCreateManyInvestigationInputEnvelope;
	set?:
		| Prisma.RecommendationWhereUniqueInput
		| Prisma.RecommendationWhereUniqueInput[];
	disconnect?:
		| Prisma.RecommendationWhereUniqueInput
		| Prisma.RecommendationWhereUniqueInput[];
	delete?:
		| Prisma.RecommendationWhereUniqueInput
		| Prisma.RecommendationWhereUniqueInput[];
	connect?:
		| Prisma.RecommendationWhereUniqueInput
		| Prisma.RecommendationWhereUniqueInput[];
	update?:
		| Prisma.RecommendationUpdateWithWhereUniqueWithoutInvestigationInput
		| Prisma.RecommendationUpdateWithWhereUniqueWithoutInvestigationInput[];
	updateMany?:
		| Prisma.RecommendationUpdateManyWithWhereWithoutInvestigationInput
		| Prisma.RecommendationUpdateManyWithWhereWithoutInvestigationInput[];
	deleteMany?:
		| Prisma.RecommendationScalarWhereInput
		| Prisma.RecommendationScalarWhereInput[];
};
export type RecommendationUncheckedUpdateManyWithoutInvestigationNestedInput = {
	create?:
		| Prisma.XOR<
				Prisma.RecommendationCreateWithoutInvestigationInput,
				Prisma.RecommendationUncheckedCreateWithoutInvestigationInput
		  >
		| Prisma.RecommendationCreateWithoutInvestigationInput[]
		| Prisma.RecommendationUncheckedCreateWithoutInvestigationInput[];
	connectOrCreate?:
		| Prisma.RecommendationCreateOrConnectWithoutInvestigationInput
		| Prisma.RecommendationCreateOrConnectWithoutInvestigationInput[];
	upsert?:
		| Prisma.RecommendationUpsertWithWhereUniqueWithoutInvestigationInput
		| Prisma.RecommendationUpsertWithWhereUniqueWithoutInvestigationInput[];
	createMany?: Prisma.RecommendationCreateManyInvestigationInputEnvelope;
	set?:
		| Prisma.RecommendationWhereUniqueInput
		| Prisma.RecommendationWhereUniqueInput[];
	disconnect?:
		| Prisma.RecommendationWhereUniqueInput
		| Prisma.RecommendationWhereUniqueInput[];
	delete?:
		| Prisma.RecommendationWhereUniqueInput
		| Prisma.RecommendationWhereUniqueInput[];
	connect?:
		| Prisma.RecommendationWhereUniqueInput
		| Prisma.RecommendationWhereUniqueInput[];
	update?:
		| Prisma.RecommendationUpdateWithWhereUniqueWithoutInvestigationInput
		| Prisma.RecommendationUpdateWithWhereUniqueWithoutInvestigationInput[];
	updateMany?:
		| Prisma.RecommendationUpdateManyWithWhereWithoutInvestigationInput
		| Prisma.RecommendationUpdateManyWithWhereWithoutInvestigationInput[];
	deleteMany?:
		| Prisma.RecommendationScalarWhereInput
		| Prisma.RecommendationScalarWhereInput[];
};
export type RecommendationCreateWithoutInvestigationInput = {
	id?: string;
	title: string;
	description?: string | null;
	priority?: string;
	category?: string | null;
	urgency?: string | null;
	actionable?: boolean;
	estimatedEffort?: string | null;
	status?: string;
	implementedAt?: Date | string | null;
	implementedBy?: string | null;
	createdAt?: Date | string;
	updatedAt?: Date | string;
};
export type RecommendationUncheckedCreateWithoutInvestigationInput = {
	id?: string;
	title: string;
	description?: string | null;
	priority?: string;
	category?: string | null;
	urgency?: string | null;
	actionable?: boolean;
	estimatedEffort?: string | null;
	status?: string;
	implementedAt?: Date | string | null;
	implementedBy?: string | null;
	createdAt?: Date | string;
	updatedAt?: Date | string;
};
export type RecommendationCreateOrConnectWithoutInvestigationInput = {
	where: Prisma.RecommendationWhereUniqueInput;
	create: Prisma.XOR<
		Prisma.RecommendationCreateWithoutInvestigationInput,
		Prisma.RecommendationUncheckedCreateWithoutInvestigationInput
	>;
};
export type RecommendationCreateManyInvestigationInputEnvelope = {
	data:
		| Prisma.RecommendationCreateManyInvestigationInput
		| Prisma.RecommendationCreateManyInvestigationInput[];
};
export type RecommendationUpsertWithWhereUniqueWithoutInvestigationInput = {
	where: Prisma.RecommendationWhereUniqueInput;
	update: Prisma.XOR<
		Prisma.RecommendationUpdateWithoutInvestigationInput,
		Prisma.RecommendationUncheckedUpdateWithoutInvestigationInput
	>;
	create: Prisma.XOR<
		Prisma.RecommendationCreateWithoutInvestigationInput,
		Prisma.RecommendationUncheckedCreateWithoutInvestigationInput
	>;
};
export type RecommendationUpdateWithWhereUniqueWithoutInvestigationInput = {
	where: Prisma.RecommendationWhereUniqueInput;
	data: Prisma.XOR<
		Prisma.RecommendationUpdateWithoutInvestigationInput,
		Prisma.RecommendationUncheckedUpdateWithoutInvestigationInput
	>;
};
export type RecommendationUpdateManyWithWhereWithoutInvestigationInput = {
	where: Prisma.RecommendationScalarWhereInput;
	data: Prisma.XOR<
		Prisma.RecommendationUpdateManyMutationInput,
		Prisma.RecommendationUncheckedUpdateManyWithoutInvestigationInput
	>;
};
export type RecommendationScalarWhereInput = {
	AND?:
		| Prisma.RecommendationScalarWhereInput
		| Prisma.RecommendationScalarWhereInput[];
	OR?: Prisma.RecommendationScalarWhereInput[];
	NOT?:
		| Prisma.RecommendationScalarWhereInput
		| Prisma.RecommendationScalarWhereInput[];
	id?: Prisma.StringFilter<"Recommendation"> | string;
	investigationId?: Prisma.StringFilter<"Recommendation"> | string;
	title?: Prisma.StringFilter<"Recommendation"> | string;
	description?: Prisma.StringNullableFilter<"Recommendation"> | string | null;
	priority?: Prisma.StringFilter<"Recommendation"> | string;
	category?: Prisma.StringNullableFilter<"Recommendation"> | string | null;
	urgency?: Prisma.StringNullableFilter<"Recommendation"> | string | null;
	actionable?: Prisma.BoolFilter<"Recommendation"> | boolean;
	estimatedEffort?:
		| Prisma.StringNullableFilter<"Recommendation">
		| string
		| null;
	status?: Prisma.StringFilter<"Recommendation"> | string;
	implementedAt?:
		| Prisma.DateTimeNullableFilter<"Recommendation">
		| Date
		| string
		| null;
	implementedBy?: Prisma.StringNullableFilter<"Recommendation"> | string | null;
	createdAt?: Prisma.DateTimeFilter<"Recommendation"> | Date | string;
	updatedAt?: Prisma.DateTimeFilter<"Recommendation"> | Date | string;
};
export type RecommendationCreateManyInvestigationInput = {
	id?: string;
	title: string;
	description?: string | null;
	priority?: string;
	category?: string | null;
	urgency?: string | null;
	actionable?: boolean;
	estimatedEffort?: string | null;
	status?: string;
	implementedAt?: Date | string | null;
	implementedBy?: string | null;
	createdAt?: Date | string;
	updatedAt?: Date | string;
};
export type RecommendationUpdateWithoutInvestigationInput = {
	id?: Prisma.StringFieldUpdateOperationsInput | string;
	title?: Prisma.StringFieldUpdateOperationsInput | string;
	description?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	priority?: Prisma.StringFieldUpdateOperationsInput | string;
	category?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	urgency?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	actionable?: Prisma.BoolFieldUpdateOperationsInput | boolean;
	estimatedEffort?:
		| Prisma.NullableStringFieldUpdateOperationsInput
		| string
		| null;
	status?: Prisma.StringFieldUpdateOperationsInput | string;
	implementedAt?:
		| Prisma.NullableDateTimeFieldUpdateOperationsInput
		| Date
		| string
		| null;
	implementedBy?:
		| Prisma.NullableStringFieldUpdateOperationsInput
		| string
		| null;
	createdAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
	updatedAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
};
export type RecommendationUncheckedUpdateWithoutInvestigationInput = {
	id?: Prisma.StringFieldUpdateOperationsInput | string;
	title?: Prisma.StringFieldUpdateOperationsInput | string;
	description?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	priority?: Prisma.StringFieldUpdateOperationsInput | string;
	category?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	urgency?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	actionable?: Prisma.BoolFieldUpdateOperationsInput | boolean;
	estimatedEffort?:
		| Prisma.NullableStringFieldUpdateOperationsInput
		| string
		| null;
	status?: Prisma.StringFieldUpdateOperationsInput | string;
	implementedAt?:
		| Prisma.NullableDateTimeFieldUpdateOperationsInput
		| Date
		| string
		| null;
	implementedBy?:
		| Prisma.NullableStringFieldUpdateOperationsInput
		| string
		| null;
	createdAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
	updatedAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
};
export type RecommendationUncheckedUpdateManyWithoutInvestigationInput = {
	id?: Prisma.StringFieldUpdateOperationsInput | string;
	title?: Prisma.StringFieldUpdateOperationsInput | string;
	description?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	priority?: Prisma.StringFieldUpdateOperationsInput | string;
	category?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	urgency?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	actionable?: Prisma.BoolFieldUpdateOperationsInput | boolean;
	estimatedEffort?:
		| Prisma.NullableStringFieldUpdateOperationsInput
		| string
		| null;
	status?: Prisma.StringFieldUpdateOperationsInput | string;
	implementedAt?:
		| Prisma.NullableDateTimeFieldUpdateOperationsInput
		| Date
		| string
		| null;
	implementedBy?:
		| Prisma.NullableStringFieldUpdateOperationsInput
		| string
		| null;
	createdAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
	updatedAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
};
export type RecommendationSelect<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = runtime.Types.Extensions.GetSelect<
	{
		id?: boolean;
		investigationId?: boolean;
		title?: boolean;
		description?: boolean;
		priority?: boolean;
		category?: boolean;
		urgency?: boolean;
		actionable?: boolean;
		estimatedEffort?: boolean;
		status?: boolean;
		implementedAt?: boolean;
		implementedBy?: boolean;
		createdAt?: boolean;
		updatedAt?: boolean;
		investigation?: boolean | Prisma.InvestigationDefaultArgs<ExtArgs>;
	},
	ExtArgs["result"]["recommendation"]
>;
export type RecommendationSelectCreateManyAndReturn<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = runtime.Types.Extensions.GetSelect<
	{
		id?: boolean;
		investigationId?: boolean;
		title?: boolean;
		description?: boolean;
		priority?: boolean;
		category?: boolean;
		urgency?: boolean;
		actionable?: boolean;
		estimatedEffort?: boolean;
		status?: boolean;
		implementedAt?: boolean;
		implementedBy?: boolean;
		createdAt?: boolean;
		updatedAt?: boolean;
		investigation?: boolean | Prisma.InvestigationDefaultArgs<ExtArgs>;
	},
	ExtArgs["result"]["recommendation"]
>;
export type RecommendationSelectUpdateManyAndReturn<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = runtime.Types.Extensions.GetSelect<
	{
		id?: boolean;
		investigationId?: boolean;
		title?: boolean;
		description?: boolean;
		priority?: boolean;
		category?: boolean;
		urgency?: boolean;
		actionable?: boolean;
		estimatedEffort?: boolean;
		status?: boolean;
		implementedAt?: boolean;
		implementedBy?: boolean;
		createdAt?: boolean;
		updatedAt?: boolean;
		investigation?: boolean | Prisma.InvestigationDefaultArgs<ExtArgs>;
	},
	ExtArgs["result"]["recommendation"]
>;
export type RecommendationSelectScalar = {
	id?: boolean;
	investigationId?: boolean;
	title?: boolean;
	description?: boolean;
	priority?: boolean;
	category?: boolean;
	urgency?: boolean;
	actionable?: boolean;
	estimatedEffort?: boolean;
	status?: boolean;
	implementedAt?: boolean;
	implementedBy?: boolean;
	createdAt?: boolean;
	updatedAt?: boolean;
};
export type RecommendationOmit<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = runtime.Types.Extensions.GetOmit<
	| "id"
	| "investigationId"
	| "title"
	| "description"
	| "priority"
	| "category"
	| "urgency"
	| "actionable"
	| "estimatedEffort"
	| "status"
	| "implementedAt"
	| "implementedBy"
	| "createdAt"
	| "updatedAt",
	ExtArgs["result"]["recommendation"]
>;
export type RecommendationInclude<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	investigation?: boolean | Prisma.InvestigationDefaultArgs<ExtArgs>;
};
export type RecommendationIncludeCreateManyAndReturn<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	investigation?: boolean | Prisma.InvestigationDefaultArgs<ExtArgs>;
};
export type RecommendationIncludeUpdateManyAndReturn<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	investigation?: boolean | Prisma.InvestigationDefaultArgs<ExtArgs>;
};
export type $RecommendationPayload<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	name: "Recommendation";
	objects: {
		investigation: Prisma.$InvestigationPayload<ExtArgs>;
	};
	scalars: runtime.Types.Extensions.GetPayloadResult<
		{
			id: string;
			investigationId: string;
			title: string;
			description: string | null;
			priority: string;
			category: string | null;
			urgency: string | null;
			actionable: boolean;
			estimatedEffort: string | null;
			status: string;
			implementedAt: Date | null;
			implementedBy: string | null;
			createdAt: Date;
			updatedAt: Date;
		},
		ExtArgs["result"]["recommendation"]
	>;
	composites: {};
};
export type RecommendationGetPayload<
	S extends boolean | null | undefined | RecommendationDefaultArgs,
> = runtime.Types.Result.GetResult<Prisma.$RecommendationPayload, S>;
export type RecommendationCountArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = Omit<
	RecommendationFindManyArgs,
	"select" | "include" | "distinct" | "omit"
> & {
	select?: RecommendationCountAggregateInputType | true;
};
export interface RecommendationDelegate<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
	GlobalOmitOptions = {},
> {
	[K: symbol]: {
		types: Prisma.TypeMap<ExtArgs>["model"]["Recommendation"];
		meta: {
			name: "Recommendation";
		};
	};
	findUnique<T extends RecommendationFindUniqueArgs>(
		args: Prisma.SelectSubset<T, RecommendationFindUniqueArgs<ExtArgs>>,
	): Prisma.Prisma__RecommendationClient<
		runtime.Types.Result.GetResult<
			Prisma.$RecommendationPayload<ExtArgs>,
			T,
			"findUnique",
			GlobalOmitOptions
		> | null,
		null,
		ExtArgs,
		GlobalOmitOptions
	>;
	findUniqueOrThrow<T extends RecommendationFindUniqueOrThrowArgs>(
		args: Prisma.SelectSubset<T, RecommendationFindUniqueOrThrowArgs<ExtArgs>>,
	): Prisma.Prisma__RecommendationClient<
		runtime.Types.Result.GetResult<
			Prisma.$RecommendationPayload<ExtArgs>,
			T,
			"findUniqueOrThrow",
			GlobalOmitOptions
		>,
		never,
		ExtArgs,
		GlobalOmitOptions
	>;
	findFirst<T extends RecommendationFindFirstArgs>(
		args?: Prisma.SelectSubset<T, RecommendationFindFirstArgs<ExtArgs>>,
	): Prisma.Prisma__RecommendationClient<
		runtime.Types.Result.GetResult<
			Prisma.$RecommendationPayload<ExtArgs>,
			T,
			"findFirst",
			GlobalOmitOptions
		> | null,
		null,
		ExtArgs,
		GlobalOmitOptions
	>;
	findFirstOrThrow<T extends RecommendationFindFirstOrThrowArgs>(
		args?: Prisma.SelectSubset<T, RecommendationFindFirstOrThrowArgs<ExtArgs>>,
	): Prisma.Prisma__RecommendationClient<
		runtime.Types.Result.GetResult<
			Prisma.$RecommendationPayload<ExtArgs>,
			T,
			"findFirstOrThrow",
			GlobalOmitOptions
		>,
		never,
		ExtArgs,
		GlobalOmitOptions
	>;
	findMany<T extends RecommendationFindManyArgs>(
		args?: Prisma.SelectSubset<T, RecommendationFindManyArgs<ExtArgs>>,
	): Prisma.PrismaPromise<
		runtime.Types.Result.GetResult<
			Prisma.$RecommendationPayload<ExtArgs>,
			T,
			"findMany",
			GlobalOmitOptions
		>
	>;
	create<T extends RecommendationCreateArgs>(
		args: Prisma.SelectSubset<T, RecommendationCreateArgs<ExtArgs>>,
	): Prisma.Prisma__RecommendationClient<
		runtime.Types.Result.GetResult<
			Prisma.$RecommendationPayload<ExtArgs>,
			T,
			"create",
			GlobalOmitOptions
		>,
		never,
		ExtArgs,
		GlobalOmitOptions
	>;
	createMany<T extends RecommendationCreateManyArgs>(
		args?: Prisma.SelectSubset<T, RecommendationCreateManyArgs<ExtArgs>>,
	): Prisma.PrismaPromise<Prisma.BatchPayload>;
	createManyAndReturn<T extends RecommendationCreateManyAndReturnArgs>(
		args?: Prisma.SelectSubset<
			T,
			RecommendationCreateManyAndReturnArgs<ExtArgs>
		>,
	): Prisma.PrismaPromise<
		runtime.Types.Result.GetResult<
			Prisma.$RecommendationPayload<ExtArgs>,
			T,
			"createManyAndReturn",
			GlobalOmitOptions
		>
	>;
	delete<T extends RecommendationDeleteArgs>(
		args: Prisma.SelectSubset<T, RecommendationDeleteArgs<ExtArgs>>,
	): Prisma.Prisma__RecommendationClient<
		runtime.Types.Result.GetResult<
			Prisma.$RecommendationPayload<ExtArgs>,
			T,
			"delete",
			GlobalOmitOptions
		>,
		never,
		ExtArgs,
		GlobalOmitOptions
	>;
	update<T extends RecommendationUpdateArgs>(
		args: Prisma.SelectSubset<T, RecommendationUpdateArgs<ExtArgs>>,
	): Prisma.Prisma__RecommendationClient<
		runtime.Types.Result.GetResult<
			Prisma.$RecommendationPayload<ExtArgs>,
			T,
			"update",
			GlobalOmitOptions
		>,
		never,
		ExtArgs,
		GlobalOmitOptions
	>;
	deleteMany<T extends RecommendationDeleteManyArgs>(
		args?: Prisma.SelectSubset<T, RecommendationDeleteManyArgs<ExtArgs>>,
	): Prisma.PrismaPromise<Prisma.BatchPayload>;
	updateMany<T extends RecommendationUpdateManyArgs>(
		args: Prisma.SelectSubset<T, RecommendationUpdateManyArgs<ExtArgs>>,
	): Prisma.PrismaPromise<Prisma.BatchPayload>;
	updateManyAndReturn<T extends RecommendationUpdateManyAndReturnArgs>(
		args: Prisma.SelectSubset<
			T,
			RecommendationUpdateManyAndReturnArgs<ExtArgs>
		>,
	): Prisma.PrismaPromise<
		runtime.Types.Result.GetResult<
			Prisma.$RecommendationPayload<ExtArgs>,
			T,
			"updateManyAndReturn",
			GlobalOmitOptions
		>
	>;
	upsert<T extends RecommendationUpsertArgs>(
		args: Prisma.SelectSubset<T, RecommendationUpsertArgs<ExtArgs>>,
	): Prisma.Prisma__RecommendationClient<
		runtime.Types.Result.GetResult<
			Prisma.$RecommendationPayload<ExtArgs>,
			T,
			"upsert",
			GlobalOmitOptions
		>,
		never,
		ExtArgs,
		GlobalOmitOptions
	>;
	count<T extends RecommendationCountArgs>(
		args?: Prisma.Subset<T, RecommendationCountArgs>,
	): Prisma.PrismaPromise<
		T extends runtime.Types.Utils.Record<"select", any>
			? T["select"] extends true
				? number
				: Prisma.GetScalarType<
						T["select"],
						RecommendationCountAggregateOutputType
					>
			: number
	>;
	aggregate<T extends RecommendationAggregateArgs>(
		args: Prisma.Subset<T, RecommendationAggregateArgs>,
	): Prisma.PrismaPromise<GetRecommendationAggregateType<T>>;
	groupBy<
		T extends RecommendationGroupByArgs,
		HasSelectOrTake extends Prisma.Or<
			Prisma.Extends<"skip", Prisma.Keys<T>>,
			Prisma.Extends<"take", Prisma.Keys<T>>
		>,
		OrderByArg extends Prisma.True extends HasSelectOrTake
			? {
					orderBy: RecommendationGroupByArgs["orderBy"];
				}
			: {
					orderBy?: RecommendationGroupByArgs["orderBy"];
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
		args: Prisma.SubsetIntersection<T, RecommendationGroupByArgs, OrderByArg> &
			InputErrors,
	): {} extends InputErrors
		? GetRecommendationGroupByPayload<T>
		: Prisma.PrismaPromise<InputErrors>;
	readonly fields: RecommendationFieldRefs;
}
export interface Prisma__RecommendationClient<
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
export interface RecommendationFieldRefs {
	readonly id: Prisma.FieldRef<"Recommendation", "String">;
	readonly investigationId: Prisma.FieldRef<"Recommendation", "String">;
	readonly title: Prisma.FieldRef<"Recommendation", "String">;
	readonly description: Prisma.FieldRef<"Recommendation", "String">;
	readonly priority: Prisma.FieldRef<"Recommendation", "String">;
	readonly category: Prisma.FieldRef<"Recommendation", "String">;
	readonly urgency: Prisma.FieldRef<"Recommendation", "String">;
	readonly actionable: Prisma.FieldRef<"Recommendation", "Boolean">;
	readonly estimatedEffort: Prisma.FieldRef<"Recommendation", "String">;
	readonly status: Prisma.FieldRef<"Recommendation", "String">;
	readonly implementedAt: Prisma.FieldRef<"Recommendation", "DateTime">;
	readonly implementedBy: Prisma.FieldRef<"Recommendation", "String">;
	readonly createdAt: Prisma.FieldRef<"Recommendation", "DateTime">;
	readonly updatedAt: Prisma.FieldRef<"Recommendation", "DateTime">;
}
export type RecommendationFindUniqueArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	select?: Prisma.RecommendationSelect<ExtArgs> | null;
	omit?: Prisma.RecommendationOmit<ExtArgs> | null;
	include?: Prisma.RecommendationInclude<ExtArgs> | null;
	where: Prisma.RecommendationWhereUniqueInput;
};
export type RecommendationFindUniqueOrThrowArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	select?: Prisma.RecommendationSelect<ExtArgs> | null;
	omit?: Prisma.RecommendationOmit<ExtArgs> | null;
	include?: Prisma.RecommendationInclude<ExtArgs> | null;
	where: Prisma.RecommendationWhereUniqueInput;
};
export type RecommendationFindFirstArgs<
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
export type RecommendationFindFirstOrThrowArgs<
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
export type RecommendationFindManyArgs<
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
export type RecommendationCreateArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	select?: Prisma.RecommendationSelect<ExtArgs> | null;
	omit?: Prisma.RecommendationOmit<ExtArgs> | null;
	include?: Prisma.RecommendationInclude<ExtArgs> | null;
	data: Prisma.XOR<
		Prisma.RecommendationCreateInput,
		Prisma.RecommendationUncheckedCreateInput
	>;
};
export type RecommendationCreateManyArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	data:
		| Prisma.RecommendationCreateManyInput
		| Prisma.RecommendationCreateManyInput[];
};
export type RecommendationCreateManyAndReturnArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	select?: Prisma.RecommendationSelectCreateManyAndReturn<ExtArgs> | null;
	omit?: Prisma.RecommendationOmit<ExtArgs> | null;
	data:
		| Prisma.RecommendationCreateManyInput
		| Prisma.RecommendationCreateManyInput[];
	include?: Prisma.RecommendationIncludeCreateManyAndReturn<ExtArgs> | null;
};
export type RecommendationUpdateArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	select?: Prisma.RecommendationSelect<ExtArgs> | null;
	omit?: Prisma.RecommendationOmit<ExtArgs> | null;
	include?: Prisma.RecommendationInclude<ExtArgs> | null;
	data: Prisma.XOR<
		Prisma.RecommendationUpdateInput,
		Prisma.RecommendationUncheckedUpdateInput
	>;
	where: Prisma.RecommendationWhereUniqueInput;
};
export type RecommendationUpdateManyArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	data: Prisma.XOR<
		Prisma.RecommendationUpdateManyMutationInput,
		Prisma.RecommendationUncheckedUpdateManyInput
	>;
	where?: Prisma.RecommendationWhereInput;
	limit?: number;
};
export type RecommendationUpdateManyAndReturnArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	select?: Prisma.RecommendationSelectUpdateManyAndReturn<ExtArgs> | null;
	omit?: Prisma.RecommendationOmit<ExtArgs> | null;
	data: Prisma.XOR<
		Prisma.RecommendationUpdateManyMutationInput,
		Prisma.RecommendationUncheckedUpdateManyInput
	>;
	where?: Prisma.RecommendationWhereInput;
	limit?: number;
	include?: Prisma.RecommendationIncludeUpdateManyAndReturn<ExtArgs> | null;
};
export type RecommendationUpsertArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	select?: Prisma.RecommendationSelect<ExtArgs> | null;
	omit?: Prisma.RecommendationOmit<ExtArgs> | null;
	include?: Prisma.RecommendationInclude<ExtArgs> | null;
	where: Prisma.RecommendationWhereUniqueInput;
	create: Prisma.XOR<
		Prisma.RecommendationCreateInput,
		Prisma.RecommendationUncheckedCreateInput
	>;
	update: Prisma.XOR<
		Prisma.RecommendationUpdateInput,
		Prisma.RecommendationUncheckedUpdateInput
	>;
};
export type RecommendationDeleteArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	select?: Prisma.RecommendationSelect<ExtArgs> | null;
	omit?: Prisma.RecommendationOmit<ExtArgs> | null;
	include?: Prisma.RecommendationInclude<ExtArgs> | null;
	where: Prisma.RecommendationWhereUniqueInput;
};
export type RecommendationDeleteManyArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	where?: Prisma.RecommendationWhereInput;
	limit?: number;
};
export type RecommendationDefaultArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	select?: Prisma.RecommendationSelect<ExtArgs> | null;
	omit?: Prisma.RecommendationOmit<ExtArgs> | null;
	include?: Prisma.RecommendationInclude<ExtArgs> | null;
};
