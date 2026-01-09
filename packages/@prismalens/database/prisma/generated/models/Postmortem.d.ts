import type * as runtime from "@prisma/client/runtime/client";
import type * as Prisma from "../internal/prismaNamespace.js";
export type PostmortemModel =
	runtime.Types.Result.DefaultSelection<Prisma.$PostmortemPayload>;
export type AggregatePostmortem = {
	_count: PostmortemCountAggregateOutputType | null;
	_avg: PostmortemAvgAggregateOutputType | null;
	_sum: PostmortemSumAggregateOutputType | null;
	_min: PostmortemMinAggregateOutputType | null;
	_max: PostmortemMaxAggregateOutputType | null;
};
export type PostmortemAvgAggregateOutputType = {
	financialImpact: number | null;
};
export type PostmortemSumAggregateOutputType = {
	financialImpact: number | null;
};
export type PostmortemMinAggregateOutputType = {
	id: string | null;
	incidentId: string | null;
	title: string | null;
	summary: string | null;
	timeline: string | null;
	whatHappened: string | null;
	whyItHappened: string | null;
	whatWeLearned: string | null;
	actionItems: string | null;
	customerImpact: string | null;
	financialImpact: number | null;
	status: string | null;
	authorId: string | null;
	createdAt: Date | null;
	updatedAt: Date | null;
	publishedAt: Date | null;
};
export type PostmortemMaxAggregateOutputType = {
	id: string | null;
	incidentId: string | null;
	title: string | null;
	summary: string | null;
	timeline: string | null;
	whatHappened: string | null;
	whyItHappened: string | null;
	whatWeLearned: string | null;
	actionItems: string | null;
	customerImpact: string | null;
	financialImpact: number | null;
	status: string | null;
	authorId: string | null;
	createdAt: Date | null;
	updatedAt: Date | null;
	publishedAt: Date | null;
};
export type PostmortemCountAggregateOutputType = {
	id: number;
	incidentId: number;
	title: number;
	summary: number;
	timeline: number;
	whatHappened: number;
	whyItHappened: number;
	whatWeLearned: number;
	actionItems: number;
	customerImpact: number;
	financialImpact: number;
	status: number;
	authorId: number;
	createdAt: number;
	updatedAt: number;
	publishedAt: number;
	_all: number;
};
export type PostmortemAvgAggregateInputType = {
	financialImpact?: true;
};
export type PostmortemSumAggregateInputType = {
	financialImpact?: true;
};
export type PostmortemMinAggregateInputType = {
	id?: true;
	incidentId?: true;
	title?: true;
	summary?: true;
	timeline?: true;
	whatHappened?: true;
	whyItHappened?: true;
	whatWeLearned?: true;
	actionItems?: true;
	customerImpact?: true;
	financialImpact?: true;
	status?: true;
	authorId?: true;
	createdAt?: true;
	updatedAt?: true;
	publishedAt?: true;
};
export type PostmortemMaxAggregateInputType = {
	id?: true;
	incidentId?: true;
	title?: true;
	summary?: true;
	timeline?: true;
	whatHappened?: true;
	whyItHappened?: true;
	whatWeLearned?: true;
	actionItems?: true;
	customerImpact?: true;
	financialImpact?: true;
	status?: true;
	authorId?: true;
	createdAt?: true;
	updatedAt?: true;
	publishedAt?: true;
};
export type PostmortemCountAggregateInputType = {
	id?: true;
	incidentId?: true;
	title?: true;
	summary?: true;
	timeline?: true;
	whatHappened?: true;
	whyItHappened?: true;
	whatWeLearned?: true;
	actionItems?: true;
	customerImpact?: true;
	financialImpact?: true;
	status?: true;
	authorId?: true;
	createdAt?: true;
	updatedAt?: true;
	publishedAt?: true;
	_all?: true;
};
export type PostmortemAggregateArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	where?: Prisma.PostmortemWhereInput;
	orderBy?:
		| Prisma.PostmortemOrderByWithRelationInput
		| Prisma.PostmortemOrderByWithRelationInput[];
	cursor?: Prisma.PostmortemWhereUniqueInput;
	take?: number;
	skip?: number;
	_count?: true | PostmortemCountAggregateInputType;
	_avg?: PostmortemAvgAggregateInputType;
	_sum?: PostmortemSumAggregateInputType;
	_min?: PostmortemMinAggregateInputType;
	_max?: PostmortemMaxAggregateInputType;
};
export type GetPostmortemAggregateType<T extends PostmortemAggregateArgs> = {
	[P in keyof T & keyof AggregatePostmortem]: P extends "_count" | "count"
		? T[P] extends true
			? number
			: Prisma.GetScalarType<T[P], AggregatePostmortem[P]>
		: Prisma.GetScalarType<T[P], AggregatePostmortem[P]>;
};
export type PostmortemGroupByArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	where?: Prisma.PostmortemWhereInput;
	orderBy?:
		| Prisma.PostmortemOrderByWithAggregationInput
		| Prisma.PostmortemOrderByWithAggregationInput[];
	by: Prisma.PostmortemScalarFieldEnum[] | Prisma.PostmortemScalarFieldEnum;
	having?: Prisma.PostmortemScalarWhereWithAggregatesInput;
	take?: number;
	skip?: number;
	_count?: PostmortemCountAggregateInputType | true;
	_avg?: PostmortemAvgAggregateInputType;
	_sum?: PostmortemSumAggregateInputType;
	_min?: PostmortemMinAggregateInputType;
	_max?: PostmortemMaxAggregateInputType;
};
export type PostmortemGroupByOutputType = {
	id: string;
	incidentId: string;
	title: string | null;
	summary: string | null;
	timeline: string | null;
	whatHappened: string | null;
	whyItHappened: string | null;
	whatWeLearned: string | null;
	actionItems: string | null;
	customerImpact: string | null;
	financialImpact: number | null;
	status: string;
	authorId: string | null;
	createdAt: Date;
	updatedAt: Date;
	publishedAt: Date | null;
	_count: PostmortemCountAggregateOutputType | null;
	_avg: PostmortemAvgAggregateOutputType | null;
	_sum: PostmortemSumAggregateOutputType | null;
	_min: PostmortemMinAggregateOutputType | null;
	_max: PostmortemMaxAggregateOutputType | null;
};
type GetPostmortemGroupByPayload<T extends PostmortemGroupByArgs> =
	Prisma.PrismaPromise<
		Array<
			Prisma.PickEnumerable<PostmortemGroupByOutputType, T["by"]> & {
				[P in keyof T & keyof PostmortemGroupByOutputType]: P extends "_count"
					? T[P] extends boolean
						? number
						: Prisma.GetScalarType<T[P], PostmortemGroupByOutputType[P]>
					: Prisma.GetScalarType<T[P], PostmortemGroupByOutputType[P]>;
			}
		>
	>;
