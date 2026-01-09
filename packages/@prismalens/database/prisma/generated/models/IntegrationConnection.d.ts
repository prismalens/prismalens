import type * as runtime from "@prisma/client/runtime/client";
import type * as Prisma from "../internal/prismaNamespace.js";
export type IntegrationConnectionModel =
	runtime.Types.Result.DefaultSelection<Prisma.$IntegrationConnectionPayload>;
export type AggregateIntegrationConnection = {
	_count: IntegrationConnectionCountAggregateOutputType | null;
	_min: IntegrationConnectionMinAggregateOutputType | null;
	_max: IntegrationConnectionMaxAggregateOutputType | null;
};
export type IntegrationConnectionMinAggregateOutputType = {
	id: string | null;
	definitionId: string | null;
	name: string | null;
	description: string | null;
	isGlobal: boolean | null;
	status: string | null;
	lastHealthCheck: Date | null;
	lastError: string | null;
	authMethod: string | null;
	credentials: string | null;
	config: string | null;
	createdAt: Date | null;
	updatedAt: Date | null;
};
export type IntegrationConnectionMaxAggregateOutputType = {
	id: string | null;
	definitionId: string | null;
	name: string | null;
	description: string | null;
	isGlobal: boolean | null;
	status: string | null;
	lastHealthCheck: Date | null;
	lastError: string | null;
	authMethod: string | null;
	credentials: string | null;
	config: string | null;
	createdAt: Date | null;
	updatedAt: Date | null;
};
export type IntegrationConnectionCountAggregateOutputType = {
	id: number;
	definitionId: number;
	name: number;
	description: number;
	isGlobal: number;
	status: number;
	lastHealthCheck: number;
	lastError: number;
	authMethod: number;
	credentials: number;
	config: number;
	createdAt: number;
	updatedAt: number;
	_all: number;
};
export type IntegrationConnectionMinAggregateInputType = {
	id?: true;
	definitionId?: true;
	name?: true;
	description?: true;
	isGlobal?: true;
	status?: true;
	lastHealthCheck?: true;
	lastError?: true;
	authMethod?: true;
	credentials?: true;
	config?: true;
	createdAt?: true;
	updatedAt?: true;
};
export type IntegrationConnectionMaxAggregateInputType = {
	id?: true;
	definitionId?: true;
	name?: true;
	description?: true;
	isGlobal?: true;
	status?: true;
	lastHealthCheck?: true;
	lastError?: true;
	authMethod?: true;
	credentials?: true;
	config?: true;
	createdAt?: true;
	updatedAt?: true;
};
export type IntegrationConnectionCountAggregateInputType = {
	id?: true;
	definitionId?: true;
	name?: true;
	description?: true;
	isGlobal?: true;
	status?: true;
	lastHealthCheck?: true;
	lastError?: true;
	authMethod?: true;
	credentials?: true;
	config?: true;
	createdAt?: true;
	updatedAt?: true;
	_all?: true;
};
export type IntegrationConnectionAggregateArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	where?: Prisma.IntegrationConnectionWhereInput;
	orderBy?:
		| Prisma.IntegrationConnectionOrderByWithRelationInput
		| Prisma.IntegrationConnectionOrderByWithRelationInput[];
	cursor?: Prisma.IntegrationConnectionWhereUniqueInput;
	take?: number;
	skip?: number;
	_count?: true | IntegrationConnectionCountAggregateInputType;
	_min?: IntegrationConnectionMinAggregateInputType;
	_max?: IntegrationConnectionMaxAggregateInputType;
};
export type GetIntegrationConnectionAggregateType<
	T extends IntegrationConnectionAggregateArgs,
> = {
	[P in keyof T & keyof AggregateIntegrationConnection]: P extends
		| "_count"
		| "count"
		? T[P] extends true
			? number
			: Prisma.GetScalarType<T[P], AggregateIntegrationConnection[P]>
		: Prisma.GetScalarType<T[P], AggregateIntegrationConnection[P]>;
};
export type IntegrationConnectionGroupByArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	where?: Prisma.IntegrationConnectionWhereInput;
	orderBy?:
		| Prisma.IntegrationConnectionOrderByWithAggregationInput
		| Prisma.IntegrationConnectionOrderByWithAggregationInput[];
	by:
		| Prisma.IntegrationConnectionScalarFieldEnum[]
		| Prisma.IntegrationConnectionScalarFieldEnum;
	having?: Prisma.IntegrationConnectionScalarWhereWithAggregatesInput;
	take?: number;
	skip?: number;
	_count?: IntegrationConnectionCountAggregateInputType | true;
	_min?: IntegrationConnectionMinAggregateInputType;
	_max?: IntegrationConnectionMaxAggregateInputType;
};
export type IntegrationConnectionGroupByOutputType = {
	id: string;
	definitionId: string;
	name: string;
	description: string | null;
	isGlobal: boolean;
	status: string;
	lastHealthCheck: Date | null;
	lastError: string | null;
	authMethod: string;
	credentials: string;
	config: string | null;
	createdAt: Date;
	updatedAt: Date;
	_count: IntegrationConnectionCountAggregateOutputType | null;
	_min: IntegrationConnectionMinAggregateOutputType | null;
	_max: IntegrationConnectionMaxAggregateOutputType | null;
};
type GetIntegrationConnectionGroupByPayload<
	T extends IntegrationConnectionGroupByArgs,
> = Prisma.PrismaPromise<
	Array<
		Prisma.PickEnumerable<IntegrationConnectionGroupByOutputType, T["by"]> & {
			[P in keyof T &
				keyof IntegrationConnectionGroupByOutputType]: P extends "_count"
				? T[P] extends boolean
					? number
					: Prisma.GetScalarType<
							T[P],
							IntegrationConnectionGroupByOutputType[P]
						>
				: Prisma.GetScalarType<T[P], IntegrationConnectionGroupByOutputType[P]>;
		}
	>
>;
export type IntegrationConnectionWhereInput = {
	AND?:
		| Prisma.IntegrationConnectionWhereInput
		| Prisma.IntegrationConnectionWhereInput[];
	OR?: Prisma.IntegrationConnectionWhereInput[];
	NOT?:
		| Prisma.IntegrationConnectionWhereInput
		| Prisma.IntegrationConnectionWhereInput[];
	id?: Prisma.StringFilter<"IntegrationConnection"> | string;
	definitionId?: Prisma.StringFilter<"IntegrationConnection"> | string;
	name?: Prisma.StringFilter<"IntegrationConnection"> | string;
	description?:
		| Prisma.StringNullableFilter<"IntegrationConnection">
		| string
		| null;
	isGlobal?: Prisma.BoolFilter<"IntegrationConnection"> | boolean;
	status?: Prisma.StringFilter<"IntegrationConnection"> | string;
	lastHealthCheck?:
		| Prisma.DateTimeNullableFilter<"IntegrationConnection">
		| Date
		| string
		| null;
	lastError?:
		| Prisma.StringNullableFilter<"IntegrationConnection">
		| string
		| null;
	authMethod?: Prisma.StringFilter<"IntegrationConnection"> | string;
	credentials?: Prisma.StringFilter<"IntegrationConnection"> | string;
	config?: Prisma.StringNullableFilter<"IntegrationConnection"> | string | null;
	createdAt?: Prisma.DateTimeFilter<"IntegrationConnection"> | Date | string;
	updatedAt?: Prisma.DateTimeFilter<"IntegrationConnection"> | Date | string;
	definition?: Prisma.XOR<
		Prisma.IntegrationDefinitionScalarRelationFilter,
		Prisma.IntegrationDefinitionWhereInput
	>;
	serviceMappings?: Prisma.ServiceIntegrationListRelationFilter;
	serviceSuggestions?: Prisma.ServiceSuggestionListRelationFilter;
};
export type IntegrationConnectionOrderByWithRelationInput = {
	id?: Prisma.SortOrder;
	definitionId?: Prisma.SortOrder;
	name?: Prisma.SortOrder;
	description?: Prisma.SortOrderInput | Prisma.SortOrder;
	isGlobal?: Prisma.SortOrder;
	status?: Prisma.SortOrder;
	lastHealthCheck?: Prisma.SortOrderInput | Prisma.SortOrder;
	lastError?: Prisma.SortOrderInput | Prisma.SortOrder;
	authMethod?: Prisma.SortOrder;
	credentials?: Prisma.SortOrder;
	config?: Prisma.SortOrderInput | Prisma.SortOrder;
	createdAt?: Prisma.SortOrder;
	updatedAt?: Prisma.SortOrder;
	definition?: Prisma.IntegrationDefinitionOrderByWithRelationInput;
	serviceMappings?: Prisma.ServiceIntegrationOrderByRelationAggregateInput;
	serviceSuggestions?: Prisma.ServiceSuggestionOrderByRelationAggregateInput;
};
export type IntegrationConnectionWhereUniqueInput = Prisma.AtLeast<
	{
		id?: string;
		definitionId_name?: Prisma.IntegrationConnectionDefinitionIdNameCompoundUniqueInput;
		AND?:
			| Prisma.IntegrationConnectionWhereInput
			| Prisma.IntegrationConnectionWhereInput[];
		OR?: Prisma.IntegrationConnectionWhereInput[];
		NOT?:
			| Prisma.IntegrationConnectionWhereInput
			| Prisma.IntegrationConnectionWhereInput[];
		definitionId?: Prisma.StringFilter<"IntegrationConnection"> | string;
		name?: Prisma.StringFilter<"IntegrationConnection"> | string;
		description?:
			| Prisma.StringNullableFilter<"IntegrationConnection">
			| string
			| null;
		isGlobal?: Prisma.BoolFilter<"IntegrationConnection"> | boolean;
		status?: Prisma.StringFilter<"IntegrationConnection"> | string;
		lastHealthCheck?:
			| Prisma.DateTimeNullableFilter<"IntegrationConnection">
			| Date
			| string
			| null;
		lastError?:
			| Prisma.StringNullableFilter<"IntegrationConnection">
			| string
			| null;
		authMethod?: Prisma.StringFilter<"IntegrationConnection"> | string;
		credentials?: Prisma.StringFilter<"IntegrationConnection"> | string;
		config?:
			| Prisma.StringNullableFilter<"IntegrationConnection">
			| string
			| null;
		createdAt?: Prisma.DateTimeFilter<"IntegrationConnection"> | Date | string;
		updatedAt?: Prisma.DateTimeFilter<"IntegrationConnection"> | Date | string;
		definition?: Prisma.XOR<
			Prisma.IntegrationDefinitionScalarRelationFilter,
			Prisma.IntegrationDefinitionWhereInput
		>;
		serviceMappings?: Prisma.ServiceIntegrationListRelationFilter;
		serviceSuggestions?: Prisma.ServiceSuggestionListRelationFilter;
	},
	"id" | "definitionId_name"
