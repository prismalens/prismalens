import type * as runtime from "@prisma/client/runtime/client";
import type * as Prisma from "../internal/prismaNamespace.js";
export type ServiceSuggestionModel =
	runtime.Types.Result.DefaultSelection<Prisma.$ServiceSuggestionPayload>;
export type AggregateServiceSuggestion = {
	_count: ServiceSuggestionCountAggregateOutputType | null;
	_min: ServiceSuggestionMinAggregateOutputType | null;
	_max: ServiceSuggestionMaxAggregateOutputType | null;
};
export type ServiceSuggestionMinAggregateOutputType = {
	id: string | null;
	connectionId: string | null;
	suggestedName: string | null;
	displayName: string | null;
	repository: string | null;
	isMonorepo: boolean | null;
	subPath: string | null;
	status: string | null;
	metadata: string | null;
	createdAt: Date | null;
	updatedAt: Date | null;
};
export type ServiceSuggestionMaxAggregateOutputType = {
	id: string | null;
	connectionId: string | null;
	suggestedName: string | null;
	displayName: string | null;
	repository: string | null;
	isMonorepo: boolean | null;
	subPath: string | null;
	status: string | null;
	metadata: string | null;
	createdAt: Date | null;
	updatedAt: Date | null;
};
export type ServiceSuggestionCountAggregateOutputType = {
	id: number;
	connectionId: number;
	suggestedName: number;
	displayName: number;
	repository: number;
	isMonorepo: number;
	subPath: number;
	status: number;
	metadata: number;
	createdAt: number;
	updatedAt: number;
	_all: number;
};
export type ServiceSuggestionMinAggregateInputType = {
	id?: true;
	connectionId?: true;
	suggestedName?: true;
	displayName?: true;
	repository?: true;
	isMonorepo?: true;
	subPath?: true;
	status?: true;
	metadata?: true;
	createdAt?: true;
	updatedAt?: true;
};
export type ServiceSuggestionMaxAggregateInputType = {
	id?: true;
	connectionId?: true;
	suggestedName?: true;
	displayName?: true;
	repository?: true;
	isMonorepo?: true;
	subPath?: true;
	status?: true;
	metadata?: true;
	createdAt?: true;
	updatedAt?: true;
};
export type ServiceSuggestionCountAggregateInputType = {
	id?: true;
	connectionId?: true;
	suggestedName?: true;
	displayName?: true;
	repository?: true;
	isMonorepo?: true;
	subPath?: true;
	status?: true;
	metadata?: true;
	createdAt?: true;
	updatedAt?: true;
	_all?: true;
};
export type ServiceSuggestionAggregateArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	where?: Prisma.ServiceSuggestionWhereInput;
	orderBy?:
		| Prisma.ServiceSuggestionOrderByWithRelationInput
		| Prisma.ServiceSuggestionOrderByWithRelationInput[];
	cursor?: Prisma.ServiceSuggestionWhereUniqueInput;
	take?: number;
	skip?: number;
	_count?: true | ServiceSuggestionCountAggregateInputType;
	_min?: ServiceSuggestionMinAggregateInputType;
	_max?: ServiceSuggestionMaxAggregateInputType;
};
export type GetServiceSuggestionAggregateType<
	T extends ServiceSuggestionAggregateArgs,
> = {
	[P in keyof T & keyof AggregateServiceSuggestion]: P extends
		| "_count"
		| "count"
		? T[P] extends true
			? number
			: Prisma.GetScalarType<T[P], AggregateServiceSuggestion[P]>
		: Prisma.GetScalarType<T[P], AggregateServiceSuggestion[P]>;
};
export type ServiceSuggestionGroupByArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	where?: Prisma.ServiceSuggestionWhereInput;
	orderBy?:
		| Prisma.ServiceSuggestionOrderByWithAggregationInput
		| Prisma.ServiceSuggestionOrderByWithAggregationInput[];
	by:
		| Prisma.ServiceSuggestionScalarFieldEnum[]
		| Prisma.ServiceSuggestionScalarFieldEnum;
	having?: Prisma.ServiceSuggestionScalarWhereWithAggregatesInput;
	take?: number;
	skip?: number;
	_count?: ServiceSuggestionCountAggregateInputType | true;
	_min?: ServiceSuggestionMinAggregateInputType;
	_max?: ServiceSuggestionMaxAggregateInputType;
};
export type ServiceSuggestionGroupByOutputType = {
	id: string;
	connectionId: string;
	suggestedName: string;
	displayName: string | null;
	repository: string;
	isMonorepo: boolean;
	subPath: string | null;
	status: string;
	metadata: string | null;
	createdAt: Date;
	updatedAt: Date;
	_count: ServiceSuggestionCountAggregateOutputType | null;
	_min: ServiceSuggestionMinAggregateOutputType | null;
	_max: ServiceSuggestionMaxAggregateOutputType | null;
};
type GetServiceSuggestionGroupByPayload<
	T extends ServiceSuggestionGroupByArgs,
> = Prisma.PrismaPromise<
	Array<
		Prisma.PickEnumerable<ServiceSuggestionGroupByOutputType, T["by"]> & {
			[P in keyof T &
				keyof ServiceSuggestionGroupByOutputType]: P extends "_count"
				? T[P] extends boolean
					? number
					: Prisma.GetScalarType<T[P], ServiceSuggestionGroupByOutputType[P]>
				: Prisma.GetScalarType<T[P], ServiceSuggestionGroupByOutputType[P]>;
		}
	>