export type PostmortemWhereInput = {
	AND?: Prisma.PostmortemWhereInput | Prisma.PostmortemWhereInput[];
	OR?: Prisma.PostmortemWhereInput[];
	NOT?: Prisma.PostmortemWhereInput | Prisma.PostmortemWhereInput[];
	id?: Prisma.StringFilter<"Postmortem"> | string;
	incidentId?: Prisma.StringFilter<"Postmortem"> | string;
	title?: Prisma.StringNullableFilter<"Postmortem"> | string | null;
	summary?: Prisma.StringNullableFilter<"Postmortem"> | string | null;
	timeline?: Prisma.StringNullableFilter<"Postmortem"> | string | null;
	whatHappened?: Prisma.StringNullableFilter<"Postmortem"> | string | null;
	whyItHappened?: Prisma.StringNullableFilter<"Postmortem"> | string | null;
	whatWeLearned?: Prisma.StringNullableFilter<"Postmortem"> | string | null;
	actionItems?: Prisma.StringNullableFilter<"Postmortem"> | string | null;
	customerImpact?: Prisma.StringNullableFilter<"Postmortem"> | string | null;
	financialImpact?: Prisma.FloatNullableFilter<"Postmortem"> | number | null;
	status?: Prisma.StringFilter<"Postmortem"> | string;
	authorId?: Prisma.StringNullableFilter<"Postmortem"> | string | null;
	createdAt?: Prisma.DateTimeFilter<"Postmortem"> | Date | string;
	updatedAt?: Prisma.DateTimeFilter<"Postmortem"> | Date | string;
	publishedAt?:
		| Prisma.DateTimeNullableFilter<"Postmortem">
		| Date
		| string
		| null;
	incident?: Prisma.XOR<
		Prisma.IncidentScalarRelationFilter,
		Prisma.IncidentWhereInput
	>;
	author?: Prisma.XOR<
		Prisma.UserNullableScalarRelationFilter,
		Prisma.UserWhereInput
	> | null;
};
export type PostmortemOrderByWithRelationInput = {
	id?: Prisma.SortOrder;
	incidentId?: Prisma.SortOrder;
	title?: Prisma.SortOrderInput | Prisma.SortOrder;
	summary?: Prisma.SortOrderInput | Prisma.SortOrder;
	timeline?: Prisma.SortOrderInput | Prisma.SortOrder;
	whatHappened?: Prisma.SortOrderInput | Prisma.SortOrder;
	whyItHappened?: Prisma.SortOrderInput | Prisma.SortOrder;
	whatWeLearned?: Prisma.SortOrderInput | Prisma.SortOrder;
	actionItems?: Prisma.SortOrderInput | Prisma.SortOrder;
	customerImpact?: Prisma.SortOrderInput | Prisma.SortOrder;
	financialImpact?: Prisma.SortOrderInput | Prisma.SortOrder;
	status?: Prisma.SortOrder;
	authorId?: Prisma.SortOrderInput | Prisma.SortOrder;
	createdAt?: Prisma.SortOrder;
	updatedAt?: Prisma.SortOrder;
	publishedAt?: Prisma.SortOrderInput | Prisma.SortOrder;
	incident?: Prisma.IncidentOrderByWithRelationInput;
	author?: Prisma.UserOrderByWithRelationInput;
};
export type PostmortemWhereUniqueInput = Prisma.AtLeast<
	{
		id?: string;
		incidentId?: string;
		AND?: Prisma.PostmortemWhereInput | Prisma.PostmortemWhereInput[];
		OR?: Prisma.PostmortemWhereInput[];
		NOT?: Prisma.PostmortemWhereInput | Prisma.PostmortemWhereInput[];
		title?: Prisma.StringNullableFilter<"Postmortem"> | string | null;
		summary?: Prisma.StringNullableFilter<"Postmortem"> | string | null;
		timeline?: Prisma.StringNullableFilter<"Postmortem"> | string | null;
		whatHappened?: Prisma.StringNullableFilter<"Postmortem"> | string | null;
		whyItHappened?: Prisma.StringNullableFilter<"Postmortem"> | string | null;
		whatWeLearned?: Prisma.StringNullableFilter<"Postmortem"> | string | null;
		actionItems?: Prisma.StringNullableFilter<"Postmortem"> | string | null;
		customerImpact?: Prisma.StringNullableFilter<"Postmortem"> | string | null;
		financialImpact?: Prisma.FloatNullableFilter<"Postmortem"> | number | null;
		status?: Prisma.StringFilter<"Postmortem"> | string;
		authorId?: Prisma.StringNullableFilter<"Postmortem"> | string | null;
		createdAt?: Prisma.DateTimeFilter<"Postmortem"> | Date | string;
		updatedAt?: Prisma.DateTimeFilter<"Postmortem"> | Date | string;
		publishedAt?:
			| Prisma.DateTimeNullableFilter<"Postmortem">
			| Date
			| string
			| null;
		incident?: Prisma.XOR<
			Prisma.IncidentScalarRelationFilter,
			Prisma.IncidentWhereInput
		>;
		author?: Prisma.XOR<
			Prisma.UserNullableScalarRelationFilter,
			Prisma.UserWhereInput
		> | null;
	},
	"id" | "incidentId"
