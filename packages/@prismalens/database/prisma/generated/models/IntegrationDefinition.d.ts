import type * as runtime from "@prisma/client/runtime/client";
import type * as Prisma from "../internal/prismaNamespace.js";
export type IntegrationDefinitionModel =
	runtime.Types.Result.DefaultSelection<Prisma.$IntegrationDefinitionPayload>;
export type AggregateIntegrationDefinition = {
	_count: IntegrationDefinitionCountAggregateOutputType | null;
	_avg: IntegrationDefinitionAvgAggregateOutputType | null;
	_sum: IntegrationDefinitionSumAggregateOutputType | null;
	_min: IntegrationDefinitionMinAggregateOutputType | null;
	_max: IntegrationDefinitionMaxAggregateOutputType | null;
};
export type IntegrationDefinitionAvgAggregateOutputType = {
	maxConnectionsCE: number | null;
};
export type IntegrationDefinitionSumAggregateOutputType = {
	maxConnectionsCE: number | null;
};
export type IntegrationDefinitionMinAggregateOutputType = {
	id: string | null;
	name: string | null;
	displayName: string | null;
	description: string | null;
	category: string | null;
	authType: string | null;
	configSchema: string | null;
	oauthConfig: string | null;
	iconUrl: string | null;
	docsUrl: string | null;
	maxConnectionsCE: number | null;
	isEnabled: boolean | null;
	createdAt: Date | null;
	updatedAt: Date | null;
};
export type IntegrationDefinitionMaxAggregateOutputType = {
	id: string | null;
	name: string | null;
	displayName: string | null;
	description: string | null;
	category: string | null;
	authType: string | null;
	configSchema: string | null;
	oauthConfig: string | null;
	iconUrl: string | null;
	docsUrl: string | null;
	maxConnectionsCE: number | null;
	isEnabled: boolean | null;
	createdAt: Date | null;
	updatedAt: Date | null;
};
export type IntegrationDefinitionCountAggregateOutputType = {
	id: number;
	name: number;
	displayName: number;
	description: number;
	category: number;
	authType: number;
	configSchema: number;
	oauthConfig: number;
	iconUrl: number;
	docsUrl: number;
	maxConnectionsCE: number;
	isEnabled: number;
	createdAt: number;
	updatedAt: number;
	_all: number;
};
export type IntegrationDefinitionAvgAggregateInputType = {
	maxConnectionsCE?: true;
};
export type IntegrationDefinitionSumAggregateInputType = {
	maxConnectionsCE?: true;
};
export type IntegrationDefinitionMinAggregateInputType = {
	id?: true;
	name?: true;
	displayName?: true;
	description?: true;
	category?: true;
	authType?: true;
	configSchema?: true;
	oauthConfig?: true;
	iconUrl?: true;
	docsUrl?: true;
	maxConnectionsCE?: true;
	isEnabled?: true;
	createdAt?: true;
	updatedAt?: true;
};
export type IntegrationDefinitionMaxAggregateInputType = {
	id?: true;
	name?: true;
	displayName?: true;
	description?: true;
	category?: true;
	authType?: true;
	configSchema?: true;
	oauthConfig?: true;
	iconUrl?: true;
	docsUrl?: true;
	maxConnectionsCE?: true;
	isEnabled?: true;
	createdAt?: true;
	updatedAt?: true;
};
export type IntegrationDefinitionCountAggregateInputType = {
	id?: true;
	name?: true;
	displayName?: true;
	description?: true;
	category?: true;
	authType?: true;
	configSchema?: true;
	oauthConfig?: true;
	iconUrl?: true;
	docsUrl?: true;
	maxConnectionsCE?: true;
	isEnabled?: true;
	createdAt?: true;
	updatedAt?: true;
	_all?: true;
};
export type IntegrationDefinitionAggregateArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	where?: Prisma.IntegrationDefinitionWhereInput;
	orderBy?:
		| Prisma.IntegrationDefinitionOrderByWithRelationInput
		| Prisma.IntegrationDefinitionOrderByWithRelationInput[];
	cursor?: Prisma.IntegrationDefinitionWhereUniqueInput;
	take?: number;
	skip?: number;
	_count?: true | IntegrationDefinitionCountAggregateInputType;
	_avg?: IntegrationDefinitionAvgAggregateInputType;
	_sum?: IntegrationDefinitionSumAggregateInputType;
	_min?: IntegrationDefinitionMinAggregateInputType;
	_max?: IntegrationDefinitionMaxAggregateInputType;
};
export type GetIntegrationDefinitionAggregateType<
	T extends IntegrationDefinitionAggregateArgs,
> = {
	[P in keyof T & keyof AggregateIntegrationDefinition]: P extends
		| "_count"
		| "count"
		? T[P] extends true
			? number
			: Prisma.GetScalarType<T[P], AggregateIntegrationDefinition[P]>
		: Prisma.GetScalarType<T[P], AggregateIntegrationDefinition[P]>;
};
export type IntegrationDefinitionGroupByArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	where?: Prisma.IntegrationDefinitionWhereInput;
	orderBy?:
		| Prisma.IntegrationDefinitionOrderByWithAggregationInput
		| Prisma.IntegrationDefinitionOrderByWithAggregationInput[];
	by:
		| Prisma.IntegrationDefinitionScalarFieldEnum[]
		| Prisma.IntegrationDefinitionScalarFieldEnum;
	having?: Prisma.IntegrationDefinitionScalarWhereWithAggregatesInput;
	take?: number;
	skip?: number;
	_count?: IntegrationDefinitionCountAggregateInputType | true;
	_avg?: IntegrationDefinitionAvgAggregateInputType;
	_sum?: IntegrationDefinitionSumAggregateInputType;
	_min?: IntegrationDefinitionMinAggregateInputType;
	_max?: IntegrationDefinitionMaxAggregateInputType;
};
export type IntegrationDefinitionGroupByOutputType = {
	id: string;
	name: string;
	displayName: string;
	description: string | null;
	category: string;
	authType: string;
	configSchema: string | null;
	oauthConfig: string | null;
	iconUrl: string | null;
	docsUrl: string | null;
	maxConnectionsCE: number | null;
	isEnabled: boolean;
	createdAt: Date;
	updatedAt: Date;
	_count: IntegrationDefinitionCountAggregateOutputType | null;
	_avg: IntegrationDefinitionAvgAggregateOutputType | null;
	_sum: IntegrationDefinitionSumAggregateOutputType | null;
	_min: IntegrationDefinitionMinAggregateOutputType | null;
	_max: IntegrationDefinitionMaxAggregateOutputType | null;
};
type GetIntegrationDefinitionGroupByPayload<
	T extends IntegrationDefinitionGroupByArgs,