>;
export type ServiceSuggestionWhereInput = {
	AND?:
		| Prisma.ServiceSuggestionWhereInput
		| Prisma.ServiceSuggestionWhereInput[];
	OR?: Prisma.ServiceSuggestionWhereInput[];
	NOT?:
		| Prisma.ServiceSuggestionWhereInput
		| Prisma.ServiceSuggestionWhereInput[];
	id?: Prisma.StringFilter<"ServiceSuggestion"> | string;
	connectionId?: Prisma.StringFilter<"ServiceSuggestion"> | string;
	suggestedName?: Prisma.StringFilter<"ServiceSuggestion"> | string;
	displayName?:
		| Prisma.StringNullableFilter<"ServiceSuggestion">
		| string
		| null;
	repository?: Prisma.StringFilter<"ServiceSuggestion"> | string;
	isMonorepo?: Prisma.BoolFilter<"ServiceSuggestion"> | boolean;
	subPath?: Prisma.StringNullableFilter<"ServiceSuggestion"> | string | null;
	status?: Prisma.StringFilter<"ServiceSuggestion"> | string;
	metadata?: Prisma.StringNullableFilter<"ServiceSuggestion"> | string | null;
	createdAt?: Prisma.DateTimeFilter<"ServiceSuggestion"> | Date | string;
	updatedAt?: Prisma.DateTimeFilter<"ServiceSuggestion"> | Date | string;
	connection?: Prisma.XOR<
		Prisma.IntegrationConnectionScalarRelationFilter,
		Prisma.IntegrationConnectionWhereInput
	>;
};
export type ServiceSuggestionOrderByWithRelationInput = {
	id?: Prisma.SortOrder;
	connectionId?: Prisma.SortOrder;
	suggestedName?: Prisma.SortOrder;
	displayName?: Prisma.SortOrderInput | Prisma.SortOrder;
	repository?: Prisma.SortOrder;
	isMonorepo?: Prisma.SortOrder;
	subPath?: Prisma.SortOrderInput | Prisma.SortOrder;
	status?: Prisma.SortOrder;
	metadata?: Prisma.SortOrderInput | Prisma.SortOrder;
	createdAt?: Prisma.SortOrder;
	updatedAt?: Prisma.SortOrder;
	connection?: Prisma.IntegrationConnectionOrderByWithRelationInput;
};
export type ServiceSuggestionWhereUniqueInput = Prisma.AtLeast<
	{
		id?: string;
		connectionId_repository_subPath?: Prisma.ServiceSuggestionConnectionIdRepositorySubPathCompoundUniqueInput;
		AND?:
			| Prisma.ServiceSuggestionWhereInput
			| Prisma.ServiceSuggestionWhereInput[];
		OR?: Prisma.ServiceSuggestionWhereInput[];
		NOT?:
			| Prisma.ServiceSuggestionWhereInput
			| Prisma.ServiceSuggestionWhereInput[];
		connectionId?: Prisma.StringFilter<"ServiceSuggestion"> | string;
		suggestedName?: Prisma.StringFilter<"ServiceSuggestion"> | string;
		displayName?:
			| Prisma.StringNullableFilter<"ServiceSuggestion">
			| string
			| null;
		repository?: Prisma.StringFilter<"ServiceSuggestion"> | string;
		isMonorepo?: Prisma.BoolFilter<"ServiceSuggestion"> | boolean;
		subPath?: Prisma.StringNullableFilter<"ServiceSuggestion"> | string | null;
		status?: Prisma.StringFilter<"ServiceSuggestion"> | string;
		metadata?: Prisma.StringNullableFilter<"ServiceSuggestion"> | string | null;
		createdAt?: Prisma.DateTimeFilter<"ServiceSuggestion"> | Date | string;
		updatedAt?: Prisma.DateTimeFilter<"ServiceSuggestion"> | Date | string;
		connection?: Prisma.XOR<
			Prisma.IntegrationConnectionScalarRelationFilter,
			Prisma.IntegrationConnectionWhereInput
		>;
	},
	"id" | "connectionId_repository_subPath"