>;
export type IntegrationConnectionOrderByWithAggregationInput = {
	id?: Prisma.SortOrder;
	definitionId?: Prisma.SortOrder;
	name?: Prisma.SortOrder;
	description?: Prisma.SortOrderInput | Prisma.SortOrder;
	isGlobal?: Prisma.SortOrder;
	status?: Prisma.SortOrder;
	lastHealthCheck?: Prisma.SortOrderInput | Prisma.SortOrder;
	lastError?: Prisma.SortOrderInput | Prisma.SortOrder;
	authMethod?: Prisma.SortOrder;
	credentials?: Prisma.SortOrder;
	config?: Prisma.SortOrderInput | Prisma.SortOrder;
	createdAt?: Prisma.SortOrder;
	updatedAt?: Prisma.SortOrder;
	_count?: Prisma.IntegrationConnectionCountOrderByAggregateInput;
	_max?: Prisma.IntegrationConnectionMaxOrderByAggregateInput;
	_min?: Prisma.IntegrationConnectionMinOrderByAggregateInput;
};
export type IntegrationConnectionScalarWhereWithAggregatesInput = {
	AND?:
		| Prisma.IntegrationConnectionScalarWhereWithAggregatesInput
		| Prisma.IntegrationConnectionScalarWhereWithAggregatesInput[];
	OR?: Prisma.IntegrationConnectionScalarWhereWithAggregatesInput[];
	NOT?:
		| Prisma.IntegrationConnectionScalarWhereWithAggregatesInput
		| Prisma.IntegrationConnectionScalarWhereWithAggregatesInput[];
	id?: Prisma.StringWithAggregatesFilter<"IntegrationConnection"> | string;
	definitionId?:
		| Prisma.StringWithAggregatesFilter<"IntegrationConnection">
		| string;
	name?: Prisma.StringWithAggregatesFilter<"IntegrationConnection"> | string;
	description?:
		| Prisma.StringNullableWithAggregatesFilter<"IntegrationConnection">
		| string
		| null;
	isGlobal?: Prisma.BoolWithAggregatesFilter<"IntegrationConnection"> | boolean;
	status?: Prisma.StringWithAggregatesFilter<"IntegrationConnection"> | string;
	lastHealthCheck?:
		| Prisma.DateTimeNullableWithAggregatesFilter<"IntegrationConnection">
		| Date
		| string
		| null;
	lastError?:
		| Prisma.StringNullableWithAggregatesFilter<"IntegrationConnection">
		| string
		| null;
	authMethod?:
		| Prisma.StringWithAggregatesFilter<"IntegrationConnection">
		| string;
	credentials?:
		| Prisma.StringWithAggregatesFilter<"IntegrationConnection">
		| string;
	config?:
		| Prisma.StringNullableWithAggregatesFilter<"IntegrationConnection">
		| string
		| null;
	createdAt?:
		| Prisma.DateTimeWithAggregatesFilter<"IntegrationConnection">
		| Date
		| string;
	updatedAt?:
		| Prisma.DateTimeWithAggregatesFilter<"IntegrationConnection">
		| Date
		| string;
};
export type IntegrationConnectionCreateInput = {
	id?: string;
	name: string;
	description?: string | null;
	isGlobal?: boolean;
	status?: string;
	lastHealthCheck?: Date | string | null;
	lastError?: string | null;
	authMethod: string;
	credentials: string;
	config?: string | null;
	createdAt?: Date | string;
	updatedAt?: Date | string;
	definition: Prisma.IntegrationDefinitionCreateNestedOneWithoutConnectionsInput;
	serviceMappings?: Prisma.ServiceIntegrationCreateNestedManyWithoutConnectionInput;
	serviceSuggestions?: Prisma.ServiceSuggestionCreateNestedManyWithoutConnectionInput;
};
export type IntegrationConnectionUncheckedCreateInput = {
	id?: string;
	definitionId: string;
	name: string;
	description?: string | null;
	isGlobal?: boolean;
	status?: string;
	lastHealthCheck?: Date | string | null;
	lastError?: string | null;
	authMethod: string;
	credentials: string;
	config?: string | null;
	createdAt?: Date | string;
	updatedAt?: Date | string;
	serviceMappings?: Prisma.ServiceIntegrationUncheckedCreateNestedManyWithoutConnectionInput;
	serviceSuggestions?: Prisma.ServiceSuggestionUncheckedCreateNestedManyWithoutConnectionInput;
};
export type IntegrationConnectionUpdateInput = {
	id?: Prisma.StringFieldUpdateOperationsInput | string;
	name?: Prisma.StringFieldUpdateOperationsInput | string;
	description?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	isGlobal?: Prisma.BoolFieldUpdateOperationsInput | boolean;
	status?: Prisma.StringFieldUpdateOperationsInput | string;
	lastHealthCheck?:
		| Prisma.NullableDateTimeFieldUpdateOperationsInput
		| Date
		| string
		| null;
	lastError?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	authMethod?: Prisma.StringFieldUpdateOperationsInput | string;
	credentials?: Prisma.StringFieldUpdateOperationsInput | string;
	config?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	createdAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
	updatedAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
	definition?: Prisma.IntegrationDefinitionUpdateOneRequiredWithoutConnectionsNestedInput;
	serviceMappings?: Prisma.ServiceIntegrationUpdateManyWithoutConnectionNestedInput;
	serviceSuggestions?: Prisma.ServiceSuggestionUpdateManyWithoutConnectionNestedInput;
};
export type IntegrationConnectionUncheckedUpdateInput = {
	id?: Prisma.StringFieldUpdateOperationsInput | string;
	definitionId?: Prisma.StringFieldUpdateOperationsInput | string;
	name?: Prisma.StringFieldUpdateOperationsInput | string;
	description?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	isGlobal?: Prisma.BoolFieldUpdateOperationsInput | boolean;
	status?: Prisma.StringFieldUpdateOperationsInput | string;
	lastHealthCheck?:
		| Prisma.NullableDateTimeFieldUpdateOperationsInput
		| Date
		| string
		| null;
	lastError?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	authMethod?: Prisma.StringFieldUpdateOperationsInput | string;
	credentials?: Prisma.StringFieldUpdateOperationsInput | string;
	config?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	createdAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
	updatedAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
	serviceMappings?: Prisma.ServiceIntegrationUncheckedUpdateManyWithoutConnectionNestedInput;
	serviceSuggestions?: Prisma.ServiceSuggestionUncheckedUpdateManyWithoutConnectionNestedInput;
};
export type IntegrationConnectionCreateManyInput = {
	id?: string;
	definitionId: string;
	name: string;
	description?: string | null;
	isGlobal?: boolean;
	status?: string;
	lastHealthCheck?: Date | string | null;
	lastError?: string | null;
	authMethod: string;
	credentials: string;
	config?: string | null;
	createdAt?: Date | string;
	updatedAt?: Date | string;
};
export type IntegrationConnectionUpdateManyMutationInput = {
	id?: Prisma.StringFieldUpdateOperationsInput | string;
	name?: Prisma.StringFieldUpdateOperationsInput | string;
	description?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	isGlobal?: Prisma.BoolFieldUpdateOperationsInput | boolean;
	status?: Prisma.StringFieldUpdateOperationsInput | string;
	lastHealthCheck?:
		| Prisma.NullableDateTimeFieldUpdateOperationsInput
		| Date
		| string
		| null;
	lastError?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	authMethod?: Prisma.StringFieldUpdateOperationsInput | string;
	credentials?: Prisma.StringFieldUpdateOperationsInput | string;
	config?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	createdAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
	updatedAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
};
export type IntegrationConnectionUncheckedUpdateManyInput = {
	id?: Prisma.StringFieldUpdateOperationsInput | string;
	definitionId?: Prisma.StringFieldUpdateOperationsInput | string;
	name?: Prisma.StringFieldUpdateOperationsInput | string;
	description?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	isGlobal?: Prisma.BoolFieldUpdateOperationsInput | boolean;
	status?: Prisma.StringFieldUpdateOperationsInput | string;
	lastHealthCheck?:
		| Prisma.NullableDateTimeFieldUpdateOperationsInput
		| Date
		| string
		| null;
	lastError?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	authMethod?: Prisma.StringFieldUpdateOperationsInput | string;
	credentials?: Prisma.StringFieldUpdateOperationsInput | string;
	config?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	createdAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
	updatedAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
};
export type IntegrationConnectionListRelationFilter = {
	every?: Prisma.IntegrationConnectionWhereInput;
	some?: Prisma.IntegrationConnectionWhereInput;
	none?: Prisma.IntegrationConnectionWhereInput;
};
export type IntegrationConnectionOrderByRelationAggregateInput = {
	_count?: Prisma.SortOrder;
};
export type IntegrationConnectionDefinitionIdNameCompoundUniqueInput = {
	definitionId: string;
	name: string;
};
export type IntegrationConnectionCountOrderByAggregateInput = {
	id?: Prisma.SortOrder;
	definitionId?: Prisma.SortOrder;
	name?: Prisma.SortOrder;
	description?: Prisma.SortOrder;
	isGlobal?: Prisma.SortOrder;
	status?: Prisma.SortOrder;
	lastHealthCheck?: Prisma.SortOrder;
	lastError?: Prisma.SortOrder;
	authMethod?: Prisma.SortOrder;
	credentials?: Prisma.SortOrder;
	config?: Prisma.SortOrder;
	createdAt?: Prisma.SortOrder;
	updatedAt?: Prisma.SortOrder;
};
export type IntegrationConnectionMaxOrderByAggregateInput = {
	id?: Prisma.SortOrder;
	definitionId?: Prisma.SortOrder;
	name?: Prisma.SortOrder;
	description?: Prisma.SortOrder;
	isGlobal?: Prisma.SortOrder;
	status?: Prisma.SortOrder;
	lastHealthCheck?: Prisma.SortOrder;
	lastError?: Prisma.SortOrder;
	authMethod?: Prisma.SortOrder;
	credentials?: Prisma.SortOrder;
	config?: Prisma.SortOrder;
	createdAt?: Prisma.SortOrder;
	updatedAt?: Prisma.SortOrder;
};
export type IntegrationConnectionMinOrderByAggregateInput = {
	id?: Prisma.SortOrder;
	definitionId?: Prisma.SortOrder;
	name?: Prisma.SortOrder;
	description?: Prisma.SortOrder;
	isGlobal?: Prisma.SortOrder;
	status?: Prisma.SortOrder;
	lastHealthCheck?: Prisma.SortOrder;
	lastError?: Prisma.SortOrder;
	authMethod?: Prisma.SortOrder;
	credentials?: Prisma.SortOrder;
	config?: Prisma.SortOrder;
	createdAt?: Prisma.SortOrder;
	updatedAt?: Prisma.SortOrder;
};
export type IntegrationConnectionScalarRelationFilter = {
	is?: Prisma.IntegrationConnectionWhereInput;
	isNot?: Prisma.IntegrationConnectionWhereInput;
};
export type IntegrationConnectionCreateNestedManyWithoutDefinitionInput = {
	create?:
		| Prisma.XOR<
				Prisma.IntegrationConnectionCreateWithoutDefinitionInput,
				Prisma.IntegrationConnectionUncheckedCreateWithoutDefinitionInput
		  >
		| Prisma.IntegrationConnectionCreateWithoutDefinitionInput[]
		| Prisma.IntegrationConnectionUncheckedCreateWithoutDefinitionInput[];
	connectOrCreate?:
		| Prisma.IntegrationConnectionCreateOrConnectWithoutDefinitionInput
		| Prisma.IntegrationConnectionCreateOrConnectWithoutDefinitionInput[];
	createMany?: Prisma.IntegrationConnectionCreateManyDefinitionInputEnvelope;
	connect?:
		| Prisma.IntegrationConnectionWhereUniqueInput
		| Prisma.IntegrationConnectionWhereUniqueInput[];
};
export type IntegrationConnectionUncheckedCreateNestedManyWithoutDefinitionInput =
	{
		create?:
			| Prisma.XOR<
					Prisma.IntegrationConnectionCreateWithoutDefinitionInput,
					Prisma.IntegrationConnectionUncheckedCreateWithoutDefinitionInput
			  >
			| Prisma.IntegrationConnectionCreateWithoutDefinitionInput[]
			| Prisma.IntegrationConnectionUncheckedCreateWithoutDefinitionInput[];
		connectOrCreate?:
			| Prisma.IntegrationConnectionCreateOrConnectWithoutDefinitionInput
			| Prisma.IntegrationConnectionCreateOrConnectWithoutDefinitionInput[];
		createMany?: Prisma.IntegrationConnectionCreateManyDefinitionInputEnvelope;
		connect?:
			| Prisma.IntegrationConnectionWhereUniqueInput
			| Prisma.IntegrationConnectionWhereUniqueInput[];
	};
