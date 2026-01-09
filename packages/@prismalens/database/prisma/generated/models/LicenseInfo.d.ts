import type * as runtime from "@prisma/client/runtime/client";
import type * as Prisma from "../internal/prismaNamespace.js";
export type LicenseInfoModel =
	runtime.Types.Result.DefaultSelection<Prisma.$LicenseInfoPayload>;
export type AggregateLicenseInfo = {
	_count: LicenseInfoCountAggregateOutputType | null;
	_avg: LicenseInfoAvgAggregateOutputType | null;
	_sum: LicenseInfoSumAggregateOutputType | null;
	_min: LicenseInfoMinAggregateOutputType | null;
	_max: LicenseInfoMaxAggregateOutputType | null;
};
export type LicenseInfoAvgAggregateOutputType = {
	seats: number | null;
};
export type LicenseInfoSumAggregateOutputType = {
	seats: number | null;
};
export type LicenseInfoMinAggregateOutputType = {
	id: string | null;
	licenseKey: string | null;
	licenseType: string | null;
	tier: string | null;
	validUntil: Date | null;
	activatedAt: Date | null;
	lastValidated: Date | null;
	features: string | null;
	quotas: string | null;
	billingCycle: string | null;
	seats: number | null;
	cloudInstanceId: string | null;
	isCloudManaged: boolean | null;
	customerEmail: string | null;
	customerName: string | null;
	metadata: string | null;
	createdAt: Date | null;
	updatedAt: Date | null;
};
export type LicenseInfoMaxAggregateOutputType = {
	id: string | null;
	licenseKey: string | null;
	licenseType: string | null;
	tier: string | null;
	validUntil: Date | null;
	activatedAt: Date | null;
	lastValidated: Date | null;
	features: string | null;
	quotas: string | null;
	billingCycle: string | null;
	seats: number | null;
	cloudInstanceId: string | null;
	isCloudManaged: boolean | null;
	customerEmail: string | null;
	customerName: string | null;
	metadata: string | null;
	createdAt: Date | null;
	updatedAt: Date | null;
};
export type LicenseInfoCountAggregateOutputType = {
	id: number;
	licenseKey: number;
	licenseType: number;
	tier: number;
	validUntil: number;
	activatedAt: number;
	lastValidated: number;
	features: number;
	quotas: number;
	billingCycle: number;
	seats: number;
	cloudInstanceId: number;
	isCloudManaged: number;
	customerEmail: number;
	customerName: number;
	metadata: number;
	createdAt: number;
	updatedAt: number;
	_all: number;
};
export type LicenseInfoAvgAggregateInputType = {
	seats?: true;
};
export type LicenseInfoSumAggregateInputType = {
	seats?: true;
};
export type LicenseInfoMinAggregateInputType = {
	id?: true;
	licenseKey?: true;
	licenseType?: true;
	tier?: true;
	validUntil?: true;
	activatedAt?: true;
	lastValidated?: true;
	features?: true;
	quotas?: true;
	billingCycle?: true;
	seats?: true;
	cloudInstanceId?: true;
	isCloudManaged?: true;
	customerEmail?: true;
	customerName?: true;
	metadata?: true;
	createdAt?: true;
	updatedAt?: true;
};
export type LicenseInfoMaxAggregateInputType = {
	id?: true;
	licenseKey?: true;
	licenseType?: true;
	tier?: true;
	validUntil?: true;
	activatedAt?: true;
	lastValidated?: true;
	features?: true;
	quotas?: true;
	billingCycle?: true;
	seats?: true;
	cloudInstanceId?: true;
	isCloudManaged?: true;
	customerEmail?: true;
	customerName?: true;
	metadata?: true;
	createdAt?: true;
	updatedAt?: true;
};
export type LicenseInfoCountAggregateInputType = {
	id?: true;
	licenseKey?: true;
	licenseType?: true;
	tier?: true;
	validUntil?: true;
	activatedAt?: true;
	lastValidated?: true;
	features?: true;
	quotas?: true;
	billingCycle?: true;
	seats?: true;
	cloudInstanceId?: true;
	isCloudManaged?: true;
	customerEmail?: true;
	customerName?: true;
	metadata?: true;
	createdAt?: true;
	updatedAt?: true;
	_all?: true;
};
export type LicenseInfoAggregateArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	where?: Prisma.LicenseInfoWhereInput;
	orderBy?:
		| Prisma.LicenseInfoOrderByWithRelationInput
		| Prisma.LicenseInfoOrderByWithRelationInput[];
	cursor?: Prisma.LicenseInfoWhereUniqueInput;
	take?: number;
	skip?: number;
	_count?: true | LicenseInfoCountAggregateInputType;
	_avg?: LicenseInfoAvgAggregateInputType;
	_sum?: LicenseInfoSumAggregateInputType;
	_min?: LicenseInfoMinAggregateInputType;
	_max?: LicenseInfoMaxAggregateInputType;
};
export type GetLicenseInfoAggregateType<T extends LicenseInfoAggregateArgs> = {
	[P in keyof T & keyof AggregateLicenseInfo]: P extends "_count" | "count"
		? T[P] extends true
			? number
			: Prisma.GetScalarType<T[P], AggregateLicenseInfo[P]>
		: Prisma.GetScalarType<T[P], AggregateLicenseInfo[P]>;
};
export type LicenseInfoGroupByArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	where?: Prisma.LicenseInfoWhereInput;
	orderBy?:
		| Prisma.LicenseInfoOrderByWithAggregationInput
		| Prisma.LicenseInfoOrderByWithAggregationInput[];
	by: Prisma.LicenseInfoScalarFieldEnum[] | Prisma.LicenseInfoScalarFieldEnum;
	having?: Prisma.LicenseInfoScalarWhereWithAggregatesInput;
	take?: number;
	skip?: number;
	_count?: LicenseInfoCountAggregateInputType | true;
	_avg?: LicenseInfoAvgAggregateInputType;
	_sum?: LicenseInfoSumAggregateInputType;
	_min?: LicenseInfoMinAggregateInputType;
	_max?: LicenseInfoMaxAggregateInputType;
};
export type LicenseInfoGroupByOutputType = {
	id: string;
	licenseKey: string | null;
	licenseType: string;
	tier: string;
	validUntil: Date | null;
	activatedAt: Date | null;
	lastValidated: Date | null;
	features: string;
	quotas: string;
	billingCycle: string | null;
	seats: number | null;
	cloudInstanceId: string | null;
	isCloudManaged: boolean;
	customerEmail: string | null;
	customerName: string | null;
	metadata: string;
	createdAt: Date;
	updatedAt: Date;
	_count: LicenseInfoCountAggregateOutputType | null;
	_avg: LicenseInfoAvgAggregateOutputType | null;
	_sum: LicenseInfoSumAggregateOutputType | null;
	_min: LicenseInfoMinAggregateOutputType | null;
	_max: LicenseInfoMaxAggregateOutputType | null;
};
type GetLicenseInfoGroupByPayload<T extends LicenseInfoGroupByArgs> =
	Prisma.PrismaPromise<
		Array<
			Prisma.PickEnumerable<LicenseInfoGroupByOutputType, T["by"]> & {
				[P in keyof T & keyof LicenseInfoGroupByOutputType]: P extends "_count"
					? T[P] extends boolean
						? number
						: Prisma.GetScalarType<T[P], LicenseInfoGroupByOutputType[P]>
					: Prisma.GetScalarType<T[P], LicenseInfoGroupByOutputType[P]>;
			}
		>
	>;