>;
export type ServiceSuggestionOrderByWithAggregationInput = {
	id?: Prisma.SortOrder;
	connectionId?: Prisma.SortOrder;
	suggestedName?: Prisma.SortOrder;
	displayName?: Prisma.SortOrderInput | Prisma.SortOrder;
	repository?: Prisma.SortOrder;
	isMonorepo?: Prisma.SortOrder;
	subPath?: Prisma.SortOrderInput | Prisma.SortOrder;
	status?: Prisma.SortOrder;
	metadata?: Prisma.SortOrderInput | Prisma.SortOrder;
	createdAt?: Prisma.SortOrder;
	updatedAt?: Prisma.SortOrder;
	_count?: Prisma.ServiceSuggestionCountOrderByAggregateInput;
	_max?: Prisma.ServiceSuggestionMaxOrderByAggregateInput;
	_min?: Prisma.ServiceSuggestionMinOrderByAggregateInput;
};
export type ServiceSuggestionScalarWhereWithAggregatesInput = {
	AND?:
		| Prisma.ServiceSuggestionScalarWhereWithAggregatesInput
		| Prisma.ServiceSuggestionScalarWhereWithAggregatesInput[];
	OR?: Prisma.ServiceSuggestionScalarWhereWithAggregatesInput[];
	NOT?:
		| Prisma.ServiceSuggestionScalarWhereWithAggregatesInput
		| Prisma.ServiceSuggestionScalarWhereWithAggregatesInput[];
	id?: Prisma.StringWithAggregatesFilter<"ServiceSuggestion"> | string;
	connectionId?:
		| Prisma.StringWithAggregatesFilter<"ServiceSuggestion">
		| string;
	suggestedName?:
		| Prisma.StringWithAggregatesFilter<"ServiceSuggestion">
		| string;
	displayName?:
		| Prisma.StringNullableWithAggregatesFilter<"ServiceSuggestion">
		| string
		| null;
	repository?: Prisma.StringWithAggregatesFilter<"ServiceSuggestion"> | string;
	isMonorepo?: Prisma.BoolWithAggregatesFilter<"ServiceSuggestion"> | boolean;
	subPath?:
		| Prisma.StringNullableWithAggregatesFilter<"ServiceSuggestion">
		| string
		| null;
	status?: Prisma.StringWithAggregatesFilter<"ServiceSuggestion"> | string;
	metadata?:
		| Prisma.StringNullableWithAggregatesFilter<"ServiceSuggestion">
		| string
		| null;
	createdAt?:
		| Prisma.DateTimeWithAggregatesFilter<"ServiceSuggestion">
		| Date
		| string;
	updatedAt?:
		| Prisma.DateTimeWithAggregatesFilter<"ServiceSuggestion">
		| Date
		| string;
};
export type ServiceSuggestionCreateInput = {
	id?: string;
	suggestedName: string;
	displayName?: string | null;
	repository: string;
	isMonorepo?: boolean;
	subPath?: string | null;
	status?: string;
	metadata?: string | null;
	createdAt?: Date | string;
	updatedAt?: Date | string;
	connection: Prisma.IntegrationConnectionCreateNestedOneWithoutServiceSuggestionsInput;
};
export type ServiceSuggestionUncheckedCreateInput = {
	id?: string;
	connectionId: string;
	suggestedName: string;
	displayName?: string | null;
	repository: string;
	isMonorepo?: boolean;
	subPath?: string | null;
	status?: string;
	metadata?: string | null;
	createdAt?: Date | string;
	updatedAt?: Date | string;
};
export type ServiceSuggestionUpdateInput = {
	id?: Prisma.StringFieldUpdateOperationsInput | string;
	suggestedName?: Prisma.StringFieldUpdateOperationsInput | string;
	displayName?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	repository?: Prisma.StringFieldUpdateOperationsInput | string;
	isMonorepo?: Prisma.BoolFieldUpdateOperationsInput | boolean;
	subPath?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	status?: Prisma.StringFieldUpdateOperationsInput | string;
	metadata?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	createdAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
	updatedAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
	connection?: Prisma.IntegrationConnectionUpdateOneRequiredWithoutServiceSuggestionsNestedInput;
};
export type ServiceSuggestionUncheckedUpdateInput = {
	id?: Prisma.StringFieldUpdateOperationsInput | string;
	connectionId?: Prisma.StringFieldUpdateOperationsInput | string;
	suggestedName?: Prisma.StringFieldUpdateOperationsInput | string;
	displayName?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	repository?: Prisma.StringFieldUpdateOperationsInput | string;
	isMonorepo?: Prisma.BoolFieldUpdateOperationsInput | boolean;
	subPath?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	status?: Prisma.StringFieldUpdateOperationsInput | string;
	metadata?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	createdAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
	updatedAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
};
export type ServiceSuggestionCreateManyInput = {
	id?: string;
	connectionId: string;
	suggestedName: string;
	displayName?: string | null;
	repository: string;
	isMonorepo?: boolean;
	subPath?: string | null;
	status?: string;
	metadata?: string | null;
	createdAt?: Date | string;
	updatedAt?: Date | string;
};
export type ServiceSuggestionUpdateManyMutationInput = {
	id?: Prisma.StringFieldUpdateOperationsInput | string;
	suggestedName?: Prisma.StringFieldUpdateOperationsInput | string;
	displayName?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	repository?: Prisma.StringFieldUpdateOperationsInput | string;
	isMonorepo?: Prisma.BoolFieldUpdateOperationsInput | boolean;
	subPath?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	status?: Prisma.StringFieldUpdateOperationsInput | string;
	metadata?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	createdAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
	updatedAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
};
export type ServiceSuggestionUncheckedUpdateManyInput = {
	id?: Prisma.StringFieldUpdateOperationsInput | string;
	connectionId?: Prisma.StringFieldUpdateOperationsInput | string;
	suggestedName?: Prisma.StringFieldUpdateOperationsInput | string;
	displayName?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	repository?: Prisma.StringFieldUpdateOperationsInput | string;
	isMonorepo?: Prisma.BoolFieldUpdateOperationsInput | boolean;
	subPath?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	status?: Prisma.StringFieldUpdateOperationsInput | string;
	metadata?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	createdAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
	updatedAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
};
export type ServiceSuggestionListRelationFilter = {
	every?: Prisma.ServiceSuggestionWhereInput;
	some?: Prisma.ServiceSuggestionWhereInput;
	none?: Prisma.ServiceSuggestionWhereInput;
};
export type ServiceSuggestionOrderByRelationAggregateInput = {
	_count?: Prisma.SortOrder;
};
export type ServiceSuggestionConnectionIdRepositorySubPathCompoundUniqueInput =
	{
		connectionId: string;
		repository: string;
		subPath: string;
	};