export type IntegrationConnectionUpdateManyWithoutDefinitionNestedInput = {
	create?:
		| Prisma.XOR<
				Prisma.IntegrationConnectionCreateWithoutDefinitionInput,
				Prisma.IntegrationConnectionUncheckedCreateWithoutDefinitionInput
		  >
		| Prisma.IntegrationConnectionCreateWithoutDefinitionInput[]
		| Prisma.IntegrationConnectionUncheckedCreateWithoutDefinitionInput[];
	connectOrCreate?:
		| Prisma.IntegrationConnectionCreateOrConnectWithoutDefinitionInput
		| Prisma.IntegrationConnectionCreateOrConnectWithoutDefinitionInput[];
	upsert?:
		| Prisma.IntegrationConnectionUpsertWithWhereUniqueWithoutDefinitionInput
		| Prisma.IntegrationConnectionUpsertWithWhereUniqueWithoutDefinitionInput[];
	createMany?: Prisma.IntegrationConnectionCreateManyDefinitionInputEnvelope;
	set?:
		| Prisma.IntegrationConnectionWhereUniqueInput
		| Prisma.IntegrationConnectionWhereUniqueInput[];
	disconnect?:
		| Prisma.IntegrationConnectionWhereUniqueInput
		| Prisma.IntegrationConnectionWhereUniqueInput[];
	delete?:
		| Prisma.IntegrationConnectionWhereUniqueInput
		| Prisma.IntegrationConnectionWhereUniqueInput[];
	connect?:
		| Prisma.IntegrationConnectionWhereUniqueInput
		| Prisma.IntegrationConnectionWhereUniqueInput[];
	update?:
		| Prisma.IntegrationConnectionUpdateWithWhereUniqueWithoutDefinitionInput
		| Prisma.IntegrationConnectionUpdateWithWhereUniqueWithoutDefinitionInput[];
	updateMany?:
		| Prisma.IntegrationConnectionUpdateManyWithWhereWithoutDefinitionInput
		| Prisma.IntegrationConnectionUpdateManyWithWhereWithoutDefinitionInput[];
	deleteMany?:
		| Prisma.IntegrationConnectionScalarWhereInput
		| Prisma.IntegrationConnectionScalarWhereInput[];
};
export type IntegrationConnectionUncheckedUpdateManyWithoutDefinitionNestedInput =
	{
		create?:
			| Prisma.XOR<
					Prisma.IntegrationConnectionCreateWithoutDefinitionInput,
					Prisma.IntegrationConnectionUncheckedCreateWithoutDefinitionInput
			  >
			| Prisma.IntegrationConnectionCreateWithoutDefinitionInput[]
			| Prisma.IntegrationConnectionUncheckedCreateWithoutDefinitionInput[];
		connectOrCreate?:
			| Prisma.IntegrationConnectionCreateOrConnectWithoutDefinitionInput
			| Prisma.IntegrationConnectionCreateOrConnectWithoutDefinitionInput[];
		upsert?:
			| Prisma.IntegrationConnectionUpsertWithWhereUniqueWithoutDefinitionInput
			| Prisma.IntegrationConnectionUpsertWithWhereUniqueWithoutDefinitionInput[];
		createMany?: Prisma.IntegrationConnectionCreateManyDefinitionInputEnvelope;
		set?:
			| Prisma.IntegrationConnectionWhereUniqueInput
			| Prisma.IntegrationConnectionWhereUniqueInput[];
		disconnect?:
			| Prisma.IntegrationConnectionWhereUniqueInput
			| Prisma.IntegrationConnectionWhereUniqueInput[];
		delete?:
			| Prisma.IntegrationConnectionWhereUniqueInput
			| Prisma.IntegrationConnectionWhereUniqueInput[];
		connect?:
			| Prisma.IntegrationConnectionWhereUniqueInput
			| Prisma.IntegrationConnectionWhereUniqueInput[];
		update?:
			| Prisma.IntegrationConnectionUpdateWithWhereUniqueWithoutDefinitionInput
			| Prisma.IntegrationConnectionUpdateWithWhereUniqueWithoutDefinitionInput[];
		updateMany?:
			| Prisma.IntegrationConnectionUpdateManyWithWhereWithoutDefinitionInput
			| Prisma.IntegrationConnectionUpdateManyWithWhereWithoutDefinitionInput[];
		deleteMany?:
			| Prisma.IntegrationConnectionScalarWhereInput
			| Prisma.IntegrationConnectionScalarWhereInput[];
	};
