import type * as runtime from "@prisma/client/runtime/client";
import type * as Prisma from "../internal/prismaNamespace.js";
export type TimelineEntryModel =
	runtime.Types.Result.DefaultSelection<Prisma.$TimelineEntryPayload>;
export type AggregateTimelineEntry = {
	_count: TimelineEntryCountAggregateOutputType | null;
	_min: TimelineEntryMinAggregateOutputType | null;
	_max: TimelineEntryMaxAggregateOutputType | null;
};
export type TimelineEntryMinAggregateOutputType = {
	id: string | null;
	incidentId: string | null;
	type: string | null;
	title: string | null;
	description: string | null;
	metadata: string | null;
	source: string | null;
	userId: string | null;
	occurredAt: Date | null;
};
export type TimelineEntryMaxAggregateOutputType = {
	id: string | null;
	incidentId: string | null;
	type: string | null;
	title: string | null;
	description: string | null;
	metadata: string | null;
	source: string | null;
	userId: string | null;
	occurredAt: Date | null;
};
export type TimelineEntryCountAggregateOutputType = {
	id: number;
	incidentId: number;
	type: number;
	title: number;
	description: number;
	metadata: number;
	source: number;
	userId: number;
	occurredAt: number;
	_all: number;
};
export type TimelineEntryMinAggregateInputType = {
	id?: true;
	incidentId?: true;
	type?: true;
	title?: true;
	description?: true;
	metadata?: true;
	source?: true;
	userId?: true;
	occurredAt?: true;
};
export type TimelineEntryMaxAggregateInputType = {
	id?: true;
	incidentId?: true;
	type?: true;
	title?: true;
	description?: true;
	metadata?: true;
	source?: true;
	userId?: true;
	occurredAt?: true;
};
export type TimelineEntryCountAggregateInputType = {
	id?: true;
	incidentId?: true;
	type?: true;
	title?: true;
	description?: true;
	metadata?: true;
	source?: true;
	userId?: true;
	occurredAt?: true;
	_all?: true;
};
export type TimelineEntryAggregateArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	where?: Prisma.TimelineEntryWhereInput;
	orderBy?:
		| Prisma.TimelineEntryOrderByWithRelationInput
		| Prisma.TimelineEntryOrderByWithRelationInput[];
	cursor?: Prisma.TimelineEntryWhereUniqueInput;
	take?: number;
	skip?: number;
	_count?: true | TimelineEntryCountAggregateInputType;
	_min?: TimelineEntryMinAggregateInputType;
	_max?: TimelineEntryMaxAggregateInputType;
};
export type GetTimelineEntryAggregateType<
	T extends TimelineEntryAggregateArgs,
> = {
	[P in keyof T & keyof AggregateTimelineEntry]: P extends "_count" | "count"
		? T[P] extends true
			? number
			: Prisma.GetScalarType<T[P], AggregateTimelineEntry[P]>
		: Prisma.GetScalarType<T[P], AggregateTimelineEntry[P]>;
};
export type TimelineEntryGroupByArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	where?: Prisma.TimelineEntryWhereInput;
	orderBy?:
		| Prisma.TimelineEntryOrderByWithAggregationInput
		| Prisma.TimelineEntryOrderByWithAggregationInput[];
	by:
		| Prisma.TimelineEntryScalarFieldEnum[]
		| Prisma.TimelineEntryScalarFieldEnum;
	having?: Prisma.TimelineEntryScalarWhereWithAggregatesInput;
	take?: number;
	skip?: number;
	_count?: TimelineEntryCountAggregateInputType | true;
	_min?: TimelineEntryMinAggregateInputType;
	_max?: TimelineEntryMaxAggregateInputType;
};
export type TimelineEntryGroupByOutputType = {
	id: string;
	incidentId: string;
	type: string;
	title: string;
	description: string | null;
	metadata: string | null;
	source: string;
	userId: string | null;
	occurredAt: Date;
	_count: TimelineEntryCountAggregateOutputType | null;
	_min: TimelineEntryMinAggregateOutputType | null;
	_max: TimelineEntryMaxAggregateOutputType | null;
};
type GetTimelineEntryGroupByPayload<T extends TimelineEntryGroupByArgs> =
	Prisma.PrismaPromise<
		Array<
			Prisma.PickEnumerable<TimelineEntryGroupByOutputType, T["by"]> & {
				[P in keyof T &
					keyof TimelineEntryGroupByOutputType]: P extends "_count"
					? T[P] extends boolean
						? number
						: Prisma.GetScalarType<T[P], TimelineEntryGroupByOutputType[P]>
					: Prisma.GetScalarType<T[P], TimelineEntryGroupByOutputType[P]>;
			}
		>
	>;
export type TimelineEntryWhereInput = {
	AND?: Prisma.TimelineEntryWhereInput | Prisma.TimelineEntryWhereInput[];
	OR?: Prisma.TimelineEntryWhereInput[];
	NOT?: Prisma.TimelineEntryWhereInput | Prisma.TimelineEntryWhereInput[];
	id?: Prisma.StringFilter<"TimelineEntry"> | string;
	incidentId?: Prisma.StringFilter<"TimelineEntry"> | string;
	type?: Prisma.StringFilter<"TimelineEntry"> | string;
	title?: Prisma.StringFilter<"TimelineEntry"> | string;
	description?: Prisma.StringNullableFilter<"TimelineEntry"> | string | null;
	metadata?: Prisma.StringNullableFilter<"TimelineEntry"> | string | null;
	source?: Prisma.StringFilter<"TimelineEntry"> | string;
	userId?: Prisma.StringNullableFilter<"TimelineEntry"> | string | null;
	occurredAt?: Prisma.DateTimeFilter<"TimelineEntry"> | Date | string;
	incident?: Prisma.XOR<
		Prisma.IncidentScalarRelationFilter,
		Prisma.IncidentWhereInput
	>;
	user?: Prisma.XOR<
		Prisma.UserNullableScalarRelationFilter,
		Prisma.UserWhereInput
	> | null;
};
export type TimelineEntryOrderByWithRelationInput = {
	id?: Prisma.SortOrder;
	incidentId?: Prisma.SortOrder;
	type?: Prisma.SortOrder;
	title?: Prisma.SortOrder;
	description?: Prisma.SortOrderInput | Prisma.SortOrder;
	metadata?: Prisma.SortOrderInput | Prisma.SortOrder;
	source?: Prisma.SortOrder;
	userId?: Prisma.SortOrderInput | Prisma.SortOrder;
	occurredAt?: Prisma.SortOrder;
	incident?: Prisma.IncidentOrderByWithRelationInput;
	user?: Prisma.UserOrderByWithRelationInput;
};
export type TimelineEntryWhereUniqueInput = Prisma.AtLeast<
	{
		id?: string;
		AND?: Prisma.TimelineEntryWhereInput | Prisma.TimelineEntryWhereInput[];
		OR?: Prisma.TimelineEntryWhereInput[];
		NOT?: Prisma.TimelineEntryWhereInput | Prisma.TimelineEntryWhereInput[];
		incidentId?: Prisma.StringFilter<"TimelineEntry"> | string;
		type?: Prisma.StringFilter<"TimelineEntry"> | string;
		title?: Prisma.StringFilter<"TimelineEntry"> | string;
		description?: Prisma.StringNullableFilter<"TimelineEntry"> | string | null;
		metadata?: Prisma.StringNullableFilter<"TimelineEntry"> | string | null;
		source?: Prisma.StringFilter<"TimelineEntry"> | string;
		userId?: Prisma.StringNullableFilter<"TimelineEntry"> | string | null;
		occurredAt?: Prisma.DateTimeFilter<"TimelineEntry"> | Date | string;
		incident?: Prisma.XOR<
			Prisma.IncidentScalarRelationFilter,
			Prisma.IncidentWhereInput
		>;
		user?: Prisma.XOR<
			Prisma.UserNullableScalarRelationFilter,
			Prisma.UserWhereInput
		> | null;
	},
	"id"