> = Prisma.PrismaPromise<
	Array<
		Prisma.PickEnumerable<IntegrationDefinitionGroupByOutputType, T["by"]> & {
			[P in keyof T &
				keyof IntegrationDefinitionGroupByOutputType]: P extends "_count"
				? T[P] extends boolean
					? number
					: Prisma.GetScalarType<
							T[P],
							IntegrationDefinitionGroupByOutputType[P]
						>
				: Prisma.GetScalarType<T[P], IntegrationDefinitionGroupByOutputType[P]>;
		}
	>
>;
export type IntegrationDefinitionWhereInput = {
	AND?:
		| Prisma.IntegrationDefinitionWhereInput
		| Prisma.IntegrationDefinitionWhereInput[];
	OR?: Prisma.IntegrationDefinitionWhereInput[];
	NOT?:
		| Prisma.IntegrationDefinitionWhereInput
		| Prisma.IntegrationDefinitionWhereInput[];
	id?: Prisma.StringFilter<"IntegrationDefinition"> | string;
	name?: Prisma.StringFilter<"IntegrationDefinition"> | string;
	displayName?: Prisma.StringFilter<"IntegrationDefinition"> | string;
	description?:
		| Prisma.StringNullableFilter<"IntegrationDefinition">
		| string
		| null;
	category?: Prisma.StringFilter<"IntegrationDefinition"> | string;
	authType?: Prisma.StringFilter<"IntegrationDefinition"> | string;
	configSchema?:
		| Prisma.StringNullableFilter<"IntegrationDefinition">
		| string
		| null;
	oauthConfig?:
		| Prisma.StringNullableFilter<"IntegrationDefinition">
		| string
		| null;
	iconUrl?:
		| Prisma.StringNullableFilter<"IntegrationDefinition">
		| string
		| null;
	docsUrl?:
		| Prisma.StringNullableFilter<"IntegrationDefinition">
		| string
		| null;
	maxConnectionsCE?:
		| Prisma.IntNullableFilter<"IntegrationDefinition">
		| number
		| null;
	isEnabled?: Prisma.BoolFilter<"IntegrationDefinition"> | boolean;
	createdAt?: Prisma.DateTimeFilter<"IntegrationDefinition"> | Date | string;
	updatedAt?: Prisma.DateTimeFilter<"IntegrationDefinition"> | Date | string;
	connections?: Prisma.IntegrationConnectionListRelationFilter;
};
export type IntegrationDefinitionOrderByWithRelationInput = {
	id?: Prisma.SortOrder;
	name?: Prisma.SortOrder;
	displayName?: Prisma.SortOrder;
	description?: Prisma.SortOrderInput | Prisma.SortOrder;
	category?: Prisma.SortOrder;
	authType?: Prisma.SortOrder;
	configSchema?: Prisma.SortOrderInput | Prisma.SortOrder;
	oauthConfig?: Prisma.SortOrderInput | Prisma.SortOrder;
	iconUrl?: Prisma.SortOrderInput | Prisma.SortOrder;
	docsUrl?: Prisma.SortOrderInput | Prisma.SortOrder;
	maxConnectionsCE?: Prisma.SortOrderInput | Prisma.SortOrder;
	isEnabled?: Prisma.SortOrder;
	createdAt?: Prisma.SortOrder;
	updatedAt?: Prisma.SortOrder;
	connections?: Prisma.IntegrationConnectionOrderByRelationAggregateInput;
};
export type IntegrationDefinitionWhereUniqueInput = Prisma.AtLeast<
	{
		id?: string;
		name?: string;
		AND?:
			| Prisma.IntegrationDefinitionWhereInput
			| Prisma.IntegrationDefinitionWhereInput[];
		OR?: Prisma.IntegrationDefinitionWhereInput[];
		NOT?:
			| Prisma.IntegrationDefinitionWhereInput
			| Prisma.IntegrationDefinitionWhereInput[];
		displayName?: Prisma.StringFilter<"IntegrationDefinition"> | string;
		description?:
			| Prisma.StringNullableFilter<"IntegrationDefinition">
			| string
			| null;
		category?: Prisma.StringFilter<"IntegrationDefinition"> | string;
		authType?: Prisma.StringFilter<"IntegrationDefinition"> | string;
		configSchema?:
			| Prisma.StringNullableFilter<"IntegrationDefinition">
			| string
			| null;
		oauthConfig?:
			| Prisma.StringNullableFilter<"IntegrationDefinition">
			| string
			| null;
		iconUrl?:
			| Prisma.StringNullableFilter<"IntegrationDefinition">
			| string
			| null;
		docsUrl?:
			| Prisma.StringNullableFilter<"IntegrationDefinition">
			| string
			| null;
		maxConnectionsCE?:
			| Prisma.IntNullableFilter<"IntegrationDefinition">
			| number
			| null;
		isEnabled?: Prisma.BoolFilter<"IntegrationDefinition"> | boolean;
		createdAt?: Prisma.DateTimeFilter<"IntegrationDefinition"> | Date | string;
		updatedAt?: Prisma.DateTimeFilter<"IntegrationDefinition"> | Date | string;
		connections?: Prisma.IntegrationConnectionListRelationFilter;
	},
	"id" | "name"