>;
export type PostmortemOrderByWithAggregationInput = {
	id?: Prisma.SortOrder;
	incidentId?: Prisma.SortOrder;
	title?: Prisma.SortOrderInput | Prisma.SortOrder;
	summary?: Prisma.SortOrderInput | Prisma.SortOrder;
	timeline?: Prisma.SortOrderInput | Prisma.SortOrder;
	whatHappened?: Prisma.SortOrderInput | Prisma.SortOrder;
	whyItHappened?: Prisma.SortOrderInput | Prisma.SortOrder;
	whatWeLearned?: Prisma.SortOrderInput | Prisma.SortOrder;
	actionItems?: Prisma.SortOrderInput | Prisma.SortOrder;
	customerImpact?: Prisma.SortOrderInput | Prisma.SortOrder;
	financialImpact?: Prisma.SortOrderInput | Prisma.SortOrder;
	status?: Prisma.SortOrder;
	authorId?: Prisma.SortOrderInput | Prisma.SortOrder;
	createdAt?: Prisma.SortOrder;
	updatedAt?: Prisma.SortOrder;
	publishedAt?: Prisma.SortOrderInput | Prisma.SortOrder;
	_count?: Prisma.PostmortemCountOrderByAggregateInput;
	_avg?: Prisma.PostmortemAvgOrderByAggregateInput;
	_max?: Prisma.PostmortemMaxOrderByAggregateInput;
	_min?: Prisma.PostmortemMinOrderByAggregateInput;
	_sum?: Prisma.PostmortemSumOrderByAggregateInput;
};
export type PostmortemScalarWhereWithAggregatesInput = {
	AND?:
		| Prisma.PostmortemScalarWhereWithAggregatesInput
		| Prisma.PostmortemScalarWhereWithAggregatesInput[];
	OR?: Prisma.PostmortemScalarWhereWithAggregatesInput[];
	NOT?:
		| Prisma.PostmortemScalarWhereWithAggregatesInput
		| Prisma.PostmortemScalarWhereWithAggregatesInput[];
	id?: Prisma.StringWithAggregatesFilter<"Postmortem"> | string;
	incidentId?: Prisma.StringWithAggregatesFilter<"Postmortem"> | string;
	title?:
		| Prisma.StringNullableWithAggregatesFilter<"Postmortem">
		| string
		| null;
	summary?:
		| Prisma.StringNullableWithAggregatesFilter<"Postmortem">
		| string
		| null;
	timeline?:
		| Prisma.StringNullableWithAggregatesFilter<"Postmortem">
		| string
		| null;
	whatHappened?:
		| Prisma.StringNullableWithAggregatesFilter<"Postmortem">
		| string
		| null;
	whyItHappened?:
		| Prisma.StringNullableWithAggregatesFilter<"Postmortem">
		| string
		| null;
	whatWeLearned?:
		| Prisma.StringNullableWithAggregatesFilter<"Postmortem">
		| string
		| null;
	actionItems?:
		| Prisma.StringNullableWithAggregatesFilter<"Postmortem">
		| string
		| null;
	customerImpact?:
		| Prisma.StringNullableWithAggregatesFilter<"Postmortem">
		| string
		| null;
	financialImpact?:
		| Prisma.FloatNullableWithAggregatesFilter<"Postmortem">
		| number
		| null;
	status?: Prisma.StringWithAggregatesFilter<"Postmortem"> | string;
	authorId?:
		| Prisma.StringNullableWithAggregatesFilter<"Postmortem">
		| string
		| null;
	createdAt?: Prisma.DateTimeWithAggregatesFilter<"Postmortem"> | Date | string;
	updatedAt?: Prisma.DateTimeWithAggregatesFilter<"Postmortem"> | Date | string;
	publishedAt?:
		| Prisma.DateTimeNullableWithAggregatesFilter<"Postmortem">
		| Date
		| string
		| null;
};
export type PostmortemCreateInput = {
	id?: string;
	title?: string | null;
	summary?: string | null;
	timeline?: string | null;
	whatHappened?: string | null;
	whyItHappened?: string | null;
	whatWeLearned?: string | null;
	actionItems?: string | null;
	customerImpact?: string | null;
	financialImpact?: number | null;
	status?: string;
	createdAt?: Date | string;
	updatedAt?: Date | string;
	publishedAt?: Date | string | null;
	incident: Prisma.IncidentCreateNestedOneWithoutPostmortemInput;
	author?: Prisma.UserCreateNestedOneWithoutPostmortemsInput;
};
export type PostmortemUncheckedCreateInput = {
	id?: string;
	incidentId: string;
	title?: string | null;
	summary?: string | null;
	timeline?: string | null;
	whatHappened?: string | null;
	whyItHappened?: string | null;
	whatWeLearned?: string | null;
	actionItems?: string | null;
	customerImpact?: string | null;
	financialImpact?: number | null;
	status?: string;
	authorId?: string | null;
	createdAt?: Date | string;
	updatedAt?: Date | string;
	publishedAt?: Date | string | null;
};
export type PostmortemUpdateInput = {
	id?: Prisma.StringFieldUpdateOperationsInput | string;
	title?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	summary?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	timeline?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	whatHappened?:
		| Prisma.NullableStringFieldUpdateOperationsInput
		| string
		| null;
	whyItHappened?:
		| Prisma.NullableStringFieldUpdateOperationsInput
		| string
		| null;
	whatWeLearned?:
		| Prisma.NullableStringFieldUpdateOperationsInput
		| string
		| null;
	actionItems?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	customerImpact?:
		| Prisma.NullableStringFieldUpdateOperationsInput
		| string
		| null;
	financialImpact?:
		| Prisma.NullableFloatFieldUpdateOperationsInput
		| number
		| null;
	status?: Prisma.StringFieldUpdateOperationsInput | string;
	createdAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
	updatedAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
	publishedAt?:
		| Prisma.NullableDateTimeFieldUpdateOperationsInput
		| Date
		| string
		| null;
	incident?: Prisma.IncidentUpdateOneRequiredWithoutPostmortemNestedInput;
	author?: Prisma.UserUpdateOneWithoutPostmortemsNestedInput;
};
export type PostmortemUncheckedUpdateInput = {
	id?: Prisma.StringFieldUpdateOperationsInput | string;
	incidentId?: Prisma.StringFieldUpdateOperationsInput | string;
	title?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	summary?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	timeline?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	whatHappened?:
		| Prisma.NullableStringFieldUpdateOperationsInput
		| string
		| null;
	whyItHappened?:
		| Prisma.NullableStringFieldUpdateOperationsInput
		| string
		| null;
	whatWeLearned?:
		| Prisma.NullableStringFieldUpdateOperationsInput
		| string
		| null;
	actionItems?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	customerImpact?:
		| Prisma.NullableStringFieldUpdateOperationsInput
		| string
		| null;
	financialImpact?:
		| Prisma.NullableFloatFieldUpdateOperationsInput
		| number
		| null;
	status?: Prisma.StringFieldUpdateOperationsInput | string;
	authorId?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	createdAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
	updatedAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
	publishedAt?:
		| Prisma.NullableDateTimeFieldUpdateOperationsInput
		| Date
		| string
		| null;
};
export type PostmortemCreateManyInput = {
	id?: string;
	incidentId: string;
	title?: string | null;
	summary?: string | null;
	timeline?: string | null;
	whatHappened?: string | null;
	whyItHappened?: string | null;
	whatWeLearned?: string | null;
	actionItems?: string | null;
	customerImpact?: string | null;
	financialImpact?: number | null;
	status?: string;
	authorId?: string | null;
	createdAt?: Date | string;
	updatedAt?: Date | string;
	publishedAt?: Date | string | null;
};
export type PostmortemUpdateManyMutationInput = {
	id?: Prisma.StringFieldUpdateOperationsInput | string;
	title?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	summary?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	timeline?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	whatHappened?:
		| Prisma.NullableStringFieldUpdateOperationsInput
		| string
		| null;
	whyItHappened?:
		| Prisma.NullableStringFieldUpdateOperationsInput
		| string
		| null;
	whatWeLearned?:
		| Prisma.NullableStringFieldUpdateOperationsInput
		| string
		| null;
	actionItems?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	customerImpact?:
		| Prisma.NullableStringFieldUpdateOperationsInput
		| string
		| null;
	financialImpact?:
		| Prisma.NullableFloatFieldUpdateOperationsInput
		| number
		| null;
	status?: Prisma.StringFieldUpdateOperationsInput | string;
	createdAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
	updatedAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
	publishedAt?:
		| Prisma.NullableDateTimeFieldUpdateOperationsInput
		| Date
		| string
		| null;
};
export type PostmortemUncheckedUpdateManyInput = {
	id?: Prisma.StringFieldUpdateOperationsInput | string;
	incidentId?: Prisma.StringFieldUpdateOperationsInput | string;
	title?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	summary?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	timeline?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	whatHappened?:
		| Prisma.NullableStringFieldUpdateOperationsInput
		| string
		| null;
	whyItHappened?:
		| Prisma.NullableStringFieldUpdateOperationsInput
		| string
		| null;
	whatWeLearned?:
		| Prisma.NullableStringFieldUpdateOperationsInput
		| string
		| null;
	actionItems?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	customerImpact?:
		| Prisma.NullableStringFieldUpdateOperationsInput
		| string
		| null;
	financialImpact?:
		| Prisma.NullableFloatFieldUpdateOperationsInput
		| number
		| null;
	status?: Prisma.StringFieldUpdateOperationsInput | string;
	authorId?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	createdAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
	updatedAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
	publishedAt?:
		| Prisma.NullableDateTimeFieldUpdateOperationsInput
		| Date
		| string
		| null;
};
export type PostmortemListRelationFilter = {
	every?: Prisma.PostmortemWhereInput;
	some?: Prisma.PostmortemWhereInput;
	none?: Prisma.PostmortemWhereInput;
};
export type PostmortemOrderByRelationAggregateInput = {
	_count?: Prisma.SortOrder;
};
export type PostmortemNullableScalarRelationFilter = {
	is?: Prisma.PostmortemWhereInput | null;
	isNot?: Prisma.PostmortemWhereInput | null;
};
export type PostmortemCountOrderByAggregateInput = {
	id?: Prisma.SortOrder;
	incidentId?: Prisma.SortOrder;
	title?: Prisma.SortOrder;
	summary?: Prisma.SortOrder;
	timeline?: Prisma.SortOrder;
	whatHappened?: Prisma.SortOrder;
	whyItHappened?: Prisma.SortOrder;
	whatWeLearned?: Prisma.SortOrder;
	actionItems?: Prisma.SortOrder;
	customerImpact?: Prisma.SortOrder;
	financialImpact?: Prisma.SortOrder;
	status?: Prisma.SortOrder;
	authorId?: Prisma.SortOrder;
	createdAt?: Prisma.SortOrder;
	updatedAt?: Prisma.SortOrder;
	publishedAt?: Prisma.SortOrder;
};
export type PostmortemAvgOrderByAggregateInput = {
	financialImpact?: Prisma.SortOrder;
};
export type PostmortemMaxOrderByAggregateInput = {
	id?: Prisma.SortOrder;
	incidentId?: Prisma.SortOrder;
	title?: Prisma.SortOrder;
	summary?: Prisma.SortOrder;
	timeline?: Prisma.SortOrder;
	whatHappened?: Prisma.SortOrder;
	whyItHappened?: Prisma.SortOrder;
	whatWeLearned?: Prisma.SortOrder;
	actionItems?: Prisma.SortOrder;
	customerImpact?: Prisma.SortOrder;
	financialImpact?: Prisma.SortOrder;
	status?: Prisma.SortOrder;
	authorId?: Prisma.SortOrder;
	createdAt?: Prisma.SortOrder;
	updatedAt?: Prisma.SortOrder;
	publishedAt?: Prisma.SortOrder;
};
export type PostmortemMinOrderByAggregateInput = {
	id?: Prisma.SortOrder;
	incidentId?: Prisma.SortOrder;
	title?: Prisma.SortOrder;
	summary?: Prisma.SortOrder;
	timeline?: Prisma.SortOrder;
	whatHappened?: Prisma.SortOrder;
	whyItHappened?: Prisma.SortOrder;
	whatWeLearned?: Prisma.SortOrder;
	actionItems?: Prisma.SortOrder;
	customerImpact?: Prisma.SortOrder;
	financialImpact?: Prisma.SortOrder;
	status?: Prisma.SortOrder;
	authorId?: Prisma.SortOrder;
	createdAt?: Prisma.SortOrder;
	updatedAt?: Prisma.SortOrder;
	publishedAt?: Prisma.SortOrder;
};
export type PostmortemSumOrderByAggregateInput = {
	financialImpact?: Prisma.SortOrder;
};
export type PostmortemCreateNestedManyWithoutAuthorInput = {
	create?:
		| Prisma.XOR<
				Prisma.PostmortemCreateWithoutAuthorInput,
				Prisma.PostmortemUncheckedCreateWithoutAuthorInput
		  >
		| Prisma.PostmortemCreateWithoutAuthorInput[]
		| Prisma.PostmortemUncheckedCreateWithoutAuthorInput[];
	connectOrCreate?:
		| Prisma.PostmortemCreateOrConnectWithoutAuthorInput
		| Prisma.PostmortemCreateOrConnectWithoutAuthorInput[];
	createMany?: Prisma.PostmortemCreateManyAuthorInputEnvelope;
	connect?:
		| Prisma.PostmortemWhereUniqueInput
		| Prisma.PostmortemWhereUniqueInput[];
};
export type PostmortemUncheckedCreateNestedManyWithoutAuthorInput = {
	create?:
		| Prisma.XOR<
				Prisma.PostmortemCreateWithoutAuthorInput,
				Prisma.PostmortemUncheckedCreateWithoutAuthorInput
		  >
		| Prisma.PostmortemCreateWithoutAuthorInput[]
		| Prisma.PostmortemUncheckedCreateWithoutAuthorInput[];
	connectOrCreate?:
		| Prisma.PostmortemCreateOrConnectWithoutAuthorInput
		| Prisma.PostmortemCreateOrConnectWithoutAuthorInput[];
	createMany?: Prisma.PostmortemCreateManyAuthorInputEnvelope;
	connect?:
		| Prisma.PostmortemWhereUniqueInput
		| Prisma.PostmortemWhereUniqueInput[];
};
export type PostmortemUpdateManyWithoutAuthorNestedInput = {
	create?:
		| Prisma.XOR<
				Prisma.PostmortemCreateWithoutAuthorInput,
				Prisma.PostmortemUncheckedCreateWithoutAuthorInput
		  >
		| Prisma.PostmortemCreateWithoutAuthorInput[]
		| Prisma.PostmortemUncheckedCreateWithoutAuthorInput[];
	connectOrCreate?:
		| Prisma.PostmortemCreateOrConnectWithoutAuthorInput
		| Prisma.PostmortemCreateOrConnectWithoutAuthorInput[];
	upsert?:
		| Prisma.PostmortemUpsertWithWhereUniqueWithoutAuthorInput
		| Prisma.PostmortemUpsertWithWhereUniqueWithoutAuthorInput[];
	createMany?: Prisma.PostmortemCreateManyAuthorInputEnvelope;
	set?: Prisma.PostmortemWhereUniqueInput | Prisma.PostmortemWhereUniqueInput[];
	disconnect?:
		| Prisma.PostmortemWhereUniqueInput
		| Prisma.PostmortemWhereUniqueInput[];
	delete?:
		| Prisma.PostmortemWhereUniqueInput
		| Prisma.PostmortemWhereUniqueInput[];
	connect?:
		| Prisma.PostmortemWhereUniqueInput
		| Prisma.PostmortemWhereUniqueInput[];
	update?:
		| Prisma.PostmortemUpdateWithWhereUniqueWithoutAuthorInput
		| Prisma.PostmortemUpdateWithWhereUniqueWithoutAuthorInput[];
	updateMany?:
		| Prisma.PostmortemUpdateManyWithWhereWithoutAuthorInput
		| Prisma.PostmortemUpdateManyWithWhereWithoutAuthorInput[];
	deleteMany?:
		| Prisma.PostmortemScalarWhereInput
		| Prisma.PostmortemScalarWhereInput[];
};
export type PostmortemUncheckedUpdateManyWithoutAuthorNestedInput = {
	create?:
		| Prisma.XOR<
				Prisma.PostmortemCreateWithoutAuthorInput,
				Prisma.PostmortemUncheckedCreateWithoutAuthorInput
		  >
		| Prisma.PostmortemCreateWithoutAuthorInput[]
		| Prisma.PostmortemUncheckedCreateWithoutAuthorInput[];
	connectOrCreate?:
		| Prisma.PostmortemCreateOrConnectWithoutAuthorInput
		| Prisma.PostmortemCreateOrConnectWithoutAuthorInput[];
	upsert?:
		| Prisma.PostmortemUpsertWithWhereUniqueWithoutAuthorInput
		| Prisma.PostmortemUpsertWithWhereUniqueWithoutAuthorInput[];
	createMany?: Prisma.PostmortemCreateManyAuthorInputEnvelope;
	set?: Prisma.PostmortemWhereUniqueInput | Prisma.PostmortemWhereUniqueInput[];
	disconnect?:
		| Prisma.PostmortemWhereUniqueInput
		| Prisma.PostmortemWhereUniqueInput[];
	delete?:
		| Prisma.PostmortemWhereUniqueInput
		| Prisma.PostmortemWhereUniqueInput[];
	connect?:
		| Prisma.PostmortemWhereUniqueInput
		| Prisma.PostmortemWhereUniqueInput[];
	update?:
		| Prisma.PostmortemUpdateWithWhereUniqueWithoutAuthorInput
		| Prisma.PostmortemUpdateWithWhereUniqueWithoutAuthorInput[];
	updateMany?:
		| Prisma.PostmortemUpdateManyWithWhereWithoutAuthorInput
		| Prisma.PostmortemUpdateManyWithWhereWithoutAuthorInput[];
	deleteMany?:
		| Prisma.PostmortemScalarWhereInput
		| Prisma.PostmortemScalarWhereInput[];
};
export type PostmortemCreateNestedOneWithoutIncidentInput = {
	create?: Prisma.XOR<
		Prisma.PostmortemCreateWithoutIncidentInput,
		Prisma.PostmortemUncheckedCreateWithoutIncidentInput
	>;
	connectOrCreate?: Prisma.PostmortemCreateOrConnectWithoutIncidentInput;
	connect?: Prisma.PostmortemWhereUniqueInput;
};
export type PostmortemUncheckedCreateNestedOneWithoutIncidentInput = {
	create?: Prisma.XOR<
		Prisma.PostmortemCreateWithoutIncidentInput,
		Prisma.PostmortemUncheckedCreateWithoutIncidentInput
	>;
	connectOrCreate?: Prisma.PostmortemCreateOrConnectWithoutIncidentInput;
	connect?: Prisma.PostmortemWhereUniqueInput;
};
export type PostmortemUpdateOneWithoutIncidentNestedInput = {
	create?: Prisma.XOR<
		Prisma.PostmortemCreateWithoutIncidentInput,
		Prisma.PostmortemUncheckedCreateWithoutIncidentInput
	>;
	connectOrCreate?: Prisma.PostmortemCreateOrConnectWithoutIncidentInput;
	upsert?: Prisma.PostmortemUpsertWithoutIncidentInput;
	disconnect?: Prisma.PostmortemWhereInput | boolean;
	delete?: Prisma.PostmortemWhereInput | boolean;
	connect?: Prisma.PostmortemWhereUniqueInput;
	update?: Prisma.XOR<
		Prisma.XOR<
			Prisma.PostmortemUpdateToOneWithWhereWithoutIncidentInput,
			Prisma.PostmortemUpdateWithoutIncidentInput
		>,
		Prisma.PostmortemUncheckedUpdateWithoutIncidentInput
	>;
};
export type PostmortemUncheckedUpdateOneWithoutIncidentNestedInput = {
	create?: Prisma.XOR<
		Prisma.PostmortemCreateWithoutIncidentInput,
		Prisma.PostmortemUncheckedCreateWithoutIncidentInput
	>;
	connectOrCreate?: Prisma.PostmortemCreateOrConnectWithoutIncidentInput;
	upsert?: Prisma.PostmortemUpsertWithoutIncidentInput;
	disconnect?: Prisma.PostmortemWhereInput | boolean;
	delete?: Prisma.PostmortemWhereInput | boolean;
	connect?: Prisma.PostmortemWhereUniqueInput;
	update?: Prisma.XOR<
		Prisma.XOR<
			Prisma.PostmortemUpdateToOneWithWhereWithoutIncidentInput,
			Prisma.PostmortemUpdateWithoutIncidentInput
		>,
		Prisma.PostmortemUncheckedUpdateWithoutIncidentInput
	>;
};
export type PostmortemCreateWithoutAuthorInput = {
	id?: string;
	title?: string | null;
	summary?: string | null;
	timeline?: string | null;
	whatHappened?: string | null;
	whyItHappened?: string | null;
	whatWeLearned?: string | null;
	actionItems?: string | null;
	customerImpact?: string | null;
	financialImpact?: number | null;
	status?: string;
	createdAt?: Date | string;
	updatedAt?: Date | string;
	publishedAt?: Date | string | null;
	incident: Prisma.IncidentCreateNestedOneWithoutPostmortemInput;
};
export type PostmortemUncheckedCreateWithoutAuthorInput = {
	id?: string;
	incidentId: string;
	title?: string | null;
	summary?: string | null;
	timeline?: string | null;
	whatHappened?: string | null;
	whyItHappened?: string | null;
	whatWeLearned?: string | null;
	actionItems?: string | null;
	customerImpact?: string | null;
	financialImpact?: number | null;
	status?: string;
	createdAt?: Date | string;
	updatedAt?: Date | string;
	publishedAt?: Date | string | null;
};
export type PostmortemCreateOrConnectWithoutAuthorInput = {
	where: Prisma.PostmortemWhereUniqueInput;
	create: Prisma.XOR<
		Prisma.PostmortemCreateWithoutAuthorInput,
		Prisma.PostmortemUncheckedCreateWithoutAuthorInput
	>;
};
export type PostmortemCreateManyAuthorInputEnvelope = {
	data:
		| Prisma.PostmortemCreateManyAuthorInput
		| Prisma.PostmortemCreateManyAuthorInput[];
};
export type PostmortemUpsertWithWhereUniqueWithoutAuthorInput = {
	where: Prisma.PostmortemWhereUniqueInput;
	update: Prisma.XOR<
		Prisma.PostmortemUpdateWithoutAuthorInput,
		Prisma.PostmortemUncheckedUpdateWithoutAuthorInput
	>;
	create: Prisma.XOR<
		Prisma.PostmortemCreateWithoutAuthorInput,
		Prisma.PostmortemUncheckedCreateWithoutAuthorInput
	>;
};
export type PostmortemUpdateWithWhereUniqueWithoutAuthorInput = {
	where: Prisma.PostmortemWhereUniqueInput;
	data: Prisma.XOR<
		Prisma.PostmortemUpdateWithoutAuthorInput,
		Prisma.PostmortemUncheckedUpdateWithoutAuthorInput
	>;
};
export type PostmortemUpdateManyWithWhereWithoutAuthorInput = {
	where: Prisma.PostmortemScalarWhereInput;
	data: Prisma.XOR<
		Prisma.PostmortemUpdateManyMutationInput,
		Prisma.PostmortemUncheckedUpdateManyWithoutAuthorInput
	>;
};
export type PostmortemScalarWhereInput = {
	AND?: Prisma.PostmortemScalarWhereInput | Prisma.PostmortemScalarWhereInput[];
	OR?: Prisma.PostmortemScalarWhereInput[];
	NOT?: Prisma.PostmortemScalarWhereInput | Prisma.PostmortemScalarWhereInput[];
	id?: Prisma.StringFilter<"Postmortem"> | string;
	incidentId?: Prisma.StringFilter<"Postmortem"> | string;
	title?: Prisma.StringNullableFilter<"Postmortem"> | string | null;
	summary?: Prisma.StringNullableFilter<"Postmortem"> | string | null;
	timeline?: Prisma.StringNullableFilter<"Postmortem"> | string | null;
	whatHappened?: Prisma.StringNullableFilter<"Postmortem"> | string | null;
	whyItHappened?: Prisma.StringNullableFilter<"Postmortem"> | string | null;
	whatWeLearned?: Prisma.StringNullableFilter<"Postmortem"> | string | null;
	actionItems?: Prisma.StringNullableFilter<"Postmortem"> | string | null;
	customerImpact?: Prisma.StringNullableFilter<"Postmortem"> | string | null;
	financialImpact?: Prisma.FloatNullableFilter<"Postmortem"> | number | null;
	status?: Prisma.StringFilter<"Postmortem"> | string;
	authorId?: Prisma.StringNullableFilter<"Postmortem"> | string | null;
	createdAt?: Prisma.DateTimeFilter<"Postmortem"> | Date | string;
	updatedAt?: Prisma.DateTimeFilter<"Postmortem"> | Date | string;
	publishedAt?:
		| Prisma.DateTimeNullableFilter<"Postmortem">
		| Date
		| string
		| null;
};
export type PostmortemCreateWithoutIncidentInput = {
	id?: string;
	title?: string | null;
	summary?: string | null;
	timeline?: string | null;
	whatHappened?: string | null;
	whyItHappened?: string | null;
	whatWeLearned?: string | null;
	actionItems?: string | null;
	customerImpact?: string | null;
	financialImpact?: number | null;
	status?: string;
	createdAt?: Date | string;
	updatedAt?: Date | string;
	publishedAt?: Date | string | null;
	author?: Prisma.UserCreateNestedOneWithoutPostmortemsInput;
};
export type PostmortemUncheckedCreateWithoutIncidentInput = {
	id?: string;
	title?: string | null;
	summary?: string | null;
	timeline?: string | null;
	whatHappened?: string | null;
	whyItHappened?: string | null;
	whatWeLearned?: string | null;
	actionItems?: string | null;
	customerImpact?: string | null;
	financialImpact?: number | null;
	status?: string;
	authorId?: string | null;
	createdAt?: Date | string;
	updatedAt?: Date | string;
	publishedAt?: Date | string | null;
};
export type PostmortemCreateOrConnectWithoutIncidentInput = {
	where: Prisma.PostmortemWhereUniqueInput;
	create: Prisma.XOR<
		Prisma.PostmortemCreateWithoutIncidentInput,
		Prisma.PostmortemUncheckedCreateWithoutIncidentInput
	>;
};
export type PostmortemUpsertWithoutIncidentInput = {
	update: Prisma.XOR<
		Prisma.PostmortemUpdateWithoutIncidentInput,
		Prisma.PostmortemUncheckedUpdateWithoutIncidentInput
	>;
	create: Prisma.XOR<
		Prisma.PostmortemCreateWithoutIncidentInput,
		Prisma.PostmortemUncheckedCreateWithoutIncidentInput
	>;
	where?: Prisma.PostmortemWhereInput;
};
export type PostmortemUpdateToOneWithWhereWithoutIncidentInput = {
	where?: Prisma.PostmortemWhereInput;
	data: Prisma.XOR<
		Prisma.PostmortemUpdateWithoutIncidentInput,
		Prisma.PostmortemUncheckedUpdateWithoutIncidentInput
	>;
};
export type PostmortemUpdateWithoutIncidentInput = {
	id?: Prisma.StringFieldUpdateOperationsInput | string;
	title?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	summary?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	timeline?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	whatHappened?:
		| Prisma.NullableStringFieldUpdateOperationsInput
		| string
		| null;
	whyItHappened?:
		| Prisma.NullableStringFieldUpdateOperationsInput
		| string
		| null;
	whatWeLearned?:
		| Prisma.NullableStringFieldUpdateOperationsInput
		| string
		| null;
	actionItems?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	customerImpact?:
		| Prisma.NullableStringFieldUpdateOperationsInput
		| string
		| null;
	financialImpact?:
		| Prisma.NullableFloatFieldUpdateOperationsInput
		| number
		| null;
	status?: Prisma.StringFieldUpdateOperationsInput | string;
	createdAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
	updatedAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
	publishedAt?:
		| Prisma.NullableDateTimeFieldUpdateOperationsInput
		| Date
		| string
		| null;
	author?: Prisma.UserUpdateOneWithoutPostmortemsNestedInput;
};
export type PostmortemUncheckedUpdateWithoutIncidentInput = {
	id?: Prisma.StringFieldUpdateOperationsInput | string;
	title?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	summary?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	timeline?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	whatHappened?:
		| Prisma.NullableStringFieldUpdateOperationsInput
		| string
		| null;
	whyItHappened?:
		| Prisma.NullableStringFieldUpdateOperationsInput
		| string
		| null;
	whatWeLearned?:
		| Prisma.NullableStringFieldUpdateOperationsInput
		| string
		| null;
	actionItems?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	customerImpact?:
		| Prisma.NullableStringFieldUpdateOperationsInput
		| string
		| null;
	financialImpact?:
		| Prisma.NullableFloatFieldUpdateOperationsInput
		| number
		| null;
	status?: Prisma.StringFieldUpdateOperationsInput | string;
	authorId?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	createdAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
	updatedAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
	publishedAt?:
		| Prisma.NullableDateTimeFieldUpdateOperationsInput
		| Date
		| string
		| null;
};
export type PostmortemCreateManyAuthorInput = {
	id?: string;
	incidentId: string;
	title?: string | null;
	summary?: string | null;
	timeline?: string | null;
	whatHappened?: string | null;
	whyItHappened?: string | null;
	whatWeLearned?: string | null;
	actionItems?: string | null;
	customerImpact?: string | null;
	financialImpact?: number | null;
	status?: string;
	createdAt?: Date | string;
	updatedAt?: Date | string;
	publishedAt?: Date | string | null;
};
export type PostmortemUpdateWithoutAuthorInput = {
	id?: Prisma.StringFieldUpdateOperationsInput | string;
	title?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	summary?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	timeline?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	whatHappened?:
		| Prisma.NullableStringFieldUpdateOperationsInput
		| string
		| null;
	whyItHappened?:
		| Prisma.NullableStringFieldUpdateOperationsInput
		| string
		| null;
	whatWeLearned?:
		| Prisma.NullableStringFieldUpdateOperationsInput
		| string
		| null;
	actionItems?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	customerImpact?:
		| Prisma.NullableStringFieldUpdateOperationsInput
		| string
		| null;
	financialImpact?:
		| Prisma.NullableFloatFieldUpdateOperationsInput
		| number
		| null;
	status?: Prisma.StringFieldUpdateOperationsInput | string;
	createdAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
	updatedAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
	publishedAt?:
		| Prisma.NullableDateTimeFieldUpdateOperationsInput
		| Date
		| string
		| null;
	incident?: Prisma.IncidentUpdateOneRequiredWithoutPostmortemNestedInput;
};
export type PostmortemUncheckedUpdateWithoutAuthorInput = {
	id?: Prisma.StringFieldUpdateOperationsInput | string;
	incidentId?: Prisma.StringFieldUpdateOperationsInput | string;
	title?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	summary?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	timeline?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	whatHappened?:
		| Prisma.NullableStringFieldUpdateOperationsInput
		| string
		| null;
	whyItHappened?:
		| Prisma.NullableStringFieldUpdateOperationsInput
		| string
		| null;
	whatWeLearned?:
		| Prisma.NullableStringFieldUpdateOperationsInput
		| string
		| null;
	actionItems?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	customerImpact?:
		| Prisma.NullableStringFieldUpdateOperationsInput
		| string
		| null;
	financialImpact?:
		| Prisma.NullableFloatFieldUpdateOperationsInput
		| number
		| null;
	status?: Prisma.StringFieldUpdateOperationsInput | string;
	createdAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
	updatedAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
	publishedAt?:
		| Prisma.NullableDateTimeFieldUpdateOperationsInput
		| Date
		| string
		| null;
};
export type PostmortemUncheckedUpdateManyWithoutAuthorInput = {
	id?: Prisma.StringFieldUpdateOperationsInput | string;
	incidentId?: Prisma.StringFieldUpdateOperationsInput | string;
	title?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	summary?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	timeline?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	whatHappened?:
		| Prisma.NullableStringFieldUpdateOperationsInput
		| string
		| null;
	whyItHappened?:
		| Prisma.NullableStringFieldUpdateOperationsInput
		| string
		| null;
	whatWeLearned?:
		| Prisma.NullableStringFieldUpdateOperationsInput
		| string
		| null;
	actionItems?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	customerImpact?:
		| Prisma.NullableStringFieldUpdateOperationsInput
		| string
		| null;
	financialImpact?:
		| Prisma.NullableFloatFieldUpdateOperationsInput
		| number
		| null;
	status?: Prisma.StringFieldUpdateOperationsInput | string;
	createdAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
	updatedAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
	publishedAt?:
		| Prisma.NullableDateTimeFieldUpdateOperationsInput
		| Date
		| string
		| null;
};
export type PostmortemSelect<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = runtime.Types.Extensions.GetSelect<
	{
		id?: boolean;
		incidentId?: boolean;
		title?: boolean;
		summary?: boolean;
		timeline?: boolean;
		whatHappened?: boolean;
		whyItHappened?: boolean;
		whatWeLearned?: boolean;
		actionItems?: boolean;
		customerImpact?: boolean;
		financialImpact?: boolean;
		status?: boolean;
		authorId?: boolean;
		createdAt?: boolean;
		updatedAt?: boolean;
		publishedAt?: boolean;
		incident?: boolean | Prisma.IncidentDefaultArgs<ExtArgs>;
		author?: boolean | Prisma.Postmortem$authorArgs<ExtArgs>;
	},
	ExtArgs["result"]["postmortem"]
