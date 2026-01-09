import type * as runtime from "@prisma/client/runtime/client";
import type * as Prisma from "../internal/prismaNamespace.js";
export type ServiceIntegrationModel = runtime.Types.Result.DefaultSelection<Prisma.$ServiceIntegrationPayload>;
export type AggregateServiceIntegration = {
    _count: ServiceIntegrationCountAggregateOutputType | null;
    _avg: ServiceIntegrationAvgAggregateOutputType | null;
    _sum: ServiceIntegrationSumAggregateOutputType | null;
    _min: ServiceIntegrationMinAggregateOutputType | null;
    _max: ServiceIntegrationMaxAggregateOutputType | null;
};
export type ServiceIntegrationAvgAggregateOutputType = {
    priority: number | null;
};
export type ServiceIntegrationSumAggregateOutputType = {
    priority: number | null;
};
export type ServiceIntegrationMinAggregateOutputType = {
    id: string | null;
    serviceId: string | null;
    connectionId: string | null;
    priority: number | null;
    config: string | null;
    isEnabled: boolean | null;
    createdAt: Date | null;
    updatedAt: Date | null;
};
export type ServiceIntegrationMaxAggregateOutputType = {
    id: string | null;
    serviceId: string | null;
    connectionId: string | null;
    priority: number | null;
    config: string | null;
    isEnabled: boolean | null;
    createdAt: Date | null;
    updatedAt: Date | null;
};
export type ServiceIntegrationCountAggregateOutputType = {
    id: number;
    serviceId: number;
    connectionId: number;
    priority: number;
    config: number;
    isEnabled: number;
    createdAt: number;
    updatedAt: number;
    _all: number;
};
export type ServiceIntegrationAvgAggregateInputType = {
    priority?: true;
};
export type ServiceIntegrationSumAggregateInputType = {
    priority?: true;
};
export type ServiceIntegrationMinAggregateInputType = {
    id?: true;
    serviceId?: true;
    connectionId?: true;
    priority?: true;
    config?: true;
    isEnabled?: true;
    createdAt?: true;
    updatedAt?: true;
};
export type ServiceIntegrationMaxAggregateInputType = {
    id?: true;
    serviceId?: true;
    connectionId?: true;
    priority?: true;
    config?: true;
    isEnabled?: true;
    createdAt?: true;
    updatedAt?: true;
};
export type ServiceIntegrationCountAggregateInputType = {
    id?: true;
    serviceId?: true;
    connectionId?: true;
    priority?: true;
    config?: true;
    isEnabled?: true;
    createdAt?: true;
    updatedAt?: true;
    _all?: true;
};
export type ServiceIntegrationAggregateArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    where?: Prisma.ServiceIntegrationWhereInput;
    orderBy?: Prisma.ServiceIntegrationOrderByWithRelationInput | Prisma.ServiceIntegrationOrderByWithRelationInput[];
    cursor?: Prisma.ServiceIntegrationWhereUniqueInput;
    take?: number;
    skip?: number;
    _count?: true | ServiceIntegrationCountAggregateInputType;
    _avg?: ServiceIntegrationAvgAggregateInputType;
    _sum?: ServiceIntegrationSumAggregateInputType;
    _min?: ServiceIntegrationMinAggregateInputType;
    _max?: ServiceIntegrationMaxAggregateInputType;
};
export type GetServiceIntegrationAggregateType<T extends ServiceIntegrationAggregateArgs> = {
    [P in keyof T & keyof AggregateServiceIntegration]: P extends '_count' | 'count' ? T[P] extends true ? number : Prisma.GetScalarType<T[P], AggregateServiceIntegration[P]> : Prisma.GetScalarType<T[P], AggregateServiceIntegration[P]>;
};
export type ServiceIntegrationGroupByArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    where?: Prisma.ServiceIntegrationWhereInput;
    orderBy?: Prisma.ServiceIntegrationOrderByWithAggregationInput | Prisma.ServiceIntegrationOrderByWithAggregationInput[];
    by: Prisma.ServiceIntegrationScalarFieldEnum[] | Prisma.ServiceIntegrationScalarFieldEnum;
    having?: Prisma.ServiceIntegrationScalarWhereWithAggregatesInput;
    take?: number;
    skip?: number;
    _count?: ServiceIntegrationCountAggregateInputType | true;
    _avg?: ServiceIntegrationAvgAggregateInputType;
    _sum?: ServiceIntegrationSumAggregateInputType;
    _min?: ServiceIntegrationMinAggregateInputType;
    _max?: ServiceIntegrationMaxAggregateInputType;
};
export type ServiceIntegrationGroupByOutputType = {
    id: string;
    serviceId: string;
    connectionId: string;
    priority: number;
    config: string | null;
    isEnabled: boolean;
    createdAt: Date;
    updatedAt: Date;
    _count: ServiceIntegrationCountAggregateOutputType | null;
    _avg: ServiceIntegrationAvgAggregateOutputType | null;
    _sum: ServiceIntegrationSumAggregateOutputType | null;
    _min: ServiceIntegrationMinAggregateOutputType | null;
    _max: ServiceIntegrationMaxAggregateOutputType | null;
};
type GetServiceIntegrationGroupByPayload<T extends ServiceIntegrationGroupByArgs> = Prisma.PrismaPromise<Array<Prisma.PickEnumerable<ServiceIntegrationGroupByOutputType, T['by']> & {
    [P in ((keyof T) & (keyof ServiceIntegrationGroupByOutputType))]: P extends '_count' ? T[P] extends boolean ? number : Prisma.GetScalarType<T[P], ServiceIntegrationGroupByOutputType[P]> : Prisma.GetScalarType<T[P], ServiceIntegrationGroupByOutputType[P]>;
}>>;
export type ServiceIntegrationWhereInput = {
    AND?: Prisma.ServiceIntegrationWhereInput | Prisma.ServiceIntegrationWhereInput[];
    OR?: Prisma.ServiceIntegrationWhereInput[];
    NOT?: Prisma.ServiceIntegrationWhereInput | Prisma.ServiceIntegrationWhereInput[];
    id?: Prisma.StringFilter<"ServiceIntegration"> | string;
    serviceId?: Prisma.StringFilter<"ServiceIntegration"> | string;
    connectionId?: Prisma.StringFilter<"ServiceIntegration"> | string;
    priority?: Prisma.IntFilter<"ServiceIntegration"> | number;
    config?: Prisma.StringNullableFilter<"ServiceIntegration"> | string | null;
    isEnabled?: Prisma.BoolFilter<"ServiceIntegration"> | boolean;
    createdAt?: Prisma.DateTimeFilter<"ServiceIntegration"> | Date | string;
    updatedAt?: Prisma.DateTimeFilter<"ServiceIntegration"> | Date | string;
    service?: Prisma.XOR<Prisma.ServiceScalarRelationFilter, Prisma.ServiceWhereInput>;
    connection?: Prisma.XOR<Prisma.IntegrationConnectionScalarRelationFilter, Prisma.IntegrationConnectionWhereInput>;
};
export type ServiceIntegrationOrderByWithRelationInput = {
    id?: Prisma.SortOrder;
    serviceId?: Prisma.SortOrder;
    connectionId?: Prisma.SortOrder;
    priority?: Prisma.SortOrder;
    config?: Prisma.SortOrderInput | Prisma.SortOrder;
    isEnabled?: Prisma.SortOrder;
    createdAt?: Prisma.SortOrder;
    updatedAt?: Prisma.SortOrder;
    service?: Prisma.ServiceOrderByWithRelationInput;
    connection?: Prisma.IntegrationConnectionOrderByWithRelationInput;
};
export type ServiceIntegrationWhereUniqueInput = Prisma.AtLeast<{
    id?: string;
    serviceId_connectionId?: Prisma.ServiceIntegrationServiceIdConnectionIdCompoundUniqueInput;
    AND?: Prisma.ServiceIntegrationWhereInput | Prisma.ServiceIntegrationWhereInput[];
    OR?: Prisma.ServiceIntegrationWhereInput[];
    NOT?: Prisma.ServiceIntegrationWhereInput | Prisma.ServiceIntegrationWhereInput[];
    serviceId?: Prisma.StringFilter<"ServiceIntegration"> | string;
    connectionId?: Prisma.StringFilter<"ServiceIntegration"> | string;
    priority?: Prisma.IntFilter<"ServiceIntegration"> | number;
    config?: Prisma.StringNullableFilter<"ServiceIntegration"> | string | null;
    isEnabled?: Prisma.BoolFilter<"ServiceIntegration"> | boolean;
    createdAt?: Prisma.DateTimeFilter<"ServiceIntegration"> | Date | string;
    updatedAt?: Prisma.DateTimeFilter<"ServiceIntegration"> | Date | string;
    service?: Prisma.XOR<Prisma.ServiceScalarRelationFilter, Prisma.ServiceWhereInput>;
    connection?: Prisma.XOR<Prisma.IntegrationConnectionScalarRelationFilter, Prisma.IntegrationConnectionWhereInput>;
}, "id" | "serviceId_connectionId">;
export type ServiceIntegrationOrderByWithAggregationInput = {
    id?: Prisma.SortOrder;
    serviceId?: Prisma.SortOrder;
    connectionId?: Prisma.SortOrder;
    priority?: Prisma.SortOrder;
    config?: Prisma.SortOrderInput | Prisma.SortOrder;
    isEnabled?: Prisma.SortOrder;
    createdAt?: Prisma.SortOrder;
    updatedAt?: Prisma.SortOrder;
    _count?: Prisma.ServiceIntegrationCountOrderByAggregateInput;
    _avg?: Prisma.ServiceIntegrationAvgOrderByAggregateInput;
    _max?: Prisma.ServiceIntegrationMaxOrderByAggregateInput;
    _min?: Prisma.ServiceIntegrationMinOrderByAggregateInput;
    _sum?: Prisma.ServiceIntegrationSumOrderByAggregateInput;
};
export type ServiceIntegrationScalarWhereWithAggregatesInput = {
    AND?: Prisma.ServiceIntegrationScalarWhereWithAggregatesInput | Prisma.ServiceIntegrationScalarWhereWithAggregatesInput[];
    OR?: Prisma.ServiceIntegrationScalarWhereWithAggregatesInput[];
    NOT?: Prisma.ServiceIntegrationScalarWhereWithAggregatesInput | Prisma.ServiceIntegrationScalarWhereWithAggregatesInput[];
    id?: Prisma.StringWithAggregatesFilter<"ServiceIntegration"> | string;
    serviceId?: Prisma.StringWithAggregatesFilter<"ServiceIntegration"> | string;
    connectionId?: Prisma.StringWithAggregatesFilter<"ServiceIntegration"> | string;
    priority?: Prisma.IntWithAggregatesFilter<"ServiceIntegration"> | number;
    config?: Prisma.StringNullableWithAggregatesFilter<"ServiceIntegration"> | string | null;
    isEnabled?: Prisma.BoolWithAggregatesFilter<"ServiceIntegration"> | boolean;
    createdAt?: Prisma.DateTimeWithAggregatesFilter<"ServiceIntegration"> | Date | string;
    updatedAt?: Prisma.DateTimeWithAggregatesFilter<"ServiceIntegration"> | Date | string;
};
export type ServiceIntegrationCreateInput = {
    id?: string;
    priority?: number;
    config?: string | null;
    isEnabled?: boolean;
    createdAt?: Date | string;
    updatedAt?: Date | string;
    service: Prisma.ServiceCreateNestedOneWithoutIntegrationsInput;
    connection: Prisma.IntegrationConnectionCreateNestedOneWithoutServiceMappingsInput;
};
export type ServiceIntegrationUncheckedCreateInput = {
    id?: string;
    serviceId: string;
    connectionId: string;
    priority?: number;
    config?: string | null;
    isEnabled?: boolean;
    createdAt?: Date | string;
    updatedAt?: Date | string;
};
export type ServiceIntegrationUpdateInput = {
    id?: Prisma.StringFieldUpdateOperationsInput | string;
    priority?: Prisma.IntFieldUpdateOperationsInput | number;
    config?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
    isEnabled?: Prisma.BoolFieldUpdateOperationsInput | boolean;
    createdAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
    updatedAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
    service?: Prisma.ServiceUpdateOneRequiredWithoutIntegrationsNestedInput;
    connection?: Prisma.IntegrationConnectionUpdateOneRequiredWithoutServiceMappingsNestedInput;
};
export type ServiceIntegrationUncheckedUpdateInput = {
    id?: Prisma.StringFieldUpdateOperationsInput | string;
    serviceId?: Prisma.StringFieldUpdateOperationsInput | string;
    connectionId?: Prisma.StringFieldUpdateOperationsInput | string;
    priority?: Prisma.IntFieldUpdateOperationsInput | number;
    config?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
    isEnabled?: Prisma.BoolFieldUpdateOperationsInput | boolean;
    createdAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
    updatedAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
};
export type ServiceIntegrationCreateManyInput = {
    id?: string;
    serviceId: string;
    connectionId: string;
    priority?: number;
    config?: string | null;
    isEnabled?: boolean;
    createdAt?: Date | string;
    updatedAt?: Date | string;
};
export type ServiceIntegrationUpdateManyMutationInput = {
    id?: Prisma.StringFieldUpdateOperationsInput | string;
    priority?: Prisma.IntFieldUpdateOperationsInput | number;
    config?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
    isEnabled?: Prisma.BoolFieldUpdateOperationsInput | boolean;
    createdAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
    updatedAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
};
export type ServiceIntegrationUncheckedUpdateManyInput = {
    id?: Prisma.StringFieldUpdateOperationsInput | string;
    serviceId?: Prisma.StringFieldUpdateOperationsInput | string;
    connectionId?: Prisma.StringFieldUpdateOperationsInput | string;
    priority?: Prisma.IntFieldUpdateOperationsInput | number;
    config?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
    isEnabled?: Prisma.BoolFieldUpdateOperationsInput | boolean;
    createdAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
    updatedAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
};
export type ServiceIntegrationListRelationFilter = {
    every?: Prisma.ServiceIntegrationWhereInput;
    some?: Prisma.ServiceIntegrationWhereInput;
    none?: Prisma.ServiceIntegrationWhereInput;
};
export type ServiceIntegrationOrderByRelationAggregateInput = {
    _count?: Prisma.SortOrder;
};
export type ServiceIntegrationServiceIdConnectionIdCompoundUniqueInput = {
    serviceId: string;
    connectionId: string;
};
export type ServiceIntegrationCountOrderByAggregateInput = {
    id?: Prisma.SortOrder;
    serviceId?: Prisma.SortOrder;
    connectionId?: Prisma.SortOrder;
    priority?: Prisma.SortOrder;
    config?: Prisma.SortOrder;
    isEnabled?: Prisma.SortOrder;
    createdAt?: Prisma.SortOrder;
    updatedAt?: Prisma.SortOrder;
};
export type ServiceIntegrationAvgOrderByAggregateInput = {
    priority?: Prisma.SortOrder;
};
export type ServiceIntegrationMaxOrderByAggregateInput = {
    id?: Prisma.SortOrder;
    serviceId?: Prisma.SortOrder;
    connectionId?: Prisma.SortOrder;
    priority?: Prisma.SortOrder;
    config?: Prisma.SortOrder;
    isEnabled?: Prisma.SortOrder;
    createdAt?: Prisma.SortOrder;
    updatedAt?: Prisma.SortOrder;
};
export type ServiceIntegrationMinOrderByAggregateInput = {
    id?: Prisma.SortOrder;
    serviceId?: Prisma.SortOrder;
    connectionId?: Prisma.SortOrder;
    priority?: Prisma.SortOrder;
    config?: Prisma.SortOrder;
    isEnabled?: Prisma.SortOrder;
    createdAt?: Prisma.SortOrder;
    updatedAt?: Prisma.SortOrder;
};
export type ServiceIntegrationSumOrderByAggregateInput = {
    priority?: Prisma.SortOrder;
};
export type ServiceIntegrationCreateNestedManyWithoutServiceInput = {
    create?: Prisma.XOR<Prisma.ServiceIntegrationCreateWithoutServiceInput, Prisma.ServiceIntegrationUncheckedCreateWithoutServiceInput> | Prisma.ServiceIntegrationCreateWithoutServiceInput[] | Prisma.ServiceIntegrationUncheckedCreateWithoutServiceInput[];
    connectOrCreate?: Prisma.ServiceIntegrationCreateOrConnectWithoutServiceInput | Prisma.ServiceIntegrationCreateOrConnectWithoutServiceInput[];
    createMany?: Prisma.ServiceIntegrationCreateManyServiceInputEnvelope;
    connect?: Prisma.ServiceIntegrationWhereUniqueInput | Prisma.ServiceIntegrationWhereUniqueInput[];
};
export type ServiceIntegrationUncheckedCreateNestedManyWithoutServiceInput = {
    create?: Prisma.XOR<Prisma.ServiceIntegrationCreateWithoutServiceInput, Prisma.ServiceIntegrationUncheckedCreateWithoutServiceInput> | Prisma.ServiceIntegrationCreateWithoutServiceInput[] | Prisma.ServiceIntegrationUncheckedCreateWithoutServiceInput[];
    connectOrCreate?: Prisma.ServiceIntegrationCreateOrConnectWithoutServiceInput | Prisma.ServiceIntegrationCreateOrConnectWithoutServiceInput[];
    createMany?: Prisma.ServiceIntegrationCreateManyServiceInputEnvelope;
    connect?: Prisma.ServiceIntegrationWhereUniqueInput | Prisma.ServiceIntegrationWhereUniqueInput[];
};
export type ServiceIntegrationUpdateManyWithoutServiceNestedInput = {
    create?: Prisma.XOR<Prisma.ServiceIntegrationCreateWithoutServiceInput, Prisma.ServiceIntegrationUncheckedCreateWithoutServiceInput> | Prisma.ServiceIntegrationCreateWithoutServiceInput[] | Prisma.ServiceIntegrationUncheckedCreateWithoutServiceInput[];
    connectOrCreate?: Prisma.ServiceIntegrationCreateOrConnectWithoutServiceInput | Prisma.ServiceIntegrationCreateOrConnectWithoutServiceInput[];
    upsert?: Prisma.ServiceIntegrationUpsertWithWhereUniqueWithoutServiceInput | Prisma.ServiceIntegrationUpsertWithWhereUniqueWithoutServiceInput[];
    createMany?: Prisma.ServiceIntegrationCreateManyServiceInputEnvelope;
    set?: Prisma.ServiceIntegrationWhereUniqueInput | Prisma.ServiceIntegrationWhereUniqueInput[];
    disconnect?: Prisma.ServiceIntegrationWhereUniqueInput | Prisma.ServiceIntegrationWhereUniqueInput[];
    delete?: Prisma.ServiceIntegrationWhereUniqueInput | Prisma.ServiceIntegrationWhereUniqueInput[];
    connect?: Prisma.ServiceIntegrationWhereUniqueInput | Prisma.ServiceIntegrationWhereUniqueInput[];
    update?: Prisma.ServiceIntegrationUpdateWithWhereUniqueWithoutServiceInput | Prisma.ServiceIntegrationUpdateWithWhereUniqueWithoutServiceInput[];
    updateMany?: Prisma.ServiceIntegrationUpdateManyWithWhereWithoutServiceInput | Prisma.ServiceIntegrationUpdateManyWithWhereWithoutServiceInput[];
    deleteMany?: Prisma.ServiceIntegrationScalarWhereInput | Prisma.ServiceIntegrationScalarWhereInput[];
};
export type ServiceIntegrationUncheckedUpdateManyWithoutServiceNestedInput = {
    create?: Prisma.XOR<Prisma.ServiceIntegrationCreateWithoutServiceInput, Prisma.ServiceIntegrationUncheckedCreateWithoutServiceInput> | Prisma.ServiceIntegrationCreateWithoutServiceInput[] | Prisma.ServiceIntegrationUncheckedCreateWithoutServiceInput[];
    connectOrCreate?: Prisma.ServiceIntegrationCreateOrConnectWithoutServiceInput | Prisma.ServiceIntegrationCreateOrConnectWithoutServiceInput[];
    upsert?: Prisma.ServiceIntegrationUpsertWithWhereUniqueWithoutServiceInput | Prisma.ServiceIntegrationUpsertWithWhereUniqueWithoutServiceInput[];
    createMany?: Prisma.ServiceIntegrationCreateManyServiceInputEnvelope;
    set?: Prisma.ServiceIntegrationWhereUniqueInput | Prisma.ServiceIntegrationWhereUniqueInput[];
    disconnect?: Prisma.ServiceIntegrationWhereUniqueInput | Prisma.ServiceIntegrationWhereUniqueInput[];
    delete?: Prisma.ServiceIntegrationWhereUniqueInput | Prisma.ServiceIntegrationWhereUniqueInput[];
    connect?: Prisma.ServiceIntegrationWhereUniqueInput | Prisma.ServiceIntegrationWhereUniqueInput[];
    update?: Prisma.ServiceIntegrationUpdateWithWhereUniqueWithoutServiceInput | Prisma.ServiceIntegrationUpdateWithWhereUniqueWithoutServiceInput[];
    updateMany?: Prisma.ServiceIntegrationUpdateManyWithWhereWithoutServiceInput | Prisma.ServiceIntegrationUpdateManyWithWhereWithoutServiceInput[];
    deleteMany?: Prisma.ServiceIntegrationScalarWhereInput | Prisma.ServiceIntegrationScalarWhereInput[];
};
export type ServiceIntegrationCreateNestedManyWithoutConnectionInput = {
    create?: Prisma.XOR<Prisma.ServiceIntegrationCreateWithoutConnectionInput, Prisma.ServiceIntegrationUncheckedCreateWithoutConnectionInput> | Prisma.ServiceIntegrationCreateWithoutConnectionInput[] | Prisma.ServiceIntegrationUncheckedCreateWithoutConnectionInput[];
    connectOrCreate?: Prisma.ServiceIntegrationCreateOrConnectWithoutConnectionInput | Prisma.ServiceIntegrationCreateOrConnectWithoutConnectionInput[];
    createMany?: Prisma.ServiceIntegrationCreateManyConnectionInputEnvelope;
    connect?: Prisma.ServiceIntegrationWhereUniqueInput | Prisma.ServiceIntegrationWhereUniqueInput[];
};
export type ServiceIntegrationUncheckedCreateNestedManyWithoutConnectionInput = {
    create?: Prisma.XOR<Prisma.ServiceIntegrationCreateWithoutConnectionInput, Prisma.ServiceIntegrationUncheckedCreateWithoutConnectionInput> | Prisma.ServiceIntegrationCreateWithoutConnectionInput[] | Prisma.ServiceIntegrationUncheckedCreateWithoutConnectionInput[];
    connectOrCreate?: Prisma.ServiceIntegrationCreateOrConnectWithoutConnectionInput | Prisma.ServiceIntegrationCreateOrConnectWithoutConnectionInput[];
    createMany?: Prisma.ServiceIntegrationCreateManyConnectionInputEnvelope;
    connect?: Prisma.ServiceIntegrationWhereUniqueInput | Prisma.ServiceIntegrationWhereUniqueInput[];
};
export type ServiceIntegrationUpdateManyWithoutConnectionNestedInput = {
    create?: Prisma.XOR<Prisma.ServiceIntegrationCreateWithoutConnectionInput, Prisma.ServiceIntegrationUncheckedCreateWithoutConnectionInput> | Prisma.ServiceIntegrationCreateWithoutConnectionInput[] | Prisma.ServiceIntegrationUncheckedCreateWithoutConnectionInput[];
    connectOrCreate?: Prisma.ServiceIntegrationCreateOrConnectWithoutConnectionInput | Prisma.ServiceIntegrationCreateOrConnectWithoutConnectionInput[];
    upsert?: Prisma.ServiceIntegrationUpsertWithWhereUniqueWithoutConnectionInput | Prisma.ServiceIntegrationUpsertWithWhereUniqueWithoutConnectionInput[];
    createMany?: Prisma.ServiceIntegrationCreateManyConnectionInputEnvelope;
    set?: Prisma.ServiceIntegrationWhereUniqueInput | Prisma.ServiceIntegrationWhereUniqueInput[];
    disconnect?: Prisma.ServiceIntegrationWhereUniqueInput | Prisma.ServiceIntegrationWhereUniqueInput[];
    delete?: Prisma.ServiceIntegrationWhereUniqueInput | Prisma.ServiceIntegrationWhereUniqueInput[];
    connect?: Prisma.ServiceIntegrationWhereUniqueInput | Prisma.ServiceIntegrationWhereUniqueInput[];
    update?: Prisma.ServiceIntegrationUpdateWithWhereUniqueWithoutConnectionInput | Prisma.ServiceIntegrationUpdateWithWhereUniqueWithoutConnectionInput[];
    updateMany?: Prisma.ServiceIntegrationUpdateManyWithWhereWithoutConnectionInput | Prisma.ServiceIntegrationUpdateManyWithWhereWithoutConnectionInput[];
    deleteMany?: Prisma.ServiceIntegrationScalarWhereInput | Prisma.ServiceIntegrationScalarWhereInput[];
};
export type ServiceIntegrationUncheckedUpdateManyWithoutConnectionNestedInput = {
    create?: Prisma.XOR<Prisma.ServiceIntegrationCreateWithoutConnectionInput, Prisma.ServiceIntegrationUncheckedCreateWithoutConnectionInput> | Prisma.ServiceIntegrationCreateWithoutConnectionInput[] | Prisma.ServiceIntegrationUncheckedCreateWithoutConnectionInput[];
    connectOrCreate?: Prisma.ServiceIntegrationCreateOrConnectWithoutConnectionInput | Prisma.ServiceIntegrationCreateOrConnectWithoutConnectionInput[];
    upsert?: Prisma.ServiceIntegrationUpsertWithWhereUniqueWithoutConnectionInput | Prisma.ServiceIntegrationUpsertWithWhereUniqueWithoutConnectionInput[];
    createMany?: Prisma.ServiceIntegrationCreateManyConnectionInputEnvelope;
    set?: Prisma.ServiceIntegrationWhereUniqueInput | Prisma.ServiceIntegrationWhereUniqueInput[];
    disconnect?: Prisma.ServiceIntegrationWhereUniqueInput | Prisma.ServiceIntegrationWhereUniqueInput[];
    delete?: Prisma.ServiceIntegrationWhereUniqueInput | Prisma.ServiceIntegrationWhereUniqueInput[];
    connect?: Prisma.ServiceIntegrationWhereUniqueInput | Prisma.ServiceIntegrationWhereUniqueInput[];
    update?: Prisma.ServiceIntegrationUpdateWithWhereUniqueWithoutConnectionInput | Prisma.ServiceIntegrationUpdateWithWhereUniqueWithoutConnectionInput[];
    updateMany?: Prisma.ServiceIntegrationUpdateManyWithWhereWithoutConnectionInput | Prisma.ServiceIntegrationUpdateManyWithWhereWithoutConnectionInput[];
    deleteMany?: Prisma.ServiceIntegrationScalarWhereInput | Prisma.ServiceIntegrationScalarWhereInput[];
};
export type ServiceIntegrationCreateWithoutServiceInput = {
    id?: string;
    priority?: number;
    config?: string | null;
    isEnabled?: boolean;
    createdAt?: Date | string;
    updatedAt?: Date | string;
    connection: Prisma.IntegrationConnectionCreateNestedOneWithoutServiceMappingsInput;
};
export type ServiceIntegrationUncheckedCreateWithoutServiceInput = {
    id?: string;
    connectionId: string;
    priority?: number;
    config?: string | null;
    isEnabled?: boolean;
    createdAt?: Date | string;
    updatedAt?: Date | string;
};
export type ServiceIntegrationCreateOrConnectWithoutServiceInput = {
    where: Prisma.ServiceIntegrationWhereUniqueInput;
    create: Prisma.XOR<Prisma.ServiceIntegrationCreateWithoutServiceInput, Prisma.ServiceIntegrationUncheckedCreateWithoutServiceInput>;
};
export type ServiceIntegrationCreateManyServiceInputEnvelope = {
    data: Prisma.ServiceIntegrationCreateManyServiceInput | Prisma.ServiceIntegrationCreateManyServiceInput[];
};
export type ServiceIntegrationUpsertWithWhereUniqueWithoutServiceInput = {
    where: Prisma.ServiceIntegrationWhereUniqueInput;
    update: Prisma.XOR<Prisma.ServiceIntegrationUpdateWithoutServiceInput, Prisma.ServiceIntegrationUncheckedUpdateWithoutServiceInput>;
    create: Prisma.XOR<Prisma.ServiceIntegrationCreateWithoutServiceInput, Prisma.ServiceIntegrationUncheckedCreateWithoutServiceInput>;
};
export type ServiceIntegrationUpdateWithWhereUniqueWithoutServiceInput = {
    where: Prisma.ServiceIntegrationWhereUniqueInput;
    data: Prisma.XOR<Prisma.ServiceIntegrationUpdateWithoutServiceInput, Prisma.ServiceIntegrationUncheckedUpdateWithoutServiceInput>;
};
export type ServiceIntegrationUpdateManyWithWhereWithoutServiceInput = {
    where: Prisma.ServiceIntegrationScalarWhereInput;
    data: Prisma.XOR<Prisma.ServiceIntegrationUpdateManyMutationInput, Prisma.ServiceIntegrationUncheckedUpdateManyWithoutServiceInput>;
};
export type ServiceIntegrationScalarWhereInput = {
    AND?: Prisma.ServiceIntegrationScalarWhereInput | Prisma.ServiceIntegrationScalarWhereInput[];
    OR?: Prisma.ServiceIntegrationScalarWhereInput[];
    NOT?: Prisma.ServiceIntegrationScalarWhereInput | Prisma.ServiceIntegrationScalarWhereInput[];
    id?: Prisma.StringFilter<"ServiceIntegration"> | string;
    serviceId?: Prisma.StringFilter<"ServiceIntegration"> | string;
    connectionId?: Prisma.StringFilter<"ServiceIntegration"> | string;
    priority?: Prisma.IntFilter<"ServiceIntegration"> | number;
    config?: Prisma.StringNullableFilter<"ServiceIntegration"> | string | null;
    isEnabled?: Prisma.BoolFilter<"ServiceIntegration"> | boolean;
    createdAt?: Prisma.DateTimeFilter<"ServiceIntegration"> | Date | string;
    updatedAt?: Prisma.DateTimeFilter<"ServiceIntegration"> | Date | string;
};
export type ServiceIntegrationCreateWithoutConnectionInput = {
    id?: string;
    priority?: number;
    config?: string | null;
    isEnabled?: boolean;
    createdAt?: Date | string;
    updatedAt?: Date | string;
    service: Prisma.ServiceCreateNestedOneWithoutIntegrationsInput;
};
export type ServiceIntegrationUncheckedCreateWithoutConnectionInput = {
    id?: string;
    serviceId: string;
    priority?: number;
    config?: string | null;
    isEnabled?: boolean;
    createdAt?: Date | string;
    updatedAt?: Date | string;
};
export type ServiceIntegrationCreateOrConnectWithoutConnectionInput = {
    where: Prisma.ServiceIntegrationWhereUniqueInput;
    create: Prisma.XOR<Prisma.ServiceIntegrationCreateWithoutConnectionInput, Prisma.ServiceIntegrationUncheckedCreateWithoutConnectionInput>;
};
export type ServiceIntegrationCreateManyConnectionInputEnvelope = {
    data: Prisma.ServiceIntegrationCreateManyConnectionInput | Prisma.ServiceIntegrationCreateManyConnectionInput[];
};
export type ServiceIntegrationUpsertWithWhereUniqueWithoutConnectionInput = {
    where: Prisma.ServiceIntegrationWhereUniqueInput;
    update: Prisma.XOR<Prisma.ServiceIntegrationUpdateWithoutConnectionInput, Prisma.ServiceIntegrationUncheckedUpdateWithoutConnectionInput>;
    create: Prisma.XOR<Prisma.ServiceIntegrationCreateWithoutConnectionInput, Prisma.ServiceIntegrationUncheckedCreateWithoutConnectionInput>;
};
export type ServiceIntegrationUpdateWithWhereUniqueWithoutConnectionInput = {
    where: Prisma.ServiceIntegrationWhereUniqueInput;
    data: Prisma.XOR<Prisma.ServiceIntegrationUpdateWithoutConnectionInput, Prisma.ServiceIntegrationUncheckedUpdateWithoutConnectionInput>;
};
export type ServiceIntegrationUpdateManyWithWhereWithoutConnectionInput = {
    where: Prisma.ServiceIntegrationScalarWhereInput;
    data: Prisma.XOR<Prisma.ServiceIntegrationUpdateManyMutationInput, Prisma.ServiceIntegrationUncheckedUpdateManyWithoutConnectionInput>;
};
export type ServiceIntegrationCreateManyServiceInput = {
    id?: string;
    connectionId: string;
    priority?: number;
    config?: string | null;
    isEnabled?: boolean;
    createdAt?: Date | string;
    updatedAt?: Date | string;
};
export type ServiceIntegrationUpdateWithoutServiceInput = {
    id?: Prisma.StringFieldUpdateOperationsInput | string;
    priority?: Prisma.IntFieldUpdateOperationsInput | number;
    config?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
    isEnabled?: Prisma.BoolFieldUpdateOperationsInput | boolean;
    createdAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
    updatedAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
    connection?: Prisma.IntegrationConnectionUpdateOneRequiredWithoutServiceMappingsNestedInput;
};
export type ServiceIntegrationUncheckedUpdateWithoutServiceInput = {
    id?: Prisma.StringFieldUpdateOperationsInput | string;
    connectionId?: Prisma.StringFieldUpdateOperationsInput | string;
    priority?: Prisma.IntFieldUpdateOperationsInput | number;
    config?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
    isEnabled?: Prisma.BoolFieldUpdateOperationsInput | boolean;
    createdAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
    updatedAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
};
export type ServiceIntegrationUncheckedUpdateManyWithoutServiceInput = {
    id?: Prisma.StringFieldUpdateOperationsInput | string;
    connectionId?: Prisma.StringFieldUpdateOperationsInput | string;
    priority?: Prisma.IntFieldUpdateOperationsInput | number;
    config?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
    isEnabled?: Prisma.BoolFieldUpdateOperationsInput | boolean;
    createdAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
    updatedAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
};
export type ServiceIntegrationCreateManyConnectionInput = {
    id?: string;
    serviceId: string;
    priority?: number;
    config?: string | null;
    isEnabled?: boolean;
    createdAt?: Date | string;
    updatedAt?: Date | string;
};
export type ServiceIntegrationUpdateWithoutConnectionInput = {
    id?: Prisma.StringFieldUpdateOperationsInput | string;
    priority?: Prisma.IntFieldUpdateOperationsInput | number;
    config?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
    isEnabled?: Prisma.BoolFieldUpdateOperationsInput | boolean;
    createdAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
    updatedAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
    service?: Prisma.ServiceUpdateOneRequiredWithoutIntegrationsNestedInput;
};
export type ServiceIntegrationUncheckedUpdateWithoutConnectionInput = {
    id?: Prisma.StringFieldUpdateOperationsInput | string;
    serviceId?: Prisma.StringFieldUpdateOperationsInput | string;
    priority?: Prisma.IntFieldUpdateOperationsInput | number;
    config?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
    isEnabled?: Prisma.BoolFieldUpdateOperationsInput | boolean;
    createdAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
    updatedAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
};
export type ServiceIntegrationUncheckedUpdateManyWithoutConnectionInput = {
    id?: Prisma.StringFieldUpdateOperationsInput | string;
    serviceId?: Prisma.StringFieldUpdateOperationsInput | string;
    priority?: Prisma.IntFieldUpdateOperationsInput | number;
    config?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
    isEnabled?: Prisma.BoolFieldUpdateOperationsInput | boolean;
    createdAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
    updatedAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
};
export type ServiceIntegrationSelect<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = runtime.Types.Extensions.GetSelect<{
    id?: boolean;
    serviceId?: boolean;
    connectionId?: boolean;
    priority?: boolean;
    config?: boolean;
    isEnabled?: boolean;
    createdAt?: boolean;
    updatedAt?: boolean;
    service?: boolean | Prisma.ServiceDefaultArgs<ExtArgs>;
    connection?: boolean | Prisma.IntegrationConnectionDefaultArgs<ExtArgs>;
}, ExtArgs["result"]["serviceIntegration"]>;
export type ServiceIntegrationSelectCreateManyAndReturn<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = runtime.Types.Extensions.GetSelect<{
    id?: boolean;
    serviceId?: boolean;
    connectionId?: boolean;
    priority?: boolean;
    config?: boolean;
    isEnabled?: boolean;
    createdAt?: boolean;
    updatedAt?: boolean;
    service?: boolean | Prisma.ServiceDefaultArgs<ExtArgs>;
    connection?: boolean | Prisma.IntegrationConnectionDefaultArgs<ExtArgs>;
}, ExtArgs["result"]["serviceIntegration"]>;
export type ServiceIntegrationSelectUpdateManyAndReturn<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = runtime.Types.Extensions.GetSelect<{
    id?: boolean;
    serviceId?: boolean;
    connectionId?: boolean;
    priority?: boolean;
    config?: boolean;
    isEnabled?: boolean;
    createdAt?: boolean;
    updatedAt?: boolean;
    service?: boolean | Prisma.ServiceDefaultArgs<ExtArgs>;
    connection?: boolean | Prisma.IntegrationConnectionDefaultArgs<ExtArgs>;
}, ExtArgs["result"]["serviceIntegration"]>;
export type ServiceIntegrationSelectScalar = {
    id?: boolean;
    serviceId?: boolean;
    connectionId?: boolean;
    priority?: boolean;
    config?: boolean;
    isEnabled?: boolean;
    createdAt?: boolean;
    updatedAt?: boolean;
};
export type ServiceIntegrationOmit<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = runtime.Types.Extensions.GetOmit<"id" | "serviceId" | "connectionId" | "priority" | "config" | "isEnabled" | "createdAt" | "updatedAt", ExtArgs["result"]["serviceIntegration"]>;
export type ServiceIntegrationInclude<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    service?: boolean | Prisma.ServiceDefaultArgs<ExtArgs>;
    connection?: boolean | Prisma.IntegrationConnectionDefaultArgs<ExtArgs>;
};
export type ServiceIntegrationIncludeCreateManyAndReturn<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    service?: boolean | Prisma.ServiceDefaultArgs<ExtArgs>;
    connection?: boolean | Prisma.IntegrationConnectionDefaultArgs<ExtArgs>;
};
export type ServiceIntegrationIncludeUpdateManyAndReturn<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    service?: boolean | Prisma.ServiceDefaultArgs<ExtArgs>;
    connection?: boolean | Prisma.IntegrationConnectionDefaultArgs<ExtArgs>;
};
export type $ServiceIntegrationPayload<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    name: "ServiceIntegration";
    objects: {
        service: Prisma.$ServicePayload<ExtArgs>;
        connection: Prisma.$IntegrationConnectionPayload<ExtArgs>;
    };
    scalars: runtime.Types.Extensions.GetPayloadResult<{
        id: string;
        serviceId: string;
        connectionId: string;
        priority: number;
        config: string | null;
        isEnabled: boolean;
        createdAt: Date;
        updatedAt: Date;
    }, ExtArgs["result"]["serviceIntegration"]>;
    composites: {};
};
export type ServiceIntegrationGetPayload<S extends boolean | null | undefined | ServiceIntegrationDefaultArgs> = runtime.Types.Result.GetResult<Prisma.$ServiceIntegrationPayload, S>;
export type ServiceIntegrationCountArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = Omit<ServiceIntegrationFindManyArgs, 'select' | 'include' | 'distinct' | 'omit'> & {
    select?: ServiceIntegrationCountAggregateInputType | true;
};
export interface ServiceIntegrationDelegate<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs, GlobalOmitOptions = {}> {
    [K: symbol]: {
        types: Prisma.TypeMap<ExtArgs>['model']['ServiceIntegration'];
        meta: {
            name: 'ServiceIntegration';
        };
    };
    findUnique<T extends ServiceIntegrationFindUniqueArgs>(args: Prisma.SelectSubset<T, ServiceIntegrationFindUniqueArgs<ExtArgs>>): Prisma.Prisma__ServiceIntegrationClient<runtime.Types.Result.GetResult<Prisma.$ServiceIntegrationPayload<ExtArgs>, T, "findUnique", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>;
    findUniqueOrThrow<T extends ServiceIntegrationFindUniqueOrThrowArgs>(args: Prisma.SelectSubset<T, ServiceIntegrationFindUniqueOrThrowArgs<ExtArgs>>): Prisma.Prisma__ServiceIntegrationClient<runtime.Types.Result.GetResult<Prisma.$ServiceIntegrationPayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>;
    findFirst<T extends ServiceIntegrationFindFirstArgs>(args?: Prisma.SelectSubset<T, ServiceIntegrationFindFirstArgs<ExtArgs>>): Prisma.Prisma__ServiceIntegrationClient<runtime.Types.Result.GetResult<Prisma.$ServiceIntegrationPayload<ExtArgs>, T, "findFirst", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>;
    findFirstOrThrow<T extends ServiceIntegrationFindFirstOrThrowArgs>(args?: Prisma.SelectSubset<T, ServiceIntegrationFindFirstOrThrowArgs<ExtArgs>>): Prisma.Prisma__ServiceIntegrationClient<runtime.Types.Result.GetResult<Prisma.$ServiceIntegrationPayload<ExtArgs>, T, "findFirstOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>;
    findMany<T extends ServiceIntegrationFindManyArgs>(args?: Prisma.SelectSubset<T, ServiceIntegrationFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<runtime.Types.Result.GetResult<Prisma.$ServiceIntegrationPayload<ExtArgs>, T, "findMany", GlobalOmitOptions>>;
    create<T extends ServiceIntegrationCreateArgs>(args: Prisma.SelectSubset<T, ServiceIntegrationCreateArgs<ExtArgs>>): Prisma.Prisma__ServiceIntegrationClient<runtime.Types.Result.GetResult<Prisma.$ServiceIntegrationPayload<ExtArgs>, T, "create", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>;
    createMany<T extends ServiceIntegrationCreateManyArgs>(args?: Prisma.SelectSubset<T, ServiceIntegrationCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<Prisma.BatchPayload>;
    createManyAndReturn<T extends ServiceIntegrationCreateManyAndReturnArgs>(args?: Prisma.SelectSubset<T, ServiceIntegrationCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<runtime.Types.Result.GetResult<Prisma.$ServiceIntegrationPayload<ExtArgs>, T, "createManyAndReturn", GlobalOmitOptions>>;
    delete<T extends ServiceIntegrationDeleteArgs>(args: Prisma.SelectSubset<T, ServiceIntegrationDeleteArgs<ExtArgs>>): Prisma.Prisma__ServiceIntegrationClient<runtime.Types.Result.GetResult<Prisma.$ServiceIntegrationPayload<ExtArgs>, T, "delete", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>;
    update<T extends ServiceIntegrationUpdateArgs>(args: Prisma.SelectSubset<T, ServiceIntegrationUpdateArgs<ExtArgs>>): Prisma.Prisma__ServiceIntegrationClient<runtime.Types.Result.GetResult<Prisma.$ServiceIntegrationPayload<ExtArgs>, T, "update", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>;
    deleteMany<T extends ServiceIntegrationDeleteManyArgs>(args?: Prisma.SelectSubset<T, ServiceIntegrationDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<Prisma.BatchPayload>;
    updateMany<T extends ServiceIntegrationUpdateManyArgs>(args: Prisma.SelectSubset<T, ServiceIntegrationUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<Prisma.BatchPayload>;
    updateManyAndReturn<T extends ServiceIntegrationUpdateManyAndReturnArgs>(args: Prisma.SelectSubset<T, ServiceIntegrationUpdateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<runtime.Types.Result.GetResult<Prisma.$ServiceIntegrationPayload<ExtArgs>, T, "updateManyAndReturn", GlobalOmitOptions>>;
    upsert<T extends ServiceIntegrationUpsertArgs>(args: Prisma.SelectSubset<T, ServiceIntegrationUpsertArgs<ExtArgs>>): Prisma.Prisma__ServiceIntegrationClient<runtime.Types.Result.GetResult<Prisma.$ServiceIntegrationPayload<ExtArgs>, T, "upsert", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>;
    count<T extends ServiceIntegrationCountArgs>(args?: Prisma.Subset<T, ServiceIntegrationCountArgs>): Prisma.PrismaPromise<T extends runtime.Types.Utils.Record<'select', any> ? T['select'] extends true ? number : Prisma.GetScalarType<T['select'], ServiceIntegrationCountAggregateOutputType> : number>;
    aggregate<T extends ServiceIntegrationAggregateArgs>(args: Prisma.Subset<T, ServiceIntegrationAggregateArgs>): Prisma.PrismaPromise<GetServiceIntegrationAggregateType<T>>;
    groupBy<T extends ServiceIntegrationGroupByArgs, HasSelectOrTake extends Prisma.Or<Prisma.Extends<'skip', Prisma.Keys<T>>, Prisma.Extends<'take', Prisma.Keys<T>>>, OrderByArg extends Prisma.True extends HasSelectOrTake ? {
        orderBy: ServiceIntegrationGroupByArgs['orderBy'];
    } : {
        orderBy?: ServiceIntegrationGroupByArgs['orderBy'];
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
    }[OrderFields]>(args: Prisma.SubsetIntersection<T, ServiceIntegrationGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetServiceIntegrationGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>;
    readonly fields: ServiceIntegrationFieldRefs;
}
export interface Prisma__ServiceIntegrationClient<T, Null = never, ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs, GlobalOmitOptions = {}> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise";
    service<T extends Prisma.ServiceDefaultArgs<ExtArgs> = {}>(args?: Prisma.Subset<T, Prisma.ServiceDefaultArgs<ExtArgs>>): Prisma.Prisma__ServiceClient<runtime.Types.Result.GetResult<Prisma.$ServicePayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions> | Null, Null, ExtArgs, GlobalOmitOptions>;
    connection<T extends Prisma.IntegrationConnectionDefaultArgs<ExtArgs> = {}>(args?: Prisma.Subset<T, Prisma.IntegrationConnectionDefaultArgs<ExtArgs>>): Prisma.Prisma__IntegrationConnectionClient<runtime.Types.Result.GetResult<Prisma.$IntegrationConnectionPayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions> | Null, Null, ExtArgs, GlobalOmitOptions>;
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): runtime.Types.Utils.JsPromise<TResult1 | TResult2>;
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): runtime.Types.Utils.JsPromise<T | TResult>;
    finally(onfinally?: (() => void) | undefined | null): runtime.Types.Utils.JsPromise<T>;
}
export interface ServiceIntegrationFieldRefs {
    readonly id: Prisma.FieldRef<"ServiceIntegration", 'String'>;
    readonly serviceId: Prisma.FieldRef<"ServiceIntegration", 'String'>;
    readonly connectionId: Prisma.FieldRef<"ServiceIntegration", 'String'>;
    readonly priority: Prisma.FieldRef<"ServiceIntegration", 'Int'>;
    readonly config: Prisma.FieldRef<"ServiceIntegration", 'String'>;
    readonly isEnabled: Prisma.FieldRef<"ServiceIntegration", 'Boolean'>;
    readonly createdAt: Prisma.FieldRef<"ServiceIntegration", 'DateTime'>;
    readonly updatedAt: Prisma.FieldRef<"ServiceIntegration", 'DateTime'>;
}
export type ServiceIntegrationFindUniqueArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    select?: Prisma.ServiceIntegrationSelect<ExtArgs> | null;
    omit?: Prisma.ServiceIntegrationOmit<ExtArgs> | null;
    include?: Prisma.ServiceIntegrationInclude<ExtArgs> | null;
    where: Prisma.ServiceIntegrationWhereUniqueInput;
};
export type ServiceIntegrationFindUniqueOrThrowArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    select?: Prisma.ServiceIntegrationSelect<ExtArgs> | null;
    omit?: Prisma.ServiceIntegrationOmit<ExtArgs> | null;
    include?: Prisma.ServiceIntegrationInclude<ExtArgs> | null;
    where: Prisma.ServiceIntegrationWhereUniqueInput;
};
export type ServiceIntegrationFindFirstArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    select?: Prisma.ServiceIntegrationSelect<ExtArgs> | null;
    omit?: Prisma.ServiceIntegrationOmit<ExtArgs> | null;
    include?: Prisma.ServiceIntegrationInclude<ExtArgs> | null;
    where?: Prisma.ServiceIntegrationWhereInput;
    orderBy?: Prisma.ServiceIntegrationOrderByWithRelationInput | Prisma.ServiceIntegrationOrderByWithRelationInput[];
    cursor?: Prisma.ServiceIntegrationWhereUniqueInput;
    take?: number;
    skip?: number;
    distinct?: Prisma.ServiceIntegrationScalarFieldEnum | Prisma.ServiceIntegrationScalarFieldEnum[];
};
export type ServiceIntegrationFindFirstOrThrowArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    select?: Prisma.ServiceIntegrationSelect<ExtArgs> | null;
    omit?: Prisma.ServiceIntegrationOmit<ExtArgs> | null;
    include?: Prisma.ServiceIntegrationInclude<ExtArgs> | null;
    where?: Prisma.ServiceIntegrationWhereInput;
    orderBy?: Prisma.ServiceIntegrationOrderByWithRelationInput | Prisma.ServiceIntegrationOrderByWithRelationInput[];
    cursor?: Prisma.ServiceIntegrationWhereUniqueInput;
    take?: number;
    skip?: number;
    distinct?: Prisma.ServiceIntegrationScalarFieldEnum | Prisma.ServiceIntegrationScalarFieldEnum[];
};
export type ServiceIntegrationFindManyArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    select?: Prisma.ServiceIntegrationSelect<ExtArgs> | null;
    omit?: Prisma.ServiceIntegrationOmit<ExtArgs> | null;
    include?: Prisma.ServiceIntegrationInclude<ExtArgs> | null;
    where?: Prisma.ServiceIntegrationWhereInput;
    orderBy?: Prisma.ServiceIntegrationOrderByWithRelationInput | Prisma.ServiceIntegrationOrderByWithRelationInput[];
    cursor?: Prisma.ServiceIntegrationWhereUniqueInput;
    take?: number;
    skip?: number;
    distinct?: Prisma.ServiceIntegrationScalarFieldEnum | Prisma.ServiceIntegrationScalarFieldEnum[];
};
export type ServiceIntegrationCreateArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    select?: Prisma.ServiceIntegrationSelect<ExtArgs> | null;
    omit?: Prisma.ServiceIntegrationOmit<ExtArgs> | null;
    include?: Prisma.ServiceIntegrationInclude<ExtArgs> | null;
    data: Prisma.XOR<Prisma.ServiceIntegrationCreateInput, Prisma.ServiceIntegrationUncheckedCreateInput>;
};
export type ServiceIntegrationCreateManyArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    data: Prisma.ServiceIntegrationCreateManyInput | Prisma.ServiceIntegrationCreateManyInput[];
};
export type ServiceIntegrationCreateManyAndReturnArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    select?: Prisma.ServiceIntegrationSelectCreateManyAndReturn<ExtArgs> | null;
    omit?: Prisma.ServiceIntegrationOmit<ExtArgs> | null;
    data: Prisma.ServiceIntegrationCreateManyInput | Prisma.ServiceIntegrationCreateManyInput[];
    include?: Prisma.ServiceIntegrationIncludeCreateManyAndReturn<ExtArgs> | null;
};
export type ServiceIntegrationUpdateArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    select?: Prisma.ServiceIntegrationSelect<ExtArgs> | null;
    omit?: Prisma.ServiceIntegrationOmit<ExtArgs> | null;
    include?: Prisma.ServiceIntegrationInclude<ExtArgs> | null;
    data: Prisma.XOR<Prisma.ServiceIntegrationUpdateInput, Prisma.ServiceIntegrationUncheckedUpdateInput>;
    where: Prisma.ServiceIntegrationWhereUniqueInput;
};
export type ServiceIntegrationUpdateManyArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    data: Prisma.XOR<Prisma.ServiceIntegrationUpdateManyMutationInput, Prisma.ServiceIntegrationUncheckedUpdateManyInput>;
    where?: Prisma.ServiceIntegrationWhereInput;
    limit?: number;
};
export type ServiceIntegrationUpdateManyAndReturnArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    select?: Prisma.ServiceIntegrationSelectUpdateManyAndReturn<ExtArgs> | null;
    omit?: Prisma.ServiceIntegrationOmit<ExtArgs> | null;
    data: Prisma.XOR<Prisma.ServiceIntegrationUpdateManyMutationInput, Prisma.ServiceIntegrationUncheckedUpdateManyInput>;
    where?: Prisma.ServiceIntegrationWhereInput;
    limit?: number;
    include?: Prisma.ServiceIntegrationIncludeUpdateManyAndReturn<ExtArgs> | null;
};
export type ServiceIntegrationUpsertArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    select?: Prisma.ServiceIntegrationSelect<ExtArgs> | null;
    omit?: Prisma.ServiceIntegrationOmit<ExtArgs> | null;
    include?: Prisma.ServiceIntegrationInclude<ExtArgs> | null;
    where: Prisma.ServiceIntegrationWhereUniqueInput;
    create: Prisma.XOR<Prisma.ServiceIntegrationCreateInput, Prisma.ServiceIntegrationUncheckedCreateInput>;
    update: Prisma.XOR<Prisma.ServiceIntegrationUpdateInput, Prisma.ServiceIntegrationUncheckedUpdateInput>;
};
export type ServiceIntegrationDeleteArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    select?: Prisma.ServiceIntegrationSelect<ExtArgs> | null;
    omit?: Prisma.ServiceIntegrationOmit<ExtArgs> | null;
    include?: Prisma.ServiceIntegrationInclude<ExtArgs> | null;
    where: Prisma.ServiceIntegrationWhereUniqueInput;
};
export type ServiceIntegrationDeleteManyArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    where?: Prisma.ServiceIntegrationWhereInput;
    limit?: number;
};
export type ServiceIntegrationDefaultArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    select?: Prisma.ServiceIntegrationSelect<ExtArgs> | null;
    omit?: Prisma.ServiceIntegrationOmit<ExtArgs> | null;
    include?: Prisma.ServiceIntegrationInclude<ExtArgs> | null;
};
export {};