export type IntegrationConnectionCreateNestedOneWithoutServiceMappingsInput = {
	create?: Prisma.XOR<
		Prisma.IntegrationConnectionCreateWithoutServiceMappingsInput,
		Prisma.IntegrationConnectionUncheckedCreateWithoutServiceMappingsInput
	>;
	connectOrCreate?: Prisma.IntegrationConnectionCreateOrConnectWithoutServiceMappingsInput;
	connect?: Prisma.IntegrationConnectionWhereUniqueInput;
};
export type IntegrationConnectionUpdateOneRequiredWithoutServiceMappingsNestedInput =
	{
		create?: Prisma.XOR<
			Prisma.IntegrationConnectionCreateWithoutServiceMappingsInput,
			Prisma.IntegrationConnectionUncheckedCreateWithoutServiceMappingsInput
		>;
		connectOrCreate?: Prisma.IntegrationConnectionCreateOrConnectWithoutServiceMappingsInput;
		upsert?: Prisma.IntegrationConnectionUpsertWithoutServiceMappingsInput;
		connect?: Prisma.IntegrationConnectionWhereUniqueInput;
		update?: Prisma.XOR<
			Prisma.XOR<
				Prisma.IntegrationConnectionUpdateToOneWithWhereWithoutServiceMappingsInput,
				Prisma.IntegrationConnectionUpdateWithoutServiceMappingsInput
			>,
			Prisma.IntegrationConnectionUncheckedUpdateWithoutServiceMappingsInput
		>;
	};
export type IntegrationConnectionCreateNestedOneWithoutServiceSuggestionsInput =
	{
		create?: Prisma.XOR<
			Prisma.IntegrationConnectionCreateWithoutServiceSuggestionsInput,
			Prisma.IntegrationConnectionUncheckedCreateWithoutServiceSuggestionsInput
		>;
		connectOrCreate?: Prisma.IntegrationConnectionCreateOrConnectWithoutServiceSuggestionsInput;
		connect?: Prisma.IntegrationConnectionWhereUniqueInput;
	};
export type IntegrationConnectionUpdateOneRequiredWithoutServiceSuggestionsNestedInput =
	{
		create?: Prisma.XOR<
			Prisma.IntegrationConnectionCreateWithoutServiceSuggestionsInput,
			Prisma.IntegrationConnectionUncheckedCreateWithoutServiceSuggestionsInput
		>;
		connectOrCreate?: Prisma.IntegrationConnectionCreateOrConnectWithoutServiceSuggestionsInput;
		upsert?: Prisma.IntegrationConnectionUpsertWithoutServiceSuggestionsInput;
		connect?: Prisma.IntegrationConnectionWhereUniqueInput;
		update?: Prisma.XOR<
			Prisma.XOR<
				Prisma.IntegrationConnectionUpdateToOneWithWhereWithoutServiceSuggestionsInput,
				Prisma.IntegrationConnectionUpdateWithoutServiceSuggestionsInput
			>,
			Prisma.IntegrationConnectionUncheckedUpdateWithoutServiceSuggestionsInput
		>;
	};
export type IntegrationConnectionCreateWithoutDefinitionInput = {
	id?: string;
	name: string;
	description?: string | null;
	isGlobal?: boolean;
	status?: string;
	lastHealthCheck?: Date | string | null;
	lastError?: string | null;
	authMethod: string;
	credentials: string;
	config?: string | null;
	createdAt?: Date | string;
	updatedAt?: Date | string;
	serviceMappings?: Prisma.ServiceIntegrationCreateNestedManyWithoutConnectionInput;
	serviceSuggestions?: Prisma.ServiceSuggestionCreateNestedManyWithoutConnectionInput;
};
export type IntegrationConnectionUncheckedCreateWithoutDefinitionInput = {
	id?: string;
	name: string;
	description?: string | null;
	isGlobal?: boolean;
	status?: string;
	lastHealthCheck?: Date | string | null;
	lastError?: string | null;
	authMethod: string;
	credentials: string;
	config?: string | null;
	createdAt?: Date | string;
	updatedAt?: Date | string;
	serviceMappings?: Prisma.ServiceIntegrationUncheckedCreateNestedManyWithoutConnectionInput;
	serviceSuggestions?: Prisma.ServiceSuggestionUncheckedCreateNestedManyWithoutConnectionInput;
};
export type IntegrationConnectionCreateOrConnectWithoutDefinitionInput = {
	where: Prisma.IntegrationConnectionWhereUniqueInput;
	create: Prisma.XOR<
		Prisma.IntegrationConnectionCreateWithoutDefinitionInput,
		Prisma.IntegrationConnectionUncheckedCreateWithoutDefinitionInput
	>;
};
export type IntegrationConnectionCreateManyDefinitionInputEnvelope = {
	data:
		| Prisma.IntegrationConnectionCreateManyDefinitionInput
		| Prisma.IntegrationConnectionCreateManyDefinitionInput[];
};
export type IntegrationConnectionUpsertWithWhereUniqueWithoutDefinitionInput = {
	where: Prisma.IntegrationConnectionWhereUniqueInput;
	update: Prisma.XOR<
		Prisma.IntegrationConnectionUpdateWithoutDefinitionInput,
		Prisma.IntegrationConnectionUncheckedUpdateWithoutDefinitionInput
	>;
	create: Prisma.XOR<
		Prisma.IntegrationConnectionCreateWithoutDefinitionInput,
		Prisma.IntegrationConnectionUncheckedCreateWithoutDefinitionInput
	>;
};
export type IntegrationConnectionUpdateWithWhereUniqueWithoutDefinitionInput = {
	where: Prisma.IntegrationConnectionWhereUniqueInput;
	data: Prisma.XOR<
		Prisma.IntegrationConnectionUpdateWithoutDefinitionInput,
		Prisma.IntegrationConnectionUncheckedUpdateWithoutDefinitionInput
	>;
};
export type IntegrationConnectionUpdateManyWithWhereWithoutDefinitionInput = {
	where: Prisma.IntegrationConnectionScalarWhereInput;
	data: Prisma.XOR<
		Prisma.IntegrationConnectionUpdateManyMutationInput,
		Prisma.IntegrationConnectionUncheckedUpdateManyWithoutDefinitionInput
	>;
};
export type IntegrationConnectionScalarWhereInput = {
	AND?:
		| Prisma.IntegrationConnectionScalarWhereInput
		| Prisma.IntegrationConnectionScalarWhereInput[];
	OR?: Prisma.IntegrationConnectionScalarWhereInput[];
	NOT?:
		| Prisma.IntegrationConnectionScalarWhereInput
		| Prisma.IntegrationConnectionScalarWhereInput[];
	id?: Prisma.StringFilter<"IntegrationConnection"> | string;
	definitionId?: Prisma.StringFilter<"IntegrationConnection"> | string;
	name?: Prisma.StringFilter<"IntegrationConnection"> | string;
	description?:
		| Prisma.StringNullableFilter<"IntegrationConnection">
		| string
		| null;
	isGlobal?: Prisma.BoolFilter<"IntegrationConnection"> | boolean;
	status?: Prisma.StringFilter<"IntegrationConnection"> | string;
	lastHealthCheck?:
		| Prisma.DateTimeNullableFilter<"IntegrationConnection">
		| Date
		| string
		| null;
	lastError?:
		| Prisma.StringNullableFilter<"IntegrationConnection">
		| string
		| null;
	authMethod?: Prisma.StringFilter<"IntegrationConnection"> | string;
	credentials?: Prisma.StringFilter<"IntegrationConnection"> | string;
	config?: Prisma.StringNullableFilter<"IntegrationConnection"> | string | null;
	createdAt?: Prisma.DateTimeFilter<"IntegrationConnection"> | Date | string;
	updatedAt?: Prisma.DateTimeFilter<"IntegrationConnection"> | Date | string;
};
export type IntegrationConnectionCreateWithoutServiceMappingsInput = {
	id?: string;
	name: string;
	description?: string | null;
	isGlobal?: boolean;
	status?: string;
	lastHealthCheck?: Date | string | null;
	lastError?: string | null;
	authMethod: string;
	credentials: string;
	config?: string | null;
	createdAt?: Date | string;
	updatedAt?: Date | string;
	definition: Prisma.IntegrationDefinitionCreateNestedOneWithoutConnectionsInput;
	serviceSuggestions?: Prisma.ServiceSuggestionCreateNestedManyWithoutConnectionInput;
};
export type IntegrationConnectionUncheckedCreateWithoutServiceMappingsInput = {
	id?: string;
	definitionId: string;
	name: string;
	description?: string | null;
	isGlobal?: boolean;
	status?: string;
	lastHealthCheck?: Date | string | null;
	lastError?: string | null;
	authMethod: string;
	credentials: string;
	config?: string | null;
	createdAt?: Date | string;
	updatedAt?: Date | string;
	serviceSuggestions?: Prisma.ServiceSuggestionUncheckedCreateNestedManyWithoutConnectionInput;
};
export type IntegrationConnectionCreateOrConnectWithoutServiceMappingsInput = {
	where: Prisma.IntegrationConnectionWhereUniqueInput;
	create: Prisma.XOR<
		Prisma.IntegrationConnectionCreateWithoutServiceMappingsInput,
		Prisma.IntegrationConnectionUncheckedCreateWithoutServiceMappingsInput
	>;
};
export type IntegrationConnectionUpsertWithoutServiceMappingsInput = {
	update: Prisma.XOR<
		Prisma.IntegrationConnectionUpdateWithoutServiceMappingsInput,
		Prisma.IntegrationConnectionUncheckedUpdateWithoutServiceMappingsInput
	>;
	create: Prisma.XOR<
		Prisma.IntegrationConnectionCreateWithoutServiceMappingsInput,
		Prisma.IntegrationConnectionUncheckedCreateWithoutServiceMappingsInput
	>;
	where?: Prisma.IntegrationConnectionWhereInput;
};
export type IntegrationConnectionUpdateToOneWithWhereWithoutServiceMappingsInput =
	{
		where?: Prisma.IntegrationConnectionWhereInput;
		data: Prisma.XOR<
			Prisma.IntegrationConnectionUpdateWithoutServiceMappingsInput,
			Prisma.IntegrationConnectionUncheckedUpdateWithoutServiceMappingsInput
		>;
	};