>;
export type PostmortemSelectCreateManyAndReturn<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = runtime.Types.Extensions.GetSelect<
	{
		id?: boolean;
		incidentId?: boolean;
		title?: boolean;
		summary?: boolean;
		timeline?: boolean;
		whatHappened?: boolean;
		whyItHappened?: boolean;
		whatWeLearned?: boolean;
		actionItems?: boolean;
		customerImpact?: boolean;
		financialImpact?: boolean;
		status?: boolean;
		authorId?: boolean;
		createdAt?: boolean;
		updatedAt?: boolean;
		publishedAt?: boolean;
		incident?: boolean | Prisma.IncidentDefaultArgs<ExtArgs>;
		author?: boolean | Prisma.Postmortem$authorArgs<ExtArgs>;
	},
	ExtArgs["result"]["postmortem"]
>;
export type PostmortemSelectUpdateManyAndReturn<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = runtime.Types.Extensions.GetSelect<
	{
		id?: boolean;
		incidentId?: boolean;
		title?: boolean;
		summary?: boolean;
		timeline?: boolean;
		whatHappened?: boolean;
		whyItHappened?: boolean;
		whatWeLearned?: boolean;
		actionItems?: boolean;
		customerImpact?: boolean;
		financialImpact?: boolean;
		status?: boolean;
		authorId?: boolean;
		createdAt?: boolean;
		updatedAt?: boolean;
		publishedAt?: boolean;
		incident?: boolean | Prisma.IncidentDefaultArgs<ExtArgs>;
		author?: boolean | Prisma.Postmortem$authorArgs<ExtArgs>;
	},
	ExtArgs["result"]["postmortem"]