>;
export type TimelineEntryOrderByWithAggregationInput = {
	id?: Prisma.SortOrder;
	incidentId?: Prisma.SortOrder;
	type?: Prisma.SortOrder;
	title?: Prisma.SortOrder;
	description?: Prisma.SortOrderInput | Prisma.SortOrder;
	metadata?: Prisma.SortOrderInput | Prisma.SortOrder;
	source?: Prisma.SortOrder;
	userId?: Prisma.SortOrderInput | Prisma.SortOrder;
	occurredAt?: Prisma.SortOrder;
	_count?: Prisma.TimelineEntryCountOrderByAggregateInput;
	_max?: Prisma.TimelineEntryMaxOrderByAggregateInput;
	_min?: Prisma.TimelineEntryMinOrderByAggregateInput;
};
export type TimelineEntryScalarWhereWithAggregatesInput = {
	AND?:
		| Prisma.TimelineEntryScalarWhereWithAggregatesInput
		| Prisma.TimelineEntryScalarWhereWithAggregatesInput[];
	OR?: Prisma.TimelineEntryScalarWhereWithAggregatesInput[];
	NOT?:
		| Prisma.TimelineEntryScalarWhereWithAggregatesInput
		| Prisma.TimelineEntryScalarWhereWithAggregatesInput[];
	id?: Prisma.StringWithAggregatesFilter<"TimelineEntry"> | string;
	incidentId?: Prisma.StringWithAggregatesFilter<"TimelineEntry"> | string;
	type?: Prisma.StringWithAggregatesFilter<"TimelineEntry"> | string;
	title?: Prisma.StringWithAggregatesFilter<"TimelineEntry"> | string;
	description?:
		| Prisma.StringNullableWithAggregatesFilter<"TimelineEntry">
		| string
		| null;
	metadata?:
		| Prisma.StringNullableWithAggregatesFilter<"TimelineEntry">
		| string
		| null;
	source?: Prisma.StringWithAggregatesFilter<"TimelineEntry"> | string;
	userId?:
		| Prisma.StringNullableWithAggregatesFilter<"TimelineEntry">
		| string
		| null;
	occurredAt?:
		| Prisma.DateTimeWithAggregatesFilter<"TimelineEntry">
		| Date
		| string;
};
export type TimelineEntryCreateInput = {
	id?: string;
	type: string;
	title: string;
	description?: string | null;
	metadata?: string | null;
	source?: string;
	occurredAt?: Date | string;
	incident: Prisma.IncidentCreateNestedOneWithoutTimelineInput;
	user?: Prisma.UserCreateNestedOneWithoutTimelineEntriesInput;
};
export type TimelineEntryUncheckedCreateInput = {
	id?: string;
	incidentId: string;
	type: string;
	title: string;
	description?: string | null;
	metadata?: string | null;
	source?: string;
	userId?: string | null;
	occurredAt?: Date | string;
};
export type TimelineEntryUpdateInput = {
	id?: Prisma.StringFieldUpdateOperationsInput | string;
	type?: Prisma.StringFieldUpdateOperationsInput | string;
	title?: Prisma.StringFieldUpdateOperationsInput | string;
	description?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	metadata?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	source?: Prisma.StringFieldUpdateOperationsInput | string;
	occurredAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
	incident?: Prisma.IncidentUpdateOneRequiredWithoutTimelineNestedInput;
	user?: Prisma.UserUpdateOneWithoutTimelineEntriesNestedInput;
};
export type TimelineEntryUncheckedUpdateInput = {
	id?: Prisma.StringFieldUpdateOperationsInput | string;
	incidentId?: Prisma.StringFieldUpdateOperationsInput | string;
	type?: Prisma.StringFieldUpdateOperationsInput | string;
	title?: Prisma.StringFieldUpdateOperationsInput | string;
	description?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	metadata?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	source?: Prisma.StringFieldUpdateOperationsInput | string;
	userId?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	occurredAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
};
export type TimelineEntryCreateManyInput = {
	id?: string;
	incidentId: string;
	type: string;
	title: string;
	description?: string | null;
	metadata?: string | null;
	source?: string;
	userId?: string | null;
	occurredAt?: Date | string;
};
export type TimelineEntryUpdateManyMutationInput = {
	id?: Prisma.StringFieldUpdateOperationsInput | string;
	type?: Prisma.StringFieldUpdateOperationsInput | string;
	title?: Prisma.StringFieldUpdateOperationsInput | string;
	description?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	metadata?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	source?: Prisma.StringFieldUpdateOperationsInput | string;
	occurredAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
};
export type TimelineEntryUncheckedUpdateManyInput = {
	id?: Prisma.StringFieldUpdateOperationsInput | string;
	incidentId?: Prisma.StringFieldUpdateOperationsInput | string;
	type?: Prisma.StringFieldUpdateOperationsInput | string;
	title?: Prisma.StringFieldUpdateOperationsInput | string;
	description?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	metadata?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	source?: Prisma.StringFieldUpdateOperationsInput | string;
	userId?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	occurredAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
};
export type TimelineEntryListRelationFilter = {
	every?: Prisma.TimelineEntryWhereInput;
	some?: Prisma.TimelineEntryWhereInput;
	none?: Prisma.TimelineEntryWhereInput;
};
export type TimelineEntryOrderByRelationAggregateInput = {
	_count?: Prisma.SortOrder;
};
export type TimelineEntryCountOrderByAggregateInput = {
	id?: Prisma.SortOrder;
	incidentId?: Prisma.SortOrder;
	type?: Prisma.SortOrder;
	title?: Prisma.SortOrder;
	description?: Prisma.SortOrder;
	metadata?: Prisma.SortOrder;
	source?: Prisma.SortOrder;
	userId?: Prisma.SortOrder;
	occurredAt?: Prisma.SortOrder;
};
export type TimelineEntryMaxOrderByAggregateInput = {
	id?: Prisma.SortOrder;
	incidentId?: Prisma.SortOrder;
	type?: Prisma.SortOrder;
	title?: Prisma.SortOrder;
	description?: Prisma.SortOrder;
	metadata?: Prisma.SortOrder;
	source?: Prisma.SortOrder;
	userId?: Prisma.SortOrder;
	occurredAt?: Prisma.SortOrder;
};
export type TimelineEntryMinOrderByAggregateInput = {
	id?: Prisma.SortOrder;
	incidentId?: Prisma.SortOrder;
	type?: Prisma.SortOrder;
	title?: Prisma.SortOrder;
	description?: Prisma.SortOrder;
	metadata?: Prisma.SortOrder;
	source?: Prisma.SortOrder;
	userId?: Prisma.SortOrder;
	occurredAt?: Prisma.SortOrder;
};
export type TimelineEntryCreateNestedManyWithoutUserInput = {
	create?:
		| Prisma.XOR<
				Prisma.TimelineEntryCreateWithoutUserInput,
				Prisma.TimelineEntryUncheckedCreateWithoutUserInput
		  >
		| Prisma.TimelineEntryCreateWithoutUserInput[]
		| Prisma.TimelineEntryUncheckedCreateWithoutUserInput[];
	connectOrCreate?:
		| Prisma.TimelineEntryCreateOrConnectWithoutUserInput
		| Prisma.TimelineEntryCreateOrConnectWithoutUserInput[];
	createMany?: Prisma.TimelineEntryCreateManyUserInputEnvelope;
	connect?:
		| Prisma.TimelineEntryWhereUniqueInput
		| Prisma.TimelineEntryWhereUniqueInput[];
};
export type TimelineEntryUncheckedCreateNestedManyWithoutUserInput = {
	create?:
		| Prisma.XOR<
				Prisma.TimelineEntryCreateWithoutUserInput,
				Prisma.TimelineEntryUncheckedCreateWithoutUserInput
		  >
		| Prisma.TimelineEntryCreateWithoutUserInput[]
		| Prisma.TimelineEntryUncheckedCreateWithoutUserInput[];
	connectOrCreate?:
		| Prisma.TimelineEntryCreateOrConnectWithoutUserInput
		| Prisma.TimelineEntryCreateOrConnectWithoutUserInput[];
	createMany?: Prisma.TimelineEntryCreateManyUserInputEnvelope;
	connect?:
		| Prisma.TimelineEntryWhereUniqueInput
		| Prisma.TimelineEntryWhereUniqueInput[];
};
export type TimelineEntryUpdateManyWithoutUserNestedInput = {
	create?:
		| Prisma.XOR<
				Prisma.TimelineEntryCreateWithoutUserInput,
				Prisma.TimelineEntryUncheckedCreateWithoutUserInput
		  >
		| Prisma.TimelineEntryCreateWithoutUserInput[]
		| Prisma.TimelineEntryUncheckedCreateWithoutUserInput[];
	connectOrCreate?:
		| Prisma.TimelineEntryCreateOrConnectWithoutUserInput
		| Prisma.TimelineEntryCreateOrConnectWithoutUserInput[];
	upsert?:
		| Prisma.TimelineEntryUpsertWithWhereUniqueWithoutUserInput
		| Prisma.TimelineEntryUpsertWithWhereUniqueWithoutUserInput[];
	createMany?: Prisma.TimelineEntryCreateManyUserInputEnvelope;
	set?:
		| Prisma.TimelineEntryWhereUniqueInput
		| Prisma.TimelineEntryWhereUniqueInput[];
	disconnect?:
		| Prisma.TimelineEntryWhereUniqueInput
		| Prisma.TimelineEntryWhereUniqueInput[];
	delete?:
		| Prisma.TimelineEntryWhereUniqueInput
		| Prisma.TimelineEntryWhereUniqueInput[];
	connect?:
		| Prisma.TimelineEntryWhereUniqueInput
		| Prisma.TimelineEntryWhereUniqueInput[];
	update?:
		| Prisma.TimelineEntryUpdateWithWhereUniqueWithoutUserInput
		| Prisma.TimelineEntryUpdateWithWhereUniqueWithoutUserInput[];
	updateMany?:
		| Prisma.TimelineEntryUpdateManyWithWhereWithoutUserInput
		| Prisma.TimelineEntryUpdateManyWithWhereWithoutUserInput[];
	deleteMany?:
		| Prisma.TimelineEntryScalarWhereInput
		| Prisma.TimelineEntryScalarWhereInput[];
};
export type TimelineEntryUncheckedUpdateManyWithoutUserNestedInput = {
	create?:
		| Prisma.XOR<
				Prisma.TimelineEntryCreateWithoutUserInput,
				Prisma.TimelineEntryUncheckedCreateWithoutUserInput
		  >
		| Prisma.TimelineEntryCreateWithoutUserInput[]
		| Prisma.TimelineEntryUncheckedCreateWithoutUserInput[];
	connectOrCreate?:
		| Prisma.TimelineEntryCreateOrConnectWithoutUserInput
		| Prisma.TimelineEntryCreateOrConnectWithoutUserInput[];
	upsert?:
		| Prisma.TimelineEntryUpsertWithWhereUniqueWithoutUserInput
		| Prisma.TimelineEntryUpsertWithWhereUniqueWithoutUserInput[];
	createMany?: Prisma.TimelineEntryCreateManyUserInputEnvelope;
	set?:
		| Prisma.TimelineEntryWhereUniqueInput
		| Prisma.TimelineEntryWhereUniqueInput[];
	disconnect?:
		| Prisma.TimelineEntryWhereUniqueInput
		| Prisma.TimelineEntryWhereUniqueInput[];
	delete?:
		| Prisma.TimelineEntryWhereUniqueInput
		| Prisma.TimelineEntryWhereUniqueInput[];
	connect?:
		| Prisma.TimelineEntryWhereUniqueInput
		| Prisma.TimelineEntryWhereUniqueInput[];
	update?:
		| Prisma.TimelineEntryUpdateWithWhereUniqueWithoutUserInput
		| Prisma.TimelineEntryUpdateWithWhereUniqueWithoutUserInput[];
	updateMany?:
		| Prisma.TimelineEntryUpdateManyWithWhereWithoutUserInput
		| Prisma.TimelineEntryUpdateManyWithWhereWithoutUserInput[];
	deleteMany?:
		| Prisma.TimelineEntryScalarWhereInput
		| Prisma.TimelineEntryScalarWhereInput[];
};
export type TimelineEntryCreateNestedManyWithoutIncidentInput = {
	create?:
		| Prisma.XOR<
				Prisma.TimelineEntryCreateWithoutIncidentInput,
				Prisma.TimelineEntryUncheckedCreateWithoutIncidentInput
		  >
		| Prisma.TimelineEntryCreateWithoutIncidentInput[]
		| Prisma.TimelineEntryUncheckedCreateWithoutIncidentInput[];
	connectOrCreate?:
		| Prisma.TimelineEntryCreateOrConnectWithoutIncidentInput
		| Prisma.TimelineEntryCreateOrConnectWithoutIncidentInput[];
	createMany?: Prisma.TimelineEntryCreateManyIncidentInputEnvelope;
	connect?:
		| Prisma.TimelineEntryWhereUniqueInput
		| Prisma.TimelineEntryWhereUniqueInput[];
};
export type TimelineEntryUncheckedCreateNestedManyWithoutIncidentInput = {
	create?:
		| Prisma.XOR<
				Prisma.TimelineEntryCreateWithoutIncidentInput,
				Prisma.TimelineEntryUncheckedCreateWithoutIncidentInput
		  >
		| Prisma.TimelineEntryCreateWithoutIncidentInput[]
		| Prisma.TimelineEntryUncheckedCreateWithoutIncidentInput[];
	connectOrCreate?:
		| Prisma.TimelineEntryCreateOrConnectWithoutIncidentInput
		| Prisma.TimelineEntryCreateOrConnectWithoutIncidentInput[];
	createMany?: Prisma.TimelineEntryCreateManyIncidentInputEnvelope;
	connect?:
		| Prisma.TimelineEntryWhereUniqueInput
		| Prisma.TimelineEntryWhereUniqueInput[];
};
export type TimelineEntryUpdateManyWithoutIncidentNestedInput = {
	create?:
		| Prisma.XOR<
				Prisma.TimelineEntryCreateWithoutIncidentInput,
				Prisma.TimelineEntryUncheckedCreateWithoutIncidentInput
		  >
		| Prisma.TimelineEntryCreateWithoutIncidentInput[]
		| Prisma.TimelineEntryUncheckedCreateWithoutIncidentInput[];
	connectOrCreate?:
		| Prisma.TimelineEntryCreateOrConnectWithoutIncidentInput
		| Prisma.TimelineEntryCreateOrConnectWithoutIncidentInput[];
	upsert?:
		| Prisma.TimelineEntryUpsertWithWhereUniqueWithoutIncidentInput
		| Prisma.TimelineEntryUpsertWithWhereUniqueWithoutIncidentInput[];
	createMany?: Prisma.TimelineEntryCreateManyIncidentInputEnvelope;
	set?:
		| Prisma.TimelineEntryWhereUniqueInput
		| Prisma.TimelineEntryWhereUniqueInput[];
	disconnect?:
		| Prisma.TimelineEntryWhereUniqueInput
		| Prisma.TimelineEntryWhereUniqueInput[];
	delete?:
		| Prisma.TimelineEntryWhereUniqueInput
		| Prisma.TimelineEntryWhereUniqueInput[];
	connect?:
		| Prisma.TimelineEntryWhereUniqueInput
		| Prisma.TimelineEntryWhereUniqueInput[];
	update?:
		| Prisma.TimelineEntryUpdateWithWhereUniqueWithoutIncidentInput
		| Prisma.TimelineEntryUpdateWithWhereUniqueWithoutIncidentInput[];
	updateMany?:
		| Prisma.TimelineEntryUpdateManyWithWhereWithoutIncidentInput
		| Prisma.TimelineEntryUpdateManyWithWhereWithoutIncidentInput[];
	deleteMany?:
		| Prisma.TimelineEntryScalarWhereInput
		| Prisma.TimelineEntryScalarWhereInput[];
};
export type TimelineEntryUncheckedUpdateManyWithoutIncidentNestedInput = {
	create?:
		| Prisma.XOR<
				Prisma.TimelineEntryCreateWithoutIncidentInput,
				Prisma.TimelineEntryUncheckedCreateWithoutIncidentInput
		  >
		| Prisma.TimelineEntryCreateWithoutIncidentInput[]
		| Prisma.TimelineEntryUncheckedCreateWithoutIncidentInput[];
	connectOrCreate?:
		| Prisma.TimelineEntryCreateOrConnectWithoutIncidentInput
		| Prisma.TimelineEntryCreateOrConnectWithoutIncidentInput[];
	upsert?:
		| Prisma.TimelineEntryUpsertWithWhereUniqueWithoutIncidentInput
		| Prisma.TimelineEntryUpsertWithWhereUniqueWithoutIncidentInput[];
	createMany?: Prisma.TimelineEntryCreateManyIncidentInputEnvelope;
	set?:
		| Prisma.TimelineEntryWhereUniqueInput
		| Prisma.TimelineEntryWhereUniqueInput[];
	disconnect?:
		| Prisma.TimelineEntryWhereUniqueInput
		| Prisma.TimelineEntryWhereUniqueInput[];
	delete?:
		| Prisma.TimelineEntryWhereUniqueInput
		| Prisma.TimelineEntryWhereUniqueInput[];
	connect?:
		| Prisma.TimelineEntryWhereUniqueInput
		| Prisma.TimelineEntryWhereUniqueInput[];
	update?:
		| Prisma.TimelineEntryUpdateWithWhereUniqueWithoutIncidentInput
		| Prisma.TimelineEntryUpdateWithWhereUniqueWithoutIncidentInput[];
	updateMany?:
		| Prisma.TimelineEntryUpdateManyWithWhereWithoutIncidentInput
		| Prisma.TimelineEntryUpdateManyWithWhereWithoutIncidentInput[];
	deleteMany?:
		| Prisma.TimelineEntryScalarWhereInput
		| Prisma.TimelineEntryScalarWhereInput[];
};
export type TimelineEntryCreateWithoutUserInput = {
	id?: string;
	type: string;
	title: string;
	description?: string | null;
	metadata?: string | null;
	source?: string;
	occurredAt?: Date | string;
	incident: Prisma.IncidentCreateNestedOneWithoutTimelineInput;
};
export type TimelineEntryUncheckedCreateWithoutUserInput = {
	id?: string;
	incidentId: string;
	type: string;
	title: string;
	description?: string | null;
	metadata?: string | null;
	source?: string;
	occurredAt?: Date | string;
};
export type TimelineEntryCreateOrConnectWithoutUserInput = {
	where: Prisma.TimelineEntryWhereUniqueInput;
	create: Prisma.XOR<
		Prisma.TimelineEntryCreateWithoutUserInput,
		Prisma.TimelineEntryUncheckedCreateWithoutUserInput
	>;
};
export type TimelineEntryCreateManyUserInputEnvelope = {
	data:
		| Prisma.TimelineEntryCreateManyUserInput
		| Prisma.TimelineEntryCreateManyUserInput[];
};
export type TimelineEntryUpsertWithWhereUniqueWithoutUserInput = {
	where: Prisma.TimelineEntryWhereUniqueInput;
	update: Prisma.XOR<
		Prisma.TimelineEntryUpdateWithoutUserInput,
		Prisma.TimelineEntryUncheckedUpdateWithoutUserInput
	>;
	create: Prisma.XOR<
		Prisma.TimelineEntryCreateWithoutUserInput,
		Prisma.TimelineEntryUncheckedCreateWithoutUserInput
	>;
};
export type TimelineEntryUpdateWithWhereUniqueWithoutUserInput = {
	where: Prisma.TimelineEntryWhereUniqueInput;
	data: Prisma.XOR<
		Prisma.TimelineEntryUpdateWithoutUserInput,
		Prisma.TimelineEntryUncheckedUpdateWithoutUserInput
	>;
};
export type TimelineEntryUpdateManyWithWhereWithoutUserInput = {
	where: Prisma.TimelineEntryScalarWhereInput;
	data: Prisma.XOR<
		Prisma.TimelineEntryUpdateManyMutationInput,
		Prisma.TimelineEntryUncheckedUpdateManyWithoutUserInput
	>;
};
export type TimelineEntryScalarWhereInput = {
	AND?:
		| Prisma.TimelineEntryScalarWhereInput
		| Prisma.TimelineEntryScalarWhereInput[];
	OR?: Prisma.TimelineEntryScalarWhereInput[];
	NOT?:
		| Prisma.TimelineEntryScalarWhereInput
		| Prisma.TimelineEntryScalarWhereInput[];
	id?: Prisma.StringFilter<"TimelineEntry"> | string;
	incidentId?: Prisma.StringFilter<"TimelineEntry"> | string;
	type?: Prisma.StringFilter<"TimelineEntry"> | string;
	title?: Prisma.StringFilter<"TimelineEntry"> | string;
	description?: Prisma.StringNullableFilter<"TimelineEntry"> | string | null;
	metadata?: Prisma.StringNullableFilter<"TimelineEntry"> | string | null;
	source?: Prisma.StringFilter<"TimelineEntry"> | string;
	userId?: Prisma.StringNullableFilter<"TimelineEntry"> | string | null;
	occurredAt?: Prisma.DateTimeFilter<"TimelineEntry"> | Date | string;
};
export type TimelineEntryCreateWithoutIncidentInput = {
	id?: string;
	type: string;
	title: string;
	description?: string | null;
	metadata?: string | null;
	source?: string;
	occurredAt?: Date | string;
	user?: Prisma.UserCreateNestedOneWithoutTimelineEntriesInput;
};
export type TimelineEntryUncheckedCreateWithoutIncidentInput = {
	id?: string;
	type: string;
	title: string;
	description?: string | null;
	metadata?: string | null;
	source?: string;
	userId?: string | null;
	occurredAt?: Date | string;
};
export type TimelineEntryCreateOrConnectWithoutIncidentInput = {
	where: Prisma.TimelineEntryWhereUniqueInput;
	create: Prisma.XOR<
		Prisma.TimelineEntryCreateWithoutIncidentInput,
		Prisma.TimelineEntryUncheckedCreateWithoutIncidentInput
	>;
};
export type TimelineEntryCreateManyIncidentInputEnvelope = {
	data:
		| Prisma.TimelineEntryCreateManyIncidentInput
		| Prisma.TimelineEntryCreateManyIncidentInput[];
};
export type TimelineEntryUpsertWithWhereUniqueWithoutIncidentInput = {
	where: Prisma.TimelineEntryWhereUniqueInput;
	update: Prisma.XOR<
		Prisma.TimelineEntryUpdateWithoutIncidentInput,
		Prisma.TimelineEntryUncheckedUpdateWithoutIncidentInput
	>;
	create: Prisma.XOR<
		Prisma.TimelineEntryCreateWithoutIncidentInput,
		Prisma.TimelineEntryUncheckedCreateWithoutIncidentInput
	>;
};
export type TimelineEntryUpdateWithWhereUniqueWithoutIncidentInput = {
	where: Prisma.TimelineEntryWhereUniqueInput;
	data: Prisma.XOR<
		Prisma.TimelineEntryUpdateWithoutIncidentInput,
		Prisma.TimelineEntryUncheckedUpdateWithoutIncidentInput
	>;
};
export type TimelineEntryUpdateManyWithWhereWithoutIncidentInput = {
	where: Prisma.TimelineEntryScalarWhereInput;
	data: Prisma.XOR<
		Prisma.TimelineEntryUpdateManyMutationInput,
		Prisma.TimelineEntryUncheckedUpdateManyWithoutIncidentInput
	>;
};
export type TimelineEntryCreateManyUserInput = {
	id?: string;
	incidentId: string;
	type: string;
	title: string;
	description?: string | null;
	metadata?: string | null;
	source?: string;
	occurredAt?: Date | string;
};
export type TimelineEntryUpdateWithoutUserInput = {
	id?: Prisma.StringFieldUpdateOperationsInput | string;
	type?: Prisma.StringFieldUpdateOperationsInput | string;
	title?: Prisma.StringFieldUpdateOperationsInput | string;
	description?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	metadata?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	source?: Prisma.StringFieldUpdateOperationsInput | string;
	occurredAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
	incident?: Prisma.IncidentUpdateOneRequiredWithoutTimelineNestedInput;
};
export type TimelineEntryUncheckedUpdateWithoutUserInput = {
	id?: Prisma.StringFieldUpdateOperationsInput | string;
	incidentId?: Prisma.StringFieldUpdateOperationsInput | string;
	type?: Prisma.StringFieldUpdateOperationsInput | string;
	title?: Prisma.StringFieldUpdateOperationsInput | string;
	description?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	metadata?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	source?: Prisma.StringFieldUpdateOperationsInput | string;
	occurredAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
};
export type TimelineEntryUncheckedUpdateManyWithoutUserInput = {
	id?: Prisma.StringFieldUpdateOperationsInput | string;
	incidentId?: Prisma.StringFieldUpdateOperationsInput | string;
	type?: Prisma.StringFieldUpdateOperationsInput | string;
	title?: Prisma.StringFieldUpdateOperationsInput | string;
	description?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	metadata?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	source?: Prisma.StringFieldUpdateOperationsInput | string;
	occurredAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
};
export type TimelineEntryCreateManyIncidentInput = {
	id?: string;
	type: string;
	title: string;
	description?: string | null;
	metadata?: string | null;
	source?: string;
	userId?: string | null;
	occurredAt?: Date | string;
};
export type TimelineEntryUpdateWithoutIncidentInput = {
	id?: Prisma.StringFieldUpdateOperationsInput | string;
	type?: Prisma.StringFieldUpdateOperationsInput | string;
	title?: Prisma.StringFieldUpdateOperationsInput | string;
	description?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	metadata?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	source?: Prisma.StringFieldUpdateOperationsInput | string;
	occurredAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
	user?: Prisma.UserUpdateOneWithoutTimelineEntriesNestedInput;
};
export type TimelineEntryUncheckedUpdateWithoutIncidentInput = {
	id?: Prisma.StringFieldUpdateOperationsInput | string;
	type?: Prisma.StringFieldUpdateOperationsInput | string;
	title?: Prisma.StringFieldUpdateOperationsInput | string;
	description?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	metadata?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	source?: Prisma.StringFieldUpdateOperationsInput | string;
	userId?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	occurredAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
};
export type TimelineEntryUncheckedUpdateManyWithoutIncidentInput = {
	id?: Prisma.StringFieldUpdateOperationsInput | string;
	type?: Prisma.StringFieldUpdateOperationsInput | string;
	title?: Prisma.StringFieldUpdateOperationsInput | string;
	description?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	metadata?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	source?: Prisma.StringFieldUpdateOperationsInput | string;
	userId?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	occurredAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
};
export type TimelineEntrySelect<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = runtime.Types.Extensions.GetSelect<
	{
		id?: boolean;
		incidentId?: boolean;
		type?: boolean;
		title?: boolean;
		description?: boolean;
		metadata?: boolean;
		source?: boolean;
		userId?: boolean;
		occurredAt?: boolean;
		incident?: boolean | Prisma.IncidentDefaultArgs<ExtArgs>;
		user?: boolean | Prisma.TimelineEntry$userArgs<ExtArgs>;
	},
	ExtArgs["result"]["timelineEntry"]