>;
export type IntegrationDefinitionOrderByWithAggregationInput = {
	id?: Prisma.SortOrder;
	name?: Prisma.SortOrder;
	displayName?: Prisma.SortOrder;
	description?: Prisma.SortOrderInput | Prisma.SortOrder;
	category?: Prisma.SortOrder;
	authType?: Prisma.SortOrder;
	configSchema?: Prisma.SortOrderInput | Prisma.SortOrder;
	oauthConfig?: Prisma.SortOrderInput | Prisma.SortOrder;
	iconUrl?: Prisma.SortOrderInput | Prisma.SortOrder;
	docsUrl?: Prisma.SortOrderInput | Prisma.SortOrder;
	maxConnectionsCE?: Prisma.SortOrderInput | Prisma.SortOrder;
	isEnabled?: Prisma.SortOrder;
	createdAt?: Prisma.SortOrder;
	updatedAt?: Prisma.SortOrder;
	_count?: Prisma.IntegrationDefinitionCountOrderByAggregateInput;
	_avg?: Prisma.IntegrationDefinitionAvgOrderByAggregateInput;
	_max?: Prisma.IntegrationDefinitionMaxOrderByAggregateInput;
	_min?: Prisma.IntegrationDefinitionMinOrderByAggregateInput;
	_sum?: Prisma.IntegrationDefinitionSumOrderByAggregateInput;
};
export type IntegrationDefinitionScalarWhereWithAggregatesInput = {
	AND?:
		| Prisma.IntegrationDefinitionScalarWhereWithAggregatesInput
		| Prisma.IntegrationDefinitionScalarWhereWithAggregatesInput[];
	OR?: Prisma.IntegrationDefinitionScalarWhereWithAggregatesInput[];
	NOT?:
		| Prisma.IntegrationDefinitionScalarWhereWithAggregatesInput
		| Prisma.IntegrationDefinitionScalarWhereWithAggregatesInput[];
	id?: Prisma.StringWithAggregatesFilter<"IntegrationDefinition"> | string;
	name?: Prisma.StringWithAggregatesFilter<"IntegrationDefinition"> | string;
	displayName?:
		| Prisma.StringWithAggregatesFilter<"IntegrationDefinition">
		| string;
	description?:
		| Prisma.StringNullableWithAggregatesFilter<"IntegrationDefinition">
		| string
		| null;
	category?:
		| Prisma.StringWithAggregatesFilter<"IntegrationDefinition">
		| string;
	authType?:
		| Prisma.StringWithAggregatesFilter<"IntegrationDefinition">
		| string;
	configSchema?:
		| Prisma.StringNullableWithAggregatesFilter<"IntegrationDefinition">
		| string
		| null;
	oauthConfig?:
		| Prisma.StringNullableWithAggregatesFilter<"IntegrationDefinition">
		| string
		| null;
	iconUrl?:
		| Prisma.StringNullableWithAggregatesFilter<"IntegrationDefinition">
		| string
		| null;
	docsUrl?:
		| Prisma.StringNullableWithAggregatesFilter<"IntegrationDefinition">
		| string
		| null;
	maxConnectionsCE?:
		| Prisma.IntNullableWithAggregatesFilter<"IntegrationDefinition">
		| number
		| null;
	isEnabled?:
		| Prisma.BoolWithAggregatesFilter<"IntegrationDefinition">
		| boolean;
	createdAt?:
		| Prisma.DateTimeWithAggregatesFilter<"IntegrationDefinition">
		| Date
		| string;
	updatedAt?:
		| Prisma.DateTimeWithAggregatesFilter<"IntegrationDefinition">
		| Date
		| string;
};
export type IntegrationDefinitionCreateInput = {
	id?: string;
	name: string;
	displayName: string;
	description?: string | null;
	category: string;
	authType: string;
	configSchema?: string | null;
	oauthConfig?: string | null;
	iconUrl?: string | null;
	docsUrl?: string | null;
	maxConnectionsCE?: number | null;
	isEnabled?: boolean;
	createdAt?: Date | string;
	updatedAt?: Date | string;
	connections?: Prisma.IntegrationConnectionCreateNestedManyWithoutDefinitionInput;
};
export type IntegrationDefinitionUncheckedCreateInput = {
	id?: string;
	name: string;
	displayName: string;
	description?: string | null;
	category: string;
	authType: string;
	configSchema?: string | null;
	oauthConfig?: string | null;
	iconUrl?: string | null;
	docsUrl?: string | null;
	maxConnectionsCE?: number | null;
	isEnabled?: boolean;
	createdAt?: Date | string;
	updatedAt?: Date | string;
	connections?: Prisma.IntegrationConnectionUncheckedCreateNestedManyWithoutDefinitionInput;
};
export type IntegrationDefinitionUpdateInput = {
	id?: Prisma.StringFieldUpdateOperationsInput | string;
	name?: Prisma.StringFieldUpdateOperationsInput | string;
	displayName?: Prisma.StringFieldUpdateOperationsInput | string;
	description?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	category?: Prisma.StringFieldUpdateOperationsInput | string;
	authType?: Prisma.StringFieldUpdateOperationsInput | string;
	configSchema?:
		| Prisma.NullableStringFieldUpdateOperationsInput
		| string
		| null;
	oauthConfig?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	iconUrl?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	docsUrl?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	maxConnectionsCE?:
		| Prisma.NullableIntFieldUpdateOperationsInput
		| number
		| null;
	isEnabled?: Prisma.BoolFieldUpdateOperationsInput | boolean;
	createdAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
	updatedAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
	connections?: Prisma.IntegrationConnectionUpdateManyWithoutDefinitionNestedInput;
};
export type IntegrationDefinitionUncheckedUpdateInput = {
	id?: Prisma.StringFieldUpdateOperationsInput | string;
	name?: Prisma.StringFieldUpdateOperationsInput | string;
	displayName?: Prisma.StringFieldUpdateOperationsInput | string;
	description?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	category?: Prisma.StringFieldUpdateOperationsInput | string;
	authType?: Prisma.StringFieldUpdateOperationsInput | string;
	configSchema?:
		| Prisma.NullableStringFieldUpdateOperationsInput
		| string
		| null;
	oauthConfig?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	iconUrl?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	docsUrl?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	maxConnectionsCE?:
		| Prisma.NullableIntFieldUpdateOperationsInput
		| number
		| null;
	isEnabled?: Prisma.BoolFieldUpdateOperationsInput | boolean;
	createdAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
	updatedAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
	connections?: Prisma.IntegrationConnectionUncheckedUpdateManyWithoutDefinitionNestedInput;
};
export type IntegrationDefinitionCreateManyInput = {
	id?: string;
	name: string;
	displayName: string;
	description?: string | null;
	category: string;
	authType: string;
	configSchema?: string | null;
	oauthConfig?: string | null;
	iconUrl?: string | null;
	docsUrl?: string | null;
	maxConnectionsCE?: number | null;
	isEnabled?: boolean;
	createdAt?: Date | string;
	updatedAt?: Date | string;
};
export type IntegrationDefinitionUpdateManyMutationInput = {
	id?: Prisma.StringFieldUpdateOperationsInput | string;
	name?: Prisma.StringFieldUpdateOperationsInput | string;
	displayName?: Prisma.StringFieldUpdateOperationsInput | string;
	description?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	category?: Prisma.StringFieldUpdateOperationsInput | string;
	authType?: Prisma.StringFieldUpdateOperationsInput | string;
	configSchema?:
		| Prisma.NullableStringFieldUpdateOperationsInput
		| string
		| null;
	oauthConfig?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	iconUrl?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	docsUrl?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	maxConnectionsCE?:
		| Prisma.NullableIntFieldUpdateOperationsInput
		| number
		| null;
	isEnabled?: Prisma.BoolFieldUpdateOperationsInput | boolean;
	createdAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
	updatedAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
};
export type IntegrationDefinitionUncheckedUpdateManyInput = {
	id?: Prisma.StringFieldUpdateOperationsInput | string;
	name?: Prisma.StringFieldUpdateOperationsInput | string;
	displayName?: Prisma.StringFieldUpdateOperationsInput | string;
	description?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	category?: Prisma.StringFieldUpdateOperationsInput | string;
	authType?: Prisma.StringFieldUpdateOperationsInput | string;
	configSchema?:
		| Prisma.NullableStringFieldUpdateOperationsInput
		| string
		| null;
	oauthConfig?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	iconUrl?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	docsUrl?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	maxConnectionsCE?:
		| Prisma.NullableIntFieldUpdateOperationsInput
		| number
		| null;
	isEnabled?: Prisma.BoolFieldUpdateOperationsInput | boolean;
	createdAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
	updatedAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
};
export type IntegrationDefinitionCountOrderByAggregateInput = {
	id?: Prisma.SortOrder;
	name?: Prisma.SortOrder;
	displayName?: Prisma.SortOrder;
	description?: Prisma.SortOrder;
	category?: Prisma.SortOrder;
	authType?: Prisma.SortOrder;
	configSchema?: Prisma.SortOrder;
	oauthConfig?: Prisma.SortOrder;
	iconUrl?: Prisma.SortOrder;
	docsUrl?: Prisma.SortOrder;
	maxConnectionsCE?: Prisma.SortOrder;
	isEnabled?: Prisma.SortOrder;
	createdAt?: Prisma.SortOrder;
	updatedAt?: Prisma.SortOrder;
};
export type IntegrationDefinitionAvgOrderByAggregateInput = {
	maxConnectionsCE?: Prisma.SortOrder;
};
export type IntegrationDefinitionMaxOrderByAggregateInput = {
	id?: Prisma.SortOrder;
	name?: Prisma.SortOrder;
	displayName?: Prisma.SortOrder;
	description?: Prisma.SortOrder;
	category?: Prisma.SortOrder;
	authType?: Prisma.SortOrder;
	configSchema?: Prisma.SortOrder;
	oauthConfig?: Prisma.SortOrder;
	iconUrl?: Prisma.SortOrder;
	docsUrl?: Prisma.SortOrder;
	maxConnectionsCE?: Prisma.SortOrder;
	isEnabled?: Prisma.SortOrder;
	createdAt?: Prisma.SortOrder;
	updatedAt?: Prisma.SortOrder;
};
export type IntegrationDefinitionMinOrderByAggregateInput = {
	id?: Prisma.SortOrder;
	name?: Prisma.SortOrder;
	displayName?: Prisma.SortOrder;
	description?: Prisma.SortOrder;
	category?: Prisma.SortOrder;
	authType?: Prisma.SortOrder;
	configSchema?: Prisma.SortOrder;
	oauthConfig?: Prisma.SortOrder;
	iconUrl?: Prisma.SortOrder;
	docsUrl?: Prisma.SortOrder;
	maxConnectionsCE?: Prisma.SortOrder;
	isEnabled?: Prisma.SortOrder;
	createdAt?: Prisma.SortOrder;
	updatedAt?: Prisma.SortOrder;
};
export type IntegrationDefinitionSumOrderByAggregateInput = {
	maxConnectionsCE?: Prisma.SortOrder;
};
export type IntegrationDefinitionScalarRelationFilter = {
	is?: Prisma.IntegrationDefinitionWhereInput;
	isNot?: Prisma.IntegrationDefinitionWhereInput;
};
export type IntegrationDefinitionCreateNestedOneWithoutConnectionsInput = {
	create?: Prisma.XOR<
		Prisma.IntegrationDefinitionCreateWithoutConnectionsInput,
		Prisma.IntegrationDefinitionUncheckedCreateWithoutConnectionsInput
	>;
	connectOrCreate?: Prisma.IntegrationDefinitionCreateOrConnectWithoutConnectionsInput;
	connect?: Prisma.IntegrationDefinitionWhereUniqueInput;
};
export type IntegrationDefinitionUpdateOneRequiredWithoutConnectionsNestedInput =
	{
		create?: Prisma.XOR<
			Prisma.IntegrationDefinitionCreateWithoutConnectionsInput,
			Prisma.IntegrationDefinitionUncheckedCreateWithoutConnectionsInput
		>;
		connectOrCreate?: Prisma.IntegrationDefinitionCreateOrConnectWithoutConnectionsInput;
		upsert?: Prisma.IntegrationDefinitionUpsertWithoutConnectionsInput;
		connect?: Prisma.IntegrationDefinitionWhereUniqueInput;
		update?: Prisma.XOR<
			Prisma.XOR<
				Prisma.IntegrationDefinitionUpdateToOneWithWhereWithoutConnectionsInput,
				Prisma.IntegrationDefinitionUpdateWithoutConnectionsInput
			>,
			Prisma.IntegrationDefinitionUncheckedUpdateWithoutConnectionsInput
		>;
	};