export type LicenseInfoWhereInput = {
	AND?: Prisma.LicenseInfoWhereInput | Prisma.LicenseInfoWhereInput[];
	OR?: Prisma.LicenseInfoWhereInput[];
	NOT?: Prisma.LicenseInfoWhereInput | Prisma.LicenseInfoWhereInput[];
	id?: Prisma.StringFilter<"LicenseInfo"> | string;
	licenseKey?: Prisma.StringNullableFilter<"LicenseInfo"> | string | null;
	licenseType?: Prisma.StringFilter<"LicenseInfo"> | string;
	tier?: Prisma.StringFilter<"LicenseInfo"> | string;
	validUntil?:
		| Prisma.DateTimeNullableFilter<"LicenseInfo">
		| Date
		| string
		| null;
	activatedAt?:
		| Prisma.DateTimeNullableFilter<"LicenseInfo">
		| Date
		| string
		| null;
	lastValidated?:
		| Prisma.DateTimeNullableFilter<"LicenseInfo">
		| Date
		| string
		| null;
	features?: Prisma.StringFilter<"LicenseInfo"> | string;
	quotas?: Prisma.StringFilter<"LicenseInfo"> | string;
	billingCycle?: Prisma.StringNullableFilter<"LicenseInfo"> | string | null;
	seats?: Prisma.IntNullableFilter<"LicenseInfo"> | number | null;
	cloudInstanceId?: Prisma.StringNullableFilter<"LicenseInfo"> | string | null;
	isCloudManaged?: Prisma.BoolFilter<"LicenseInfo"> | boolean;
	customerEmail?: Prisma.StringNullableFilter<"LicenseInfo"> | string | null;
	customerName?: Prisma.StringNullableFilter<"LicenseInfo"> | string | null;
	metadata?: Prisma.StringFilter<"LicenseInfo"> | string;
	createdAt?: Prisma.DateTimeFilter<"LicenseInfo"> | Date | string;
	updatedAt?: Prisma.DateTimeFilter<"LicenseInfo"> | Date | string;
};
export type LicenseInfoOrderByWithRelationInput = {
	id?: Prisma.SortOrder;
	licenseKey?: Prisma.SortOrderInput | Prisma.SortOrder;
	licenseType?: Prisma.SortOrder;
	tier?: Prisma.SortOrder;
	validUntil?: Prisma.SortOrderInput | Prisma.SortOrder;
	activatedAt?: Prisma.SortOrderInput | Prisma.SortOrder;
	lastValidated?: Prisma.SortOrderInput | Prisma.SortOrder;
	features?: Prisma.SortOrder;
	quotas?: Prisma.SortOrder;
	billingCycle?: Prisma.SortOrderInput | Prisma.SortOrder;
	seats?: Prisma.SortOrderInput | Prisma.SortOrder;
	cloudInstanceId?: Prisma.SortOrderInput | Prisma.SortOrder;
	isCloudManaged?: Prisma.SortOrder;
	customerEmail?: Prisma.SortOrderInput | Prisma.SortOrder;
	customerName?: Prisma.SortOrderInput | Prisma.SortOrder;
	metadata?: Prisma.SortOrder;
	createdAt?: Prisma.SortOrder;
	updatedAt?: Prisma.SortOrder;
};
export type LicenseInfoWhereUniqueInput = Prisma.AtLeast<
	{
		id?: string;
		licenseKey?: string;
		AND?: Prisma.LicenseInfoWhereInput | Prisma.LicenseInfoWhereInput[];
		OR?: Prisma.LicenseInfoWhereInput[];
		NOT?: Prisma.LicenseInfoWhereInput | Prisma.LicenseInfoWhereInput[];
		licenseType?: Prisma.StringFilter<"LicenseInfo"> | string;
		tier?: Prisma.StringFilter<"LicenseInfo"> | string;
		validUntil?:
			| Prisma.DateTimeNullableFilter<"LicenseInfo">
			| Date
			| string
			| null;
		activatedAt?:
			| Prisma.DateTimeNullableFilter<"LicenseInfo">
			| Date
			| string
			| null;
		lastValidated?:
			| Prisma.DateTimeNullableFilter<"LicenseInfo">
			| Date
			| string
			| null;
		features?: Prisma.StringFilter<"LicenseInfo"> | string;
		quotas?: Prisma.StringFilter<"LicenseInfo"> | string;
		billingCycle?: Prisma.StringNullableFilter<"LicenseInfo"> | string | null;
		seats?: Prisma.IntNullableFilter<"LicenseInfo"> | number | null;
		cloudInstanceId?:
			| Prisma.StringNullableFilter<"LicenseInfo">
			| string
			| null;
		isCloudManaged?: Prisma.BoolFilter<"LicenseInfo"> | boolean;
		customerEmail?: Prisma.StringNullableFilter<"LicenseInfo"> | string | null;
		customerName?: Prisma.StringNullableFilter<"LicenseInfo"> | string | null;
		metadata?: Prisma.StringFilter<"LicenseInfo"> | string;
		createdAt?: Prisma.DateTimeFilter<"LicenseInfo"> | Date | string;
		updatedAt?: Prisma.DateTimeFilter<"LicenseInfo"> | Date | string;
	},
	"id" | "licenseKey"