export type IntegrationConnectionUpdateWithoutServiceMappingsInput = {
	id?: Prisma.StringFieldUpdateOperationsInput | string;
	name?: Prisma.StringFieldUpdateOperationsInput | string;
	description?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	isGlobal?: Prisma.BoolFieldUpdateOperationsInput | boolean;
	status?: Prisma.StringFieldUpdateOperationsInput | string;
	lastHealthCheck?:
		| Prisma.NullableDateTimeFieldUpdateOperationsInput
		| Date
		| string
		| null;
	lastError?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	authMethod?: Prisma.StringFieldUpdateOperationsInput | string;
	credentials?: Prisma.StringFieldUpdateOperationsInput | string;
	config?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	createdAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
	updatedAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
	definition?: Prisma.IntegrationDefinitionUpdateOneRequiredWithoutConnectionsNestedInput;
	serviceSuggestions?: Prisma.ServiceSuggestionUpdateManyWithoutConnectionNestedInput;
};
export type IntegrationConnectionUncheckedUpdateWithoutServiceMappingsInput = {
	id?: Prisma.StringFieldUpdateOperationsInput | string;
	definitionId?: Prisma.StringFieldUpdateOperationsInput | string;
	name?: Prisma.StringFieldUpdateOperationsInput | string;
	description?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	isGlobal?: Prisma.BoolFieldUpdateOperationsInput | boolean;
	status?: Prisma.StringFieldUpdateOperationsInput | string;
	lastHealthCheck?:
		| Prisma.NullableDateTimeFieldUpdateOperationsInput
		| Date
		| string
		| null;
	lastError?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	authMethod?: Prisma.StringFieldUpdateOperationsInput | string;
	credentials?: Prisma.StringFieldUpdateOperationsInput | string;
	config?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	createdAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
	updatedAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
	serviceSuggestions?: Prisma.ServiceSuggestionUncheckedUpdateManyWithoutConnectionNestedInput;
};
export type IntegrationConnectionCreateWithoutServiceSuggestionsInput = {
	id?: string;
	name: string;
	description?: string | null;
	isGlobal?: boolean;
	status?: string;
	lastHealthCheck?: Date | string | null;
	lastError?: string | null;
	authMethod: string;
	credentials: string;
	config?: string | null;
	createdAt?: Date | string;
	updatedAt?: Date | string;
	definition: Prisma.IntegrationDefinitionCreateNestedOneWithoutConnectionsInput;
	serviceMappings?: Prisma.ServiceIntegrationCreateNestedManyWithoutConnectionInput;
};
export type IntegrationConnectionUncheckedCreateWithoutServiceSuggestionsInput =
	{
		id?: string;
		definitionId: string;
		name: string;
		description?: string | null;
		isGlobal?: boolean;
		status?: string;
		lastHealthCheck?: Date | string | null;
		lastError?: string | null;
		authMethod: string;
		credentials: string;
		config?: string | null;
		createdAt?: Date | string;
		updatedAt?: Date | string;
		serviceMappings?: Prisma.ServiceIntegrationUncheckedCreateNestedManyWithoutConnectionInput;
	};
export type IntegrationConnectionCreateOrConnectWithoutServiceSuggestionsInput =
	{
		where: Prisma.IntegrationConnectionWhereUniqueInput;
		create: Prisma.XOR<
			Prisma.IntegrationConnectionCreateWithoutServiceSuggestionsInput,
			Prisma.IntegrationConnectionUncheckedCreateWithoutServiceSuggestionsInput
		>;
	};
export type IntegrationConnectionUpsertWithoutServiceSuggestionsInput = {
	update: Prisma.XOR<
		Prisma.IntegrationConnectionUpdateWithoutServiceSuggestionsInput,
		Prisma.IntegrationConnectionUncheckedUpdateWithoutServiceSuggestionsInput
	>;
	create: Prisma.XOR<
		Prisma.IntegrationConnectionCreateWithoutServiceSuggestionsInput,
		Prisma.IntegrationConnectionUncheckedCreateWithoutServiceSuggestionsInput
	>;
	where?: Prisma.IntegrationConnectionWhereInput;
};
export type IntegrationConnectionUpdateToOneWithWhereWithoutServiceSuggestionsInput =
	{
		where?: Prisma.IntegrationConnectionWhereInput;
		data: Prisma.XOR<
			Prisma.IntegrationConnectionUpdateWithoutServiceSuggestionsInput,
			Prisma.IntegrationConnectionUncheckedUpdateWithoutServiceSuggestionsInput
		>;
	};
export type IntegrationConnectionUpdateWithoutServiceSuggestionsInput = {
	id?: Prisma.StringFieldUpdateOperationsInput | string;
	name?: Prisma.StringFieldUpdateOperationsInput | string;
	description?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	isGlobal?: Prisma.BoolFieldUpdateOperationsInput | boolean;
	status?: Prisma.StringFieldUpdateOperationsInput | string;
	lastHealthCheck?:
		| Prisma.NullableDateTimeFieldUpdateOperationsInput
		| Date
		| string
		| null;
	lastError?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	authMethod?: Prisma.StringFieldUpdateOperationsInput | string;
	credentials?: Prisma.StringFieldUpdateOperationsInput | string;
	config?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	createdAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
	updatedAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
	definition?: Prisma.IntegrationDefinitionUpdateOneRequiredWithoutConnectionsNestedInput;
	serviceMappings?: Prisma.ServiceIntegrationUpdateManyWithoutConnectionNestedInput;
};
export type IntegrationConnectionUncheckedUpdateWithoutServiceSuggestionsInput =
	{
		id?: Prisma.StringFieldUpdateOperationsInput | string;
		definitionId?: Prisma.StringFieldUpdateOperationsInput | string;
		name?: Prisma.StringFieldUpdateOperationsInput | string;
		description?:
			| Prisma.NullableStringFieldUpdateOperationsInput
			| string
			| null;
		isGlobal?: Prisma.BoolFieldUpdateOperationsInput | boolean;
		status?: Prisma.StringFieldUpdateOperationsInput | string;
		lastHealthCheck?:
			| Prisma.NullableDateTimeFieldUpdateOperationsInput
			| Date
			| string
			| null;
		lastError?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
		authMethod?: Prisma.StringFieldUpdateOperationsInput | string;
		credentials?: Prisma.StringFieldUpdateOperationsInput | string;
		config?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
		createdAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
		updatedAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
		serviceMappings?: Prisma.ServiceIntegrationUncheckedUpdateManyWithoutConnectionNestedInput;
	};