export type ServiceSuggestionCountOrderByAggregateInput = {
	id?: Prisma.SortOrder;
	connectionId?: Prisma.SortOrder;
	suggestedName?: Prisma.SortOrder;
	displayName?: Prisma.SortOrder;
	repository?: Prisma.SortOrder;
	isMonorepo?: Prisma.SortOrder;
	subPath?: Prisma.SortOrder;
	status?: Prisma.SortOrder;
	metadata?: Prisma.SortOrder;
	createdAt?: Prisma.SortOrder;
	updatedAt?: Prisma.SortOrder;
};
export type ServiceSuggestionMaxOrderByAggregateInput = {
	id?: Prisma.SortOrder;
	connectionId?: Prisma.SortOrder;
	suggestedName?: Prisma.SortOrder;
	displayName?: Prisma.SortOrder;
	repository?: Prisma.SortOrder;
	isMonorepo?: Prisma.SortOrder;
	subPath?: Prisma.SortOrder;
	status?: Prisma.SortOrder;
	metadata?: Prisma.SortOrder;
	createdAt?: Prisma.SortOrder;
	updatedAt?: Prisma.SortOrder;
};
export type ServiceSuggestionMinOrderByAggregateInput = {
	id?: Prisma.SortOrder;
	connectionId?: Prisma.SortOrder;
	suggestedName?: Prisma.SortOrder;
	displayName?: Prisma.SortOrder;
	repository?: Prisma.SortOrder;
	isMonorepo?: Prisma.SortOrder;
	subPath?: Prisma.SortOrder;
	status?: Prisma.SortOrder;
	metadata?: Prisma.SortOrder;
	createdAt?: Prisma.SortOrder;
	updatedAt?: Prisma.SortOrder;
};
export type ServiceSuggestionCreateNestedManyWithoutConnectionInput = {
	create?:
		| Prisma.XOR<
				Prisma.ServiceSuggestionCreateWithoutConnectionInput,
				Prisma.ServiceSuggestionUncheckedCreateWithoutConnectionInput
		  >
		| Prisma.ServiceSuggestionCreateWithoutConnectionInput[]
		| Prisma.ServiceSuggestionUncheckedCreateWithoutConnectionInput[];
	connectOrCreate?:
		| Prisma.ServiceSuggestionCreateOrConnectWithoutConnectionInput
		| Prisma.ServiceSuggestionCreateOrConnectWithoutConnectionInput[];
	createMany?: Prisma.ServiceSuggestionCreateManyConnectionInputEnvelope;
	connect?:
		| Prisma.ServiceSuggestionWhereUniqueInput
		| Prisma.ServiceSuggestionWhereUniqueInput[];
};
export type ServiceSuggestionUncheckedCreateNestedManyWithoutConnectionInput = {
	create?:
		| Prisma.XOR<
				Prisma.ServiceSuggestionCreateWithoutConnectionInput,
				Prisma.ServiceSuggestionUncheckedCreateWithoutConnectionInput
		  >
		| Prisma.ServiceSuggestionCreateWithoutConnectionInput[]
		| Prisma.ServiceSuggestionUncheckedCreateWithoutConnectionInput[];
	connectOrCreate?:
		| Prisma.ServiceSuggestionCreateOrConnectWithoutConnectionInput
		| Prisma.ServiceSuggestionCreateOrConnectWithoutConnectionInput[];
	createMany?: Prisma.ServiceSuggestionCreateManyConnectionInputEnvelope;
	connect?:
		| Prisma.ServiceSuggestionWhereUniqueInput
		| Prisma.ServiceSuggestionWhereUniqueInput[];
};
export type ServiceSuggestionUpdateManyWithoutConnectionNestedInput = {
	create?:
		| Prisma.XOR<
				Prisma.ServiceSuggestionCreateWithoutConnectionInput,
				Prisma.ServiceSuggestionUncheckedCreateWithoutConnectionInput
		  >
		| Prisma.ServiceSuggestionCreateWithoutConnectionInput[]
		| Prisma.ServiceSuggestionUncheckedCreateWithoutConnectionInput[];
	connectOrCreate?:
		| Prisma.ServiceSuggestionCreateOrConnectWithoutConnectionInput
		| Prisma.ServiceSuggestionCreateOrConnectWithoutConnectionInput[];
	upsert?:
		| Prisma.ServiceSuggestionUpsertWithWhereUniqueWithoutConnectionInput
		| Prisma.ServiceSuggestionUpsertWithWhereUniqueWithoutConnectionInput[];
	createMany?: Prisma.ServiceSuggestionCreateManyConnectionInputEnvelope;
	set?:
		| Prisma.ServiceSuggestionWhereUniqueInput
		| Prisma.ServiceSuggestionWhereUniqueInput[];
	disconnect?:
		| Prisma.ServiceSuggestionWhereUniqueInput
		| Prisma.ServiceSuggestionWhereUniqueInput[];
	delete?:
		| Prisma.ServiceSuggestionWhereUniqueInput
		| Prisma.ServiceSuggestionWhereUniqueInput[];
	connect?:
		| Prisma.ServiceSuggestionWhereUniqueInput
		| Prisma.ServiceSuggestionWhereUniqueInput[];
	update?:
		| Prisma.ServiceSuggestionUpdateWithWhereUniqueWithoutConnectionInput
		| Prisma.ServiceSuggestionUpdateWithWhereUniqueWithoutConnectionInput[];
	updateMany?:
		| Prisma.ServiceSuggestionUpdateManyWithWhereWithoutConnectionInput
		| Prisma.ServiceSuggestionUpdateManyWithWhereWithoutConnectionInput[];
	deleteMany?:
		| Prisma.ServiceSuggestionScalarWhereInput
		| Prisma.ServiceSuggestionScalarWhereInput[];
};
export type ServiceSuggestionUncheckedUpdateManyWithoutConnectionNestedInput = {
	create?:
		| Prisma.XOR<
				Prisma.ServiceSuggestionCreateWithoutConnectionInput,
				Prisma.ServiceSuggestionUncheckedCreateWithoutConnectionInput
		  >
		| Prisma.ServiceSuggestionCreateWithoutConnectionInput[]
		| Prisma.ServiceSuggestionUncheckedCreateWithoutConnectionInput[];
	connectOrCreate?:
		| Prisma.ServiceSuggestionCreateOrConnectWithoutConnectionInput
		| Prisma.ServiceSuggestionCreateOrConnectWithoutConnectionInput[];
	upsert?:
		| Prisma.ServiceSuggestionUpsertWithWhereUniqueWithoutConnectionInput
		| Prisma.ServiceSuggestionUpsertWithWhereUniqueWithoutConnectionInput[];
	createMany?: Prisma.ServiceSuggestionCreateManyConnectionInputEnvelope;
	set?:
		| Prisma.ServiceSuggestionWhereUniqueInput
		| Prisma.ServiceSuggestionWhereUniqueInput[];
	disconnect?:
		| Prisma.ServiceSuggestionWhereUniqueInput
		| Prisma.ServiceSuggestionWhereUniqueInput[];
	delete?:
		| Prisma.ServiceSuggestionWhereUniqueInput
		| Prisma.ServiceSuggestionWhereUniqueInput[];
	connect?:
		| Prisma.ServiceSuggestionWhereUniqueInput
		| Prisma.ServiceSuggestionWhereUniqueInput[];
	update?:
		| Prisma.ServiceSuggestionUpdateWithWhereUniqueWithoutConnectionInput
		| Prisma.ServiceSuggestionUpdateWithWhereUniqueWithoutConnectionInput[];
	updateMany?:
		| Prisma.ServiceSuggestionUpdateManyWithWhereWithoutConnectionInput
		| Prisma.ServiceSuggestionUpdateManyWithWhereWithoutConnectionInput[];
	deleteMany?:
		| Prisma.ServiceSuggestionScalarWhereInput
		| Prisma.ServiceSuggestionScalarWhereInput[];
};
export type ServiceSuggestionCreateWithoutConnectionInput = {
	id?: string;
	suggestedName: string;
	displayName?: string | null;
	repository: string;
	isMonorepo?: boolean;
	subPath?: string | null;
	status?: string;
	metadata?: string | null;
	createdAt?: Date | string;
	updatedAt?: Date | string;
};
export type ServiceSuggestionUncheckedCreateWithoutConnectionInput = {
	id?: string;
	suggestedName: string;
	displayName?: string | null;
	repository: string;
	isMonorepo?: boolean;
	subPath?: string | null;
	status?: string;
	metadata?: string | null;
	createdAt?: Date | string;
	updatedAt?: Date | string;
};
export type ServiceSuggestionCreateOrConnectWithoutConnectionInput = {
	where: Prisma.ServiceSuggestionWhereUniqueInput;
	create: Prisma.XOR<
		Prisma.ServiceSuggestionCreateWithoutConnectionInput,
		Prisma.ServiceSuggestionUncheckedCreateWithoutConnectionInput
	>;
};
export type ServiceSuggestionCreateManyConnectionInputEnvelope = {
	data:
		| Prisma.ServiceSuggestionCreateManyConnectionInput
		| Prisma.ServiceSuggestionCreateManyConnectionInput[];
};
export type ServiceSuggestionUpsertWithWhereUniqueWithoutConnectionInput = {
	where: Prisma.ServiceSuggestionWhereUniqueInput;
	update: Prisma.XOR<
		Prisma.ServiceSuggestionUpdateWithoutConnectionInput,
		Prisma.ServiceSuggestionUncheckedUpdateWithoutConnectionInput
	>;
	create: Prisma.XOR<
		Prisma.ServiceSuggestionCreateWithoutConnectionInput,
		Prisma.ServiceSuggestionUncheckedCreateWithoutConnectionInput
	>;
};
export type ServiceSuggestionUpdateWithWhereUniqueWithoutConnectionInput = {
	where: Prisma.ServiceSuggestionWhereUniqueInput;
	data: Prisma.XOR<
		Prisma.ServiceSuggestionUpdateWithoutConnectionInput,
		Prisma.ServiceSuggestionUncheckedUpdateWithoutConnectionInput
	>;
};
export type ServiceSuggestionUpdateManyWithWhereWithoutConnectionInput = {
	where: Prisma.ServiceSuggestionScalarWhereInput;
	data: Prisma.XOR<
		Prisma.ServiceSuggestionUpdateManyMutationInput,
		Prisma.ServiceSuggestionUncheckedUpdateManyWithoutConnectionInput
	>;
};
export type ServiceSuggestionScalarWhereInput = {
	AND?:
		| Prisma.ServiceSuggestionScalarWhereInput
		| Prisma.ServiceSuggestionScalarWhereInput[];
	OR?: Prisma.ServiceSuggestionScalarWhereInput[];
	NOT?:
		| Prisma.ServiceSuggestionScalarWhereInput
		| Prisma.ServiceSuggestionScalarWhereInput[];
	id?: Prisma.StringFilter<"ServiceSuggestion"> | string;
	connectionId?: Prisma.StringFilter<"ServiceSuggestion"> | string;
	suggestedName?: Prisma.StringFilter<"ServiceSuggestion"> | string;
	displayName?:
		| Prisma.StringNullableFilter<"ServiceSuggestion">
		| string
		| null;
	repository?: Prisma.StringFilter<"ServiceSuggestion"> | string;
	isMonorepo?: Prisma.BoolFilter<"ServiceSuggestion"> | boolean;
	subPath?: Prisma.StringNullableFilter<"ServiceSuggestion"> | string | null;
	status?: Prisma.StringFilter<"ServiceSuggestion"> | string;
	metadata?: Prisma.StringNullableFilter<"ServiceSuggestion"> | string | null;
	createdAt?: Prisma.DateTimeFilter<"ServiceSuggestion"> | Date | string;
	updatedAt?: Prisma.DateTimeFilter<"ServiceSuggestion"> | Date | string;
};
export type ServiceSuggestionCreateManyConnectionInput = {
	id?: string;
	suggestedName: string;
	displayName?: string | null;
	repository: string;
	isMonorepo?: boolean;
	subPath?: string | null;
	status?: string;
	metadata?: string | null;
	createdAt?: Date | string;
	updatedAt?: Date | string;
};
export type ServiceSuggestionUpdateWithoutConnectionInput = {
	id?: Prisma.StringFieldUpdateOperationsInput | string;
	suggestedName?: Prisma.StringFieldUpdateOperationsInput | string;
	displayName?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	repository?: Prisma.StringFieldUpdateOperationsInput | string;
	isMonorepo?: Prisma.BoolFieldUpdateOperationsInput | boolean;
	subPath?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	status?: Prisma.StringFieldUpdateOperationsInput | string;
	metadata?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	createdAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
	updatedAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
};
export type ServiceSuggestionUncheckedUpdateWithoutConnectionInput = {
	id?: Prisma.StringFieldUpdateOperationsInput | string;
	suggestedName?: Prisma.StringFieldUpdateOperationsInput | string;
	displayName?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	repository?: Prisma.StringFieldUpdateOperationsInput | string;
	isMonorepo?: Prisma.BoolFieldUpdateOperationsInput | boolean;
	subPath?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	status?: Prisma.StringFieldUpdateOperationsInput | string;
	metadata?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	createdAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
	updatedAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
};
export type ServiceSuggestionUncheckedUpdateManyWithoutConnectionInput = {
	id?: Prisma.StringFieldUpdateOperationsInput | string;
	suggestedName?: Prisma.StringFieldUpdateOperationsInput | string;
	displayName?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	repository?: Prisma.StringFieldUpdateOperationsInput | string;
	isMonorepo?: Prisma.BoolFieldUpdateOperationsInput | boolean;
	subPath?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	status?: Prisma.StringFieldUpdateOperationsInput | string;
	metadata?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	createdAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
	updatedAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
};
export type ServiceSuggestionSelect<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = runtime.Types.Extensions.GetSelect<
	{
		id?: boolean;
		connectionId?: boolean;
		suggestedName?: boolean;
		displayName?: boolean;
		repository?: boolean;
		isMonorepo?: boolean;
		subPath?: boolean;
		status?: boolean;
		metadata?: boolean;
		createdAt?: boolean;
		updatedAt?: boolean;
		connection?: boolean | Prisma.IntegrationConnectionDefaultArgs<ExtArgs>;
	},
	ExtArgs["result"]["serviceSuggestion"]