export type IntegrationDefinitionCreateWithoutConnectionsInput = {
	id?: string;
	name: string;
	displayName: string;
	description?: string | null;
	category: string;
	authType: string;
	configSchema?: string | null;
	oauthConfig?: string | null;
	iconUrl?: string | null;
	docsUrl?: string | null;
	maxConnectionsCE?: number | null;
	isEnabled?: boolean;
	createdAt?: Date | string;
	updatedAt?: Date | string;
};
export type IntegrationDefinitionUncheckedCreateWithoutConnectionsInput = {
	id?: string;
	name: string;
	displayName: string;
	description?: string | null;
	category: string;
	authType: string;
	configSchema?: string | null;
	oauthConfig?: string | null;
	iconUrl?: string | null;
	docsUrl?: string | null;
	maxConnectionsCE?: number | null;
	isEnabled?: boolean;
	createdAt?: Date | string;
	updatedAt?: Date | string;
};
export type IntegrationDefinitionCreateOrConnectWithoutConnectionsInput = {
	where: Prisma.IntegrationDefinitionWhereUniqueInput;
	create: Prisma.XOR<
		Prisma.IntegrationDefinitionCreateWithoutConnectionsInput,
		Prisma.IntegrationDefinitionUncheckedCreateWithoutConnectionsInput
	>;
};
export type IntegrationDefinitionUpsertWithoutConnectionsInput = {
	update: Prisma.XOR<
		Prisma.IntegrationDefinitionUpdateWithoutConnectionsInput,
		Prisma.IntegrationDefinitionUncheckedUpdateWithoutConnectionsInput
	>;
	create: Prisma.XOR<
		Prisma.IntegrationDefinitionCreateWithoutConnectionsInput,
		Prisma.IntegrationDefinitionUncheckedCreateWithoutConnectionsInput
	>;
	where?: Prisma.IntegrationDefinitionWhereInput;
};
export type IntegrationDefinitionUpdateToOneWithWhereWithoutConnectionsInput = {
	where?: Prisma.IntegrationDefinitionWhereInput;
	data: Prisma.XOR<
		Prisma.IntegrationDefinitionUpdateWithoutConnectionsInput,
		Prisma.IntegrationDefinitionUncheckedUpdateWithoutConnectionsInput
	>;
};
export type IntegrationDefinitionUpdateWithoutConnectionsInput = {
	id?: Prisma.StringFieldUpdateOperationsInput | string;
	name?: Prisma.StringFieldUpdateOperationsInput | string;
	displayName?: Prisma.StringFieldUpdateOperationsInput | string;
	description?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	category?: Prisma.StringFieldUpdateOperationsInput | string;
	authType?: Prisma.StringFieldUpdateOperationsInput | string;
	configSchema?:
		| Prisma.NullableStringFieldUpdateOperationsInput
		| string
		| null;
	oauthConfig?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	iconUrl?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	docsUrl?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	maxConnectionsCE?:
		| Prisma.NullableIntFieldUpdateOperationsInput
		| number
		| null;
	isEnabled?: Prisma.BoolFieldUpdateOperationsInput | boolean;
	createdAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
	updatedAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
};
export type IntegrationDefinitionUncheckedUpdateWithoutConnectionsInput = {
	id?: Prisma.StringFieldUpdateOperationsInput | string;
	name?: Prisma.StringFieldUpdateOperationsInput | string;
	displayName?: Prisma.StringFieldUpdateOperationsInput | string;
	description?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	category?: Prisma.StringFieldUpdateOperationsInput | string;
	authType?: Prisma.StringFieldUpdateOperationsInput | string;
	configSchema?:
		| Prisma.NullableStringFieldUpdateOperationsInput
		| string
		| null;
	oauthConfig?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	iconUrl?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	docsUrl?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	maxConnectionsCE?:
		| Prisma.NullableIntFieldUpdateOperationsInput
		| number
		| null;
	isEnabled?: Prisma.BoolFieldUpdateOperationsInput | boolean;
	createdAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
	updatedAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
};
export type IntegrationDefinitionCountOutputType = {
	connections: number;
};
export type IntegrationDefinitionCountOutputTypeSelect<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	connections?:
		| boolean
		| IntegrationDefinitionCountOutputTypeCountConnectionsArgs;
};
export type IntegrationDefinitionCountOutputTypeDefaultArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	select?: Prisma.IntegrationDefinitionCountOutputTypeSelect<ExtArgs> | null;
};
export type IntegrationDefinitionCountOutputTypeCountConnectionsArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	where?: Prisma.IntegrationConnectionWhereInput;
};
export type IntegrationDefinitionSelect<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = runtime.Types.Extensions.GetSelect<
	{
		id?: boolean;
		name?: boolean;
		displayName?: boolean;
		description?: boolean;
		category?: boolean;
		authType?: boolean;
		configSchema?: boolean;
		oauthConfig?: boolean;
		iconUrl?: boolean;
		docsUrl?: boolean;
		maxConnectionsCE?: boolean;
		isEnabled?: boolean;
		createdAt?: boolean;
		updatedAt?: boolean;
		connections?:
			| boolean
			| Prisma.IntegrationDefinition$connectionsArgs<ExtArgs>;
		_count?:
			| boolean
			| Prisma.IntegrationDefinitionCountOutputTypeDefaultArgs<ExtArgs>;
	},
	ExtArgs["result"]["integrationDefinition"]