>;
export type TimelineEntrySelectCreateManyAndReturn<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = runtime.Types.Extensions.GetSelect<
	{
		id?: boolean;
		incidentId?: boolean;
		type?: boolean;
		title?: boolean;
		description?: boolean;
		metadata?: boolean;
		source?: boolean;
		userId?: boolean;
		occurredAt?: boolean;
		incident?: boolean | Prisma.IncidentDefaultArgs<ExtArgs>;
		user?: boolean | Prisma.TimelineEntry$userArgs<ExtArgs>;
	},
	ExtArgs["result"]["timelineEntry"]
>;
export type TimelineEntrySelectUpdateManyAndReturn<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = runtime.Types.Extensions.GetSelect<
	{
		id?: boolean;
		incidentId?: boolean;
		type?: boolean;
		title?: boolean;
		description?: boolean;
		metadata?: boolean;
		source?: boolean;
		userId?: boolean;
		occurredAt?: boolean;
		incident?: boolean | Prisma.IncidentDefaultArgs<ExtArgs>;
		user?: boolean | Prisma.TimelineEntry$userArgs<ExtArgs>;
	},
	ExtArgs["result"]["timelineEntry"]
>;
export type TimelineEntrySelectScalar = {
	id?: boolean;
	incidentId?: boolean;
	type?: boolean;
	title?: boolean;
	description?: boolean;
	metadata?: boolean;
	source?: boolean;
	userId?: boolean;
	occurredAt?: boolean;
};
export type TimelineEntryOmit<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = runtime.Types.Extensions.GetOmit<
	| "id"
	| "incidentId"
	| "type"
	| "title"
	| "description"
	| "metadata"
	| "source"
	| "userId"
	| "occurredAt",
	ExtArgs["result"]["timelineEntry"]