export type IntegrationConnectionCreateManyDefinitionInput = {
	id?: string;
	name: string;
	description?: string | null;
	isGlobal?: boolean;
	status?: string;
	lastHealthCheck?: Date | string | null;
	lastError?: string | null;
	authMethod: string;
	credentials: string;
	config?: string | null;
	createdAt?: Date | string;
	updatedAt?: Date | string;
};
export type IntegrationConnectionUpdateWithoutDefinitionInput = {
	id?: Prisma.StringFieldUpdateOperationsInput | string;
	name?: Prisma.StringFieldUpdateOperationsInput | string;
	description?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	isGlobal?: Prisma.BoolFieldUpdateOperationsInput | boolean;
	status?: Prisma.StringFieldUpdateOperationsInput | string;
	lastHealthCheck?:
		| Prisma.NullableDateTimeFieldUpdateOperationsInput
		| Date
		| string
		| null;
	lastError?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	authMethod?: Prisma.StringFieldUpdateOperationsInput | string;
	credentials?: Prisma.StringFieldUpdateOperationsInput | string;
	config?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	createdAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
	updatedAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
	serviceMappings?: Prisma.ServiceIntegrationUpdateManyWithoutConnectionNestedInput;
	serviceSuggestions?: Prisma.ServiceSuggestionUpdateManyWithoutConnectionNestedInput;
};
export type IntegrationConnectionUncheckedUpdateWithoutDefinitionInput = {
	id?: Prisma.StringFieldUpdateOperationsInput | string;
	name?: Prisma.StringFieldUpdateOperationsInput | string;
	description?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	isGlobal?: Prisma.BoolFieldUpdateOperationsInput | boolean;
	status?: Prisma.StringFieldUpdateOperationsInput | string;
	lastHealthCheck?:
		| Prisma.NullableDateTimeFieldUpdateOperationsInput
		| Date
		| string
		| null;
	lastError?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	authMethod?: Prisma.StringFieldUpdateOperationsInput | string;
	credentials?: Prisma.StringFieldUpdateOperationsInput | string;
	config?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	createdAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
	updatedAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
	serviceMappings?: Prisma.ServiceIntegrationUncheckedUpdateManyWithoutConnectionNestedInput;
	serviceSuggestions?: Prisma.ServiceSuggestionUncheckedUpdateManyWithoutConnectionNestedInput;
};
export type IntegrationConnectionUncheckedUpdateManyWithoutDefinitionInput = {
	id?: Prisma.StringFieldUpdateOperationsInput | string;
	name?: Prisma.StringFieldUpdateOperationsInput | string;
	description?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	isGlobal?: Prisma.BoolFieldUpdateOperationsInput | boolean;
	status?: Prisma.StringFieldUpdateOperationsInput | string;
	lastHealthCheck?:
		| Prisma.NullableDateTimeFieldUpdateOperationsInput
		| Date
		| string
		| null;
	lastError?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	authMethod?: Prisma.StringFieldUpdateOperationsInput | string;
	credentials?: Prisma.StringFieldUpdateOperationsInput | string;
	config?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	createdAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
	updatedAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
};
export type IntegrationConnectionCountOutputType = {
	serviceMappings: number;
	serviceSuggestions: number;
};
export type IntegrationConnectionCountOutputTypeSelect<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	serviceMappings?:
		| boolean
		| IntegrationConnectionCountOutputTypeCountServiceMappingsArgs;
	serviceSuggestions?:
		| boolean
		| IntegrationConnectionCountOutputTypeCountServiceSuggestionsArgs;
};
export type IntegrationConnectionCountOutputTypeDefaultArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	select?: Prisma.IntegrationConnectionCountOutputTypeSelect<ExtArgs> | null;
};
export type IntegrationConnectionCountOutputTypeCountServiceMappingsArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	where?: Prisma.ServiceIntegrationWhereInput;
};
export type IntegrationConnectionCountOutputTypeCountServiceSuggestionsArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	where?: Prisma.ServiceSuggestionWhereInput;
};
export type IntegrationConnectionSelect<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = runtime.Types.Extensions.GetSelect<
	{
		id?: boolean;
		definitionId?: boolean;
		name?: boolean;
		description?: boolean;
		isGlobal?: boolean;
		status?: boolean;
		lastHealthCheck?: boolean;
		lastError?: boolean;
		authMethod?: boolean;
		credentials?: boolean;
		config?: boolean;
		createdAt?: boolean;
		updatedAt?: boolean;
		definition?: boolean | Prisma.IntegrationDefinitionDefaultArgs<ExtArgs>;
		serviceMappings?:
			| boolean
			| Prisma.IntegrationConnection$serviceMappingsArgs<ExtArgs>;
		serviceSuggestions?:
			| boolean
			| Prisma.IntegrationConnection$serviceSuggestionsArgs<ExtArgs>;
		_count?:
			| boolean
			| Prisma.IntegrationConnectionCountOutputTypeDefaultArgs<ExtArgs>;
	},
	ExtArgs["result"]["integrationConnection"]
>;
export type IntegrationConnectionSelectCreateManyAndReturn<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = runtime.Types.Extensions.GetSelect<
	{
		id?: boolean;
		definitionId?: boolean;
		name?: boolean;
		description?: boolean;
		isGlobal?: boolean;
		status?: boolean;
		lastHealthCheck?: boolean;
		lastError?: boolean;
		authMethod?: boolean;
		credentials?: boolean;
		config?: boolean;
		createdAt?: boolean;
		updatedAt?: boolean;
		definition?: boolean | Prisma.IntegrationDefinitionDefaultArgs<ExtArgs>;
	},
	ExtArgs["result"]["integrationConnection"]
>;
export type IntegrationConnectionSelectUpdateManyAndReturn<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = runtime.Types.Extensions.GetSelect<
	{
		id?: boolean;
		definitionId?: boolean;
		name?: boolean;
		description?: boolean;
		isGlobal?: boolean;
		status?: boolean;
		lastHealthCheck?: boolean;
		lastError?: boolean;
		authMethod?: boolean;
		credentials?: boolean;
		config?: boolean;
		createdAt?: boolean;
		updatedAt?: boolean;
		definition?: boolean | Prisma.IntegrationDefinitionDefaultArgs<ExtArgs>;
	},
	ExtArgs["result"]["integrationConnection"]
>;
export type IntegrationConnectionSelectScalar = {
	id?: boolean;
	definitionId?: boolean;
	name?: boolean;
	description?: boolean;
	isGlobal?: boolean;
	status?: boolean;
	lastHealthCheck?: boolean;
	lastError?: boolean;
	authMethod?: boolean;
	credentials?: boolean;
	config?: boolean;
	createdAt?: boolean;
	updatedAt?: boolean;
};
export type IntegrationConnectionOmit<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = runtime.Types.Extensions.GetOmit<
	| "id"
	| "definitionId"
	| "name"
	| "description"
	| "isGlobal"
	| "status"
	| "lastHealthCheck"
	| "lastError"
	| "authMethod"
	| "credentials"
	| "config"
	| "createdAt"
	| "updatedAt",
	ExtArgs["result"]["integrationConnection"]
>;
export type IntegrationConnectionInclude<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	definition?: boolean | Prisma.IntegrationDefinitionDefaultArgs<ExtArgs>;
	serviceMappings?:
		| boolean
		| Prisma.IntegrationConnection$serviceMappingsArgs<ExtArgs>;
	serviceSuggestions?:
		| boolean
		| Prisma.IntegrationConnection$serviceSuggestionsArgs<ExtArgs>;
	_count?:
		| boolean
		| Prisma.IntegrationConnectionCountOutputTypeDefaultArgs<ExtArgs>;
};
export type IntegrationConnectionIncludeCreateManyAndReturn<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	definition?: boolean | Prisma.IntegrationDefinitionDefaultArgs<ExtArgs>;
};
export type IntegrationConnectionIncludeUpdateManyAndReturn<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	definition?: boolean | Prisma.IntegrationDefinitionDefaultArgs<ExtArgs>;
};
export type $IntegrationConnectionPayload<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	name: "IntegrationConnection";
	objects: {
		definition: Prisma.$IntegrationDefinitionPayload<ExtArgs>;
		serviceMappings: Prisma.$ServiceIntegrationPayload<ExtArgs>[];
		serviceSuggestions: Prisma.$ServiceSuggestionPayload<ExtArgs>[];
	};
	scalars: runtime.Types.Extensions.GetPayloadResult<
		{
			id: string;
			definitionId: string;
			name: string;
			description: string | null;
			isGlobal: boolean;
			status: string;
			lastHealthCheck: Date | null;
			lastError: string | null;
			authMethod: string;
			credentials: string;
			config: string | null;
			createdAt: Date;
			updatedAt: Date;
		},
		ExtArgs["result"]["integrationConnection"]
	>;
	composites: {};
};
export type IntegrationConnectionGetPayload<
	S extends boolean | null | undefined | IntegrationConnectionDefaultArgs,
> = runtime.Types.Result.GetResult<Prisma.$IntegrationConnectionPayload, S>;
export type IntegrationConnectionCountArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = Omit<
	IntegrationConnectionFindManyArgs,
	"select" | "include" | "distinct" | "omit"
> & {
	select?: IntegrationConnectionCountAggregateInputType | true;
};
export interface IntegrationConnectionDelegate<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
	GlobalOmitOptions = {},