>;
export type IntegrationDefinitionSelectCreateManyAndReturn<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = runtime.Types.Extensions.GetSelect<
	{
		id?: boolean;
		name?: boolean;
		displayName?: boolean;
		description?: boolean;
		category?: boolean;
		authType?: boolean;
		configSchema?: boolean;
		oauthConfig?: boolean;
		iconUrl?: boolean;
		docsUrl?: boolean;
		maxConnectionsCE?: boolean;
		isEnabled?: boolean;
		createdAt?: boolean;
		updatedAt?: boolean;
	},
	ExtArgs["result"]["integrationDefinition"]
>;
export type IntegrationDefinitionSelectUpdateManyAndReturn<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = runtime.Types.Extensions.GetSelect<
	{
		id?: boolean;
		name?: boolean;
		displayName?: boolean;
		description?: boolean;
		category?: boolean;
		authType?: boolean;
		configSchema?: boolean;
		oauthConfig?: boolean;
		iconUrl?: boolean;
		docsUrl?: boolean;
		maxConnectionsCE?: boolean;
		isEnabled?: boolean;
		createdAt?: boolean;
		updatedAt?: boolean;
	},
	ExtArgs["result"]["integrationDefinition"]
>;
export type IntegrationDefinitionSelectScalar = {
	id?: boolean;
	name?: boolean;
	displayName?: boolean;
	description?: boolean;
	category?: boolean;
	authType?: boolean;
	configSchema?: boolean;
	oauthConfig?: boolean;
	iconUrl?: boolean;
	docsUrl?: boolean;
	maxConnectionsCE?: boolean;
	isEnabled?: boolean;
	createdAt?: boolean;
	updatedAt?: boolean;
};
export type IntegrationDefinitionOmit<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = runtime.Types.Extensions.GetOmit<
	| "id"
	| "name"
	| "displayName"
	| "description"
	| "category"
	| "authType"
	| "configSchema"
	| "oauthConfig"
	| "iconUrl"
	| "docsUrl"
	| "maxConnectionsCE"
	| "isEnabled"
	| "createdAt"
	| "updatedAt",
	ExtArgs["result"]["integrationDefinition"]