>;
export type LicenseInfoOrderByWithAggregationInput = {
	id?: Prisma.SortOrder;
	licenseKey?: Prisma.SortOrderInput | Prisma.SortOrder;
	licenseType?: Prisma.SortOrder;
	tier?: Prisma.SortOrder;
	validUntil?: Prisma.SortOrderInput | Prisma.SortOrder;
	activatedAt?: Prisma.SortOrderInput | Prisma.SortOrder;
	lastValidated?: Prisma.SortOrderInput | Prisma.SortOrder;
	features?: Prisma.SortOrder;
	quotas?: Prisma.SortOrder;
	billingCycle?: Prisma.SortOrderInput | Prisma.SortOrder;
	seats?: Prisma.SortOrderInput | Prisma.SortOrder;
	cloudInstanceId?: Prisma.SortOrderInput | Prisma.SortOrder;
	isCloudManaged?: Prisma.SortOrder;
	customerEmail?: Prisma.SortOrderInput | Prisma.SortOrder;
	customerName?: Prisma.SortOrderInput | Prisma.SortOrder;
	metadata?: Prisma.SortOrder;
	createdAt?: Prisma.SortOrder;
	updatedAt?: Prisma.SortOrder;
	_count?: Prisma.LicenseInfoCountOrderByAggregateInput;
	_avg?: Prisma.LicenseInfoAvgOrderByAggregateInput;
	_max?: Prisma.LicenseInfoMaxOrderByAggregateInput;
	_min?: Prisma.LicenseInfoMinOrderByAggregateInput;
	_sum?: Prisma.LicenseInfoSumOrderByAggregateInput;
};
export type LicenseInfoScalarWhereWithAggregatesInput = {
	AND?:
		| Prisma.LicenseInfoScalarWhereWithAggregatesInput
		| Prisma.LicenseInfoScalarWhereWithAggregatesInput[];
	OR?: Prisma.LicenseInfoScalarWhereWithAggregatesInput[];
	NOT?:
		| Prisma.LicenseInfoScalarWhereWithAggregatesInput
		| Prisma.LicenseInfoScalarWhereWithAggregatesInput[];
	id?: Prisma.StringWithAggregatesFilter<"LicenseInfo"> | string;
	licenseKey?:
		| Prisma.StringNullableWithAggregatesFilter<"LicenseInfo">
		| string
		| null;
	licenseType?: Prisma.StringWithAggregatesFilter<"LicenseInfo"> | string;
	tier?: Prisma.StringWithAggregatesFilter<"LicenseInfo"> | string;
	validUntil?:
		| Prisma.DateTimeNullableWithAggregatesFilter<"LicenseInfo">
		| Date
		| string
		| null;
	activatedAt?:
		| Prisma.DateTimeNullableWithAggregatesFilter<"LicenseInfo">
		| Date
		| string
		| null;
	lastValidated?:
		| Prisma.DateTimeNullableWithAggregatesFilter<"LicenseInfo">
		| Date
		| string
		| null;
	features?: Prisma.StringWithAggregatesFilter<"LicenseInfo"> | string;
	quotas?: Prisma.StringWithAggregatesFilter<"LicenseInfo"> | string;
	billingCycle?:
		| Prisma.StringNullableWithAggregatesFilter<"LicenseInfo">
		| string
		| null;
	seats?: Prisma.IntNullableWithAggregatesFilter<"LicenseInfo"> | number | null;
	cloudInstanceId?:
		| Prisma.StringNullableWithAggregatesFilter<"LicenseInfo">
		| string
		| null;
	isCloudManaged?: Prisma.BoolWithAggregatesFilter<"LicenseInfo"> | boolean;
	customerEmail?:
		| Prisma.StringNullableWithAggregatesFilter<"LicenseInfo">
		| string
		| null;
	customerName?:
		| Prisma.StringNullableWithAggregatesFilter<"LicenseInfo">
		| string
		| null;
	metadata?: Prisma.StringWithAggregatesFilter<"LicenseInfo"> | string;
	createdAt?:
		| Prisma.DateTimeWithAggregatesFilter<"LicenseInfo">
		| Date
		| string;
	updatedAt?:
		| Prisma.DateTimeWithAggregatesFilter<"LicenseInfo">
		| Date
		| string;
};
export type LicenseInfoCreateInput = {
	id?: string;
	licenseKey?: string | null;
	licenseType?: string;
	tier?: string;
	validUntil?: Date | string | null;
	activatedAt?: Date | string | null;
	lastValidated?: Date | string | null;
	features?: string;
	quotas?: string;
	billingCycle?: string | null;
	seats?: number | null;
	cloudInstanceId?: string | null;
	isCloudManaged?: boolean;
	customerEmail?: string | null;
	customerName?: string | null;
	metadata?: string;
	createdAt?: Date | string;
	updatedAt?: Date | string;
};
export type LicenseInfoUncheckedCreateInput = {
	id?: string;
	licenseKey?: string | null;
	licenseType?: string;
	tier?: string;
	validUntil?: Date | string | null;
	activatedAt?: Date | string | null;
	lastValidated?: Date | string | null;
	features?: string;
	quotas?: string;
	billingCycle?: string | null;
	seats?: number | null;
	cloudInstanceId?: string | null;
	isCloudManaged?: boolean;
	customerEmail?: string | null;
	customerName?: string | null;
	metadata?: string;
	createdAt?: Date | string;
	updatedAt?: Date | string;
};
export type LicenseInfoUpdateInput = {
	id?: Prisma.StringFieldUpdateOperationsInput | string;
	licenseKey?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	licenseType?: Prisma.StringFieldUpdateOperationsInput | string;
	tier?: Prisma.StringFieldUpdateOperationsInput | string;
	validUntil?:
		| Prisma.NullableDateTimeFieldUpdateOperationsInput
		| Date
		| string
		| null;
	activatedAt?:
		| Prisma.NullableDateTimeFieldUpdateOperationsInput
		| Date
		| string
		| null;
	lastValidated?:
		| Prisma.NullableDateTimeFieldUpdateOperationsInput
		| Date
		| string
		| null;
	features?: Prisma.StringFieldUpdateOperationsInput | string;
	quotas?: Prisma.StringFieldUpdateOperationsInput | string;
	billingCycle?:
		| Prisma.NullableStringFieldUpdateOperationsInput
		| string
		| null;
	seats?: Prisma.NullableIntFieldUpdateOperationsInput | number | null;
	cloudInstanceId?:
		| Prisma.NullableStringFieldUpdateOperationsInput
		| string
		| null;
	isCloudManaged?: Prisma.BoolFieldUpdateOperationsInput | boolean;
	customerEmail?:
		| Prisma.NullableStringFieldUpdateOperationsInput
		| string
		| null;
	customerName?:
		| Prisma.NullableStringFieldUpdateOperationsInput
		| string
		| null;
	metadata?: Prisma.StringFieldUpdateOperationsInput | string;
	createdAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
	updatedAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
};
export type LicenseInfoUncheckedUpdateInput = {
	id?: Prisma.StringFieldUpdateOperationsInput | string;
	licenseKey?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	licenseType?: Prisma.StringFieldUpdateOperationsInput | string;
	tier?: Prisma.StringFieldUpdateOperationsInput | string;
	validUntil?:
		| Prisma.NullableDateTimeFieldUpdateOperationsInput
		| Date
		| string
		| null;
	activatedAt?:
		| Prisma.NullableDateTimeFieldUpdateOperationsInput
		| Date
		| string
		| null;
	lastValidated?:
		| Prisma.NullableDateTimeFieldUpdateOperationsInput
		| Date
		| string
		| null;
	features?: Prisma.StringFieldUpdateOperationsInput | string;
	quotas?: Prisma.StringFieldUpdateOperationsInput | string;
	billingCycle?:
		| Prisma.NullableStringFieldUpdateOperationsInput
		| string
		| null;
	seats?: Prisma.NullableIntFieldUpdateOperationsInput | number | null;
	cloudInstanceId?:
		| Prisma.NullableStringFieldUpdateOperationsInput
		| string
		| null;
	isCloudManaged?: Prisma.BoolFieldUpdateOperationsInput | boolean;
	customerEmail?:
		| Prisma.NullableStringFieldUpdateOperationsInput
		| string
		| null;
	customerName?:
		| Prisma.NullableStringFieldUpdateOperationsInput
		| string
		| null;
	metadata?: Prisma.StringFieldUpdateOperationsInput | string;
	createdAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
	updatedAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
};
export type LicenseInfoCreateManyInput = {
	id?: string;
	licenseKey?: string | null;
	licenseType?: string;
	tier?: string;
	validUntil?: Date | string | null;
	activatedAt?: Date | string | null;
	lastValidated?: Date | string | null;
	features?: string;
	quotas?: string;
	billingCycle?: string | null;
	seats?: number | null;
	cloudInstanceId?: string | null;
	isCloudManaged?: boolean;
	customerEmail?: string | null;
	customerName?: string | null;
	metadata?: string;
	createdAt?: Date | string;
	updatedAt?: Date | string;
};
export type LicenseInfoUpdateManyMutationInput = {
	id?: Prisma.StringFieldUpdateOperationsInput | string;
	licenseKey?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	licenseType?: Prisma.StringFieldUpdateOperationsInput | string;
	tier?: Prisma.StringFieldUpdateOperationsInput | string;
	validUntil?:
		| Prisma.NullableDateTimeFieldUpdateOperationsInput
		| Date
		| string
		| null;
	activatedAt?:
		| Prisma.NullableDateTimeFieldUpdateOperationsInput
		| Date
		| string
		| null;
	lastValidated?:
		| Prisma.NullableDateTimeFieldUpdateOperationsInput
		| Date
		| string
		| null;
	features?: Prisma.StringFieldUpdateOperationsInput | string;
	quotas?: Prisma.StringFieldUpdateOperationsInput | string;
	billingCycle?:
		| Prisma.NullableStringFieldUpdateOperationsInput
		| string
		| null;
	seats?: Prisma.NullableIntFieldUpdateOperationsInput | number | null;
	cloudInstanceId?:
		| Prisma.NullableStringFieldUpdateOperationsInput
		| string
		| null;
	isCloudManaged?: Prisma.BoolFieldUpdateOperationsInput | boolean;
	customerEmail?:
		| Prisma.NullableStringFieldUpdateOperationsInput
		| string
		| null;
	customerName?:
		| Prisma.NullableStringFieldUpdateOperationsInput
		| string
		| null;
	metadata?: Prisma.StringFieldUpdateOperationsInput | string;
	createdAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
	updatedAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
};
export type LicenseInfoUncheckedUpdateManyInput = {
	id?: Prisma.StringFieldUpdateOperationsInput | string;
	licenseKey?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
	licenseType?: Prisma.StringFieldUpdateOperationsInput | string;
	tier?: Prisma.StringFieldUpdateOperationsInput | string;
	validUntil?:
		| Prisma.NullableDateTimeFieldUpdateOperationsInput
		| Date
		| string
		| null;
	activatedAt?:
		| Prisma.NullableDateTimeFieldUpdateOperationsInput
		| Date
		| string
		| null;
	lastValidated?:
		| Prisma.NullableDateTimeFieldUpdateOperationsInput
		| Date
		| string
		| null;
	features?: Prisma.StringFieldUpdateOperationsInput | string;
	quotas?: Prisma.StringFieldUpdateOperationsInput | string;
	billingCycle?:
		| Prisma.NullableStringFieldUpdateOperationsInput
		| string
		| null;
	seats?: Prisma.NullableIntFieldUpdateOperationsInput | number | null;
	cloudInstanceId?:
		| Prisma.NullableStringFieldUpdateOperationsInput
		| string
		| null;
	isCloudManaged?: Prisma.BoolFieldUpdateOperationsInput | boolean;
	customerEmail?:
		| Prisma.NullableStringFieldUpdateOperationsInput
		| string
		| null;
	customerName?:
		| Prisma.NullableStringFieldUpdateOperationsInput
		| string
		| null;
	metadata?: Prisma.StringFieldUpdateOperationsInput | string;
	createdAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
	updatedAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
};
export type LicenseInfoCountOrderByAggregateInput = {
	id?: Prisma.SortOrder;
	licenseKey?: Prisma.SortOrder;
	licenseType?: Prisma.SortOrder;
	tier?: Prisma.SortOrder;
	validUntil?: Prisma.SortOrder;
	activatedAt?: Prisma.SortOrder;
	lastValidated?: Prisma.SortOrder;
	features?: Prisma.SortOrder;
	quotas?: Prisma.SortOrder;
	billingCycle?: Prisma.SortOrder;
	seats?: Prisma.SortOrder;
	cloudInstanceId?: Prisma.SortOrder;
	isCloudManaged?: Prisma.SortOrder;
	customerEmail?: Prisma.SortOrder;
	customerName?: Prisma.SortOrder;
	metadata?: Prisma.SortOrder;
	createdAt?: Prisma.SortOrder;
	updatedAt?: Prisma.SortOrder;
};
export type LicenseInfoAvgOrderByAggregateInput = {
	seats?: Prisma.SortOrder;
};
export type LicenseInfoMaxOrderByAggregateInput = {
	id?: Prisma.SortOrder;
	licenseKey?: Prisma.SortOrder;
	licenseType?: Prisma.SortOrder;
	tier?: Prisma.SortOrder;
	validUntil?: Prisma.SortOrder;
	activatedAt?: Prisma.SortOrder;
	lastValidated?: Prisma.SortOrder;
	features?: Prisma.SortOrder;
	quotas?: Prisma.SortOrder;
	billingCycle?: Prisma.SortOrder;
	seats?: Prisma.SortOrder;
	cloudInstanceId?: Prisma.SortOrder;
	isCloudManaged?: Prisma.SortOrder;
	customerEmail?: Prisma.SortOrder;
	customerName?: Prisma.SortOrder;
	metadata?: Prisma.SortOrder;
	createdAt?: Prisma.SortOrder;
	updatedAt?: Prisma.SortOrder;
};
export type LicenseInfoMinOrderByAggregateInput = {
	id?: Prisma.SortOrder;
	licenseKey?: Prisma.SortOrder;
	licenseType?: Prisma.SortOrder;
	tier?: Prisma.SortOrder;
	validUntil?: Prisma.SortOrder;
	activatedAt?: Prisma.SortOrder;
	lastValidated?: Prisma.SortOrder;
	features?: Prisma.SortOrder;
	quotas?: Prisma.SortOrder;
	billingCycle?: Prisma.SortOrder;
	seats?: Prisma.SortOrder;
	cloudInstanceId?: Prisma.SortOrder;
	isCloudManaged?: Prisma.SortOrder;
	customerEmail?: Prisma.SortOrder;
	customerName?: Prisma.SortOrder;
	metadata?: Prisma.SortOrder;
	createdAt?: Prisma.SortOrder;
	updatedAt?: Prisma.SortOrder;
};
export type LicenseInfoSumOrderByAggregateInput = {
	seats?: Prisma.SortOrder;
};
export type LicenseInfoSelect<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = runtime.Types.Extensions.GetSelect<
	{
		id?: boolean;
		licenseKey?: boolean;
		licenseType?: boolean;
		tier?: boolean;
		validUntil?: boolean;
		activatedAt?: boolean;
		lastValidated?: boolean;
		features?: boolean;
		quotas?: boolean;
		billingCycle?: boolean;
		seats?: boolean;
		cloudInstanceId?: boolean;
		isCloudManaged?: boolean;
		customerEmail?: boolean;
		customerName?: boolean;
		metadata?: boolean;
		createdAt?: boolean;
		updatedAt?: boolean;
	},
	ExtArgs["result"]["licenseInfo"]