>;
export type ServiceSuggestionSelectCreateManyAndReturn<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = runtime.Types.Extensions.GetSelect<
	{
		id?: boolean;
		connectionId?: boolean;
		suggestedName?: boolean;
		displayName?: boolean;
		repository?: boolean;
		isMonorepo?: boolean;
		subPath?: boolean;
		status?: boolean;
		metadata?: boolean;
		createdAt?: boolean;
		updatedAt?: boolean;
		connection?: boolean | Prisma.IntegrationConnectionDefaultArgs<ExtArgs>;
	},
	ExtArgs["result"]["serviceSuggestion"]
>;
export type ServiceSuggestionSelectUpdateManyAndReturn<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = runtime.Types.Extensions.GetSelect<
	{
		id?: boolean;
		connectionId?: boolean;
		suggestedName?: boolean;
		displayName?: boolean;
		repository?: boolean;
		isMonorepo?: boolean;
		subPath?: boolean;
		status?: boolean;
		metadata?: boolean;
		createdAt?: boolean;
		updatedAt?: boolean;
		connection?: boolean | Prisma.IntegrationConnectionDefaultArgs<ExtArgs>;
	},
	ExtArgs["result"]["serviceSuggestion"]
>;
export type ServiceSuggestionSelectScalar = {
	id?: boolean;
	connectionId?: boolean;
	suggestedName?: boolean;
	displayName?: boolean;
	repository?: boolean;
	isMonorepo?: boolean;
	subPath?: boolean;
	status?: boolean;
	metadata?: boolean;
	createdAt?: boolean;
	updatedAt?: boolean;
};
export type ServiceSuggestionOmit<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = runtime.Types.Extensions.GetOmit<
	| "id"
	| "connectionId"
	| "suggestedName"
	| "displayName"
	| "repository"
	| "isMonorepo"
	| "subPath"
	| "status"
	| "metadata"
	| "createdAt"
	| "updatedAt",
	ExtArgs["result"]["serviceSuggestion"]