>;
export type IntegrationDefinitionInclude<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	connections?: boolean | Prisma.IntegrationDefinition$connectionsArgs<ExtArgs>;
	_count?:
		| boolean
		| Prisma.IntegrationDefinitionCountOutputTypeDefaultArgs<ExtArgs>;
};
export type IntegrationDefinitionIncludeCreateManyAndReturn<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {};
export type IntegrationDefinitionIncludeUpdateManyAndReturn<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {};
export type $IntegrationDefinitionPayload<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	name: "IntegrationDefinition";
	objects: {
		connections: Prisma.$IntegrationConnectionPayload<ExtArgs>[];
	};
	scalars: runtime.Types.Extensions.GetPayloadResult<
		{
			id: string;
			name: string;
			displayName: string;
			description: string | null;
			category: string;
			authType: string;
			configSchema: string | null;
			oauthConfig: string | null;
			iconUrl: string | null;
			docsUrl: string | null;
			maxConnectionsCE: number | null;
			isEnabled: boolean;
			createdAt: Date;
			updatedAt: Date;
		},
		ExtArgs["result"]["integrationDefinition"]
	>;
	composites: {};
};
export type IntegrationDefinitionGetPayload<
	S extends boolean | null | undefined | IntegrationDefinitionDefaultArgs,
> = runtime.Types.Result.GetResult<Prisma.$IntegrationDefinitionPayload, S>;
export type IntegrationDefinitionCountArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = Omit<
	IntegrationDefinitionFindManyArgs,
	"select" | "include" | "distinct" | "omit"
> & {
	select?: IntegrationDefinitionCountAggregateInputType | true;
};
export interface IntegrationDefinitionDelegate<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
	GlobalOmitOptions = {},
> {
	[K: symbol]: {
		types: Prisma.TypeMap<ExtArgs>["model"]["IntegrationDefinition"];
		meta: {
			name: "IntegrationDefinition";
		};
	};
	findUnique<T extends IntegrationDefinitionFindUniqueArgs>(
		args: Prisma.SelectSubset<T, IntegrationDefinitionFindUniqueArgs<ExtArgs>>,
	): Prisma.Prisma__IntegrationDefinitionClient<
		runtime.Types.Result.GetResult<
			Prisma.$IntegrationDefinitionPayload<ExtArgs>,
			T,
			"findUnique",
			GlobalOmitOptions
		> | null,
		null,
		ExtArgs,
		GlobalOmitOptions
	>;
	findUniqueOrThrow<T extends IntegrationDefinitionFindUniqueOrThrowArgs>(
		args: Prisma.SelectSubset<
			T,
			IntegrationDefinitionFindUniqueOrThrowArgs<ExtArgs>
		>,
	): Prisma.Prisma__IntegrationDefinitionClient<
		runtime.Types.Result.GetResult<
			Prisma.$IntegrationDefinitionPayload<ExtArgs>,
			T,
			"findUniqueOrThrow",
			GlobalOmitOptions
		>,
		never,
		ExtArgs,
		GlobalOmitOptions
	>;
	findFirst<T extends IntegrationDefinitionFindFirstArgs>(
		args?: Prisma.SelectSubset<T, IntegrationDefinitionFindFirstArgs<ExtArgs>>,
	): Prisma.Prisma__IntegrationDefinitionClient<
		runtime.Types.Result.GetResult<
			Prisma.$IntegrationDefinitionPayload<ExtArgs>,
			T,
			"findFirst",
			GlobalOmitOptions
		> | null,
		null,
		ExtArgs,
		GlobalOmitOptions
	>;
	findFirstOrThrow<T extends IntegrationDefinitionFindFirstOrThrowArgs>(
		args?: Prisma.SelectSubset<
			T,
			IntegrationDefinitionFindFirstOrThrowArgs<ExtArgs>
		>,
	): Prisma.Prisma__IntegrationDefinitionClient<
		runtime.Types.Result.GetResult<
			Prisma.$IntegrationDefinitionPayload<ExtArgs>,
			T,
			"findFirstOrThrow",
			GlobalOmitOptions
		>,
		never,
		ExtArgs,
		GlobalOmitOptions
	>;
	findMany<T extends IntegrationDefinitionFindManyArgs>(
		args?: Prisma.SelectSubset<T, IntegrationDefinitionFindManyArgs<ExtArgs>>,
	): Prisma.PrismaPromise<
		runtime.Types.Result.GetResult<
			Prisma.$IntegrationDefinitionPayload<ExtArgs>,
			T,
			"findMany",
			GlobalOmitOptions
		>
	>;
	create<T extends IntegrationDefinitionCreateArgs>(
		args: Prisma.SelectSubset<T, IntegrationDefinitionCreateArgs<ExtArgs>>,
	): Prisma.Prisma__IntegrationDefinitionClient<
		runtime.Types.Result.GetResult<
			Prisma.$IntegrationDefinitionPayload<ExtArgs>,
			T,
			"create",
			GlobalOmitOptions
		>,
		never,
		ExtArgs,
		GlobalOmitOptions
	>;
	createMany<T extends IntegrationDefinitionCreateManyArgs>(
		args?: Prisma.SelectSubset<T, IntegrationDefinitionCreateManyArgs<ExtArgs>>,
	): Prisma.PrismaPromise<Prisma.BatchPayload>;
	createManyAndReturn<T extends IntegrationDefinitionCreateManyAndReturnArgs>(
		args?: Prisma.SelectSubset<
			T,
			IntegrationDefinitionCreateManyAndReturnArgs<ExtArgs>
		>,
	): Prisma.PrismaPromise<
		runtime.Types.Result.GetResult<
			Prisma.$IntegrationDefinitionPayload<ExtArgs>,
			T,
			"createManyAndReturn",
			GlobalOmitOptions
		>
	>;
	delete<T extends IntegrationDefinitionDeleteArgs>(
		args: Prisma.SelectSubset<T, IntegrationDefinitionDeleteArgs<ExtArgs>>,
	): Prisma.Prisma__IntegrationDefinitionClient<
		runtime.Types.Result.GetResult<
			Prisma.$IntegrationDefinitionPayload<ExtArgs>,
			T,
			"delete",
			GlobalOmitOptions
		>,
		never,
		ExtArgs,
		GlobalOmitOptions
	>;
	update<T extends IntegrationDefinitionUpdateArgs>(
		args: Prisma.SelectSubset<T, IntegrationDefinitionUpdateArgs<ExtArgs>>,
	): Prisma.Prisma__IntegrationDefinitionClient<
		runtime.Types.Result.GetResult<
			Prisma.$IntegrationDefinitionPayload<ExtArgs>,
			T,
			"update",
			GlobalOmitOptions
		>,
		never,
		ExtArgs,
		GlobalOmitOptions
	>;
	deleteMany<T extends IntegrationDefinitionDeleteManyArgs>(
		args?: Prisma.SelectSubset<T, IntegrationDefinitionDeleteManyArgs<ExtArgs>>,
	): Prisma.PrismaPromise<Prisma.BatchPayload>;
	updateMany<T extends IntegrationDefinitionUpdateManyArgs>(
		args: Prisma.SelectSubset<T, IntegrationDefinitionUpdateManyArgs<ExtArgs>>,
	): Prisma.PrismaPromise<Prisma.BatchPayload>;
	updateManyAndReturn<T extends IntegrationDefinitionUpdateManyAndReturnArgs>(
		args: Prisma.SelectSubset<
			T,
			IntegrationDefinitionUpdateManyAndReturnArgs<ExtArgs>
		>,
	): Prisma.PrismaPromise<
		runtime.Types.Result.GetResult<
			Prisma.$IntegrationDefinitionPayload<ExtArgs>,
			T,
			"updateManyAndReturn",
			GlobalOmitOptions
		>
	>;
	upsert<T extends IntegrationDefinitionUpsertArgs>(
		args: Prisma.SelectSubset<T, IntegrationDefinitionUpsertArgs<ExtArgs>>,
	): Prisma.Prisma__IntegrationDefinitionClient<
		runtime.Types.Result.GetResult<
			Prisma.$IntegrationDefinitionPayload<ExtArgs>,
			T,
			"upsert",
			GlobalOmitOptions
		>,
		never,
		ExtArgs,
		GlobalOmitOptions
	>;
	count<T extends IntegrationDefinitionCountArgs>(
		args?: Prisma.Subset<T, IntegrationDefinitionCountArgs>,
	): Prisma.PrismaPromise<
		T extends runtime.Types.Utils.Record<"select", any>
			? T["select"] extends true
				? number
				: Prisma.GetScalarType<
						T["select"],
						IntegrationDefinitionCountAggregateOutputType
					>
			: number
	>;
	aggregate<T extends IntegrationDefinitionAggregateArgs>(
		args: Prisma.Subset<T, IntegrationDefinitionAggregateArgs>,
	): Prisma.PrismaPromise<GetIntegrationDefinitionAggregateType<T>>;
	groupBy<
		T extends IntegrationDefinitionGroupByArgs,
		HasSelectOrTake extends Prisma.Or<
			Prisma.Extends<"skip", Prisma.Keys<T>>,
			Prisma.Extends<"take", Prisma.Keys<T>>
		>,
		OrderByArg extends Prisma.True extends HasSelectOrTake
			? {
					orderBy: IntegrationDefinitionGroupByArgs["orderBy"];
				}
			: {
					orderBy?: IntegrationDefinitionGroupByArgs["orderBy"];
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
			IntegrationDefinitionGroupByArgs,
			OrderByArg
		> &
			InputErrors,
	): {} extends InputErrors
		? GetIntegrationDefinitionGroupByPayload<T>
		: Prisma.PrismaPromise<InputErrors>;
	readonly fields: IntegrationDefinitionFieldRefs;
}
export interface Prisma__IntegrationDefinitionClient<
	T,
	Null = never,
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
	GlobalOmitOptions = {},