>;
export type LicenseInfoSelectCreateManyAndReturn<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = runtime.Types.Extensions.GetSelect<
	{
		id?: boolean;
		licenseKey?: boolean;
		licenseType?: boolean;
		tier?: boolean;
		validUntil?: boolean;
		activatedAt?: boolean;
		lastValidated?: boolean;
		features?: boolean;
		quotas?: boolean;
		billingCycle?: boolean;
		seats?: boolean;
		cloudInstanceId?: boolean;
		isCloudManaged?: boolean;
		customerEmail?: boolean;
		customerName?: boolean;
		metadata?: boolean;
		createdAt?: boolean;
		updatedAt?: boolean;
	},
	ExtArgs["result"]["licenseInfo"]
>;
export type LicenseInfoSelectUpdateManyAndReturn<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = runtime.Types.Extensions.GetSelect<
	{
		id?: boolean;
		licenseKey?: boolean;
		licenseType?: boolean;
		tier?: boolean;
		validUntil?: boolean;
		activatedAt?: boolean;
		lastValidated?: boolean;
		features?: boolean;
		quotas?: boolean;
		billingCycle?: boolean;
		seats?: boolean;
		cloudInstanceId?: boolean;
		isCloudManaged?: boolean;
		customerEmail?: boolean;
		customerName?: boolean;
		metadata?: boolean;
		createdAt?: boolean;
		updatedAt?: boolean;
	},
	ExtArgs["result"]["licenseInfo"]