>;
export type ServiceSuggestionInclude<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	connection?: boolean | Prisma.IntegrationConnectionDefaultArgs<ExtArgs>;
};
export type ServiceSuggestionIncludeCreateManyAndReturn<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	connection?: boolean | Prisma.IntegrationConnectionDefaultArgs<ExtArgs>;
};
export type ServiceSuggestionIncludeUpdateManyAndReturn<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	connection?: boolean | Prisma.IntegrationConnectionDefaultArgs<ExtArgs>;
};
export type $ServiceSuggestionPayload<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	name: "ServiceSuggestion";
	objects: {
		connection: Prisma.$IntegrationConnectionPayload<ExtArgs>;
	};
	scalars: runtime.Types.Extensions.GetPayloadResult<
		{
			id: string;
			connectionId: string;
			suggestedName: string;
			displayName: string | null;
			repository: string;
			isMonorepo: boolean;
			subPath: string | null;
			status: string;
			metadata: string | null;
			createdAt: Date;
			updatedAt: Date;
		},
		ExtArgs["result"]["serviceSuggestion"]
	>;
	composites: {};
};
export type ServiceSuggestionGetPayload<
	S extends boolean | null | undefined | ServiceSuggestionDefaultArgs,
> = runtime.Types.Result.GetResult<Prisma.$ServiceSuggestionPayload, S>;
export type ServiceSuggestionCountArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = Omit<
	ServiceSuggestionFindManyArgs,
	"select" | "include" | "distinct" | "omit"
> & {
	select?: ServiceSuggestionCountAggregateInputType | true;
};
export interface ServiceSuggestionDelegate<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
	GlobalOmitOptions = {},
> {
	[K: symbol]: {
		types: Prisma.TypeMap<ExtArgs>["model"]["ServiceSuggestion"];
		meta: {
			name: "ServiceSuggestion";
		};
	};
	findUnique<T extends ServiceSuggestionFindUniqueArgs>(
		args: Prisma.SelectSubset<T, ServiceSuggestionFindUniqueArgs<ExtArgs>>,
	): Prisma.Prisma__ServiceSuggestionClient<
		runtime.Types.Result.GetResult<
			Prisma.$ServiceSuggestionPayload<ExtArgs>,
			T,
			"findUnique",
			GlobalOmitOptions
		> | null,
		null,
		ExtArgs,
		GlobalOmitOptions
	>;
	findUniqueOrThrow<T extends ServiceSuggestionFindUniqueOrThrowArgs>(
		args: Prisma.SelectSubset<
			T,
			ServiceSuggestionFindUniqueOrThrowArgs<ExtArgs>
		>,
	): Prisma.Prisma__ServiceSuggestionClient<
		runtime.Types.Result.GetResult<
			Prisma.$ServiceSuggestionPayload<ExtArgs>,
			T,
			"findUniqueOrThrow",
			GlobalOmitOptions
		>,
		never,
		ExtArgs,
		GlobalOmitOptions
	>;
	findFirst<T extends ServiceSuggestionFindFirstArgs>(
		args?: Prisma.SelectSubset<T, ServiceSuggestionFindFirstArgs<ExtArgs>>,
	): Prisma.Prisma__ServiceSuggestionClient<
		runtime.Types.Result.GetResult<
			Prisma.$ServiceSuggestionPayload<ExtArgs>,
			T,
			"findFirst",
			GlobalOmitOptions
		> | null,
		null,
		ExtArgs,
		GlobalOmitOptions
	>;
	findFirstOrThrow<T extends ServiceSuggestionFindFirstOrThrowArgs>(
		args?: Prisma.SelectSubset<
			T,
			ServiceSuggestionFindFirstOrThrowArgs<ExtArgs>
		>,
	): Prisma.Prisma__ServiceSuggestionClient<
		runtime.Types.Result.GetResult<
			Prisma.$ServiceSuggestionPayload<ExtArgs>,
			T,
			"findFirstOrThrow",
			GlobalOmitOptions
		>,
		never,
		ExtArgs,
		GlobalOmitOptions
	>;
	findMany<T extends ServiceSuggestionFindManyArgs>(
		args?: Prisma.SelectSubset<T, ServiceSuggestionFindManyArgs<ExtArgs>>,
	): Prisma.PrismaPromise<
		runtime.Types.Result.GetResult<
			Prisma.$ServiceSuggestionPayload<ExtArgs>,
			T,
			"findMany",
			GlobalOmitOptions
		>
	>;
	create<T extends ServiceSuggestionCreateArgs>(
		args: Prisma.SelectSubset<T, ServiceSuggestionCreateArgs<ExtArgs>>,
	): Prisma.Prisma__ServiceSuggestionClient<
		runtime.Types.Result.GetResult<
			Prisma.$ServiceSuggestionPayload<ExtArgs>,
			T,
			"create",
			GlobalOmitOptions
		>,
		never,
		ExtArgs,
		GlobalOmitOptions
	>;
	createMany<T extends ServiceSuggestionCreateManyArgs>(
		args?: Prisma.SelectSubset<T, ServiceSuggestionCreateManyArgs<ExtArgs>>,
	): Prisma.PrismaPromise<Prisma.BatchPayload>;
	createManyAndReturn<T extends ServiceSuggestionCreateManyAndReturnArgs>(
		args?: Prisma.SelectSubset<
			T,
			ServiceSuggestionCreateManyAndReturnArgs<ExtArgs>
		>,
	): Prisma.PrismaPromise<
		runtime.Types.Result.GetResult<
			Prisma.$ServiceSuggestionPayload<ExtArgs>,
			T,
			"createManyAndReturn",
			GlobalOmitOptions
		>
	>;
	delete<T extends ServiceSuggestionDeleteArgs>(
		args: Prisma.SelectSubset<T, ServiceSuggestionDeleteArgs<ExtArgs>>,
	): Prisma.Prisma__ServiceSuggestionClient<
		runtime.Types.Result.GetResult<
			Prisma.$ServiceSuggestionPayload<ExtArgs>,
			T,
			"delete",
			GlobalOmitOptions
		>,
		never,
		ExtArgs,
		GlobalOmitOptions
	>;
	update<T extends ServiceSuggestionUpdateArgs>(
		args: Prisma.SelectSubset<T, ServiceSuggestionUpdateArgs<ExtArgs>>,
	): Prisma.Prisma__ServiceSuggestionClient<
		runtime.Types.Result.GetResult<
			Prisma.$ServiceSuggestionPayload<ExtArgs>,
			T,
			"update",
			GlobalOmitOptions
		>,
		never,
		ExtArgs,
		GlobalOmitOptions
	>;
	deleteMany<T extends ServiceSuggestionDeleteManyArgs>(
		args?: Prisma.SelectSubset<T, ServiceSuggestionDeleteManyArgs<ExtArgs>>,
	): Prisma.PrismaPromise<Prisma.BatchPayload>;
	updateMany<T extends ServiceSuggestionUpdateManyArgs>(
		args: Prisma.SelectSubset<T, ServiceSuggestionUpdateManyArgs<ExtArgs>>,
	): Prisma.PrismaPromise<Prisma.BatchPayload>;
	updateManyAndReturn<T extends ServiceSuggestionUpdateManyAndReturnArgs>(
		args: Prisma.SelectSubset<
			T,
			ServiceSuggestionUpdateManyAndReturnArgs<ExtArgs>
		>,
	): Prisma.PrismaPromise<
		runtime.Types.Result.GetResult<
			Prisma.$ServiceSuggestionPayload<ExtArgs>,
			T,
			"updateManyAndReturn",
			GlobalOmitOptions
		>
	>;
	upsert<T extends ServiceSuggestionUpsertArgs>(
		args: Prisma.SelectSubset<T, ServiceSuggestionUpsertArgs<ExtArgs>>,
	): Prisma.Prisma__ServiceSuggestionClient<
		runtime.Types.Result.GetResult<
			Prisma.$ServiceSuggestionPayload<ExtArgs>,
			T,
			"upsert",
			GlobalOmitOptions
		>,
		never,
		ExtArgs,
		GlobalOmitOptions
	>;
	count<T extends ServiceSuggestionCountArgs>(
		args?: Prisma.Subset<T, ServiceSuggestionCountArgs>,
	): Prisma.PrismaPromise<
		T extends runtime.Types.Utils.Record<"select", any>
			? T["select"] extends true
				? number
				: Prisma.GetScalarType<
						T["select"],
						ServiceSuggestionCountAggregateOutputType
					>
			: number
	>;
	aggregate<T extends ServiceSuggestionAggregateArgs>(
		args: Prisma.Subset<T, ServiceSuggestionAggregateArgs>,
	): Prisma.PrismaPromise<GetServiceSuggestionAggregateType<T>>;
	groupBy<
		T extends ServiceSuggestionGroupByArgs,
		HasSelectOrTake extends Prisma.Or<
			Prisma.Extends<"skip", Prisma.Keys<T>>,
			Prisma.Extends<"take", Prisma.Keys<T>>
		>,
		OrderByArg extends Prisma.True extends HasSelectOrTake
			? {
					orderBy: ServiceSuggestionGroupByArgs["orderBy"];
				}
			: {
					orderBy?: ServiceSuggestionGroupByArgs["orderBy"];
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
		args: Prisma.SubsetIntersection<
			T,
			ServiceSuggestionGroupByArgs,
			OrderByArg
		> &
			InputErrors,
	): {} extends InputErrors
		? GetServiceSuggestionGroupByPayload<T>
		: Prisma.PrismaPromise<InputErrors>;
	readonly fields: ServiceSuggestionFieldRefs;
}
export interface Prisma__ServiceSuggestionClient<
	T,
	Null = never,
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
	GlobalOmitOptions = {},