>;
export type PostmortemSelectScalar = {
	id?: boolean;
	incidentId?: boolean;
	title?: boolean;
	summary?: boolean;
	timeline?: boolean;
	whatHappened?: boolean;
	whyItHappened?: boolean;
	whatWeLearned?: boolean;
	actionItems?: boolean;
	customerImpact?: boolean;
	financialImpact?: boolean;
	status?: boolean;
	authorId?: boolean;
	createdAt?: boolean;
	updatedAt?: boolean;
	publishedAt?: boolean;
};
export type PostmortemOmit<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = runtime.Types.Extensions.GetOmit<
	| "id"
	| "incidentId"
	| "title"
	| "summary"
	| "timeline"
	| "whatHappened"
	| "whyItHappened"
	| "whatWeLearned"
	| "actionItems"
	| "customerImpact"
	| "financialImpact"
	| "status"
	| "authorId"
	| "createdAt"
	| "updatedAt"
	| "publishedAt",
	ExtArgs["result"]["postmortem"]
>;
export type PostmortemInclude<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	incident?: boolean | Prisma.IncidentDefaultArgs<ExtArgs>;
	author?: boolean | Prisma.Postmortem$authorArgs<ExtArgs>;
};
export type PostmortemIncludeCreateManyAndReturn<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	incident?: boolean | Prisma.IncidentDefaultArgs<ExtArgs>;
	author?: boolean | Prisma.Postmortem$authorArgs<ExtArgs>;
};
export type PostmortemIncludeUpdateManyAndReturn<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	incident?: boolean | Prisma.IncidentDefaultArgs<ExtArgs>;
	author?: boolean | Prisma.Postmortem$authorArgs<ExtArgs>;
};
export type $PostmortemPayload<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	name: "Postmortem";
	objects: {
		incident: Prisma.$IncidentPayload<ExtArgs>;
		author: Prisma.$UserPayload<ExtArgs> | null;
	};
	scalars: runtime.Types.Extensions.GetPayloadResult<
		{
			id: string;
			incidentId: string;
			title: string | null;
			summary: string | null;
			timeline: string | null;
			whatHappened: string | null;
			whyItHappened: string | null;
			whatWeLearned: string | null;
			actionItems: string | null;
			customerImpact: string | null;
			financialImpact: number | null;
			status: string;
			authorId: string | null;
			createdAt: Date;
			updatedAt: Date;
			publishedAt: Date | null;
		},
		ExtArgs["result"]["postmortem"]
	>;
	composites: {};
};
export type PostmortemGetPayload<
	S extends boolean | null | undefined | PostmortemDefaultArgs,