> extends Prisma.PrismaPromise<T> {
	readonly [Symbol.toStringTag]: "PrismaPromise";
	connections<
		T extends Prisma.IntegrationDefinition$connectionsArgs<ExtArgs> = {},
	>(
		args?: Prisma.Subset<
			T,
			Prisma.IntegrationDefinition$connectionsArgs<ExtArgs>
		>,
	): Prisma.PrismaPromise<
		| runtime.Types.Result.GetResult<
				Prisma.$IntegrationConnectionPayload<ExtArgs>,
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
export interface IntegrationDefinitionFieldRefs {
	readonly id: Prisma.FieldRef<"IntegrationDefinition", "String">;
	readonly name: Prisma.FieldRef<"IntegrationDefinition", "String">;
	readonly displayName: Prisma.FieldRef<"IntegrationDefinition", "String">;
	readonly description: Prisma.FieldRef<"IntegrationDefinition", "String">;
	readonly category: Prisma.FieldRef<"IntegrationDefinition", "String">;
	readonly authType: Prisma.FieldRef<"IntegrationDefinition", "String">;
	readonly configSchema: Prisma.FieldRef<"IntegrationDefinition", "String">;
	readonly oauthConfig: Prisma.FieldRef<"IntegrationDefinition", "String">;
	readonly iconUrl: Prisma.FieldRef<"IntegrationDefinition", "String">;
	readonly docsUrl: Prisma.FieldRef<"IntegrationDefinition", "String">;
	readonly maxConnectionsCE: Prisma.FieldRef<"IntegrationDefinition", "Int">;
	readonly isEnabled: Prisma.FieldRef<"IntegrationDefinition", "Boolean">;
	readonly createdAt: Prisma.FieldRef<"IntegrationDefinition", "DateTime">;
	readonly updatedAt: Prisma.FieldRef<"IntegrationDefinition", "DateTime">;
}
export type IntegrationDefinitionFindUniqueArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	select?: Prisma.IntegrationDefinitionSelect<ExtArgs> | null;
	omit?: Prisma.IntegrationDefinitionOmit<ExtArgs> | null;
	include?: Prisma.IntegrationDefinitionInclude<ExtArgs> | null;
	where: Prisma.IntegrationDefinitionWhereUniqueInput;
};
export type IntegrationDefinitionFindUniqueOrThrowArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	select?: Prisma.IntegrationDefinitionSelect<ExtArgs> | null;
	omit?: Prisma.IntegrationDefinitionOmit<ExtArgs> | null;
	include?: Prisma.IntegrationDefinitionInclude<ExtArgs> | null;
	where: Prisma.IntegrationDefinitionWhereUniqueInput;
};
export type IntegrationDefinitionFindFirstArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	select?: Prisma.IntegrationDefinitionSelect<ExtArgs> | null;
	omit?: Prisma.IntegrationDefinitionOmit<ExtArgs> | null;
	include?: Prisma.IntegrationDefinitionInclude<ExtArgs> | null;
	where?: Prisma.IntegrationDefinitionWhereInput;
	orderBy?:
		| Prisma.IntegrationDefinitionOrderByWithRelationInput
		| Prisma.IntegrationDefinitionOrderByWithRelationInput[];
	cursor?: Prisma.IntegrationDefinitionWhereUniqueInput;
	take?: number;
	skip?: number;
	distinct?:
		| Prisma.IntegrationDefinitionScalarFieldEnum
		| Prisma.IntegrationDefinitionScalarFieldEnum[];
};
export type IntegrationDefinitionFindFirstOrThrowArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	select?: Prisma.IntegrationDefinitionSelect<ExtArgs> | null;
	omit?: Prisma.IntegrationDefinitionOmit<ExtArgs> | null;
	include?: Prisma.IntegrationDefinitionInclude<ExtArgs> | null;
	where?: Prisma.IntegrationDefinitionWhereInput;
	orderBy?:
		| Prisma.IntegrationDefinitionOrderByWithRelationInput
		| Prisma.IntegrationDefinitionOrderByWithRelationInput[];
	cursor?: Prisma.IntegrationDefinitionWhereUniqueInput;
	take?: number;
	skip?: number;
	distinct?:
		| Prisma.IntegrationDefinitionScalarFieldEnum
		| Prisma.IntegrationDefinitionScalarFieldEnum[];
};
export type IntegrationDefinitionFindManyArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	select?: Prisma.IntegrationDefinitionSelect<ExtArgs> | null;
	omit?: Prisma.IntegrationDefinitionOmit<ExtArgs> | null;
	include?: Prisma.IntegrationDefinitionInclude<ExtArgs> | null;
	where?: Prisma.IntegrationDefinitionWhereInput;
	orderBy?:
		| Prisma.IntegrationDefinitionOrderByWithRelationInput
		| Prisma.IntegrationDefinitionOrderByWithRelationInput[];
	cursor?: Prisma.IntegrationDefinitionWhereUniqueInput;
	take?: number;
	skip?: number;
	distinct?:
		| Prisma.IntegrationDefinitionScalarFieldEnum
		| Prisma.IntegrationDefinitionScalarFieldEnum[];
};
export type IntegrationDefinitionCreateArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	select?: Prisma.IntegrationDefinitionSelect<ExtArgs> | null;
	omit?: Prisma.IntegrationDefinitionOmit<ExtArgs> | null;
	include?: Prisma.IntegrationDefinitionInclude<ExtArgs> | null;
	data: Prisma.XOR<
		Prisma.IntegrationDefinitionCreateInput,
		Prisma.IntegrationDefinitionUncheckedCreateInput
	>;
};
export type IntegrationDefinitionCreateManyArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	data:
		| Prisma.IntegrationDefinitionCreateManyInput
		| Prisma.IntegrationDefinitionCreateManyInput[];
};
export type IntegrationDefinitionCreateManyAndReturnArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	select?: Prisma.IntegrationDefinitionSelectCreateManyAndReturn<ExtArgs> | null;
	omit?: Prisma.IntegrationDefinitionOmit<ExtArgs> | null;
	data:
		| Prisma.IntegrationDefinitionCreateManyInput
		| Prisma.IntegrationDefinitionCreateManyInput[];
};
export type IntegrationDefinitionUpdateArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	select?: Prisma.IntegrationDefinitionSelect<ExtArgs> | null;
	omit?: Prisma.IntegrationDefinitionOmit<ExtArgs> | null;
	include?: Prisma.IntegrationDefinitionInclude<ExtArgs> | null;
	data: Prisma.XOR<
		Prisma.IntegrationDefinitionUpdateInput,
		Prisma.IntegrationDefinitionUncheckedUpdateInput
	>;
	where: Prisma.IntegrationDefinitionWhereUniqueInput;
};
export type IntegrationDefinitionUpdateManyArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	data: Prisma.XOR<
		Prisma.IntegrationDefinitionUpdateManyMutationInput,
		Prisma.IntegrationDefinitionUncheckedUpdateManyInput
	>;
	where?: Prisma.IntegrationDefinitionWhereInput;
	limit?: number;
};
export type IntegrationDefinitionUpdateManyAndReturnArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	select?: Prisma.IntegrationDefinitionSelectUpdateManyAndReturn<ExtArgs> | null;
	omit?: Prisma.IntegrationDefinitionOmit<ExtArgs> | null;
	data: Prisma.XOR<
		Prisma.IntegrationDefinitionUpdateManyMutationInput,
		Prisma.IntegrationDefinitionUncheckedUpdateManyInput
	>;
	where?: Prisma.IntegrationDefinitionWhereInput;
	limit?: number;
};
export type IntegrationDefinitionUpsertArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	select?: Prisma.IntegrationDefinitionSelect<ExtArgs> | null;
	omit?: Prisma.IntegrationDefinitionOmit<ExtArgs> | null;
	include?: Prisma.IntegrationDefinitionInclude<ExtArgs> | null;
	where: Prisma.IntegrationDefinitionWhereUniqueInput;
	create: Prisma.XOR<
		Prisma.IntegrationDefinitionCreateInput,
		Prisma.IntegrationDefinitionUncheckedCreateInput
	>;
	update: Prisma.XOR<
		Prisma.IntegrationDefinitionUpdateInput,
		Prisma.IntegrationDefinitionUncheckedUpdateInput
	>;
};
export type IntegrationDefinitionDeleteArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	select?: Prisma.IntegrationDefinitionSelect<ExtArgs> | null;
	omit?: Prisma.IntegrationDefinitionOmit<ExtArgs> | null;
	include?: Prisma.IntegrationDefinitionInclude<ExtArgs> | null;
	where: Prisma.IntegrationDefinitionWhereUniqueInput;
};
export type IntegrationDefinitionDeleteManyArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	where?: Prisma.IntegrationDefinitionWhereInput;
	limit?: number;
};
export type IntegrationDefinition$connectionsArgs<
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
export type IntegrationDefinitionDefaultArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	select?: Prisma.IntegrationDefinitionSelect<ExtArgs> | null;
	omit?: Prisma.IntegrationDefinitionOmit<ExtArgs> | null;
	include?: Prisma.IntegrationDefinitionInclude<ExtArgs> | null;
};