> extends Prisma.PrismaPromise<T> {
	readonly [Symbol.toStringTag]: "PrismaPromise";
	connection<T extends Prisma.IntegrationConnectionDefaultArgs<ExtArgs> = {}>(
		args?: Prisma.Subset<T, Prisma.IntegrationConnectionDefaultArgs<ExtArgs>>,
	): Prisma.Prisma__IntegrationConnectionClient<
		| runtime.Types.Result.GetResult<
				Prisma.$IntegrationConnectionPayload<ExtArgs>,
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
export interface ServiceSuggestionFieldRefs {
	readonly id: Prisma.FieldRef<"ServiceSuggestion", "String">;
	readonly connectionId: Prisma.FieldRef<"ServiceSuggestion", "String">;
	readonly suggestedName: Prisma.FieldRef<"ServiceSuggestion", "String">;
	readonly displayName: Prisma.FieldRef<"ServiceSuggestion", "String">;
	readonly repository: Prisma.FieldRef<"ServiceSuggestion", "String">;
	readonly isMonorepo: Prisma.FieldRef<"ServiceSuggestion", "Boolean">;
	readonly subPath: Prisma.FieldRef<"ServiceSuggestion", "String">;
	readonly status: Prisma.FieldRef<"ServiceSuggestion", "String">;
	readonly metadata: Prisma.FieldRef<"ServiceSuggestion", "String">;
	readonly createdAt: Prisma.FieldRef<"ServiceSuggestion", "DateTime">;
	readonly updatedAt: Prisma.FieldRef<"ServiceSuggestion", "DateTime">;
}
export type ServiceSuggestionFindUniqueArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	select?: Prisma.ServiceSuggestionSelect<ExtArgs> | null;
	omit?: Prisma.ServiceSuggestionOmit<ExtArgs> | null;
	include?: Prisma.ServiceSuggestionInclude<ExtArgs> | null;
	where: Prisma.ServiceSuggestionWhereUniqueInput;
};
export type ServiceSuggestionFindUniqueOrThrowArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	select?: Prisma.ServiceSuggestionSelect<ExtArgs> | null;
	omit?: Prisma.ServiceSuggestionOmit<ExtArgs> | null;
	include?: Prisma.ServiceSuggestionInclude<ExtArgs> | null;
	where: Prisma.ServiceSuggestionWhereUniqueInput;
};
export type ServiceSuggestionFindFirstArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	select?: Prisma.ServiceSuggestionSelect<ExtArgs> | null;
	omit?: Prisma.ServiceSuggestionOmit<ExtArgs> | null;
	include?: Prisma.ServiceSuggestionInclude<ExtArgs> | null;
	where?: Prisma.ServiceSuggestionWhereInput;
	orderBy?:
		| Prisma.ServiceSuggestionOrderByWithRelationInput
		| Prisma.ServiceSuggestionOrderByWithRelationInput[];
	cursor?: Prisma.ServiceSuggestionWhereUniqueInput;
	take?: number;
	skip?: number;
	distinct?:
		| Prisma.ServiceSuggestionScalarFieldEnum
		| Prisma.ServiceSuggestionScalarFieldEnum[];
};
export type ServiceSuggestionFindFirstOrThrowArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	select?: Prisma.ServiceSuggestionSelect<ExtArgs> | null;
	omit?: Prisma.ServiceSuggestionOmit<ExtArgs> | null;
	include?: Prisma.ServiceSuggestionInclude<ExtArgs> | null;
	where?: Prisma.ServiceSuggestionWhereInput;
	orderBy?:
		| Prisma.ServiceSuggestionOrderByWithRelationInput
		| Prisma.ServiceSuggestionOrderByWithRelationInput[];
	cursor?: Prisma.ServiceSuggestionWhereUniqueInput;
	take?: number;
	skip?: number;
	distinct?:
		| Prisma.ServiceSuggestionScalarFieldEnum
		| Prisma.ServiceSuggestionScalarFieldEnum[];
};
export type ServiceSuggestionFindManyArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	select?: Prisma.ServiceSuggestionSelect<ExtArgs> | null;
	omit?: Prisma.ServiceSuggestionOmit<ExtArgs> | null;
	include?: Prisma.ServiceSuggestionInclude<ExtArgs> | null;
	where?: Prisma.ServiceSuggestionWhereInput;
	orderBy?:
		| Prisma.ServiceSuggestionOrderByWithRelationInput
		| Prisma.ServiceSuggestionOrderByWithRelationInput[];
	cursor?: Prisma.ServiceSuggestionWhereUniqueInput;
	take?: number;
	skip?: number;
	distinct?:
		| Prisma.ServiceSuggestionScalarFieldEnum
		| Prisma.ServiceSuggestionScalarFieldEnum[];
};
export type ServiceSuggestionCreateArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	select?: Prisma.ServiceSuggestionSelect<ExtArgs> | null;
	omit?: Prisma.ServiceSuggestionOmit<ExtArgs> | null;
	include?: Prisma.ServiceSuggestionInclude<ExtArgs> | null;
	data: Prisma.XOR<
		Prisma.ServiceSuggestionCreateInput,
		Prisma.ServiceSuggestionUncheckedCreateInput
	>;
};
export type ServiceSuggestionCreateManyArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	data:
		| Prisma.ServiceSuggestionCreateManyInput
		| Prisma.ServiceSuggestionCreateManyInput[];
};
export type ServiceSuggestionCreateManyAndReturnArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	select?: Prisma.ServiceSuggestionSelectCreateManyAndReturn<ExtArgs> | null;
	omit?: Prisma.ServiceSuggestionOmit<ExtArgs> | null;
	data:
		| Prisma.ServiceSuggestionCreateManyInput
		| Prisma.ServiceSuggestionCreateManyInput[];
	include?: Prisma.ServiceSuggestionIncludeCreateManyAndReturn<ExtArgs> | null;
};
export type ServiceSuggestionUpdateArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	select?: Prisma.ServiceSuggestionSelect<ExtArgs> | null;
	omit?: Prisma.ServiceSuggestionOmit<ExtArgs> | null;
	include?: Prisma.ServiceSuggestionInclude<ExtArgs> | null;
	data: Prisma.XOR<
		Prisma.ServiceSuggestionUpdateInput,
		Prisma.ServiceSuggestionUncheckedUpdateInput
	>;
	where: Prisma.ServiceSuggestionWhereUniqueInput;
};
export type ServiceSuggestionUpdateManyArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	data: Prisma.XOR<
		Prisma.ServiceSuggestionUpdateManyMutationInput,
		Prisma.ServiceSuggestionUncheckedUpdateManyInput
	>;
	where?: Prisma.ServiceSuggestionWhereInput;
	limit?: number;
};
export type ServiceSuggestionUpdateManyAndReturnArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	select?: Prisma.ServiceSuggestionSelectUpdateManyAndReturn<ExtArgs> | null;
	omit?: Prisma.ServiceSuggestionOmit<ExtArgs> | null;
	data: Prisma.XOR<
		Prisma.ServiceSuggestionUpdateManyMutationInput,
		Prisma.ServiceSuggestionUncheckedUpdateManyInput
	>;
	where?: Prisma.ServiceSuggestionWhereInput;
	limit?: number;
	include?: Prisma.ServiceSuggestionIncludeUpdateManyAndReturn<ExtArgs> | null;
};
export type ServiceSuggestionUpsertArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	select?: Prisma.ServiceSuggestionSelect<ExtArgs> | null;
	omit?: Prisma.ServiceSuggestionOmit<ExtArgs> | null;
	include?: Prisma.ServiceSuggestionInclude<ExtArgs> | null;
	where: Prisma.ServiceSuggestionWhereUniqueInput;
	create: Prisma.XOR<
		Prisma.ServiceSuggestionCreateInput,
		Prisma.ServiceSuggestionUncheckedCreateInput
	>;
	update: Prisma.XOR<
		Prisma.ServiceSuggestionUpdateInput,
		Prisma.ServiceSuggestionUncheckedUpdateInput
	>;
};
export type ServiceSuggestionDeleteArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	select?: Prisma.ServiceSuggestionSelect<ExtArgs> | null;
	omit?: Prisma.ServiceSuggestionOmit<ExtArgs> | null;
	include?: Prisma.ServiceSuggestionInclude<ExtArgs> | null;
	where: Prisma.ServiceSuggestionWhereUniqueInput;
};
export type ServiceSuggestionDeleteManyArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	where?: Prisma.ServiceSuggestionWhereInput;
	limit?: number;
};
export type ServiceSuggestionDefaultArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	select?: Prisma.ServiceSuggestionSelect<ExtArgs> | null;
	omit?: Prisma.ServiceSuggestionOmit<ExtArgs> | null;
	include?: Prisma.ServiceSuggestionInclude<ExtArgs> | null;
};
