import type * as runtime from "@prisma/client/runtime/client";
import type * as Prisma from "../internal/prismaNamespace.js";
export type AlertMappingRuleModel = runtime.Types.Result.DefaultSelection<Prisma.$AlertMappingRulePayload>;
export type AggregateAlertMappingRule = {
    _count: AlertMappingRuleCountAggregateOutputType | null;
    _avg: AlertMappingRuleAvgAggregateOutputType | null;
    _sum: AlertMappingRuleSumAggregateOutputType | null;
    _min: AlertMappingRuleMinAggregateOutputType | null;
    _max: AlertMappingRuleMaxAggregateOutputType | null;
};
export type AlertMappingRuleAvgAggregateOutputType = {
    priority: number | null;
};
export type AlertMappingRuleSumAggregateOutputType = {
    priority: number | null;
};
export type AlertMappingRuleMinAggregateOutputType = {
    id: string | null;
    name: string | null;
    description: string | null;
    priority: number | null;
    enabled: boolean | null;
    matchCriteria: string | null;
    serviceId: string | null;
    createdAt: Date | null;
    updatedAt: Date | null;
};
export type AlertMappingRuleMaxAggregateOutputType = {
    id: string | null;
    name: string | null;
    description: string | null;
    priority: number | null;
    enabled: boolean | null;
    matchCriteria: string | null;
    serviceId: string | null;
    createdAt: Date | null;
    updatedAt: Date | null;
};
export type AlertMappingRuleCountAggregateOutputType = {
    id: number;
    name: number;
    description: number;
    priority: number;
    enabled: number;
    matchCriteria: number;
    serviceId: number;
    createdAt: number;
    updatedAt: number;
    _all: number;
};
export type AlertMappingRuleAvgAggregateInputType = {
    priority?: true;
};
export type AlertMappingRuleSumAggregateInputType = {
    priority?: true;
};
export type AlertMappingRuleMinAggregateInputType = {
    id?: true;
    name?: true;
    description?: true;
    priority?: true;
    enabled?: true;
    matchCriteria?: true;
    serviceId?: true;
    createdAt?: true;
    updatedAt?: true;
};
export type AlertMappingRuleMaxAggregateInputType = {
    id?: true;
    name?: true;
    description?: true;
    priority?: true;
    enabled?: true;
    matchCriteria?: true;
    serviceId?: true;
    createdAt?: true;
    updatedAt?: true;
};
export type AlertMappingRuleCountAggregateInputType = {
    id?: true;
    name?: true;
    description?: true;
    priority?: true;
    enabled?: true;
    matchCriteria?: true;
    serviceId?: true;
    createdAt?: true;
    updatedAt?: true;
    _all?: true;
};
export type AlertMappingRuleAggregateArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    where?: Prisma.AlertMappingRuleWhereInput;
    orderBy?: Prisma.AlertMappingRuleOrderByWithRelationInput | Prisma.AlertMappingRuleOrderByWithRelationInput[];
    cursor?: Prisma.AlertMappingRuleWhereUniqueInput;
    take?: number;
    skip?: number;
    _count?: true | AlertMappingRuleCountAggregateInputType;
    _avg?: AlertMappingRuleAvgAggregateInputType;
    _sum?: AlertMappingRuleSumAggregateInputType;
    _min?: AlertMappingRuleMinAggregateInputType;
    _max?: AlertMappingRuleMaxAggregateInputType;
};
export type GetAlertMappingRuleAggregateType<T extends AlertMappingRuleAggregateArgs> = {
    [P in keyof T & keyof AggregateAlertMappingRule]: P extends '_count' | 'count' ? T[P] extends true ? number : Prisma.GetScalarType<T[P], AggregateAlertMappingRule[P]> : Prisma.GetScalarType<T[P], AggregateAlertMappingRule[P]>;
};
export type AlertMappingRuleGroupByArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    where?: Prisma.AlertMappingRuleWhereInput;
    orderBy?: Prisma.AlertMappingRuleOrderByWithAggregationInput | Prisma.AlertMappingRuleOrderByWithAggregationInput[];
    by: Prisma.AlertMappingRuleScalarFieldEnum[] | Prisma.AlertMappingRuleScalarFieldEnum;
    having?: Prisma.AlertMappingRuleScalarWhereWithAggregatesInput;
    take?: number;
    skip?: number;
    _count?: AlertMappingRuleCountAggregateInputType | true;
    _avg?: AlertMappingRuleAvgAggregateInputType;
    _sum?: AlertMappingRuleSumAggregateInputType;
    _min?: AlertMappingRuleMinAggregateInputType;
    _max?: AlertMappingRuleMaxAggregateInputType;
};
export type AlertMappingRuleGroupByOutputType = {
    id: string;
    name: string;
    description: string | null;
    priority: number;
    enabled: boolean;
    matchCriteria: string;
    serviceId: string;
    createdAt: Date;
    updatedAt: Date;
    _count: AlertMappingRuleCountAggregateOutputType | null;
    _avg: AlertMappingRuleAvgAggregateOutputType | null;
    _sum: AlertMappingRuleSumAggregateOutputType | null;
    _min: AlertMappingRuleMinAggregateOutputType | null;
    _max: AlertMappingRuleMaxAggregateOutputType | null;
};
type GetAlertMappingRuleGroupByPayload<T extends AlertMappingRuleGroupByArgs> = Prisma.PrismaPromise<Array<Prisma.PickEnumerable<AlertMappingRuleGroupByOutputType, T['by']> & {
    [P in ((keyof T) & (keyof AlertMappingRuleGroupByOutputType))]: P extends '_count' ? T[P] extends boolean ? number : Prisma.GetScalarType<T[P], AlertMappingRuleGroupByOutputType[P]> : Prisma.GetScalarType<T[P], AlertMappingRuleGroupByOutputType[P]>;
}>>;
export type AlertMappingRuleWhereInput = {
    AND?: Prisma.AlertMappingRuleWhereInput | Prisma.AlertMappingRuleWhereInput[];
    OR?: Prisma.AlertMappingRuleWhereInput[];
    NOT?: Prisma.AlertMappingRuleWhereInput | Prisma.AlertMappingRuleWhereInput[];
    id?: Prisma.StringFilter<"AlertMappingRule"> | string;
    name?: Prisma.StringFilter<"AlertMappingRule"> | string;
    description?: Prisma.StringNullableFilter<"AlertMappingRule"> | string | null;
    priority?: Prisma.IntFilter<"AlertMappingRule"> | number;
    enabled?: Prisma.BoolFilter<"AlertMappingRule"> | boolean;
    matchCriteria?: Prisma.StringFilter<"AlertMappingRule"> | string;
    serviceId?: Prisma.StringFilter<"AlertMappingRule"> | string;
    createdAt?: Prisma.DateTimeFilter<"AlertMappingRule"> | Date | string;
    updatedAt?: Prisma.DateTimeFilter<"AlertMappingRule"> | Date | string;
    service?: Prisma.XOR<Prisma.ServiceScalarRelationFilter, Prisma.ServiceWhereInput>;
};
export type AlertMappingRuleOrderByWithRelationInput = {
    id?: Prisma.SortOrder;
    name?: Prisma.SortOrder;
    description?: Prisma.SortOrderInput | Prisma.SortOrder;
    priority?: Prisma.SortOrder;
    enabled?: Prisma.SortOrder;
    matchCriteria?: Prisma.SortOrder;
    serviceId?: Prisma.SortOrder;
    createdAt?: Prisma.SortOrder;
    updatedAt?: Prisma.SortOrder;
    service?: Prisma.ServiceOrderByWithRelationInput;
};
export type AlertMappingRuleWhereUniqueInput = Prisma.AtLeast<{
    id?: string;
    AND?: Prisma.AlertMappingRuleWhereInput | Prisma.AlertMappingRuleWhereInput[];
    OR?: Prisma.AlertMappingRuleWhereInput[];
    NOT?: Prisma.AlertMappingRuleWhereInput | Prisma.AlertMappingRuleWhereInput[];
    name?: Prisma.StringFilter<"AlertMappingRule"> | string;
    description?: Prisma.StringNullableFilter<"AlertMappingRule"> | string | null;
    priority?: Prisma.IntFilter<"AlertMappingRule"> | number;
    enabled?: Prisma.BoolFilter<"AlertMappingRule"> | boolean;
    matchCriteria?: Prisma.StringFilter<"AlertMappingRule"> | string;
    serviceId?: Prisma.StringFilter<"AlertMappingRule"> | string;
    createdAt?: Prisma.DateTimeFilter<"AlertMappingRule"> | Date | string;
    updatedAt?: Prisma.DateTimeFilter<"AlertMappingRule"> | Date | string;
    service?: Prisma.XOR<Prisma.ServiceScalarRelationFilter, Prisma.ServiceWhereInput>;
}, "id">;
export type AlertMappingRuleOrderByWithAggregationInput = {
    id?: Prisma.SortOrder;
    name?: Prisma.SortOrder;
    description?: Prisma.SortOrderInput | Prisma.SortOrder;
    priority?: Prisma.SortOrder;
    enabled?: Prisma.SortOrder;
    matchCriteria?: Prisma.SortOrder;
    serviceId?: Prisma.SortOrder;
    createdAt?: Prisma.SortOrder;
    updatedAt?: Prisma.SortOrder;
    _count?: Prisma.AlertMappingRuleCountOrderByAggregateInput;
    _avg?: Prisma.AlertMappingRuleAvgOrderByAggregateInput;
    _max?: Prisma.AlertMappingRuleMaxOrderByAggregateInput;
    _min?: Prisma.AlertMappingRuleMinOrderByAggregateInput;
    _sum?: Prisma.AlertMappingRuleSumOrderByAggregateInput;
};
export type AlertMappingRuleScalarWhereWithAggregatesInput = {
    AND?: Prisma.AlertMappingRuleScalarWhereWithAggregatesInput | Prisma.AlertMappingRuleScalarWhereWithAggregatesInput[];
    OR?: Prisma.AlertMappingRuleScalarWhereWithAggregatesInput[];
    NOT?: Prisma.AlertMappingRuleScalarWhereWithAggregatesInput | Prisma.AlertMappingRuleScalarWhereWithAggregatesInput[];
    id?: Prisma.StringWithAggregatesFilter<"AlertMappingRule"> | string;
    name?: Prisma.StringWithAggregatesFilter<"AlertMappingRule"> | string;
    description?: Prisma.StringNullableWithAggregatesFilter<"AlertMappingRule"> | string | null;
    priority?: Prisma.IntWithAggregatesFilter<"AlertMappingRule"> | number;
    enabled?: Prisma.BoolWithAggregatesFilter<"AlertMappingRule"> | boolean;
    matchCriteria?: Prisma.StringWithAggregatesFilter<"AlertMappingRule"> | string;
    serviceId?: Prisma.StringWithAggregatesFilter<"AlertMappingRule"> | string;
    createdAt?: Prisma.DateTimeWithAggregatesFilter<"AlertMappingRule"> | Date | string;
    updatedAt?: Prisma.DateTimeWithAggregatesFilter<"AlertMappingRule"> | Date | string;
};
export type AlertMappingRuleCreateInput = {
    id?: string;
    name: string;
    description?: string | null;
    priority?: number;
    enabled?: boolean;
    matchCriteria: string;
    createdAt?: Date | string;
    updatedAt?: Date | string;
    service: Prisma.ServiceCreateNestedOneWithoutAlertMappingRulesInput;
};
export type AlertMappingRuleUncheckedCreateInput = {
    id?: string;
    name: string;
    description?: string | null;
    priority?: number;
    enabled?: boolean;
    matchCriteria: string;
    serviceId: string;
    createdAt?: Date | string;
    updatedAt?: Date | string;
};
export type AlertMappingRuleUpdateInput = {
    id?: Prisma.StringFieldUpdateOperationsInput | string;
    name?: Prisma.StringFieldUpdateOperationsInput | string;
    description?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
    priority?: Prisma.IntFieldUpdateOperationsInput | number;
    enabled?: Prisma.BoolFieldUpdateOperationsInput | boolean;
    matchCriteria?: Prisma.StringFieldUpdateOperationsInput | string;
    createdAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
    updatedAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
    service?: Prisma.ServiceUpdateOneRequiredWithoutAlertMappingRulesNestedInput;
};
export type AlertMappingRuleUncheckedUpdateInput = {
    id?: Prisma.StringFieldUpdateOperationsInput | string;
    name?: Prisma.StringFieldUpdateOperationsInput | string;
    description?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
    priority?: Prisma.IntFieldUpdateOperationsInput | number;
    enabled?: Prisma.BoolFieldUpdateOperationsInput | boolean;
    matchCriteria?: Prisma.StringFieldUpdateOperationsInput | string;
    serviceId?: Prisma.StringFieldUpdateOperationsInput | string;
    createdAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
    updatedAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
};
export type AlertMappingRuleCreateManyInput = {
    id?: string;
    name: string;
    description?: string | null;
    priority?: number;
    enabled?: boolean;
    matchCriteria: string;
    serviceId: string;
    createdAt?: Date | string;
    updatedAt?: Date | string;
};
export type AlertMappingRuleUpdateManyMutationInput = {
    id?: Prisma.StringFieldUpdateOperationsInput | string;
    name?: Prisma.StringFieldUpdateOperationsInput | string;
    description?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
    priority?: Prisma.IntFieldUpdateOperationsInput | number;
    enabled?: Prisma.BoolFieldUpdateOperationsInput | boolean;
    matchCriteria?: Prisma.StringFieldUpdateOperationsInput | string;
    createdAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
    updatedAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
};
export type AlertMappingRuleUncheckedUpdateManyInput = {
    id?: Prisma.StringFieldUpdateOperationsInput | string;
    name?: Prisma.StringFieldUpdateOperationsInput | string;
    description?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
    priority?: Prisma.IntFieldUpdateOperationsInput | number;
    enabled?: Prisma.BoolFieldUpdateOperationsInput | boolean;
    matchCriteria?: Prisma.StringFieldUpdateOperationsInput | string;
    serviceId?: Prisma.StringFieldUpdateOperationsInput | string;
    createdAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
    updatedAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
};
export type AlertMappingRuleListRelationFilter = {
    every?: Prisma.AlertMappingRuleWhereInput;
    some?: Prisma.AlertMappingRuleWhereInput;
    none?: Prisma.AlertMappingRuleWhereInput;
};
export type AlertMappingRuleOrderByRelationAggregateInput = {
    _count?: Prisma.SortOrder;
};
export type AlertMappingRuleCountOrderByAggregateInput = {
    id?: Prisma.SortOrder;
    name?: Prisma.SortOrder;
    description?: Prisma.SortOrder;
    priority?: Prisma.SortOrder;
    enabled?: Prisma.SortOrder;
    matchCriteria?: Prisma.SortOrder;
    serviceId?: Prisma.SortOrder;
    createdAt?: Prisma.SortOrder;
    updatedAt?: Prisma.SortOrder;
};
export type AlertMappingRuleAvgOrderByAggregateInput = {
    priority?: Prisma.SortOrder;
};
export type AlertMappingRuleMaxOrderByAggregateInput = {
    id?: Prisma.SortOrder;
    name?: Prisma.SortOrder;
    description?: Prisma.SortOrder;
    priority?: Prisma.SortOrder;
    enabled?: Prisma.SortOrder;
    matchCriteria?: Prisma.SortOrder;
    serviceId?: Prisma.SortOrder;
    createdAt?: Prisma.SortOrder;
    updatedAt?: Prisma.SortOrder;
};
export type AlertMappingRuleMinOrderByAggregateInput = {
    id?: Prisma.SortOrder;
    name?: Prisma.SortOrder;
    description?: Prisma.SortOrder;
    priority?: Prisma.SortOrder;
    enabled?: Prisma.SortOrder;
    matchCriteria?: Prisma.SortOrder;
    serviceId?: Prisma.SortOrder;
    createdAt?: Prisma.SortOrder;
    updatedAt?: Prisma.SortOrder;
};
export type AlertMappingRuleSumOrderByAggregateInput = {
    priority?: Prisma.SortOrder;
};
export type AlertMappingRuleCreateNestedManyWithoutServiceInput = {
    create?: Prisma.XOR<Prisma.AlertMappingRuleCreateWithoutServiceInput, Prisma.AlertMappingRuleUncheckedCreateWithoutServiceInput> | Prisma.AlertMappingRuleCreateWithoutServiceInput[] | Prisma.AlertMappingRuleUncheckedCreateWithoutServiceInput[];
    connectOrCreate?: Prisma.AlertMappingRuleCreateOrConnectWithoutServiceInput | Prisma.AlertMappingRuleCreateOrConnectWithoutServiceInput[];
    createMany?: Prisma.AlertMappingRuleCreateManyServiceInputEnvelope;
    connect?: Prisma.AlertMappingRuleWhereUniqueInput | Prisma.AlertMappingRuleWhereUniqueInput[];
};
export type AlertMappingRuleUncheckedCreateNestedManyWithoutServiceInput = {
    create?: Prisma.XOR<Prisma.AlertMappingRuleCreateWithoutServiceInput, Prisma.AlertMappingRuleUncheckedCreateWithoutServiceInput> | Prisma.AlertMappingRuleCreateWithoutServiceInput[] | Prisma.AlertMappingRuleUncheckedCreateWithoutServiceInput[];
    connectOrCreate?: Prisma.AlertMappingRuleCreateOrConnectWithoutServiceInput | Prisma.AlertMappingRuleCreateOrConnectWithoutServiceInput[];
    createMany?: Prisma.AlertMappingRuleCreateManyServiceInputEnvelope;
    connect?: Prisma.AlertMappingRuleWhereUniqueInput | Prisma.AlertMappingRuleWhereUniqueInput[];
};
export type AlertMappingRuleUpdateManyWithoutServiceNestedInput = {
    create?: Prisma.XOR<Prisma.AlertMappingRuleCreateWithoutServiceInput, Prisma.AlertMappingRuleUncheckedCreateWithoutServiceInput> | Prisma.AlertMappingRuleCreateWithoutServiceInput[] | Prisma.AlertMappingRuleUncheckedCreateWithoutServiceInput[];
    connectOrCreate?: Prisma.AlertMappingRuleCreateOrConnectWithoutServiceInput | Prisma.AlertMappingRuleCreateOrConnectWithoutServiceInput[];
    upsert?: Prisma.AlertMappingRuleUpsertWithWhereUniqueWithoutServiceInput | Prisma.AlertMappingRuleUpsertWithWhereUniqueWithoutServiceInput[];
    createMany?: Prisma.AlertMappingRuleCreateManyServiceInputEnvelope;
    set?: Prisma.AlertMappingRuleWhereUniqueInput | Prisma.AlertMappingRuleWhereUniqueInput[];
    disconnect?: Prisma.AlertMappingRuleWhereUniqueInput | Prisma.AlertMappingRuleWhereUniqueInput[];
    delete?: Prisma.AlertMappingRuleWhereUniqueInput | Prisma.AlertMappingRuleWhereUniqueInput[];
    connect?: Prisma.AlertMappingRuleWhereUniqueInput | Prisma.AlertMappingRuleWhereUniqueInput[];
    update?: Prisma.AlertMappingRuleUpdateWithWhereUniqueWithoutServiceInput | Prisma.AlertMappingRuleUpdateWithWhereUniqueWithoutServiceInput[];
    updateMany?: Prisma.AlertMappingRuleUpdateManyWithWhereWithoutServiceInput | Prisma.AlertMappingRuleUpdateManyWithWhereWithoutServiceInput[];
    deleteMany?: Prisma.AlertMappingRuleScalarWhereInput | Prisma.AlertMappingRuleScalarWhereInput[];
};
export type AlertMappingRuleUncheckedUpdateManyWithoutServiceNestedInput = {
    create?: Prisma.XOR<Prisma.AlertMappingRuleCreateWithoutServiceInput, Prisma.AlertMappingRuleUncheckedCreateWithoutServiceInput> | Prisma.AlertMappingRuleCreateWithoutServiceInput[] | Prisma.AlertMappingRuleUncheckedCreateWithoutServiceInput[];
    connectOrCreate?: Prisma.AlertMappingRuleCreateOrConnectWithoutServiceInput | Prisma.AlertMappingRuleCreateOrConnectWithoutServiceInput[];
    upsert?: Prisma.AlertMappingRuleUpsertWithWhereUniqueWithoutServiceInput | Prisma.AlertMappingRuleUpsertWithWhereUniqueWithoutServiceInput[];
    createMany?: Prisma.AlertMappingRuleCreateManyServiceInputEnvelope;
    set?: Prisma.AlertMappingRuleWhereUniqueInput | Prisma.AlertMappingRuleWhereUniqueInput[];
    disconnect?: Prisma.AlertMappingRuleWhereUniqueInput | Prisma.AlertMappingRuleWhereUniqueInput[];
    delete?: Prisma.AlertMappingRuleWhereUniqueInput | Prisma.AlertMappingRuleWhereUniqueInput[];
    connect?: Prisma.AlertMappingRuleWhereUniqueInput | Prisma.AlertMappingRuleWhereUniqueInput[];
    update?: Prisma.AlertMappingRuleUpdateWithWhereUniqueWithoutServiceInput | Prisma.AlertMappingRuleUpdateWithWhereUniqueWithoutServiceInput[];
    updateMany?: Prisma.AlertMappingRuleUpdateManyWithWhereWithoutServiceInput | Prisma.AlertMappingRuleUpdateManyWithWhereWithoutServiceInput[];
    deleteMany?: Prisma.AlertMappingRuleScalarWhereInput | Prisma.AlertMappingRuleScalarWhereInput[];
};
export type AlertMappingRuleCreateWithoutServiceInput = {
    id?: string;
    name: string;
    description?: string | null;
    priority?: number;
    enabled?: boolean;
    matchCriteria: string;
    createdAt?: Date | string;
    updatedAt?: Date | string;
};
export type AlertMappingRuleUncheckedCreateWithoutServiceInput = {
    id?: string;
    name: string;
    description?: string | null;
    priority?: number;
    enabled?: boolean;
    matchCriteria: string;
    createdAt?: Date | string;
    updatedAt?: Date | string;
};
export type AlertMappingRuleCreateOrConnectWithoutServiceInput = {
    where: Prisma.AlertMappingRuleWhereUniqueInput;
    create: Prisma.XOR<Prisma.AlertMappingRuleCreateWithoutServiceInput, Prisma.AlertMappingRuleUncheckedCreateWithoutServiceInput>;
};
export type AlertMappingRuleCreateManyServiceInputEnvelope = {
    data: Prisma.AlertMappingRuleCreateManyServiceInput | Prisma.AlertMappingRuleCreateManyServiceInput[];
};
export type AlertMappingRuleUpsertWithWhereUniqueWithoutServiceInput = {
    where: Prisma.AlertMappingRuleWhereUniqueInput;
    update: Prisma.XOR<Prisma.AlertMappingRuleUpdateWithoutServiceInput, Prisma.AlertMappingRuleUncheckedUpdateWithoutServiceInput>;
    create: Prisma.XOR<Prisma.AlertMappingRuleCreateWithoutServiceInput, Prisma.AlertMappingRuleUncheckedCreateWithoutServiceInput>;
};
export type AlertMappingRuleUpdateWithWhereUniqueWithoutServiceInput = {
    where: Prisma.AlertMappingRuleWhereUniqueInput;
    data: Prisma.XOR<Prisma.AlertMappingRuleUpdateWithoutServiceInput, Prisma.AlertMappingRuleUncheckedUpdateWithoutServiceInput>;
};
export type AlertMappingRuleUpdateManyWithWhereWithoutServiceInput = {
    where: Prisma.AlertMappingRuleScalarWhereInput;
    data: Prisma.XOR<Prisma.AlertMappingRuleUpdateManyMutationInput, Prisma.AlertMappingRuleUncheckedUpdateManyWithoutServiceInput>;
};
export type AlertMappingRuleScalarWhereInput = {
    AND?: Prisma.AlertMappingRuleScalarWhereInput | Prisma.AlertMappingRuleScalarWhereInput[];
    OR?: Prisma.AlertMappingRuleScalarWhereInput[];
    NOT?: Prisma.AlertMappingRuleScalarWhereInput | Prisma.AlertMappingRuleScalarWhereInput[];
    id?: Prisma.StringFilter<"AlertMappingRule"> | string;
    name?: Prisma.StringFilter<"AlertMappingRule"> | string;
    description?: Prisma.StringNullableFilter<"AlertMappingRule"> | string | null;
    priority?: Prisma.IntFilter<"AlertMappingRule"> | number;
    enabled?: Prisma.BoolFilter<"AlertMappingRule"> | boolean;
    matchCriteria?: Prisma.StringFilter<"AlertMappingRule"> | string;
    serviceId?: Prisma.StringFilter<"AlertMappingRule"> | string;
    createdAt?: Prisma.DateTimeFilter<"AlertMappingRule"> | Date | string;
    updatedAt?: Prisma.DateTimeFilter<"AlertMappingRule"> | Date | string;
};
export type AlertMappingRuleCreateManyServiceInput = {
    id?: string;
    name: string;
    description?: string | null;
    priority?: number;
    enabled?: boolean;
    matchCriteria: string;
    createdAt?: Date | string;
    updatedAt?: Date | string;
};
export type AlertMappingRuleUpdateWithoutServiceInput = {
    id?: Prisma.StringFieldUpdateOperationsInput | string;
    name?: Prisma.StringFieldUpdateOperationsInput | string;
    description?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
    priority?: Prisma.IntFieldUpdateOperationsInput | number;
    enabled?: Prisma.BoolFieldUpdateOperationsInput | boolean;
    matchCriteria?: Prisma.StringFieldUpdateOperationsInput | string;
    createdAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
    updatedAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
};
export type AlertMappingRuleUncheckedUpdateWithoutServiceInput = {
    id?: Prisma.StringFieldUpdateOperationsInput | string;
    name?: Prisma.StringFieldUpdateOperationsInput | string;
    description?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
    priority?: Prisma.IntFieldUpdateOperationsInput | number;
    enabled?: Prisma.BoolFieldUpdateOperationsInput | boolean;
    matchCriteria?: Prisma.StringFieldUpdateOperationsInput | string;
    createdAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
    updatedAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
};
export type AlertMappingRuleUncheckedUpdateManyWithoutServiceInput = {
    id?: Prisma.StringFieldUpdateOperationsInput | string;
    name?: Prisma.StringFieldUpdateOperationsInput | string;
    description?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
    priority?: Prisma.IntFieldUpdateOperationsInput | number;
    enabled?: Prisma.BoolFieldUpdateOperationsInput | boolean;
    matchCriteria?: Prisma.StringFieldUpdateOperationsInput | string;
    createdAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
    updatedAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
};
export type AlertMappingRuleSelect<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = runtime.Types.Extensions.GetSelect<{
    id?: boolean;
    name?: boolean;
    description?: boolean;
    priority?: boolean;
    enabled?: boolean;
    matchCriteria?: boolean;
    serviceId?: boolean;
    createdAt?: boolean;
    updatedAt?: boolean;
    service?: boolean | Prisma.ServiceDefaultArgs<ExtArgs>;
}, ExtArgs["result"]["alertMappingRule"]>;
export type AlertMappingRuleSelectCreateManyAndReturn<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = runtime.Types.Extensions.GetSelect<{
    id?: boolean;
    name?: boolean;
    description?: boolean;
    priority?: boolean;
    enabled?: boolean;
    matchCriteria?: boolean;
    serviceId?: boolean;
    createdAt?: boolean;
    updatedAt?: boolean;
    service?: boolean | Prisma.ServiceDefaultArgs<ExtArgs>;
}, ExtArgs["result"]["alertMappingRule"]>;
export type AlertMappingRuleSelectUpdateManyAndReturn<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = runtime.Types.Extensions.GetSelect<{
    id?: boolean;
    name?: boolean;
    description?: boolean;
    priority?: boolean;
    enabled?: boolean;
    matchCriteria?: boolean;
    serviceId?: boolean;
    createdAt?: boolean;
    updatedAt?: boolean;
    service?: boolean | Prisma.ServiceDefaultArgs<ExtArgs>;
}, ExtArgs["result"]["alertMappingRule"]>;
export type AlertMappingRuleSelectScalar = {
    id?: boolean;
    name?: boolean;
    description?: boolean;
    priority?: boolean;
    enabled?: boolean;
    matchCriteria?: boolean;
    serviceId?: boolean;
    createdAt?: boolean;
    updatedAt?: boolean;
};
export type AlertMappingRuleOmit<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = runtime.Types.Extensions.GetOmit<"id" | "name" | "description" | "priority" | "enabled" | "matchCriteria" | "serviceId" | "createdAt" | "updatedAt", ExtArgs["result"]["alertMappingRule"]>;
export type AlertMappingRuleInclude<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    service?: boolean | Prisma.ServiceDefaultArgs<ExtArgs>;
};
export type AlertMappingRuleIncludeCreateManyAndReturn<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    service?: boolean | Prisma.ServiceDefaultArgs<ExtArgs>;
};
export type AlertMappingRuleIncludeUpdateManyAndReturn<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    service?: boolean | Prisma.ServiceDefaultArgs<ExtArgs>;
};
export type $AlertMappingRulePayload<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    name: "AlertMappingRule";
    objects: {
        service: Prisma.$ServicePayload<ExtArgs>;
    };
    scalars: runtime.Types.Extensions.GetPayloadResult<{
        id: string;
        name: string;
        description: string | null;
        priority: number;
        enabled: boolean;
        matchCriteria: string;
        serviceId: string;
        createdAt: Date;
        updatedAt: Date;
    }, ExtArgs["result"]["alertMappingRule"]>;
    composites: {};
};
export type AlertMappingRuleGetPayload<S extends boolean | null | undefined | AlertMappingRuleDefaultArgs> = runtime.Types.Result.GetResult<Prisma.$AlertMappingRulePayload, S>;
export type AlertMappingRuleCountArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = Omit<AlertMappingRuleFindManyArgs, 'select' | 'include' | 'distinct' | 'omit'> & {
    select?: AlertMappingRuleCountAggregateInputType | true;
};
export interface AlertMappingRuleDelegate<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs, GlobalOmitOptions = {}> {
    [K: symbol]: {
        types: Prisma.TypeMap<ExtArgs>['model']['AlertMappingRule'];
        meta: {
            name: 'AlertMappingRule';
        };
    };
    findUnique<T extends AlertMappingRuleFindUniqueArgs>(args: Prisma.SelectSubset<T, AlertMappingRuleFindUniqueArgs<ExtArgs>>): Prisma.Prisma__AlertMappingRuleClient<runtime.Types.Result.GetResult<Prisma.$AlertMappingRulePayload<ExtArgs>, T, "findUnique", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>;
    findUniqueOrThrow<T extends AlertMappingRuleFindUniqueOrThrowArgs>(args: Prisma.SelectSubset<T, AlertMappingRuleFindUniqueOrThrowArgs<ExtArgs>>): Prisma.Prisma__AlertMappingRuleClient<runtime.Types.Result.GetResult<Prisma.$AlertMappingRulePayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>;
    findFirst<T extends AlertMappingRuleFindFirstArgs>(args?: Prisma.SelectSubset<T, AlertMappingRuleFindFirstArgs<ExtArgs>>): Prisma.Prisma__AlertMappingRuleClient<runtime.Types.Result.GetResult<Prisma.$AlertMappingRulePayload<ExtArgs>, T, "findFirst", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>;
    findFirstOrThrow<T extends AlertMappingRuleFindFirstOrThrowArgs>(args?: Prisma.SelectSubset<T, AlertMappingRuleFindFirstOrThrowArgs<ExtArgs>>): Prisma.Prisma__AlertMappingRuleClient<runtime.Types.Result.GetResult<Prisma.$AlertMappingRulePayload<ExtArgs>, T, "findFirstOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>;
    findMany<T extends AlertMappingRuleFindManyArgs>(args?: Prisma.SelectSubset<T, AlertMappingRuleFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<runtime.Types.Result.GetResult<Prisma.$AlertMappingRulePayload<ExtArgs>, T, "findMany", GlobalOmitOptions>>;
    create<T extends AlertMappingRuleCreateArgs>(args: Prisma.SelectSubset<T, AlertMappingRuleCreateArgs<ExtArgs>>): Prisma.Prisma__AlertMappingRuleClient<runtime.Types.Result.GetResult<Prisma.$AlertMappingRulePayload<ExtArgs>, T, "create", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>;
    createMany<T extends AlertMappingRuleCreateManyArgs>(args?: Prisma.SelectSubset<T, AlertMappingRuleCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<Prisma.BatchPayload>;
    createManyAndReturn<T extends AlertMappingRuleCreateManyAndReturnArgs>(args?: Prisma.SelectSubset<T, AlertMappingRuleCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<runtime.Types.Result.GetResult<Prisma.$AlertMappingRulePayload<ExtArgs>, T, "createManyAndReturn", GlobalOmitOptions>>;
    delete<T extends AlertMappingRuleDeleteArgs>(args: Prisma.SelectSubset<T, AlertMappingRuleDeleteArgs<ExtArgs>>): Prisma.Prisma__AlertMappingRuleClient<runtime.Types.Result.GetResult<Prisma.$AlertMappingRulePayload<ExtArgs>, T, "delete", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>;
    update<T extends AlertMappingRuleUpdateArgs>(args: Prisma.SelectSubset<T, AlertMappingRuleUpdateArgs<ExtArgs>>): Prisma.Prisma__AlertMappingRuleClient<runtime.Types.Result.GetResult<Prisma.$AlertMappingRulePayload<ExtArgs>, T, "update", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>;
    deleteMany<T extends AlertMappingRuleDeleteManyArgs>(args?: Prisma.SelectSubset<T, AlertMappingRuleDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<Prisma.BatchPayload>;
    updateMany<T extends AlertMappingRuleUpdateManyArgs>(args: Prisma.SelectSubset<T, AlertMappingRuleUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<Prisma.BatchPayload>;
    updateManyAndReturn<T extends AlertMappingRuleUpdateManyAndReturnArgs>(args: Prisma.SelectSubset<T, AlertMappingRuleUpdateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<runtime.Types.Result.GetResult<Prisma.$AlertMappingRulePayload<ExtArgs>, T, "updateManyAndReturn", GlobalOmitOptions>>;
    upsert<T extends AlertMappingRuleUpsertArgs>(args: Prisma.SelectSubset<T, AlertMappingRuleUpsertArgs<ExtArgs>>): Prisma.Prisma__AlertMappingRuleClient<runtime.Types.Result.GetResult<Prisma.$AlertMappingRulePayload<ExtArgs>, T, "upsert", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>;
    count<T extends AlertMappingRuleCountArgs>(args?: Prisma.Subset<T, AlertMappingRuleCountArgs>): Prisma.PrismaPromise<T extends runtime.Types.Utils.Record<'select', any> ? T['select'] extends true ? number : Prisma.GetScalarType<T['select'], AlertMappingRuleCountAggregateOutputType> : number>;
    aggregate<T extends AlertMappingRuleAggregateArgs>(args: Prisma.Subset<T, AlertMappingRuleAggregateArgs>): Prisma.PrismaPromise<GetAlertMappingRuleAggregateType<T>>;
    groupBy<T extends AlertMappingRuleGroupByArgs, HasSelectOrTake extends Prisma.Or<Prisma.Extends<'skip', Prisma.Keys<T>>, Prisma.Extends<'take', Prisma.Keys<T>>>, OrderByArg extends Prisma.True extends HasSelectOrTake ? {
        orderBy: AlertMappingRuleGroupByArgs['orderBy'];
    } : {
        orderBy?: AlertMappingRuleGroupByArgs['orderBy'];
    }, OrderFields extends Prisma.ExcludeUnderscoreKeys<Prisma.Keys<Prisma.MaybeTupleToUnion<T['orderBy']>>>, ByFields extends Prisma.MaybeTupleToUnion<T['by']>, ByValid extends Prisma.Has<ByFields, OrderFields>, HavingFields extends Prisma.GetHavingFields<T['having']>, HavingValid extends Prisma.Has<ByFields, HavingFields>, ByEmpty extends T['by'] extends never[] ? Prisma.True : Prisma.False, InputErrors extends ByEmpty extends Prisma.True ? `Error: "by" must not be empty.` : HavingValid extends Prisma.False ? {
        [P in HavingFields]: P extends ByFields ? never : P extends string ? `Error: Field "${P}" used in "having" needs to be provided in "by".` : [
            Error,
            'Field ',
            P,
            ` in "having" needs to be provided in "by"`
        ];
    }[HavingFields] : 'take' extends Prisma.Keys<T> ? 'orderBy' extends Prisma.Keys<T> ? ByValid extends Prisma.True ? {} : {
        [P in OrderFields]: P extends ByFields ? never : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`;
    }[OrderFields] : 'Error: If you provide "take", you also need to provide "orderBy"' : 'skip' extends Prisma.Keys<T> ? 'orderBy' extends Prisma.Keys<T> ? ByValid extends Prisma.True ? {} : {
        [P in OrderFields]: P extends ByFields ? never : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`;
    }[OrderFields] : 'Error: If you provide "skip", you also need to provide "orderBy"' : ByValid extends Prisma.True ? {} : {
        [P in OrderFields]: P extends ByFields ? never : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`;
    }[OrderFields]>(args: Prisma.SubsetIntersection<T, AlertMappingRuleGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetAlertMappingRuleGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>;
    readonly fields: AlertMappingRuleFieldRefs;
}
export interface Prisma__AlertMappingRuleClient<T, Null = never, ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs, GlobalOmitOptions = {}> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise";
    service<T extends Prisma.ServiceDefaultArgs<ExtArgs> = {}>(args?: Prisma.Subset<T, Prisma.ServiceDefaultArgs<ExtArgs>>): Prisma.Prisma__ServiceClient<runtime.Types.Result.GetResult<Prisma.$ServicePayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions> | Null, Null, ExtArgs, GlobalOmitOptions>;
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): runtime.Types.Utils.JsPromise<TResult1 | TResult2>;
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): runtime.Types.Utils.JsPromise<T | TResult>;
    finally(onfinally?: (() => void) | undefined | null): runtime.Types.Utils.JsPromise<T>;
}
export interface AlertMappingRuleFieldRefs {
    readonly id: Prisma.FieldRef<"AlertMappingRule", 'String'>;
    readonly name: Prisma.FieldRef<"AlertMappingRule", 'String'>;
    readonly description: Prisma.FieldRef<"AlertMappingRule", 'String'>;
    readonly priority: Prisma.FieldRef<"AlertMappingRule", 'Int'>;
    readonly enabled: Prisma.FieldRef<"AlertMappingRule", 'Boolean'>;
    readonly matchCriteria: Prisma.FieldRef<"AlertMappingRule", 'String'>;
    readonly serviceId: Prisma.FieldRef<"AlertMappingRule", 'String'>;
    readonly createdAt: Prisma.FieldRef<"AlertMappingRule", 'DateTime'>;
    readonly updatedAt: Prisma.FieldRef<"AlertMappingRule", 'DateTime'>;
}
export type AlertMappingRuleFindUniqueArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    select?: Prisma.AlertMappingRuleSelect<ExtArgs> | null;
    omit?: Prisma.AlertMappingRuleOmit<ExtArgs> | null;
    include?: Prisma.AlertMappingRuleInclude<ExtArgs> | null;
    where: Prisma.AlertMappingRuleWhereUniqueInput;
};
export type AlertMappingRuleFindUniqueOrThrowArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    select?: Prisma.AlertMappingRuleSelect<ExtArgs> | null;
    omit?: Prisma.AlertMappingRuleOmit<ExtArgs> | null;
    include?: Prisma.AlertMappingRuleInclude<ExtArgs> | null;
    where: Prisma.AlertMappingRuleWhereUniqueInput;
};
export type AlertMappingRuleFindFirstArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    select?: Prisma.AlertMappingRuleSelect<ExtArgs> | null;
    omit?: Prisma.AlertMappingRuleOmit<ExtArgs> | null;
    include?: Prisma.AlertMappingRuleInclude<ExtArgs> | null;
    where?: Prisma.AlertMappingRuleWhereInput;
    orderBy?: Prisma.AlertMappingRuleOrderByWithRelationInput | Prisma.AlertMappingRuleOrderByWithRelationInput[];
    cursor?: Prisma.AlertMappingRuleWhereUniqueInput;
    take?: number;
    skip?: number;
    distinct?: Prisma.AlertMappingRuleScalarFieldEnum | Prisma.AlertMappingRuleScalarFieldEnum[];
};
export type AlertMappingRuleFindFirstOrThrowArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    select?: Prisma.AlertMappingRuleSelect<ExtArgs> | null;
    omit?: Prisma.AlertMappingRuleOmit<ExtArgs> | null;
    include?: Prisma.AlertMappingRuleInclude<ExtArgs> | null;
    where?: Prisma.AlertMappingRuleWhereInput;
    orderBy?: Prisma.AlertMappingRuleOrderByWithRelationInput | Prisma.AlertMappingRuleOrderByWithRelationInput[];
    cursor?: Prisma.AlertMappingRuleWhereUniqueInput;
    take?: number;
    skip?: number;
    distinct?: Prisma.AlertMappingRuleScalarFieldEnum | Prisma.AlertMappingRuleScalarFieldEnum[];
};
export type AlertMappingRuleFindManyArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    select?: Prisma.AlertMappingRuleSelect<ExtArgs> | null;
    omit?: Prisma.AlertMappingRuleOmit<ExtArgs> | null;
    include?: Prisma.AlertMappingRuleInclude<ExtArgs> | null;
    where?: Prisma.AlertMappingRuleWhereInput;
    orderBy?: Prisma.AlertMappingRuleOrderByWithRelationInput | Prisma.AlertMappingRuleOrderByWithRelationInput[];
    cursor?: Prisma.AlertMappingRuleWhereUniqueInput;
    take?: number;
    skip?: number;
    distinct?: Prisma.AlertMappingRuleScalarFieldEnum | Prisma.AlertMappingRuleScalarFieldEnum[];
};
export type AlertMappingRuleCreateArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    select?: Prisma.AlertMappingRuleSelect<ExtArgs> | null;
    omit?: Prisma.AlertMappingRuleOmit<ExtArgs> | null;
    include?: Prisma.AlertMappingRuleInclude<ExtArgs> | null;
    data: Prisma.XOR<Prisma.AlertMappingRuleCreateInput, Prisma.AlertMappingRuleUncheckedCreateInput>;
};
export type AlertMappingRuleCreateManyArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    data: Prisma.AlertMappingRuleCreateManyInput | Prisma.AlertMappingRuleCreateManyInput[];
};
export type AlertMappingRuleCreateManyAndReturnArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    select?: Prisma.AlertMappingRuleSelectCreateManyAndReturn<ExtArgs> | null;
    omit?: Prisma.AlertMappingRuleOmit<ExtArgs> | null;
    data: Prisma.AlertMappingRuleCreateManyInput | Prisma.AlertMappingRuleCreateManyInput[];
    include?: Prisma.AlertMappingRuleIncludeCreateManyAndReturn<ExtArgs> | null;
};
export type AlertMappingRuleUpdateArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    select?: Prisma.AlertMappingRuleSelect<ExtArgs> | null;
    omit?: Prisma.AlertMappingRuleOmit<ExtArgs> | null;
    include?: Prisma.AlertMappingRuleInclude<ExtArgs> | null;
    data: Prisma.XOR<Prisma.AlertMappingRuleUpdateInput, Prisma.AlertMappingRuleUncheckedUpdateInput>;
    where: Prisma.AlertMappingRuleWhereUniqueInput;
};
export type AlertMappingRuleUpdateManyArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    data: Prisma.XOR<Prisma.AlertMappingRuleUpdateManyMutationInput, Prisma.AlertMappingRuleUncheckedUpdateManyInput>;
    where?: Prisma.AlertMappingRuleWhereInput;
    limit?: number;
};
export type AlertMappingRuleUpdateManyAndReturnArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    select?: Prisma.AlertMappingRuleSelectUpdateManyAndReturn<ExtArgs> | null;
    omit?: Prisma.AlertMappingRuleOmit<ExtArgs> | null;
    data: Prisma.XOR<Prisma.AlertMappingRuleUpdateManyMutationInput, Prisma.AlertMappingRuleUncheckedUpdateManyInput>;
    where?: Prisma.AlertMappingRuleWhereInput;
    limit?: number;
    include?: Prisma.AlertMappingRuleIncludeUpdateManyAndReturn<ExtArgs> | null;
};
export type AlertMappingRuleUpsertArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    select?: Prisma.AlertMappingRuleSelect<ExtArgs> | null;
    omit?: Prisma.AlertMappingRuleOmit<ExtArgs> | null;
    include?: Prisma.AlertMappingRuleInclude<ExtArgs> | null;
    where: Prisma.AlertMappingRuleWhereUniqueInput;
    create: Prisma.XOR<Prisma.AlertMappingRuleCreateInput, Prisma.AlertMappingRuleUncheckedCreateInput>;
    update: Prisma.XOR<Prisma.AlertMappingRuleUpdateInput, Prisma.AlertMappingRuleUncheckedUpdateInput>;
};
export type AlertMappingRuleDeleteArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    select?: Prisma.AlertMappingRuleSelect<ExtArgs> | null;
    omit?: Prisma.AlertMappingRuleOmit<ExtArgs> | null;
    include?: Prisma.AlertMappingRuleInclude<ExtArgs> | null;
    where: Prisma.AlertMappingRuleWhereUniqueInput;
};
export type AlertMappingRuleDeleteManyArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    where?: Prisma.AlertMappingRuleWhereInput;
    limit?: number;
};
export type AlertMappingRuleDefaultArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    select?: Prisma.AlertMappingRuleSelect<ExtArgs> | null;
    omit?: Prisma.AlertMappingRuleOmit<ExtArgs> | null;
    include?: Prisma.AlertMappingRuleInclude<ExtArgs> | null;
};
export {};