>;
export type LicenseInfoSelectScalar = {
	id?: boolean;
	licenseKey?: boolean;
	licenseType?: boolean;
	tier?: boolean;
	validUntil?: boolean;
	activatedAt?: boolean;
	lastValidated?: boolean;
	features?: boolean;
	quotas?: boolean;
	billingCycle?: boolean;
	seats?: boolean;
	cloudInstanceId?: boolean;
	isCloudManaged?: boolean;
	customerEmail?: boolean;
	customerName?: boolean;
	metadata?: boolean;
	createdAt?: boolean;
	updatedAt?: boolean;
};
export type LicenseInfoOmit<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = runtime.Types.Extensions.GetOmit<
	| "id"
	| "licenseKey"
	| "licenseType"
	| "tier"
	| "validUntil"
	| "activatedAt"
	| "lastValidated"
	| "features"
	| "quotas"
	| "billingCycle"
	| "seats"
	| "cloudInstanceId"
	| "isCloudManaged"
	| "customerEmail"
	| "customerName"
	| "metadata"
	| "createdAt"
	| "updatedAt",
	ExtArgs["result"]["licenseInfo"]
>;
export type $LicenseInfoPayload<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	name: "LicenseInfo";
	objects: {};
	scalars: runtime.Types.Extensions.GetPayloadResult<
		{
			id: string;
			licenseKey: string | null;
			licenseType: string;
			tier: string;
			validUntil: Date | null;
			activatedAt: Date | null;
			lastValidated: Date | null;
			features: string;
			quotas: string;
			billingCycle: string | null;
			seats: number | null;
			cloudInstanceId: string | null;
			isCloudManaged: boolean;
			customerEmail: string | null;
			customerName: string | null;
			metadata: string;
			createdAt: Date;
			updatedAt: Date;
		},
		ExtArgs["result"]["licenseInfo"]
	>;
	composites: {};
};
export type LicenseInfoGetPayload<
	S extends boolean | null | undefined | LicenseInfoDefaultArgs,