> {
	[K: symbol]: {
		types: Prisma.TypeMap<ExtArgs>["model"]["IntegrationConnection"];
		meta: {
			name: "IntegrationConnection";
		};
	};
	findUnique<T extends IntegrationConnectionFindUniqueArgs>(
		args: Prisma.SelectSubset<T, IntegrationConnectionFindUniqueArgs<ExtArgs>>,
	): Prisma.Prisma__IntegrationConnectionClient<
		runtime.Types.Result.GetResult<
			Prisma.$IntegrationConnectionPayload<ExtArgs>,
			T,
			"findUnique",
			GlobalOmitOptions
		> | null,
		null,
		ExtArgs,
		GlobalOmitOptions
	>;
	findUniqueOrThrow<T extends IntegrationConnectionFindUniqueOrThrowArgs>(
		args: Prisma.SelectSubset<
			T,
			IntegrationConnectionFindUniqueOrThrowArgs<ExtArgs>
		>,
	): Prisma.Prisma__IntegrationConnectionClient<
		runtime.Types.Result.GetResult<
			Prisma.$IntegrationConnectionPayload<ExtArgs>,
			T,
			"findUniqueOrThrow",
			GlobalOmitOptions
		>,
		never,
		ExtArgs,
		GlobalOmitOptions
	>;
	findFirst<T extends IntegrationConnectionFindFirstArgs>(
		args?: Prisma.SelectSubset<T, IntegrationConnectionFindFirstArgs<ExtArgs>>,
	): Prisma.Prisma__IntegrationConnectionClient<
		runtime.Types.Result.GetResult<
			Prisma.$IntegrationConnectionPayload<ExtArgs>,
			T,
			"findFirst",
			GlobalOmitOptions
		> | null,
		null,
		ExtArgs,
		GlobalOmitOptions
	>;
	findFirstOrThrow<T extends IntegrationConnectionFindFirstOrThrowArgs>(
		args?: Prisma.SelectSubset<
			T,
			IntegrationConnectionFindFirstOrThrowArgs<ExtArgs>
		>,
	): Prisma.Prisma__IntegrationConnectionClient<
		runtime.Types.Result.GetResult<
			Prisma.$IntegrationConnectionPayload<ExtArgs>,
			T,
			"findFirstOrThrow",
			GlobalOmitOptions
		>,
		never,
		ExtArgs,
		GlobalOmitOptions
	>;
	findMany<T extends IntegrationConnectionFindManyArgs>(
		args?: Prisma.SelectSubset<T, IntegrationConnectionFindManyArgs<ExtArgs>>,
	): Prisma.PrismaPromise<
		runtime.Types.Result.GetResult<
			Prisma.$IntegrationConnectionPayload<ExtArgs>,
			T,
			"findMany",
			GlobalOmitOptions
		>
	>;
	create<T extends IntegrationConnectionCreateArgs>(
		args: Prisma.SelectSubset<T, IntegrationConnectionCreateArgs<ExtArgs>>,
	): Prisma.Prisma__IntegrationConnectionClient<
		runtime.Types.Result.GetResult<
			Prisma.$IntegrationConnectionPayload<ExtArgs>,
			T,
			"create",
			GlobalOmitOptions
		>,
		never,
		ExtArgs,
		GlobalOmitOptions
	>;
	createMany<T extends IntegrationConnectionCreateManyArgs>(
		args?: Prisma.SelectSubset<T, IntegrationConnectionCreateManyArgs<ExtArgs>>,
	): Prisma.PrismaPromise<Prisma.BatchPayload>;
	createManyAndReturn<T extends IntegrationConnectionCreateManyAndReturnArgs>(
		args?: Prisma.SelectSubset<
			T,
			IntegrationConnectionCreateManyAndReturnArgs<ExtArgs>
		>,
	): Prisma.PrismaPromise<
		runtime.Types.Result.GetResult<
			Prisma.$IntegrationConnectionPayload<ExtArgs>,
			T,
			"createManyAndReturn",
			GlobalOmitOptions
		>
	>;
	delete<T extends IntegrationConnectionDeleteArgs>(
		args: Prisma.SelectSubset<T, IntegrationConnectionDeleteArgs<ExtArgs>>,
	): Prisma.Prisma__IntegrationConnectionClient<
		runtime.Types.Result.GetResult<
			Prisma.$IntegrationConnectionPayload<ExtArgs>,
			T,
			"delete",
			GlobalOmitOptions
		>,
		never,
		ExtArgs,
		GlobalOmitOptions
	>;
	update<T extends IntegrationConnectionUpdateArgs>(
		args: Prisma.SelectSubset<T, IntegrationConnectionUpdateArgs<ExtArgs>>,
	): Prisma.Prisma__IntegrationConnectionClient<
		runtime.Types.Result.GetResult<
			Prisma.$IntegrationConnectionPayload<ExtArgs>,
			T,
			"update",
			GlobalOmitOptions
		>,
		never,
		ExtArgs,
		GlobalOmitOptions
	>;
	deleteMany<T extends IntegrationConnectionDeleteManyArgs>(
		args?: Prisma.SelectSubset<T, IntegrationConnectionDeleteManyArgs<ExtArgs>>,
	): Prisma.PrismaPromise<Prisma.BatchPayload>;
	updateMany<T extends IntegrationConnectionUpdateManyArgs>(
		args: Prisma.SelectSubset<T, IntegrationConnectionUpdateManyArgs<ExtArgs>>,
	): Prisma.PrismaPromise<Prisma.BatchPayload>;
	updateManyAndReturn<T extends IntegrationConnectionUpdateManyAndReturnArgs>(
		args: Prisma.SelectSubset<
			T,
			IntegrationConnectionUpdateManyAndReturnArgs<ExtArgs>
		>,
	): Prisma.PrismaPromise<
		runtime.Types.Result.GetResult<
			Prisma.$IntegrationConnectionPayload<ExtArgs>,
			T,
			"updateManyAndReturn",
			GlobalOmitOptions
		>
	>;
	upsert<T extends IntegrationConnectionUpsertArgs>(
		args: Prisma.SelectSubset<T, IntegrationConnectionUpsertArgs<ExtArgs>>,
	): Prisma.Prisma__IntegrationConnectionClient<
		runtime.Types.Result.GetResult<
			Prisma.$IntegrationConnectionPayload<ExtArgs>,
			T,
			"upsert",
			GlobalOmitOptions
		>,
		never,
		ExtArgs,
		GlobalOmitOptions
	>;
	count<T extends IntegrationConnectionCountArgs>(
		args?: Prisma.Subset<T, IntegrationConnectionCountArgs>,
	): Prisma.PrismaPromise<
		T extends runtime.Types.Utils.Record<"select", any>
			? T["select"] extends true
				? number
				: Prisma.GetScalarType<
						T["select"],
						IntegrationConnectionCountAggregateOutputType
					>
			: number
	>;
	aggregate<T extends IntegrationConnectionAggregateArgs>(
		args: Prisma.Subset<T, IntegrationConnectionAggregateArgs>,
	): Prisma.PrismaPromise<GetIntegrationConnectionAggregateType<T>>;
	groupBy<
		T extends IntegrationConnectionGroupByArgs,
		HasSelectOrTake extends Prisma.Or<
			Prisma.Extends<"skip", Prisma.Keys<T>>,
			Prisma.Extends<"take", Prisma.Keys<T>>
		>,
		OrderByArg extends Prisma.True extends HasSelectOrTake
			? {
					orderBy: IntegrationConnectionGroupByArgs["orderBy"];
				}
			: {
					orderBy?: IntegrationConnectionGroupByArgs["orderBy"];
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
			IntegrationConnectionGroupByArgs,
			OrderByArg
		> &
			InputErrors,
	): {} extends InputErrors
		? GetIntegrationConnectionGroupByPayload<T>
		: Prisma.PrismaPromise<InputErrors>;
	readonly fields: IntegrationConnectionFieldRefs;
}
export interface Prisma__IntegrationConnectionClient<
	T,
	Null = never,
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
	GlobalOmitOptions = {},