>;
export type TimelineEntryInclude<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	incident?: boolean | Prisma.IncidentDefaultArgs<ExtArgs>;
	user?: boolean | Prisma.TimelineEntry$userArgs<ExtArgs>;
};
export type TimelineEntryIncludeCreateManyAndReturn<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	incident?: boolean | Prisma.IncidentDefaultArgs<ExtArgs>;
	user?: boolean | Prisma.TimelineEntry$userArgs<ExtArgs>;
};
export type TimelineEntryIncludeUpdateManyAndReturn<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	incident?: boolean | Prisma.IncidentDefaultArgs<ExtArgs>;
	user?: boolean | Prisma.TimelineEntry$userArgs<ExtArgs>;
};
export type $TimelineEntryPayload<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	name: "TimelineEntry";
	objects: {
		incident: Prisma.$IncidentPayload<ExtArgs>;
		user: Prisma.$UserPayload<ExtArgs> | null;
	};
	scalars: runtime.Types.Extensions.GetPayloadResult<
		{
			id: string;
			incidentId: string;
			type: string;
			title: string;
			description: string | null;
			metadata: string | null;
			source: string;
			userId: string | null;
			occurredAt: Date;
		},
		ExtArgs["result"]["timelineEntry"]
	>;
	composites: {};
};
export type TimelineEntryGetPayload<
	S extends boolean | null | undefined | TimelineEntryDefaultArgs,