> = runtime.Types.Result.GetResult<Prisma.$LicenseInfoPayload, S>;
export type LicenseInfoCountArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = Omit<
	LicenseInfoFindManyArgs,
	"select" | "include" | "distinct" | "omit"
> & {
	select?: LicenseInfoCountAggregateInputType | true;
};
export interface LicenseInfoDelegate<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
	GlobalOmitOptions = {},
> {
	[K: symbol]: {
		types: Prisma.TypeMap<ExtArgs>["model"]["LicenseInfo"];
		meta: {
			name: "LicenseInfo";
		};
	};
	findUnique<T extends LicenseInfoFindUniqueArgs>(
		args: Prisma.SelectSubset<T, LicenseInfoFindUniqueArgs<ExtArgs>>,
	): Prisma.Prisma__LicenseInfoClient<
		runtime.Types.Result.GetResult<
			Prisma.$LicenseInfoPayload<ExtArgs>,
			T,
			"findUnique",
			GlobalOmitOptions
		> | null,
		null,
		ExtArgs,
		GlobalOmitOptions
	>;
	findUniqueOrThrow<T extends LicenseInfoFindUniqueOrThrowArgs>(
		args: Prisma.SelectSubset<T, LicenseInfoFindUniqueOrThrowArgs<ExtArgs>>,
	): Prisma.Prisma__LicenseInfoClient<
		runtime.Types.Result.GetResult<
			Prisma.$LicenseInfoPayload<ExtArgs>,
			T,
			"findUniqueOrThrow",
			GlobalOmitOptions
		>,
		never,
		ExtArgs,
		GlobalOmitOptions
	>;
	findFirst<T extends LicenseInfoFindFirstArgs>(
		args?: Prisma.SelectSubset<T, LicenseInfoFindFirstArgs<ExtArgs>>,
	): Prisma.Prisma__LicenseInfoClient<
		runtime.Types.Result.GetResult<
			Prisma.$LicenseInfoPayload<ExtArgs>,
			T,
			"findFirst",
			GlobalOmitOptions
		> | null,
		null,
		ExtArgs,
		GlobalOmitOptions
	>;
	findFirstOrThrow<T extends LicenseInfoFindFirstOrThrowArgs>(
		args?: Prisma.SelectSubset<T, LicenseInfoFindFirstOrThrowArgs<ExtArgs>>,
	): Prisma.Prisma__LicenseInfoClient<
		runtime.Types.Result.GetResult<
			Prisma.$LicenseInfoPayload<ExtArgs>,
			T,
			"findFirstOrThrow",
			GlobalOmitOptions
		>,
		never,
		ExtArgs,
		GlobalOmitOptions
	>;
	findMany<T extends LicenseInfoFindManyArgs>(
		args?: Prisma.SelectSubset<T, LicenseInfoFindManyArgs<ExtArgs>>,
	): Prisma.PrismaPromise<
		runtime.Types.Result.GetResult<
			Prisma.$LicenseInfoPayload<ExtArgs>,
			T,
			"findMany",
			GlobalOmitOptions
		>
	>;
	create<T extends LicenseInfoCreateArgs>(
		args: Prisma.SelectSubset<T, LicenseInfoCreateArgs<ExtArgs>>,
	): Prisma.Prisma__LicenseInfoClient<
		runtime.Types.Result.GetResult<
			Prisma.$LicenseInfoPayload<ExtArgs>,
			T,
			"create",
			GlobalOmitOptions
		>,
		never,
		ExtArgs,
		GlobalOmitOptions
	>;
	createMany<T extends LicenseInfoCreateManyArgs>(
		args?: Prisma.SelectSubset<T, LicenseInfoCreateManyArgs<ExtArgs>>,
	): Prisma.PrismaPromise<Prisma.BatchPayload>;
	createManyAndReturn<T extends LicenseInfoCreateManyAndReturnArgs>(
		args?: Prisma.SelectSubset<T, LicenseInfoCreateManyAndReturnArgs<ExtArgs>>,
	): Prisma.PrismaPromise<
		runtime.Types.Result.GetResult<
			Prisma.$LicenseInfoPayload<ExtArgs>,
			T,
			"createManyAndReturn",
			GlobalOmitOptions
		>
	>;
	delete<T extends LicenseInfoDeleteArgs>(
		args: Prisma.SelectSubset<T, LicenseInfoDeleteArgs<ExtArgs>>,
	): Prisma.Prisma__LicenseInfoClient<
		runtime.Types.Result.GetResult<
			Prisma.$LicenseInfoPayload<ExtArgs>,
			T,
			"delete",
			GlobalOmitOptions
		>,
		never,
		ExtArgs,
		GlobalOmitOptions
	>;
	update<T extends LicenseInfoUpdateArgs>(
		args: Prisma.SelectSubset<T, LicenseInfoUpdateArgs<ExtArgs>>,
	): Prisma.Prisma__LicenseInfoClient<
		runtime.Types.Result.GetResult<
			Prisma.$LicenseInfoPayload<ExtArgs>,
			T,
			"update",
			GlobalOmitOptions
		>,
		never,
		ExtArgs,
		GlobalOmitOptions
	>;
	deleteMany<T extends LicenseInfoDeleteManyArgs>(
		args?: Prisma.SelectSubset<T, LicenseInfoDeleteManyArgs<ExtArgs>>,
	): Prisma.PrismaPromise<Prisma.BatchPayload>;
	updateMany<T extends LicenseInfoUpdateManyArgs>(
		args: Prisma.SelectSubset<T, LicenseInfoUpdateManyArgs<ExtArgs>>,
	): Prisma.PrismaPromise<Prisma.BatchPayload>;
	updateManyAndReturn<T extends LicenseInfoUpdateManyAndReturnArgs>(
		args: Prisma.SelectSubset<T, LicenseInfoUpdateManyAndReturnArgs<ExtArgs>>,
	): Prisma.PrismaPromise<
		runtime.Types.Result.GetResult<
			Prisma.$LicenseInfoPayload<ExtArgs>,
			T,
			"updateManyAndReturn",
			GlobalOmitOptions
		>
	>;
	upsert<T extends LicenseInfoUpsertArgs>(
		args: Prisma.SelectSubset<T, LicenseInfoUpsertArgs<ExtArgs>>,
	): Prisma.Prisma__LicenseInfoClient<
		runtime.Types.Result.GetResult<
			Prisma.$LicenseInfoPayload<ExtArgs>,
			T,
			"upsert",
			GlobalOmitOptions
		>,
		never,
		ExtArgs,
		GlobalOmitOptions
	>;
	count<T extends LicenseInfoCountArgs>(
		args?: Prisma.Subset<T, LicenseInfoCountArgs>,
	): Prisma.PrismaPromise<
		T extends runtime.Types.Utils.Record<"select", any>
			? T["select"] extends true
				? number
				: Prisma.GetScalarType<T["select"], LicenseInfoCountAggregateOutputType>
			: number
	>;
	aggregate<T extends LicenseInfoAggregateArgs>(
		args: Prisma.Subset<T, LicenseInfoAggregateArgs>,
	): Prisma.PrismaPromise<GetLicenseInfoAggregateType<T>>;
	groupBy<
		T extends LicenseInfoGroupByArgs,
		HasSelectOrTake extends Prisma.Or<
			Prisma.Extends<"skip", Prisma.Keys<T>>,
			Prisma.Extends<"take", Prisma.Keys<T>>
		>,
		OrderByArg extends Prisma.True extends HasSelectOrTake
			? {
					orderBy: LicenseInfoGroupByArgs["orderBy"];
				}
			: {
					orderBy?: LicenseInfoGroupByArgs["orderBy"];
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
		args: Prisma.SubsetIntersection<T, LicenseInfoGroupByArgs, OrderByArg> &
			InputErrors,
	): {} extends InputErrors
		? GetLicenseInfoGroupByPayload<T>
		: Prisma.PrismaPromise<InputErrors>;
	readonly fields: LicenseInfoFieldRefs;
}
export interface Prisma__LicenseInfoClient<
	T,
	Null = never,
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
	GlobalOmitOptions = {},