> extends Prisma.PrismaPromise<T> {
	readonly [Symbol.toStringTag]: "PrismaPromise";
	definition<T extends Prisma.IntegrationDefinitionDefaultArgs<ExtArgs> = {}>(
		args?: Prisma.Subset<T, Prisma.IntegrationDefinitionDefaultArgs<ExtArgs>>,
	): Prisma.Prisma__IntegrationDefinitionClient<
		| runtime.Types.Result.GetResult<
				Prisma.$IntegrationDefinitionPayload<ExtArgs>,
				T,
				"findUniqueOrThrow",
				GlobalOmitOptions
		  >
		| Null,
		Null,
		ExtArgs,
		GlobalOmitOptions
	>;
	serviceMappings<
		T extends Prisma.IntegrationConnection$serviceMappingsArgs<ExtArgs> = {},
	>(
		args?: Prisma.Subset<
			T,
			Prisma.IntegrationConnection$serviceMappingsArgs<ExtArgs>
		>,
	): Prisma.PrismaPromise<
		| runtime.Types.Result.GetResult<
				Prisma.$ServiceIntegrationPayload<ExtArgs>,
				T,
				"findMany",
				GlobalOmitOptions
		  >
		| Null
	>;
	serviceSuggestions<
		T extends Prisma.IntegrationConnection$serviceSuggestionsArgs<ExtArgs> = {},
	>(
		args?: Prisma.Subset<
			T,
			Prisma.IntegrationConnection$serviceSuggestionsArgs<ExtArgs>
		>,
	): Prisma.PrismaPromise<
		| runtime.Types.Result.GetResult<
				Prisma.$ServiceSuggestionPayload<ExtArgs>,
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
export interface IntegrationConnectionFieldRefs {
	readonly id: Prisma.FieldRef<"IntegrationConnection", "String">;
	readonly definitionId: Prisma.FieldRef<"IntegrationConnection", "String">;
	readonly name: Prisma.FieldRef<"IntegrationConnection", "String">;
	readonly description: Prisma.FieldRef<"IntegrationConnection", "String">;
	readonly isGlobal: Prisma.FieldRef<"IntegrationConnection", "Boolean">;
	readonly status: Prisma.FieldRef<"IntegrationConnection", "String">;
	readonly lastHealthCheck: Prisma.FieldRef<
		"IntegrationConnection",
		"DateTime"
	>;
	readonly lastError: Prisma.FieldRef<"IntegrationConnection", "String">;
	readonly authMethod: Prisma.FieldRef<"IntegrationConnection", "String">;
	readonly credentials: Prisma.FieldRef<"IntegrationConnection", "String">;
	readonly config: Prisma.FieldRef<"IntegrationConnection", "String">;
	readonly createdAt: Prisma.FieldRef<"IntegrationConnection", "DateTime">;
	readonly updatedAt: Prisma.FieldRef<"IntegrationConnection", "DateTime">;
}
export type IntegrationConnectionFindUniqueArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	select?: Prisma.IntegrationConnectionSelect<ExtArgs> | null;
	omit?: Prisma.IntegrationConnectionOmit<ExtArgs> | null;
	include?: Prisma.IntegrationConnectionInclude<ExtArgs> | null;
	where: Prisma.IntegrationConnectionWhereUniqueInput;
};
export type IntegrationConnectionFindUniqueOrThrowArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	select?: Prisma.IntegrationConnectionSelect<ExtArgs> | null;
	omit?: Prisma.IntegrationConnectionOmit<ExtArgs> | null;
	include?: Prisma.IntegrationConnectionInclude<ExtArgs> | null;
	where: Prisma.IntegrationConnectionWhereUniqueInput;
};
export type IntegrationConnectionFindFirstArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	select?: Prisma.IntegrationConnectionSelect<ExtArgs> | null;
	omit?: Prisma.IntegrationConnectionOmit<ExtArgs> | null;
	include?: Prisma.IntegrationConnectionInclude<ExtArgs> | null;
	where?: Prisma.IntegrationConnectionWhereInput;
	orderBy?:
		| Prisma.IntegrationConnectionOrderByWithRelationInput
		| Prisma.IntegrationConnectionOrderByWithRelationInput[];
	cursor?: Prisma.IntegrationConnectionWhereUniqueInput;
	take?: number;
	skip?: number;
	distinct?:
		| Prisma.IntegrationConnectionScalarFieldEnum
		| Prisma.IntegrationConnectionScalarFieldEnum[];
};
export type IntegrationConnectionFindFirstOrThrowArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	select?: Prisma.IntegrationConnectionSelect<ExtArgs> | null;
	omit?: Prisma.IntegrationConnectionOmit<ExtArgs> | null;
	include?: Prisma.IntegrationConnectionInclude<ExtArgs> | null;
	where?: Prisma.IntegrationConnectionWhereInput;
	orderBy?:
		| Prisma.IntegrationConnectionOrderByWithRelationInput
		| Prisma.IntegrationConnectionOrderByWithRelationInput[];
	cursor?: Prisma.IntegrationConnectionWhereUniqueInput;
	take?: number;
	skip?: number;
	distinct?:
		| Prisma.IntegrationConnectionScalarFieldEnum
		| Prisma.IntegrationConnectionScalarFieldEnum[];
};
export type IntegrationConnectionFindManyArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	select?: Prisma.IntegrationConnectionSelect<ExtArgs> | null;
	omit?: Prisma.IntegrationConnectionOmit<ExtArgs> | null;
	include?: Prisma.IntegrationConnectionInclude<ExtArgs> | null;
	where?: Prisma.IntegrationConnectionWhereInput;
	orderBy?:
		| Prisma.IntegrationConnectionOrderByWithRelationInput
		| Prisma.IntegrationConnectionOrderByWithRelationInput[];
	cursor?: Prisma.IntegrationConnectionWhereUniqueInput;
	take?: number;
	skip?: number;
	distinct?:
		| Prisma.IntegrationConnectionScalarFieldEnum
		| Prisma.IntegrationConnectionScalarFieldEnum[];
};
export type IntegrationConnectionCreateArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	select?: Prisma.IntegrationConnectionSelect<ExtArgs> | null;
	omit?: Prisma.IntegrationConnectionOmit<ExtArgs> | null;
	include?: Prisma.IntegrationConnectionInclude<ExtArgs> | null;
	data: Prisma.XOR<
		Prisma.IntegrationConnectionCreateInput,
		Prisma.IntegrationConnectionUncheckedCreateInput
	>;
};
export type IntegrationConnectionCreateManyArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	data:
		| Prisma.IntegrationConnectionCreateManyInput
		| Prisma.IntegrationConnectionCreateManyInput[];
};
export type IntegrationConnectionCreateManyAndReturnArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	select?: Prisma.IntegrationConnectionSelectCreateManyAndReturn<ExtArgs> | null;
	omit?: Prisma.IntegrationConnectionOmit<ExtArgs> | null;
	data:
		| Prisma.IntegrationConnectionCreateManyInput
		| Prisma.IntegrationConnectionCreateManyInput[];
	include?: Prisma.IntegrationConnectionIncludeCreateManyAndReturn<ExtArgs> | null;
};
export type IntegrationConnectionUpdateArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	select?: Prisma.IntegrationConnectionSelect<ExtArgs> | null;
	omit?: Prisma.IntegrationConnectionOmit<ExtArgs> | null;
	include?: Prisma.IntegrationConnectionInclude<ExtArgs> | null;
	data: Prisma.XOR<
		Prisma.IntegrationConnectionUpdateInput,
		Prisma.IntegrationConnectionUncheckedUpdateInput
	>;
	where: Prisma.IntegrationConnectionWhereUniqueInput;
};
export type IntegrationConnectionUpdateManyArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	data: Prisma.XOR<
		Prisma.IntegrationConnectionUpdateManyMutationInput,
		Prisma.IntegrationConnectionUncheckedUpdateManyInput
	>;
	where?: Prisma.IntegrationConnectionWhereInput;
	limit?: number;
};
export type IntegrationConnectionUpdateManyAndReturnArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	select?: Prisma.IntegrationConnectionSelectUpdateManyAndReturn<ExtArgs> | null;
	omit?: Prisma.IntegrationConnectionOmit<ExtArgs> | null;
	data: Prisma.XOR<
		Prisma.IntegrationConnectionUpdateManyMutationInput,
		Prisma.IntegrationConnectionUncheckedUpdateManyInput
	>;
	where?: Prisma.IntegrationConnectionWhereInput;
	limit?: number;
	include?: Prisma.IntegrationConnectionIncludeUpdateManyAndReturn<ExtArgs> | null;
};
export type IntegrationConnectionUpsertArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	select?: Prisma.IntegrationConnectionSelect<ExtArgs> | null;
	omit?: Prisma.IntegrationConnectionOmit<ExtArgs> | null;
	include?: Prisma.IntegrationConnectionInclude<ExtArgs> | null;
	where: Prisma.IntegrationConnectionWhereUniqueInput;
	create: Prisma.XOR<
		Prisma.IntegrationConnectionCreateInput,
		Prisma.IntegrationConnectionUncheckedCreateInput
	>;
	update: Prisma.XOR<
		Prisma.IntegrationConnectionUpdateInput,
		Prisma.IntegrationConnectionUncheckedUpdateInput
	>;
};
export type IntegrationConnectionDeleteArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	select?: Prisma.IntegrationConnectionSelect<ExtArgs> | null;
	omit?: Prisma.IntegrationConnectionOmit<ExtArgs> | null;
	include?: Prisma.IntegrationConnectionInclude<ExtArgs> | null;
	where: Prisma.IntegrationConnectionWhereUniqueInput;
};
export type IntegrationConnectionDeleteManyArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	where?: Prisma.IntegrationConnectionWhereInput;
	limit?: number;
};
export type IntegrationConnection$serviceMappingsArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	select?: Prisma.ServiceIntegrationSelect<ExtArgs> | null;
	omit?: Prisma.ServiceIntegrationOmit<ExtArgs> | null;
	include?: Prisma.ServiceIntegrationInclude<ExtArgs> | null;
	where?: Prisma.ServiceIntegrationWhereInput;
	orderBy?:
		| Prisma.ServiceIntegrationOrderByWithRelationInput
		| Prisma.ServiceIntegrationOrderByWithRelationInput[];
	cursor?: Prisma.ServiceIntegrationWhereUniqueInput;
	take?: number;
	skip?: number;
	distinct?:
		| Prisma.ServiceIntegrationScalarFieldEnum
		| Prisma.ServiceIntegrationScalarFieldEnum[];
};
export type IntegrationConnection$serviceSuggestionsArgs<
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
export type IntegrationConnectionDefaultArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	select?: Prisma.IntegrationConnectionSelect<ExtArgs> | null;
	omit?: Prisma.IntegrationConnectionOmit<ExtArgs> | null;
	include?: Prisma.IntegrationConnectionInclude<ExtArgs> | null;
};