> = runtime.Types.Result.GetResult<Prisma.$TimelineEntryPayload, S>;
export type TimelineEntryCountArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = Omit<
	TimelineEntryFindManyArgs,
	"select" | "include" | "distinct" | "omit"
> & {
	select?: TimelineEntryCountAggregateInputType | true;
};
export interface TimelineEntryDelegate<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
	GlobalOmitOptions = {},
> {
	[K: symbol]: {
		types: Prisma.TypeMap<ExtArgs>["model"]["TimelineEntry"];
		meta: {
			name: "TimelineEntry";
		};
	};
	findUnique<T extends TimelineEntryFindUniqueArgs>(
		args: Prisma.SelectSubset<T, TimelineEntryFindUniqueArgs<ExtArgs>>,
	): Prisma.Prisma__TimelineEntryClient<
		runtime.Types.Result.GetResult<
			Prisma.$TimelineEntryPayload<ExtArgs>,
			T,
			"findUnique",
			GlobalOmitOptions
		> | null,
		null,
		ExtArgs,
		GlobalOmitOptions
	>;
	findUniqueOrThrow<T extends TimelineEntryFindUniqueOrThrowArgs>(
		args: Prisma.SelectSubset<T, TimelineEntryFindUniqueOrThrowArgs<ExtArgs>>,
	): Prisma.Prisma__TimelineEntryClient<
		runtime.Types.Result.GetResult<
			Prisma.$TimelineEntryPayload<ExtArgs>,
			T,
			"findUniqueOrThrow",
			GlobalOmitOptions
		>,
		never,
		ExtArgs,
		GlobalOmitOptions
	>;
	findFirst<T extends TimelineEntryFindFirstArgs>(
		args?: Prisma.SelectSubset<T, TimelineEntryFindFirstArgs<ExtArgs>>,
	): Prisma.Prisma__TimelineEntryClient<
		runtime.Types.Result.GetResult<
			Prisma.$TimelineEntryPayload<ExtArgs>,
			T,
			"findFirst",
			GlobalOmitOptions
		> | null,
		null,
		ExtArgs,
		GlobalOmitOptions
	>;
	findFirstOrThrow<T extends TimelineEntryFindFirstOrThrowArgs>(
		args?: Prisma.SelectSubset<T, TimelineEntryFindFirstOrThrowArgs<ExtArgs>>,
	): Prisma.Prisma__TimelineEntryClient<
		runtime.Types.Result.GetResult<
			Prisma.$TimelineEntryPayload<ExtArgs>,
			T,
			"findFirstOrThrow",
			GlobalOmitOptions
		>,
		never,
		ExtArgs,
		GlobalOmitOptions
	>;
	findMany<T extends TimelineEntryFindManyArgs>(
		args?: Prisma.SelectSubset<T, TimelineEntryFindManyArgs<ExtArgs>>,
	): Prisma.PrismaPromise<
		runtime.Types.Result.GetResult<
			Prisma.$TimelineEntryPayload<ExtArgs>,
			T,
			"findMany",
			GlobalOmitOptions
		>
	>;
	create<T extends TimelineEntryCreateArgs>(
		args: Prisma.SelectSubset<T, TimelineEntryCreateArgs<ExtArgs>>,
	): Prisma.Prisma__TimelineEntryClient<
		runtime.Types.Result.GetResult<
			Prisma.$TimelineEntryPayload<ExtArgs>,
			T,
			"create",
			GlobalOmitOptions
		>,
		never,
		ExtArgs,
		GlobalOmitOptions
	>;
	createMany<T extends TimelineEntryCreateManyArgs>(
		args?: Prisma.SelectSubset<T, TimelineEntryCreateManyArgs<ExtArgs>>,
	): Prisma.PrismaPromise<Prisma.BatchPayload>;
	createManyAndReturn<T extends TimelineEntryCreateManyAndReturnArgs>(
		args?: Prisma.SelectSubset<
			T,
			TimelineEntryCreateManyAndReturnArgs<ExtArgs>
		>,
	): Prisma.PrismaPromise<
		runtime.Types.Result.GetResult<
			Prisma.$TimelineEntryPayload<ExtArgs>,
			T,
			"createManyAndReturn",
			GlobalOmitOptions
		>
	>;
	delete<T extends TimelineEntryDeleteArgs>(
		args: Prisma.SelectSubset<T, TimelineEntryDeleteArgs<ExtArgs>>,
	): Prisma.Prisma__TimelineEntryClient<
		runtime.Types.Result.GetResult<
			Prisma.$TimelineEntryPayload<ExtArgs>,
			T,
			"delete",
			GlobalOmitOptions
		>,
		never,
		ExtArgs,
		GlobalOmitOptions
	>;
	update<T extends TimelineEntryUpdateArgs>(
		args: Prisma.SelectSubset<T, TimelineEntryUpdateArgs<ExtArgs>>,
	): Prisma.Prisma__TimelineEntryClient<
		runtime.Types.Result.GetResult<
			Prisma.$TimelineEntryPayload<ExtArgs>,
			T,
			"update",
			GlobalOmitOptions
		>,
		never,
		ExtArgs,
		GlobalOmitOptions
	>;
	deleteMany<T extends TimelineEntryDeleteManyArgs>(
		args?: Prisma.SelectSubset<T, TimelineEntryDeleteManyArgs<ExtArgs>>,
	): Prisma.PrismaPromise<Prisma.BatchPayload>;
	updateMany<T extends TimelineEntryUpdateManyArgs>(
		args: Prisma.SelectSubset<T, TimelineEntryUpdateManyArgs<ExtArgs>>,
	): Prisma.PrismaPromise<Prisma.BatchPayload>;
	updateManyAndReturn<T extends TimelineEntryUpdateManyAndReturnArgs>(
		args: Prisma.SelectSubset<T, TimelineEntryUpdateManyAndReturnArgs<ExtArgs>>,
	): Prisma.PrismaPromise<
		runtime.Types.Result.GetResult<
			Prisma.$TimelineEntryPayload<ExtArgs>,
			T,
			"updateManyAndReturn",
			GlobalOmitOptions
		>
	>;
	upsert<T extends TimelineEntryUpsertArgs>(
		args: Prisma.SelectSubset<T, TimelineEntryUpsertArgs<ExtArgs>>,
	): Prisma.Prisma__TimelineEntryClient<
		runtime.Types.Result.GetResult<
			Prisma.$TimelineEntryPayload<ExtArgs>,
			T,
			"upsert",
			GlobalOmitOptions
		>,
		never,
		ExtArgs,
		GlobalOmitOptions
	>;
	count<T extends TimelineEntryCountArgs>(
		args?: Prisma.Subset<T, TimelineEntryCountArgs>,
	): Prisma.PrismaPromise<
		T extends runtime.Types.Utils.Record<"select", any>
			? T["select"] extends true
				? number
				: Prisma.GetScalarType<
						T["select"],
						TimelineEntryCountAggregateOutputType
					>
			: number
	>;
	aggregate<T extends TimelineEntryAggregateArgs>(
		args: Prisma.Subset<T, TimelineEntryAggregateArgs>,
	): Prisma.PrismaPromise<GetTimelineEntryAggregateType<T>>;
	groupBy<
		T extends TimelineEntryGroupByArgs,
		HasSelectOrTake extends Prisma.Or<
			Prisma.Extends<"skip", Prisma.Keys<T>>,
			Prisma.Extends<"take", Prisma.Keys<T>>
		>,
		OrderByArg extends Prisma.True extends HasSelectOrTake
			? {
					orderBy: TimelineEntryGroupByArgs["orderBy"];
				}
			: {
					orderBy?: TimelineEntryGroupByArgs["orderBy"];
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
		args: Prisma.SubsetIntersection<T, TimelineEntryGroupByArgs, OrderByArg> &
			InputErrors,
	): {} extends InputErrors
		? GetTimelineEntryGroupByPayload<T>
		: Prisma.PrismaPromise<InputErrors>;
	readonly fields: TimelineEntryFieldRefs;
}
export interface Prisma__TimelineEntryClient<
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
	user<T extends Prisma.TimelineEntry$userArgs<ExtArgs> = {}>(
		args?: Prisma.Subset<T, Prisma.TimelineEntry$userArgs<ExtArgs>>,
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
export interface TimelineEntryFieldRefs {
	readonly id: Prisma.FieldRef<"TimelineEntry", "String">;
	readonly incidentId: Prisma.FieldRef<"TimelineEntry", "String">;
	readonly type: Prisma.FieldRef<"TimelineEntry", "String">;
	readonly title: Prisma.FieldRef<"TimelineEntry", "String">;
	readonly description: Prisma.FieldRef<"TimelineEntry", "String">;
	readonly metadata: Prisma.FieldRef<"TimelineEntry", "String">;
	readonly source: Prisma.FieldRef<"TimelineEntry", "String">;
	readonly userId: Prisma.FieldRef<"TimelineEntry", "String">;
	readonly occurredAt: Prisma.FieldRef<"TimelineEntry", "DateTime">;
}
export type TimelineEntryFindUniqueArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	select?: Prisma.TimelineEntrySelect<ExtArgs> | null;
	omit?: Prisma.TimelineEntryOmit<ExtArgs> | null;
	include?: Prisma.TimelineEntryInclude<ExtArgs> | null;
	where: Prisma.TimelineEntryWhereUniqueInput;
};
export type TimelineEntryFindUniqueOrThrowArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	select?: Prisma.TimelineEntrySelect<ExtArgs> | null;
	omit?: Prisma.TimelineEntryOmit<ExtArgs> | null;
	include?: Prisma.TimelineEntryInclude<ExtArgs> | null;
	where: Prisma.TimelineEntryWhereUniqueInput;
};
export type TimelineEntryFindFirstArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	select?: Prisma.TimelineEntrySelect<ExtArgs> | null;
	omit?: Prisma.TimelineEntryOmit<ExtArgs> | null;
	include?: Prisma.TimelineEntryInclude<ExtArgs> | null;
	where?: Prisma.TimelineEntryWhereInput;
	orderBy?:
		| Prisma.TimelineEntryOrderByWithRelationInput
		| Prisma.TimelineEntryOrderByWithRelationInput[];
	cursor?: Prisma.TimelineEntryWhereUniqueInput;
	take?: number;
	skip?: number;
	distinct?:
		| Prisma.TimelineEntryScalarFieldEnum
		| Prisma.TimelineEntryScalarFieldEnum[];
};
export type TimelineEntryFindFirstOrThrowArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	select?: Prisma.TimelineEntrySelect<ExtArgs> | null;
	omit?: Prisma.TimelineEntryOmit<ExtArgs> | null;
	include?: Prisma.TimelineEntryInclude<ExtArgs> | null;
	where?: Prisma.TimelineEntryWhereInput;
	orderBy?:
		| Prisma.TimelineEntryOrderByWithRelationInput
		| Prisma.TimelineEntryOrderByWithRelationInput[];
	cursor?: Prisma.TimelineEntryWhereUniqueInput;
	take?: number;
	skip?: number;
	distinct?:
		| Prisma.TimelineEntryScalarFieldEnum
		| Prisma.TimelineEntryScalarFieldEnum[];
};
export type TimelineEntryFindManyArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	select?: Prisma.TimelineEntrySelect<ExtArgs> | null;
	omit?: Prisma.TimelineEntryOmit<ExtArgs> | null;
	include?: Prisma.TimelineEntryInclude<ExtArgs> | null;
	where?: Prisma.TimelineEntryWhereInput;
	orderBy?:
		| Prisma.TimelineEntryOrderByWithRelationInput
		| Prisma.TimelineEntryOrderByWithRelationInput[];
	cursor?: Prisma.TimelineEntryWhereUniqueInput;
	take?: number;
	skip?: number;
	distinct?:
		| Prisma.TimelineEntryScalarFieldEnum
		| Prisma.TimelineEntryScalarFieldEnum[];
};
export type TimelineEntryCreateArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	select?: Prisma.TimelineEntrySelect<ExtArgs> | null;
	omit?: Prisma.TimelineEntryOmit<ExtArgs> | null;
	include?: Prisma.TimelineEntryInclude<ExtArgs> | null;
	data: Prisma.XOR<
		Prisma.TimelineEntryCreateInput,
		Prisma.TimelineEntryUncheckedCreateInput
	>;
};
export type TimelineEntryCreateManyArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	data:
		| Prisma.TimelineEntryCreateManyInput
		| Prisma.TimelineEntryCreateManyInput[];
};
export type TimelineEntryCreateManyAndReturnArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	select?: Prisma.TimelineEntrySelectCreateManyAndReturn<ExtArgs> | null;
	omit?: Prisma.TimelineEntryOmit<ExtArgs> | null;
	data:
		| Prisma.TimelineEntryCreateManyInput
		| Prisma.TimelineEntryCreateManyInput[];
	include?: Prisma.TimelineEntryIncludeCreateManyAndReturn<ExtArgs> | null;
};
export type TimelineEntryUpdateArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	select?: Prisma.TimelineEntrySelect<ExtArgs> | null;
	omit?: Prisma.TimelineEntryOmit<ExtArgs> | null;
	include?: Prisma.TimelineEntryInclude<ExtArgs> | null;
	data: Prisma.XOR<
		Prisma.TimelineEntryUpdateInput,
		Prisma.TimelineEntryUncheckedUpdateInput
	>;
	where: Prisma.TimelineEntryWhereUniqueInput;
};
export type TimelineEntryUpdateManyArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	data: Prisma.XOR<
		Prisma.TimelineEntryUpdateManyMutationInput,
		Prisma.TimelineEntryUncheckedUpdateManyInput
	>;
	where?: Prisma.TimelineEntryWhereInput;
	limit?: number;
};
export type TimelineEntryUpdateManyAndReturnArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	select?: Prisma.TimelineEntrySelectUpdateManyAndReturn<ExtArgs> | null;
	omit?: Prisma.TimelineEntryOmit<ExtArgs> | null;
	data: Prisma.XOR<
		Prisma.TimelineEntryUpdateManyMutationInput,
		Prisma.TimelineEntryUncheckedUpdateManyInput
	>;
	where?: Prisma.TimelineEntryWhereInput;
	limit?: number;
	include?: Prisma.TimelineEntryIncludeUpdateManyAndReturn<ExtArgs> | null;
};
export type TimelineEntryUpsertArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	select?: Prisma.TimelineEntrySelect<ExtArgs> | null;
	omit?: Prisma.TimelineEntryOmit<ExtArgs> | null;
	include?: Prisma.TimelineEntryInclude<ExtArgs> | null;
	where: Prisma.TimelineEntryWhereUniqueInput;
	create: Prisma.XOR<
		Prisma.TimelineEntryCreateInput,
		Prisma.TimelineEntryUncheckedCreateInput
	>;
	update: Prisma.XOR<
		Prisma.TimelineEntryUpdateInput,
		Prisma.TimelineEntryUncheckedUpdateInput
	>;
};
export type TimelineEntryDeleteArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	select?: Prisma.TimelineEntrySelect<ExtArgs> | null;
	omit?: Prisma.TimelineEntryOmit<ExtArgs> | null;
	include?: Prisma.TimelineEntryInclude<ExtArgs> | null;
	where: Prisma.TimelineEntryWhereUniqueInput;
};
export type TimelineEntryDeleteManyArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	where?: Prisma.TimelineEntryWhereInput;
	limit?: number;
};
export type TimelineEntry$userArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	select?: Prisma.UserSelect<ExtArgs> | null;
	omit?: Prisma.UserOmit<ExtArgs> | null;
	include?: Prisma.UserInclude<ExtArgs> | null;
	where?: Prisma.UserWhereInput;
};
export type TimelineEntryDefaultArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	select?: Prisma.TimelineEntrySelect<ExtArgs> | null;
	omit?: Prisma.TimelineEntryOmit<ExtArgs> | null;
	include?: Prisma.TimelineEntryInclude<ExtArgs> | null;
};