> = runtime.Types.Result.GetResult<Prisma.$PostmortemPayload, S>;
export type PostmortemCountArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = Omit<PostmortemFindManyArgs, "select" | "include" | "distinct" | "omit"> & {
	select?: PostmortemCountAggregateInputType | true;
};
export interface PostmortemDelegate<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
	GlobalOmitOptions = {},
> {
	[K: symbol]: {
		types: Prisma.TypeMap<ExtArgs>["model"]["Postmortem"];
		meta: {
			name: "Postmortem";
		};
	};
	findUnique<T extends PostmortemFindUniqueArgs>(
		args: Prisma.SelectSubset<T, PostmortemFindUniqueArgs<ExtArgs>>,
	): Prisma.Prisma__PostmortemClient<
		runtime.Types.Result.GetResult<
			Prisma.$PostmortemPayload<ExtArgs>,
			T,
			"findUnique",
			GlobalOmitOptions
		> | null,
		null,
		ExtArgs,
		GlobalOmitOptions
	>;
	findUniqueOrThrow<T extends PostmortemFindUniqueOrThrowArgs>(
		args: Prisma.SelectSubset<T, PostmortemFindUniqueOrThrowArgs<ExtArgs>>,
	): Prisma.Prisma__PostmortemClient<
		runtime.Types.Result.GetResult<
			Prisma.$PostmortemPayload<ExtArgs>,
			T,
			"findUniqueOrThrow",
			GlobalOmitOptions
		>,
		never,
		ExtArgs,
		GlobalOmitOptions
	>;
	findFirst<T extends PostmortemFindFirstArgs>(
		args?: Prisma.SelectSubset<T, PostmortemFindFirstArgs<ExtArgs>>,
	): Prisma.Prisma__PostmortemClient<
		runtime.Types.Result.GetResult<
			Prisma.$PostmortemPayload<ExtArgs>,
			T,
			"findFirst",
			GlobalOmitOptions
		> | null,
		null,
		ExtArgs,
		GlobalOmitOptions
	>;
	findFirstOrThrow<T extends PostmortemFindFirstOrThrowArgs>(
		args?: Prisma.SelectSubset<T, PostmortemFindFirstOrThrowArgs<ExtArgs>>,
	): Prisma.Prisma__PostmortemClient<
		runtime.Types.Result.GetResult<
			Prisma.$PostmortemPayload<ExtArgs>,
			T,
			"findFirstOrThrow",
			GlobalOmitOptions
		>,
		never,
		ExtArgs,
		GlobalOmitOptions
	>;
	findMany<T extends PostmortemFindManyArgs>(
		args?: Prisma.SelectSubset<T, PostmortemFindManyArgs<ExtArgs>>,
	): Prisma.PrismaPromise<
		runtime.Types.Result.GetResult<
			Prisma.$PostmortemPayload<ExtArgs>,
			T,
			"findMany",
			GlobalOmitOptions
		>
	>;
	create<T extends PostmortemCreateArgs>(
		args: Prisma.SelectSubset<T, PostmortemCreateArgs<ExtArgs>>,
	): Prisma.Prisma__PostmortemClient<
		runtime.Types.Result.GetResult<
			Prisma.$PostmortemPayload<ExtArgs>,
			T,
			"create",
			GlobalOmitOptions
		>,
		never,
		ExtArgs,
		GlobalOmitOptions
	>;
	createMany<T extends PostmortemCreateManyArgs>(
		args?: Prisma.SelectSubset<T, PostmortemCreateManyArgs<ExtArgs>>,
	): Prisma.PrismaPromise<Prisma.BatchPayload>;
	createManyAndReturn<T extends PostmortemCreateManyAndReturnArgs>(
		args?: Prisma.SelectSubset<T, PostmortemCreateManyAndReturnArgs<ExtArgs>>,
	): Prisma.PrismaPromise<
		runtime.Types.Result.GetResult<
			Prisma.$PostmortemPayload<ExtArgs>,
			T,
			"createManyAndReturn",
			GlobalOmitOptions
		>
	>;
	delete<T extends PostmortemDeleteArgs>(
		args: Prisma.SelectSubset<T, PostmortemDeleteArgs<ExtArgs>>,
	): Prisma.Prisma__PostmortemClient<
		runtime.Types.Result.GetResult<
			Prisma.$PostmortemPayload<ExtArgs>,
			T,
			"delete",
			GlobalOmitOptions
		>,
		never,
		ExtArgs,
		GlobalOmitOptions
	>;
	update<T extends PostmortemUpdateArgs>(
		args: Prisma.SelectSubset<T, PostmortemUpdateArgs<ExtArgs>>,
	): Prisma.Prisma__PostmortemClient<
		runtime.Types.Result.GetResult<
			Prisma.$PostmortemPayload<ExtArgs>,
			T,
			"update",
			GlobalOmitOptions
		>,
		never,
		ExtArgs,
		GlobalOmitOptions
	>;
	deleteMany<T extends PostmortemDeleteManyArgs>(
		args?: Prisma.SelectSubset<T, PostmortemDeleteManyArgs<ExtArgs>>,
	): Prisma.PrismaPromise<Prisma.BatchPayload>;
	updateMany<T extends PostmortemUpdateManyArgs>(
		args: Prisma.SelectSubset<T, PostmortemUpdateManyArgs<ExtArgs>>,
	): Prisma.PrismaPromise<Prisma.BatchPayload>;
	updateManyAndReturn<T extends PostmortemUpdateManyAndReturnArgs>(
		args: Prisma.SelectSubset<T, PostmortemUpdateManyAndReturnArgs<ExtArgs>>,
	): Prisma.PrismaPromise<
		runtime.Types.Result.GetResult<
			Prisma.$PostmortemPayload<ExtArgs>,
			T,
			"updateManyAndReturn",
			GlobalOmitOptions
		>
	>;
	upsert<T extends PostmortemUpsertArgs>(
		args: Prisma.SelectSubset<T, PostmortemUpsertArgs<ExtArgs>>,
	): Prisma.Prisma__PostmortemClient<
		runtime.Types.Result.GetResult<
			Prisma.$PostmortemPayload<ExtArgs>,
			T,
			"upsert",
			GlobalOmitOptions
		>,
		never,
		ExtArgs,
		GlobalOmitOptions
	>;
	count<T extends PostmortemCountArgs>(
		args?: Prisma.Subset<T, PostmortemCountArgs>,
	): Prisma.PrismaPromise<
		T extends runtime.Types.Utils.Record<"select", any>
			? T["select"] extends true
				? number
				: Prisma.GetScalarType<T["select"], PostmortemCountAggregateOutputType>
			: number
	>;
	aggregate<T extends PostmortemAggregateArgs>(
		args: Prisma.Subset<T, PostmortemAggregateArgs>,
	): Prisma.PrismaPromise<GetPostmortemAggregateType<T>>;
	groupBy<
		T extends PostmortemGroupByArgs,
		HasSelectOrTake extends Prisma.Or<
			Prisma.Extends<"skip", Prisma.Keys<T>>,
			Prisma.Extends<"take", Prisma.Keys<T>>
		>,
		OrderByArg extends Prisma.True extends HasSelectOrTake
			? {
					orderBy: PostmortemGroupByArgs["orderBy"];
				}
			: {
					orderBy?: PostmortemGroupByArgs["orderBy"];
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
		args: Prisma.SubsetIntersection<T, PostmortemGroupByArgs, OrderByArg> &
			InputErrors,
	): {} extends InputErrors
		? GetPostmortemGroupByPayload<T>
		: Prisma.PrismaPromise<InputErrors>;
	readonly fields: PostmortemFieldRefs;
}
export interface Prisma__PostmortemClient<
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
	author<T extends Prisma.Postmortem$authorArgs<ExtArgs> = {}>(
		args?: Prisma.Subset<T, Prisma.Postmortem$authorArgs<ExtArgs>>,
	): Prisma.Prisma__UserClient<
		runtime.Types.Result.GetResult<
			Prisma.$UserPayload<ExtArgs>,
			T,
			"findUniqueOrThrow",
			GlobalOmitOptions
		> | null,
		null,
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
export interface PostmortemFieldRefs {
	readonly id: Prisma.FieldRef<"Postmortem", "String">;
	readonly incidentId: Prisma.FieldRef<"Postmortem", "String">;
	readonly title: Prisma.FieldRef<"Postmortem", "String">;
	readonly summary: Prisma.FieldRef<"Postmortem", "String">;
	readonly timeline: Prisma.FieldRef<"Postmortem", "String">;
	readonly whatHappened: Prisma.FieldRef<"Postmortem", "String">;
	readonly whyItHappened: Prisma.FieldRef<"Postmortem", "String">;
	readonly whatWeLearned: Prisma.FieldRef<"Postmortem", "String">;
	readonly actionItems: Prisma.FieldRef<"Postmortem", "String">;
	readonly customerImpact: Prisma.FieldRef<"Postmortem", "String">;
	readonly financialImpact: Prisma.FieldRef<"Postmortem", "Float">;
	readonly status: Prisma.FieldRef<"Postmortem", "String">;
	readonly authorId: Prisma.FieldRef<"Postmortem", "String">;
	readonly createdAt: Prisma.FieldRef<"Postmortem", "DateTime">;
	readonly updatedAt: Prisma.FieldRef<"Postmortem", "DateTime">;
	readonly publishedAt: Prisma.FieldRef<"Postmortem", "DateTime">;
}
export type PostmortemFindUniqueArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	select?: Prisma.PostmortemSelect<ExtArgs> | null;
	omit?: Prisma.PostmortemOmit<ExtArgs> | null;
	include?: Prisma.PostmortemInclude<ExtArgs> | null;
	where: Prisma.PostmortemWhereUniqueInput;
};
export type PostmortemFindUniqueOrThrowArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	select?: Prisma.PostmortemSelect<ExtArgs> | null;
	omit?: Prisma.PostmortemOmit<ExtArgs> | null;
	include?: Prisma.PostmortemInclude<ExtArgs> | null;
	where: Prisma.PostmortemWhereUniqueInput;
};
export type PostmortemFindFirstArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	select?: Prisma.PostmortemSelect<ExtArgs> | null;
	omit?: Prisma.PostmortemOmit<ExtArgs> | null;
	include?: Prisma.PostmortemInclude<ExtArgs> | null;
	where?: Prisma.PostmortemWhereInput;
	orderBy?:
		| Prisma.PostmortemOrderByWithRelationInput
		| Prisma.PostmortemOrderByWithRelationInput[];
	cursor?: Prisma.PostmortemWhereUniqueInput;
	take?: number;
	skip?: number;
	distinct?:
		| Prisma.PostmortemScalarFieldEnum
		| Prisma.PostmortemScalarFieldEnum[];
};
export type PostmortemFindFirstOrThrowArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	select?: Prisma.PostmortemSelect<ExtArgs> | null;
	omit?: Prisma.PostmortemOmit<ExtArgs> | null;
	include?: Prisma.PostmortemInclude<ExtArgs> | null;
	where?: Prisma.PostmortemWhereInput;
	orderBy?:
		| Prisma.PostmortemOrderByWithRelationInput
		| Prisma.PostmortemOrderByWithRelationInput[];
	cursor?: Prisma.PostmortemWhereUniqueInput;
	take?: number;
	skip?: number;
	distinct?:
		| Prisma.PostmortemScalarFieldEnum
		| Prisma.PostmortemScalarFieldEnum[];
};
export type PostmortemFindManyArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	select?: Prisma.PostmortemSelect<ExtArgs> | null;
	omit?: Prisma.PostmortemOmit<ExtArgs> | null;
	include?: Prisma.PostmortemInclude<ExtArgs> | null;
	where?: Prisma.PostmortemWhereInput;
	orderBy?:
		| Prisma.PostmortemOrderByWithRelationInput
		| Prisma.PostmortemOrderByWithRelationInput[];
	cursor?: Prisma.PostmortemWhereUniqueInput;
	take?: number;
	skip?: number;
	distinct?:
		| Prisma.PostmortemScalarFieldEnum
		| Prisma.PostmortemScalarFieldEnum[];
};
export type PostmortemCreateArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	select?: Prisma.PostmortemSelect<ExtArgs> | null;
	omit?: Prisma.PostmortemOmit<ExtArgs> | null;
	include?: Prisma.PostmortemInclude<ExtArgs> | null;
	data: Prisma.XOR<
		Prisma.PostmortemCreateInput,
		Prisma.PostmortemUncheckedCreateInput
	>;
};
export type PostmortemCreateManyArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	data: Prisma.PostmortemCreateManyInput | Prisma.PostmortemCreateManyInput[];
};
export type PostmortemCreateManyAndReturnArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	select?: Prisma.PostmortemSelectCreateManyAndReturn<ExtArgs> | null;
	omit?: Prisma.PostmortemOmit<ExtArgs> | null;
	data: Prisma.PostmortemCreateManyInput | Prisma.PostmortemCreateManyInput[];
	include?: Prisma.PostmortemIncludeCreateManyAndReturn<ExtArgs> | null;
};
export type PostmortemUpdateArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	select?: Prisma.PostmortemSelect<ExtArgs> | null;
	omit?: Prisma.PostmortemOmit<ExtArgs> | null;
	include?: Prisma.PostmortemInclude<ExtArgs> | null;
	data: Prisma.XOR<
		Prisma.PostmortemUpdateInput,
		Prisma.PostmortemUncheckedUpdateInput
	>;
	where: Prisma.PostmortemWhereUniqueInput;
};
export type PostmortemUpdateManyArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	data: Prisma.XOR<
		Prisma.PostmortemUpdateManyMutationInput,
		Prisma.PostmortemUncheckedUpdateManyInput
	>;
	where?: Prisma.PostmortemWhereInput;
	limit?: number;
};
export type PostmortemUpdateManyAndReturnArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	select?: Prisma.PostmortemSelectUpdateManyAndReturn<ExtArgs> | null;
	omit?: Prisma.PostmortemOmit<ExtArgs> | null;
	data: Prisma.XOR<
		Prisma.PostmortemUpdateManyMutationInput,
		Prisma.PostmortemUncheckedUpdateManyInput
	>;
	where?: Prisma.PostmortemWhereInput;
	limit?: number;
	include?: Prisma.PostmortemIncludeUpdateManyAndReturn<ExtArgs> | null;
};
export type PostmortemUpsertArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	select?: Prisma.PostmortemSelect<ExtArgs> | null;
	omit?: Prisma.PostmortemOmit<ExtArgs> | null;
	include?: Prisma.PostmortemInclude<ExtArgs> | null;
	where: Prisma.PostmortemWhereUniqueInput;
	create: Prisma.XOR<
		Prisma.PostmortemCreateInput,
		Prisma.PostmortemUncheckedCreateInput
	>;
	update: Prisma.XOR<
		Prisma.PostmortemUpdateInput,
		Prisma.PostmortemUncheckedUpdateInput
	>;
};
export type PostmortemDeleteArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	select?: Prisma.PostmortemSelect<ExtArgs> | null;
	omit?: Prisma.PostmortemOmit<ExtArgs> | null;
	include?: Prisma.PostmortemInclude<ExtArgs> | null;
	where: Prisma.PostmortemWhereUniqueInput;
};
export type PostmortemDeleteManyArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	where?: Prisma.PostmortemWhereInput;
	limit?: number;
};
export type Postmortem$authorArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	select?: Prisma.UserSelect<ExtArgs> | null;
	omit?: Prisma.UserOmit<ExtArgs> | null;
	include?: Prisma.UserInclude<ExtArgs> | null;
	where?: Prisma.UserWhereInput;
};
export type PostmortemDefaultArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	select?: Prisma.PostmortemSelect<ExtArgs> | null;
	omit?: Prisma.PostmortemOmit<ExtArgs> | null;
	include?: Prisma.PostmortemInclude<ExtArgs> | null;
};