> extends Prisma.PrismaPromise<T> {
	readonly [Symbol.toStringTag]: "PrismaPromise";
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
export interface LicenseInfoFieldRefs {
	readonly id: Prisma.FieldRef<"LicenseInfo", "String">;
	readonly licenseKey: Prisma.FieldRef<"LicenseInfo", "String">;
	readonly licenseType: Prisma.FieldRef<"LicenseInfo", "String">;
	readonly tier: Prisma.FieldRef<"LicenseInfo", "String">;
	readonly validUntil: Prisma.FieldRef<"LicenseInfo", "DateTime">;
	readonly activatedAt: Prisma.FieldRef<"LicenseInfo", "DateTime">;
	readonly lastValidated: Prisma.FieldRef<"LicenseInfo", "DateTime">;
	readonly features: Prisma.FieldRef<"LicenseInfo", "String">;
	readonly quotas: Prisma.FieldRef<"LicenseInfo", "String">;
	readonly billingCycle: Prisma.FieldRef<"LicenseInfo", "String">;
	readonly seats: Prisma.FieldRef<"LicenseInfo", "Int">;
	readonly cloudInstanceId: Prisma.FieldRef<"LicenseInfo", "String">;
	readonly isCloudManaged: Prisma.FieldRef<"LicenseInfo", "Boolean">;
	readonly customerEmail: Prisma.FieldRef<"LicenseInfo", "String">;
	readonly customerName: Prisma.FieldRef<"LicenseInfo", "String">;
	readonly metadata: Prisma.FieldRef<"LicenseInfo", "String">;
	readonly createdAt: Prisma.FieldRef<"LicenseInfo", "DateTime">;
	readonly updatedAt: Prisma.FieldRef<"LicenseInfo", "DateTime">;
}
export type LicenseInfoFindUniqueArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	select?: Prisma.LicenseInfoSelect<ExtArgs> | null;
	omit?: Prisma.LicenseInfoOmit<ExtArgs> | null;
	where: Prisma.LicenseInfoWhereUniqueInput;
};
export type LicenseInfoFindUniqueOrThrowArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	select?: Prisma.LicenseInfoSelect<ExtArgs> | null;
	omit?: Prisma.LicenseInfoOmit<ExtArgs> | null;
	where: Prisma.LicenseInfoWhereUniqueInput;
};
export type LicenseInfoFindFirstArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	select?: Prisma.LicenseInfoSelect<ExtArgs> | null;
	omit?: Prisma.LicenseInfoOmit<ExtArgs> | null;
	where?: Prisma.LicenseInfoWhereInput;
	orderBy?:
		| Prisma.LicenseInfoOrderByWithRelationInput
		| Prisma.LicenseInfoOrderByWithRelationInput[];
	cursor?: Prisma.LicenseInfoWhereUniqueInput;
	take?: number;
	skip?: number;
	distinct?:
		| Prisma.LicenseInfoScalarFieldEnum
		| Prisma.LicenseInfoScalarFieldEnum[];
};
export type LicenseInfoFindFirstOrThrowArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	select?: Prisma.LicenseInfoSelect<ExtArgs> | null;
	omit?: Prisma.LicenseInfoOmit<ExtArgs> | null;
	where?: Prisma.LicenseInfoWhereInput;
	orderBy?:
		| Prisma.LicenseInfoOrderByWithRelationInput
		| Prisma.LicenseInfoOrderByWithRelationInput[];
	cursor?: Prisma.LicenseInfoWhereUniqueInput;
	take?: number;
	skip?: number;
	distinct?:
		| Prisma.LicenseInfoScalarFieldEnum
		| Prisma.LicenseInfoScalarFieldEnum[];
};
export type LicenseInfoFindManyArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	select?: Prisma.LicenseInfoSelect<ExtArgs> | null;
	omit?: Prisma.LicenseInfoOmit<ExtArgs> | null;
	where?: Prisma.LicenseInfoWhereInput;
	orderBy?:
		| Prisma.LicenseInfoOrderByWithRelationInput
		| Prisma.LicenseInfoOrderByWithRelationInput[];
	cursor?: Prisma.LicenseInfoWhereUniqueInput;
	take?: number;
	skip?: number;
	distinct?:
		| Prisma.LicenseInfoScalarFieldEnum
		| Prisma.LicenseInfoScalarFieldEnum[];
};
export type LicenseInfoCreateArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	select?: Prisma.LicenseInfoSelect<ExtArgs> | null;
	omit?: Prisma.LicenseInfoOmit<ExtArgs> | null;
	data: Prisma.XOR<
		Prisma.LicenseInfoCreateInput,
		Prisma.LicenseInfoUncheckedCreateInput
	>;
};
export type LicenseInfoCreateManyArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	data: Prisma.LicenseInfoCreateManyInput | Prisma.LicenseInfoCreateManyInput[];
};
export type LicenseInfoCreateManyAndReturnArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	select?: Prisma.LicenseInfoSelectCreateManyAndReturn<ExtArgs> | null;
	omit?: Prisma.LicenseInfoOmit<ExtArgs> | null;
	data: Prisma.LicenseInfoCreateManyInput | Prisma.LicenseInfoCreateManyInput[];
};
export type LicenseInfoUpdateArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	select?: Prisma.LicenseInfoSelect<ExtArgs> | null;
	omit?: Prisma.LicenseInfoOmit<ExtArgs> | null;
	data: Prisma.XOR<
		Prisma.LicenseInfoUpdateInput,
		Prisma.LicenseInfoUncheckedUpdateInput
	>;
	where: Prisma.LicenseInfoWhereUniqueInput;
};
export type LicenseInfoUpdateManyArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	data: Prisma.XOR<
		Prisma.LicenseInfoUpdateManyMutationInput,
		Prisma.LicenseInfoUncheckedUpdateManyInput
	>;
	where?: Prisma.LicenseInfoWhereInput;
	limit?: number;
};
export type LicenseInfoUpdateManyAndReturnArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	select?: Prisma.LicenseInfoSelectUpdateManyAndReturn<ExtArgs> | null;
	omit?: Prisma.LicenseInfoOmit<ExtArgs> | null;
	data: Prisma.XOR<
		Prisma.LicenseInfoUpdateManyMutationInput,
		Prisma.LicenseInfoUncheckedUpdateManyInput
	>;
	where?: Prisma.LicenseInfoWhereInput;
	limit?: number;
};
export type LicenseInfoUpsertArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	select?: Prisma.LicenseInfoSelect<ExtArgs> | null;
	omit?: Prisma.LicenseInfoOmit<ExtArgs> | null;
	where: Prisma.LicenseInfoWhereUniqueInput;
	create: Prisma.XOR<
		Prisma.LicenseInfoCreateInput,
		Prisma.LicenseInfoUncheckedCreateInput
	>;
	update: Prisma.XOR<
		Prisma.LicenseInfoUpdateInput,
		Prisma.LicenseInfoUncheckedUpdateInput
	>;
};
export type LicenseInfoDeleteArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	select?: Prisma.LicenseInfoSelect<ExtArgs> | null;
	omit?: Prisma.LicenseInfoOmit<ExtArgs> | null;
	where: Prisma.LicenseInfoWhereUniqueInput;
};
export type LicenseInfoDeleteManyArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	where?: Prisma.LicenseInfoWhereInput;
	limit?: number;
};
export type LicenseInfoDefaultArgs<
	ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> = {
	select?: Prisma.LicenseInfoSelect<ExtArgs> | null;
	omit?: Prisma.LicenseInfoOmit<ExtArgs> | null;
};
