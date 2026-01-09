import type * as runtime from "@prisma/client/runtime/client";
import type * as Prisma from "../internal/prismaNamespace.js";
export type ServiceDependencyModel = runtime.Types.Result.DefaultSelection<Prisma.$ServiceDependencyPayload>;
export type AggregateServiceDependency = {
    _count: ServiceDependencyCountAggregateOutputType | null;
    _min: ServiceDependencyMinAggregateOutputType | null;
    _max: ServiceDependencyMaxAggregateOutputType | null;
};
export type ServiceDependencyMinAggregateOutputType = {
    id: string | null;
    dependentId: string | null;
    dependencyId: string | null;
    dependencyType: string | null;
    criticality: string | null;
    createdAt: Date | null;
};
export type ServiceDependencyMaxAggregateOutputType = {
    id: string | null;
    dependentId: string | null;
    dependencyId: string | null;
    dependencyType: string | null;
    criticality: string | null;
    createdAt: Date | null;
};
export type ServiceDependencyCountAggregateOutputType = {
    id: number;
    dependentId: number;
    dependencyId: number;
    dependencyType: number;
    criticality: number;
    createdAt: number;
    _all: number;
};
export type ServiceDependencyMinAggregateInputType = {
    id?: true;
    dependentId?: true;
    dependencyId?: true;
    dependencyType?: true;
    criticality?: true;
    createdAt?: true;
};
export type ServiceDependencyMaxAggregateInputType = {
    id?: true;
    dependentId?: true;
    dependencyId?: true;
    dependencyType?: true;
    criticality?: true;
    createdAt?: true;
};
export type ServiceDependencyCountAggregateInputType = {
    id?: true;
    dependentId?: true;
    dependencyId?: true;
    dependencyType?: true;
    criticality?: true;
    createdAt?: true;
    _all?: true;
};
export type ServiceDependencyAggregateArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    where?: Prisma.ServiceDependencyWhereInput;
    orderBy?: Prisma.ServiceDependencyOrderByWithRelationInput | Prisma.ServiceDependencyOrderByWithRelationInput[];
    cursor?: Prisma.ServiceDependencyWhereUniqueInput;
    take?: number;
    skip?: number;
    _count?: true | ServiceDependencyCountAggregateInputType;
    _min?: ServiceDependencyMinAggregateInputType;
    _max?: ServiceDependencyMaxAggregateInputType;
};
export type GetServiceDependencyAggregateType<T extends ServiceDependencyAggregateArgs> = {
    [P in keyof T & keyof AggregateServiceDependency]: P extends '_count' | 'count' ? T[P] extends true ? number : Prisma.GetScalarType<T[P], AggregateServiceDependency[P]> : Prisma.GetScalarType<T[P], AggregateServiceDependency[P]>;
};
export type ServiceDependencyGroupByArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    where?: Prisma.ServiceDependencyWhereInput;
    orderBy?: Prisma.ServiceDependencyOrderByWithAggregationInput | Prisma.ServiceDependencyOrderByWithAggregationInput[];
    by: Prisma.ServiceDependencyScalarFieldEnum[] | Prisma.ServiceDependencyScalarFieldEnum;
    having?: Prisma.ServiceDependencyScalarWhereWithAggregatesInput;
    take?: number;
    skip?: number;
    _count?: ServiceDependencyCountAggregateInputType | true;
    _min?: ServiceDependencyMinAggregateInputType;
    _max?: ServiceDependencyMaxAggregateInputType;
};
export type ServiceDependencyGroupByOutputType = {
    id: string;
    dependentId: string;
    dependencyId: string;
    dependencyType: string;
    criticality: string;
    createdAt: Date;
    _count: ServiceDependencyCountAggregateOutputType | null;
    _min: ServiceDependencyMinAggregateOutputType | null;
    _max: ServiceDependencyMaxAggregateOutputType | null;
};
type GetServiceDependencyGroupByPayload<T extends ServiceDependencyGroupByArgs> = Prisma.PrismaPromise<Array<Prisma.PickEnumerable<ServiceDependencyGroupByOutputType, T['by']> & {
    [P in ((keyof T) & (keyof ServiceDependencyGroupByOutputType))]: P extends '_count' ? T[P] extends boolean ? number : Prisma.GetScalarType<T[P], ServiceDependencyGroupByOutputType[P]> : Prisma.GetScalarType<T[P], ServiceDependencyGroupByOutputType[P]>;
}>>;
export type ServiceDependencyWhereInput = {
    AND?: Prisma.ServiceDependencyWhereInput | Prisma.ServiceDependencyWhereInput[];
    OR?: Prisma.ServiceDependencyWhereInput[];
    NOT?: Prisma.ServiceDependencyWhereInput | Prisma.ServiceDependencyWhereInput[];
    id?: Prisma.StringFilter<"ServiceDependency"> | string;
    dependentId?: Prisma.StringFilter<"ServiceDependency"> | string;
    dependencyId?: Prisma.StringFilter<"ServiceDependency"> | string;
    dependencyType?: Prisma.StringFilter<"ServiceDependency"> | string;
    criticality?: Prisma.StringFilter<"ServiceDependency"> | string;
    createdAt?: Prisma.DateTimeFilter<"ServiceDependency"> | Date | string;
    dependent?: Prisma.XOR<Prisma.ServiceScalarRelationFilter, Prisma.ServiceWhereInput>;
    dependency?: Prisma.XOR<Prisma.ServiceScalarRelationFilter, Prisma.ServiceWhereInput>;
};
export type ServiceDependencyOrderByWithRelationInput = {
    id?: Prisma.SortOrder;
    dependentId?: Prisma.SortOrder;
    dependencyId?: Prisma.SortOrder;
    dependencyType?: Prisma.SortOrder;
    criticality?: Prisma.SortOrder;
    createdAt?: Prisma.SortOrder;
    dependent?: Prisma.ServiceOrderByWithRelationInput;
    dependency?: Prisma.ServiceOrderByWithRelationInput;
};
export type ServiceDependencyWhereUniqueInput = Prisma.AtLeast<{
    id?: string;
    dependentId_dependencyId?: Prisma.ServiceDependencyDependentIdDependencyIdCompoundUniqueInput;
    AND?: Prisma.ServiceDependencyWhereInput | Prisma.ServiceDependencyWhereInput[];
    OR?: Prisma.ServiceDependencyWhereInput[];
    NOT?: Prisma.ServiceDependencyWhereInput | Prisma.ServiceDependencyWhereInput[];
    dependentId?: Prisma.StringFilter<"ServiceDependency"> | string;
    dependencyId?: Prisma.StringFilter<"ServiceDependency"> | string;
    dependencyType?: Prisma.StringFilter<"ServiceDependency"> | string;
    criticality?: Prisma.StringFilter<"ServiceDependency"> | string;
    createdAt?: Prisma.DateTimeFilter<"ServiceDependency"> | Date | string;
    dependent?: Prisma.XOR<Prisma.ServiceScalarRelationFilter, Prisma.ServiceWhereInput>;
    dependency?: Prisma.XOR<Prisma.ServiceScalarRelationFilter, Prisma.ServiceWhereInput>;
}, "id" | "dependentId_dependencyId">;
export type ServiceDependencyOrderByWithAggregationInput = {
    id?: Prisma.SortOrder;
    dependentId?: Prisma.SortOrder;
    dependencyId?: Prisma.SortOrder;
    dependencyType?: Prisma.SortOrder;
    criticality?: Prisma.SortOrder;
    createdAt?: Prisma.SortOrder;
    _count?: Prisma.ServiceDependencyCountOrderByAggregateInput;
    _max?: Prisma.ServiceDependencyMaxOrderByAggregateInput;
    _min?: Prisma.ServiceDependencyMinOrderByAggregateInput;
};
export type ServiceDependencyScalarWhereWithAggregatesInput = {
    AND?: Prisma.ServiceDependencyScalarWhereWithAggregatesInput | Prisma.ServiceDependencyScalarWhereWithAggregatesInput[];
    OR?: Prisma.ServiceDependencyScalarWhereWithAggregatesInput[];
    NOT?: Prisma.ServiceDependencyScalarWhereWithAggregatesInput | Prisma.ServiceDependencyScalarWhereWithAggregatesInput[];
    id?: Prisma.StringWithAggregatesFilter<"ServiceDependency"> | string;
    dependentId?: Prisma.StringWithAggregatesFilter<"ServiceDependency"> | string;
    dependencyId?: Prisma.StringWithAggregatesFilter<"ServiceDependency"> | string;
    dependencyType?: Prisma.StringWithAggregatesFilter<"ServiceDependency"> | string;
    criticality?: Prisma.StringWithAggregatesFilter<"ServiceDependency"> | string;
    createdAt?: Prisma.DateTimeWithAggregatesFilter<"ServiceDependency"> | Date | string;
};
export type ServiceDependencyCreateInput = {
    id?: string;
    dependencyType?: string;
    criticality?: string;
    createdAt?: Date | string;
    dependent: Prisma.ServiceCreateNestedOneWithoutDependenciesInput;
    dependency: Prisma.ServiceCreateNestedOneWithoutDependentsInput;
};
export type ServiceDependencyUncheckedCreateInput = {
    id?: string;
    dependentId: string;
    dependencyId: string;
    dependencyType?: string;
    criticality?: string;
    createdAt?: Date | string;
};
export type ServiceDependencyUpdateInput = {
    id?: Prisma.StringFieldUpdateOperationsInput | string;
    dependencyType?: Prisma.StringFieldUpdateOperationsInput | string;
    criticality?: Prisma.StringFieldUpdateOperationsInput | string;
    createdAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
    dependent?: Prisma.ServiceUpdateOneRequiredWithoutDependenciesNestedInput;
    dependency?: Prisma.ServiceUpdateOneRequiredWithoutDependentsNestedInput;
};
export type ServiceDependencyUncheckedUpdateInput = {
    id?: Prisma.StringFieldUpdateOperationsInput | string;
    dependentId?: Prisma.StringFieldUpdateOperationsInput | string;
    dependencyId?: Prisma.StringFieldUpdateOperationsInput | string;
    dependencyType?: Prisma.StringFieldUpdateOperationsInput | string;
    criticality?: Prisma.StringFieldUpdateOperationsInput | string;
    createdAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
};
export type ServiceDependencyCreateManyInput = {
    id?: string;
    dependentId: string;
    dependencyId: string;
    dependencyType?: string;
    criticality?: string;
    createdAt?: Date | string;
};
export type ServiceDependencyUpdateManyMutationInput = {
    id?: Prisma.StringFieldUpdateOperationsInput | string;
    dependencyType?: Prisma.StringFieldUpdateOperationsInput | string;
    criticality?: Prisma.StringFieldUpdateOperationsInput | string;
    createdAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
};
export type ServiceDependencyUncheckedUpdateManyInput = {
    id?: Prisma.StringFieldUpdateOperationsInput | string;
    dependentId?: Prisma.StringFieldUpdateOperationsInput | string;
    dependencyId?: Prisma.StringFieldUpdateOperationsInput | string;
    dependencyType?: Prisma.StringFieldUpdateOperationsInput | string;
    criticality?: Prisma.StringFieldUpdateOperationsInput | string;
    createdAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
};
export type ServiceDependencyListRelationFilter = {
    every?: Prisma.ServiceDependencyWhereInput;
    some?: Prisma.ServiceDependencyWhereInput;
    none?: Prisma.ServiceDependencyWhereInput;
};
export type ServiceDependencyOrderByRelationAggregateInput = {
    _count?: Prisma.SortOrder;
};
export type ServiceDependencyDependentIdDependencyIdCompoundUniqueInput = {
    dependentId: string;
    dependencyId: string;
};
export type ServiceDependencyCountOrderByAggregateInput = {
    id?: Prisma.SortOrder;
    dependentId?: Prisma.SortOrder;
    dependencyId?: Prisma.SortOrder;
    dependencyType?: Prisma.SortOrder;
    criticality?: Prisma.SortOrder;
    createdAt?: Prisma.SortOrder;
};
export type ServiceDependencyMaxOrderByAggregateInput = {
    id?: Prisma.SortOrder;
    dependentId?: Prisma.SortOrder;
    dependencyId?: Prisma.SortOrder;
    dependencyType?: Prisma.SortOrder;
    criticality?: Prisma.SortOrder;
    createdAt?: Prisma.SortOrder;
};
export type ServiceDependencyMinOrderByAggregateInput = {
    id?: Prisma.SortOrder;
    dependentId?: Prisma.SortOrder;
    dependencyId?: Prisma.SortOrder;
    dependencyType?: Prisma.SortOrder;
    criticality?: Prisma.SortOrder;
    createdAt?: Prisma.SortOrder;
};
export type ServiceDependencyCreateNestedManyWithoutDependentInput = {
    create?: Prisma.XOR<Prisma.ServiceDependencyCreateWithoutDependentInput, Prisma.ServiceDependencyUncheckedCreateWithoutDependentInput> | Prisma.ServiceDependencyCreateWithoutDependentInput[] | Prisma.ServiceDependencyUncheckedCreateWithoutDependentInput[];
    connectOrCreate?: Prisma.ServiceDependencyCreateOrConnectWithoutDependentInput | Prisma.ServiceDependencyCreateOrConnectWithoutDependentInput[];
    createMany?: Prisma.ServiceDependencyCreateManyDependentInputEnvelope;
    connect?: Prisma.ServiceDependencyWhereUniqueInput | Prisma.ServiceDependencyWhereUniqueInput[];
};
export type ServiceDependencyCreateNestedManyWithoutDependencyInput = {
    create?: Prisma.XOR<Prisma.ServiceDependencyCreateWithoutDependencyInput, Prisma.ServiceDependencyUncheckedCreateWithoutDependencyInput> | Prisma.ServiceDependencyCreateWithoutDependencyInput[] | Prisma.ServiceDependencyUncheckedCreateWithoutDependencyInput[];
    connectOrCreate?: Prisma.ServiceDependencyCreateOrConnectWithoutDependencyInput | Prisma.ServiceDependencyCreateOrConnectWithoutDependencyInput[];
    createMany?: Prisma.ServiceDependencyCreateManyDependencyInputEnvelope;
    connect?: Prisma.ServiceDependencyWhereUniqueInput | Prisma.ServiceDependencyWhereUniqueInput[];
};
export type ServiceDependencyUncheckedCreateNestedManyWithoutDependentInput = {
    create?: Prisma.XOR<Prisma.ServiceDependencyCreateWithoutDependentInput, Prisma.ServiceDependencyUncheckedCreateWithoutDependentInput> | Prisma.ServiceDependencyCreateWithoutDependentInput[] | Prisma.ServiceDependencyUncheckedCreateWithoutDependentInput[];
    connectOrCreate?: Prisma.ServiceDependencyCreateOrConnectWithoutDependentInput | Prisma.ServiceDependencyCreateOrConnectWithoutDependentInput[];
    createMany?: Prisma.ServiceDependencyCreateManyDependentInputEnvelope;
    connect?: Prisma.ServiceDependencyWhereUniqueInput | Prisma.ServiceDependencyWhereUniqueInput[];
};
export type ServiceDependencyUncheckedCreateNestedManyWithoutDependencyInput = {
    create?: Prisma.XOR<Prisma.ServiceDependencyCreateWithoutDependencyInput, Prisma.ServiceDependencyUncheckedCreateWithoutDependencyInput> | Prisma.ServiceDependencyCreateWithoutDependencyInput[] | Prisma.ServiceDependencyUncheckedCreateWithoutDependencyInput[];
    connectOrCreate?: Prisma.ServiceDependencyCreateOrConnectWithoutDependencyInput | Prisma.ServiceDependencyCreateOrConnectWithoutDependencyInput[];
    createMany?: Prisma.ServiceDependencyCreateManyDependencyInputEnvelope;
    connect?: Prisma.ServiceDependencyWhereUniqueInput | Prisma.ServiceDependencyWhereUniqueInput[];
};
export type ServiceDependencyUpdateManyWithoutDependentNestedInput = {
    create?: Prisma.XOR<Prisma.ServiceDependencyCreateWithoutDependentInput, Prisma.ServiceDependencyUncheckedCreateWithoutDependentInput> | Prisma.ServiceDependencyCreateWithoutDependentInput[] | Prisma.ServiceDependencyUncheckedCreateWithoutDependentInput[];
    connectOrCreate?: Prisma.ServiceDependencyCreateOrConnectWithoutDependentInput | Prisma.ServiceDependencyCreateOrConnectWithoutDependentInput[];
    upsert?: Prisma.ServiceDependencyUpsertWithWhereUniqueWithoutDependentInput | Prisma.ServiceDependencyUpsertWithWhereUniqueWithoutDependentInput[];
    createMany?: Prisma.ServiceDependencyCreateManyDependentInputEnvelope;
    set?: Prisma.ServiceDependencyWhereUniqueInput | Prisma.ServiceDependencyWhereUniqueInput[];
    disconnect?: Prisma.ServiceDependencyWhereUniqueInput | Prisma.ServiceDependencyWhereUniqueInput[];
    delete?: Prisma.ServiceDependencyWhereUniqueInput | Prisma.ServiceDependencyWhereUniqueInput[];
    connect?: Prisma.ServiceDependencyWhereUniqueInput | Prisma.ServiceDependencyWhereUniqueInput[];
    update?: Prisma.ServiceDependencyUpdateWithWhereUniqueWithoutDependentInput | Prisma.ServiceDependencyUpdateWithWhereUniqueWithoutDependentInput[];
    updateMany?: Prisma.ServiceDependencyUpdateManyWithWhereWithoutDependentInput | Prisma.ServiceDependencyUpdateManyWithWhereWithoutDependentInput[];
    deleteMany?: Prisma.ServiceDependencyScalarWhereInput | Prisma.ServiceDependencyScalarWhereInput[];
};
export type ServiceDependencyUpdateManyWithoutDependencyNestedInput = {
    create?: Prisma.XOR<Prisma.ServiceDependencyCreateWithoutDependencyInput, Prisma.ServiceDependencyUncheckedCreateWithoutDependencyInput> | Prisma.ServiceDependencyCreateWithoutDependencyInput[] | Prisma.ServiceDependencyUncheckedCreateWithoutDependencyInput[];
    connectOrCreate?: Prisma.ServiceDependencyCreateOrConnectWithoutDependencyInput | Prisma.ServiceDependencyCreateOrConnectWithoutDependencyInput[];
    upsert?: Prisma.ServiceDependencyUpsertWithWhereUniqueWithoutDependencyInput | Prisma.ServiceDependencyUpsertWithWhereUniqueWithoutDependencyInput[];
    createMany?: Prisma.ServiceDependencyCreateManyDependencyInputEnvelope;
    set?: Prisma.ServiceDependencyWhereUniqueInput | Prisma.ServiceDependencyWhereUniqueInput[];
    disconnect?: Prisma.ServiceDependencyWhereUniqueInput | Prisma.ServiceDependencyWhereUniqueInput[];
    delete?: Prisma.ServiceDependencyWhereUniqueInput | Prisma.ServiceDependencyWhereUniqueInput[];
    connect?: Prisma.ServiceDependencyWhereUniqueInput | Prisma.ServiceDependencyWhereUniqueInput[];
    update?: Prisma.ServiceDependencyUpdateWithWhereUniqueWithoutDependencyInput | Prisma.ServiceDependencyUpdateWithWhereUniqueWithoutDependencyInput[];
    updateMany?: Prisma.ServiceDependencyUpdateManyWithWhereWithoutDependencyInput | Prisma.ServiceDependencyUpdateManyWithWhereWithoutDependencyInput[];
    deleteMany?: Prisma.ServiceDependencyScalarWhereInput | Prisma.ServiceDependencyScalarWhereInput[];
};
export type ServiceDependencyUncheckedUpdateManyWithoutDependentNestedInput = {
    create?: Prisma.XOR<Prisma.ServiceDependencyCreateWithoutDependentInput, Prisma.ServiceDependencyUncheckedCreateWithoutDependentInput> | Prisma.ServiceDependencyCreateWithoutDependentInput[] | Prisma.ServiceDependencyUncheckedCreateWithoutDependentInput[];
    connectOrCreate?: Prisma.ServiceDependencyCreateOrConnectWithoutDependentInput | Prisma.ServiceDependencyCreateOrConnectWithoutDependentInput[];
    upsert?: Prisma.ServiceDependencyUpsertWithWhereUniqueWithoutDependentInput | Prisma.ServiceDependencyUpsertWithWhereUniqueWithoutDependentInput[];
    createMany?: Prisma.ServiceDependencyCreateManyDependentInputEnvelope;
    set?: Prisma.ServiceDependencyWhereUniqueInput | Prisma.ServiceDependencyWhereUniqueInput[];
    disconnect?: Prisma.ServiceDependencyWhereUniqueInput | Prisma.ServiceDependencyWhereUniqueInput[];
    delete?: Prisma.ServiceDependencyWhereUniqueInput | Prisma.ServiceDependencyWhereUniqueInput[];
    connect?: Prisma.ServiceDependencyWhereUniqueInput | Prisma.ServiceDependencyWhereUniqueInput[];
    update?: Prisma.ServiceDependencyUpdateWithWhereUniqueWithoutDependentInput | Prisma.ServiceDependencyUpdateWithWhereUniqueWithoutDependentInput[];
    updateMany?: Prisma.ServiceDependencyUpdateManyWithWhereWithoutDependentInput | Prisma.ServiceDependencyUpdateManyWithWhereWithoutDependentInput[];
    deleteMany?: Prisma.ServiceDependencyScalarWhereInput | Prisma.ServiceDependencyScalarWhereInput[];
};
export type ServiceDependencyUncheckedUpdateManyWithoutDependencyNestedInput = {
    create?: Prisma.XOR<Prisma.ServiceDependencyCreateWithoutDependencyInput, Prisma.ServiceDependencyUncheckedCreateWithoutDependencyInput> | Prisma.ServiceDependencyCreateWithoutDependencyInput[] | Prisma.ServiceDependencyUncheckedCreateWithoutDependencyInput[];
    connectOrCreate?: Prisma.ServiceDependencyCreateOrConnectWithoutDependencyInput | Prisma.ServiceDependencyCreateOrConnectWithoutDependencyInput[];
    upsert?: Prisma.ServiceDependencyUpsertWithWhereUniqueWithoutDependencyInput | Prisma.ServiceDependencyUpsertWithWhereUniqueWithoutDependencyInput[];
    createMany?: Prisma.ServiceDependencyCreateManyDependencyInputEnvelope;
    set?: Prisma.ServiceDependencyWhereUniqueInput | Prisma.ServiceDependencyWhereUniqueInput[];
    disconnect?: Prisma.ServiceDependencyWhereUniqueInput | Prisma.ServiceDependencyWhereUniqueInput[];
    delete?: Prisma.ServiceDependencyWhereUniqueInput | Prisma.ServiceDependencyWhereUniqueInput[];
    connect?: Prisma.ServiceDependencyWhereUniqueInput | Prisma.ServiceDependencyWhereUniqueInput[];
    update?: Prisma.ServiceDependencyUpdateWithWhereUniqueWithoutDependencyInput | Prisma.ServiceDependencyUpdateWithWhereUniqueWithoutDependencyInput[];
    updateMany?: Prisma.ServiceDependencyUpdateManyWithWhereWithoutDependencyInput | Prisma.ServiceDependencyUpdateManyWithWhereWithoutDependencyInput[];
    deleteMany?: Prisma.ServiceDependencyScalarWhereInput | Prisma.ServiceDependencyScalarWhereInput[];
};
export type ServiceDependencyCreateWithoutDependentInput = {
    id?: string;
    dependencyType?: string;
    criticality?: string;
    createdAt?: Date | string;
    dependency: Prisma.ServiceCreateNestedOneWithoutDependentsInput;
};
export type ServiceDependencyUncheckedCreateWithoutDependentInput = {
    id?: string;
    dependencyId: string;
    dependencyType?: string;
    criticality?: string;
    createdAt?: Date | string;
};
export type ServiceDependencyCreateOrConnectWithoutDependentInput = {
    where: Prisma.ServiceDependencyWhereUniqueInput;
    create: Prisma.XOR<Prisma.ServiceDependencyCreateWithoutDependentInput, Prisma.ServiceDependencyUncheckedCreateWithoutDependentInput>;
};
export type ServiceDependencyCreateManyDependentInputEnvelope = {
    data: Prisma.ServiceDependencyCreateManyDependentInput | Prisma.ServiceDependencyCreateManyDependentInput[];
};
export type ServiceDependencyCreateWithoutDependencyInput = {
    id?: string;
    dependencyType?: string;
    criticality?: string;
    createdAt?: Date | string;
    dependent: Prisma.ServiceCreateNestedOneWithoutDependenciesInput;
};
export type ServiceDependencyUncheckedCreateWithoutDependencyInput = {
    id?: string;
    dependentId: string;
    dependencyType?: string;
    criticality?: string;
    createdAt?: Date | string;
};
export type ServiceDependencyCreateOrConnectWithoutDependencyInput = {
    where: Prisma.ServiceDependencyWhereUniqueInput;
    create: Prisma.XOR<Prisma.ServiceDependencyCreateWithoutDependencyInput, Prisma.ServiceDependencyUncheckedCreateWithoutDependencyInput>;
};
export type ServiceDependencyCreateManyDependencyInputEnvelope = {
    data: Prisma.ServiceDependencyCreateManyDependencyInput | Prisma.ServiceDependencyCreateManyDependencyInput[];
};
export type ServiceDependencyUpsertWithWhereUniqueWithoutDependentInput = {
    where: Prisma.ServiceDependencyWhereUniqueInput;
    update: Prisma.XOR<Prisma.ServiceDependencyUpdateWithoutDependentInput, Prisma.ServiceDependencyUncheckedUpdateWithoutDependentInput>;
    create: Prisma.XOR<Prisma.ServiceDependencyCreateWithoutDependentInput, Prisma.ServiceDependencyUncheckedCreateWithoutDependentInput>;
};
export type ServiceDependencyUpdateWithWhereUniqueWithoutDependentInput = {
    where: Prisma.ServiceDependencyWhereUniqueInput;
    data: Prisma.XOR<Prisma.ServiceDependencyUpdateWithoutDependentInput, Prisma.ServiceDependencyUncheckedUpdateWithoutDependentInput>;
};
export type ServiceDependencyUpdateManyWithWhereWithoutDependentInput = {
    where: Prisma.ServiceDependencyScalarWhereInput;
    data: Prisma.XOR<Prisma.ServiceDependencyUpdateManyMutationInput, Prisma.ServiceDependencyUncheckedUpdateManyWithoutDependentInput>;
};
export type ServiceDependencyScalarWhereInput = {
    AND?: Prisma.ServiceDependencyScalarWhereInput | Prisma.ServiceDependencyScalarWhereInput[];
    OR?: Prisma.ServiceDependencyScalarWhereInput[];
    NOT?: Prisma.ServiceDependencyScalarWhereInput | Prisma.ServiceDependencyScalarWhereInput[];
    id?: Prisma.StringFilter<"ServiceDependency"> | string;
    dependentId?: Prisma.StringFilter<"ServiceDependency"> | string;
    dependencyId?: Prisma.StringFilter<"ServiceDependency"> | string;
    dependencyType?: Prisma.StringFilter<"ServiceDependency"> | string;
    criticality?: Prisma.StringFilter<"ServiceDependency"> | string;
    createdAt?: Prisma.DateTimeFilter<"ServiceDependency"> | Date | string;
};
export type ServiceDependencyUpsertWithWhereUniqueWithoutDependencyInput = {
    where: Prisma.ServiceDependencyWhereUniqueInput;
    update: Prisma.XOR<Prisma.ServiceDependencyUpdateWithoutDependencyInput, Prisma.ServiceDependencyUncheckedUpdateWithoutDependencyInput>;
    create: Prisma.XOR<Prisma.ServiceDependencyCreateWithoutDependencyInput, Prisma.ServiceDependencyUncheckedCreateWithoutDependencyInput>;
};
export type ServiceDependencyUpdateWithWhereUniqueWithoutDependencyInput = {
    where: Prisma.ServiceDependencyWhereUniqueInput;
    data: Prisma.XOR<Prisma.ServiceDependencyUpdateWithoutDependencyInput, Prisma.ServiceDependencyUncheckedUpdateWithoutDependencyInput>;
};
export type ServiceDependencyUpdateManyWithWhereWithoutDependencyInput = {
    where: Prisma.ServiceDependencyScalarWhereInput;
    data: Prisma.XOR<Prisma.ServiceDependencyUpdateManyMutationInput, Prisma.ServiceDependencyUncheckedUpdateManyWithoutDependencyInput>;
};
export type ServiceDependencyCreateManyDependentInput = {
    id?: string;
    dependencyId: string;
    dependencyType?: string;
    criticality?: string;
    createdAt?: Date | string;
};
export type ServiceDependencyCreateManyDependencyInput = {
    id?: string;
    dependentId: string;
    dependencyType?: string;
    criticality?: string;
    createdAt?: Date | string;
};
export type ServiceDependencyUpdateWithoutDependentInput = {
    id?: Prisma.StringFieldUpdateOperationsInput | string;
    dependencyType?: Prisma.StringFieldUpdateOperationsInput | string;
    criticality?: Prisma.StringFieldUpdateOperationsInput | string;
    createdAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
    dependency?: Prisma.ServiceUpdateOneRequiredWithoutDependentsNestedInput;
};
export type ServiceDependencyUncheckedUpdateWithoutDependentInput = {
    id?: Prisma.StringFieldUpdateOperationsInput | string;
    dependencyId?: Prisma.StringFieldUpdateOperationsInput | string;
    dependencyType?: Prisma.StringFieldUpdateOperationsInput | string;
    criticality?: Prisma.StringFieldUpdateOperationsInput | string;
    createdAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
};
export type ServiceDependencyUncheckedUpdateManyWithoutDependentInput = {
    id?: Prisma.StringFieldUpdateOperationsInput | string;
    dependencyId?: Prisma.StringFieldUpdateOperationsInput | string;
    dependencyType?: Prisma.StringFieldUpdateOperationsInput | string;
    criticality?: Prisma.StringFieldUpdateOperationsInput | string;
    createdAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
};
export type ServiceDependencyUpdateWithoutDependencyInput = {
    id?: Prisma.StringFieldUpdateOperationsInput | string;
    dependencyType?: Prisma.StringFieldUpdateOperationsInput | string;
    criticality?: Prisma.StringFieldUpdateOperationsInput | string;
    createdAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
    dependent?: Prisma.ServiceUpdateOneRequiredWithoutDependenciesNestedInput;
};
export type ServiceDependencyUncheckedUpdateWithoutDependencyInput = {
    id?: Prisma.StringFieldUpdateOperationsInput | string;
    dependentId?: Prisma.StringFieldUpdateOperationsInput | string;
    dependencyType?: Prisma.StringFieldUpdateOperationsInput | string;
    criticality?: Prisma.StringFieldUpdateOperationsInput | string;
    createdAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
};
export type ServiceDependencyUncheckedUpdateManyWithoutDependencyInput = {
    id?: Prisma.StringFieldUpdateOperationsInput | string;
    dependentId?: Prisma.StringFieldUpdateOperationsInput | string;
    dependencyType?: Prisma.StringFieldUpdateOperationsInput | string;
    criticality?: Prisma.StringFieldUpdateOperationsInput | string;
    createdAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
};
export type ServiceDependencySelect<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = runtime.Types.Extensions.GetSelect<{
    id?: boolean;
    dependentId?: boolean;
    dependencyId?: boolean;
    dependencyType?: boolean;
    criticality?: boolean;
    createdAt?: boolean;
    dependent?: boolean | Prisma.ServiceDefaultArgs<ExtArgs>;
    dependency?: boolean | Prisma.ServiceDefaultArgs<ExtArgs>;
}, ExtArgs["result"]["serviceDependency"]>;
export type ServiceDependencySelectCreateManyAndReturn<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = runtime.Types.Extensions.GetSelect<{
    id?: boolean;
    dependentId?: boolean;
    dependencyId?: boolean;
    dependencyType?: boolean;
    criticality?: boolean;
    createdAt?: boolean;
    dependent?: boolean | Prisma.ServiceDefaultArgs<ExtArgs>;
    dependency?: boolean | Prisma.ServiceDefaultArgs<ExtArgs>;
}, ExtArgs["result"]["serviceDependency"]>;
export type ServiceDependencySelectUpdateManyAndReturn<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = runtime.Types.Extensions.GetSelect<{
    id?: boolean;
    dependentId?: boolean;
    dependencyId?: boolean;
    dependencyType?: boolean;
    criticality?: boolean;
    createdAt?: boolean;
    dependent?: boolean | Prisma.ServiceDefaultArgs<ExtArgs>;
    dependency?: boolean | Prisma.ServiceDefaultArgs<ExtArgs>;
}, ExtArgs["result"]["serviceDependency"]>;
export type ServiceDependencySelectScalar = {
    id?: boolean;
    dependentId?: boolean;
    dependencyId?: boolean;
    dependencyType?: boolean;
    criticality?: boolean;
    createdAt?: boolean;
};
export type ServiceDependencyOmit<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = runtime.Types.Extensions.GetOmit<"id" | "dependentId" | "dependencyId" | "dependencyType" | "criticality" | "createdAt", ExtArgs["result"]["serviceDependency"]>;
export type ServiceDependencyInclude<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    dependent?: boolean | Prisma.ServiceDefaultArgs<ExtArgs>;
    dependency?: boolean | Prisma.ServiceDefaultArgs<ExtArgs>;
};
export type ServiceDependencyIncludeCreateManyAndReturn<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    dependent?: boolean | Prisma.ServiceDefaultArgs<ExtArgs>;
    dependency?: boolean | Prisma.ServiceDefaultArgs<ExtArgs>;
};
export type ServiceDependencyIncludeUpdateManyAndReturn<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    dependent?: boolean | Prisma.ServiceDefaultArgs<ExtArgs>;
    dependency?: boolean | Prisma.ServiceDefaultArgs<ExtArgs>;
};
export type $ServiceDependencyPayload<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    name: "ServiceDependency";
    objects: {
        dependent: Prisma.$ServicePayload<ExtArgs>;
        dependency: Prisma.$ServicePayload<ExtArgs>;
    };
    scalars: runtime.Types.Extensions.GetPayloadResult<{
        id: string;
        dependentId: string;
        dependencyId: string;
        dependencyType: string;
        criticality: string;
        createdAt: Date;
    }, ExtArgs["result"]["serviceDependency"]>;
    composites: {};
};
export type ServiceDependencyGetPayload<S extends boolean | null | undefined | ServiceDependencyDefaultArgs> = runtime.Types.Result.GetResult<Prisma.$ServiceDependencyPayload, S>;
export type ServiceDependencyCountArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = Omit<ServiceDependencyFindManyArgs, 'select' | 'include' | 'distinct' | 'omit'> & {
    select?: ServiceDependencyCountAggregateInputType | true;
};
export interface ServiceDependencyDelegate<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs, GlobalOmitOptions = {}> {
    [K: symbol]: {
        types: Prisma.TypeMap<ExtArgs>['model']['ServiceDependency'];
        meta: {
            name: 'ServiceDependency';
        };
    };
    findUnique<T extends ServiceDependencyFindUniqueArgs>(args: Prisma.SelectSubset<T, ServiceDependencyFindUniqueArgs<ExtArgs>>): Prisma.Prisma__ServiceDependencyClient<runtime.Types.Result.GetResult<Prisma.$ServiceDependencyPayload<ExtArgs>, T, "findUnique", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>;
    findUniqueOrThrow<T extends ServiceDependencyFindUniqueOrThrowArgs>(args: Prisma.SelectSubset<T, ServiceDependencyFindUniqueOrThrowArgs<ExtArgs>>): Prisma.Prisma__ServiceDependencyClient<runtime.Types.Result.GetResult<Prisma.$ServiceDependencyPayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>;
    findFirst<T extends ServiceDependencyFindFirstArgs>(args?: Prisma.SelectSubset<T, ServiceDependencyFindFirstArgs<ExtArgs>>): Prisma.Prisma__ServiceDependencyClient<runtime.Types.Result.GetResult<Prisma.$ServiceDependencyPayload<ExtArgs>, T, "findFirst", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>;
    findFirstOrThrow<T extends ServiceDependencyFindFirstOrThrowArgs>(args?: Prisma.SelectSubset<T, ServiceDependencyFindFirstOrThrowArgs<ExtArgs>>): Prisma.Prisma__ServiceDependencyClient<runtime.Types.Result.GetResult<Prisma.$ServiceDependencyPayload<ExtArgs>, T, "findFirstOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>;
    findMany<T extends ServiceDependencyFindManyArgs>(args?: Prisma.SelectSubset<T, ServiceDependencyFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<runtime.Types.Result.GetResult<Prisma.$ServiceDependencyPayload<ExtArgs>, T, "findMany", GlobalOmitOptions>>;
    create<T extends ServiceDependencyCreateArgs>(args: Prisma.SelectSubset<T, ServiceDependencyCreateArgs<ExtArgs>>): Prisma.Prisma__ServiceDependencyClient<runtime.Types.Result.GetResult<Prisma.$ServiceDependencyPayload<ExtArgs>, T, "create", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>;
    createMany<T extends ServiceDependencyCreateManyArgs>(args?: Prisma.SelectSubset<T, ServiceDependencyCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<Prisma.BatchPayload>;
    createManyAndReturn<T extends ServiceDependencyCreateManyAndReturnArgs>(args?: Prisma.SelectSubset<T, ServiceDependencyCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<runtime.Types.Result.GetResult<Prisma.$ServiceDependencyPayload<ExtArgs>, T, "createManyAndReturn", GlobalOmitOptions>>;
    delete<T extends ServiceDependencyDeleteArgs>(args: Prisma.SelectSubset<T, ServiceDependencyDeleteArgs<ExtArgs>>): Prisma.Prisma__ServiceDependencyClient<runtime.Types.Result.GetResult<Prisma.$ServiceDependencyPayload<ExtArgs>, T, "delete", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>;
    update<T extends ServiceDependencyUpdateArgs>(args: Prisma.SelectSubset<T, ServiceDependencyUpdateArgs<ExtArgs>>): Prisma.Prisma__ServiceDependencyClient<runtime.Types.Result.GetResult<Prisma.$ServiceDependencyPayload<ExtArgs>, T, "update", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>;
    deleteMany<T extends ServiceDependencyDeleteManyArgs>(args?: Prisma.SelectSubset<T, ServiceDependencyDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<Prisma.BatchPayload>;
    updateMany<T extends ServiceDependencyUpdateManyArgs>(args: Prisma.SelectSubset<T, ServiceDependencyUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<Prisma.BatchPayload>;
    updateManyAndReturn<T extends ServiceDependencyUpdateManyAndReturnArgs>(args: Prisma.SelectSubset<T, ServiceDependencyUpdateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<runtime.Types.Result.GetResult<Prisma.$ServiceDependencyPayload<ExtArgs>, T, "updateManyAndReturn", GlobalOmitOptions>>;
    upsert<T extends ServiceDependencyUpsertArgs>(args: Prisma.SelectSubset<T, ServiceDependencyUpsertArgs<ExtArgs>>): Prisma.Prisma__ServiceDependencyClient<runtime.Types.Result.GetResult<Prisma.$ServiceDependencyPayload<ExtArgs>, T, "upsert", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>;
    count<T extends ServiceDependencyCountArgs>(args?: Prisma.Subset<T, ServiceDependencyCountArgs>): Prisma.PrismaPromise<T extends runtime.Types.Utils.Record<'select', any> ? T['select'] extends true ? number : Prisma.GetScalarType<T['select'], ServiceDependencyCountAggregateOutputType> : number>;
    aggregate<T extends ServiceDependencyAggregateArgs>(args: Prisma.Subset<T, ServiceDependencyAggregateArgs>): Prisma.PrismaPromise<GetServiceDependencyAggregateType<T>>;
    groupBy<T extends ServiceDependencyGroupByArgs, HasSelectOrTake extends Prisma.Or<Prisma.Extends<'skip', Prisma.Keys<T>>, Prisma.Extends<'take', Prisma.Keys<T>>>, OrderByArg extends Prisma.True extends HasSelectOrTake ? {
        orderBy: ServiceDependencyGroupByArgs['orderBy'];
    } : {
        orderBy?: ServiceDependencyGroupByArgs['orderBy'];
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
    }[OrderFields]>(args: Prisma.SubsetIntersection<T, ServiceDependencyGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetServiceDependencyGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>;
    readonly fields: ServiceDependencyFieldRefs;
}
export interface Prisma__ServiceDependencyClient<T, Null = never, ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs, GlobalOmitOptions = {}> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise";
    dependent<T extends Prisma.ServiceDefaultArgs<ExtArgs> = {}>(args?: Prisma.Subset<T, Prisma.ServiceDefaultArgs<ExtArgs>>): Prisma.Prisma__ServiceClient<runtime.Types.Result.GetResult<Prisma.$ServicePayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions> | Null, Null, ExtArgs, GlobalOmitOptions>;
    dependency<T extends Prisma.ServiceDefaultArgs<ExtArgs> = {}>(args?: Prisma.Subset<T, Prisma.ServiceDefaultArgs<ExtArgs>>): Prisma.Prisma__ServiceClient<runtime.Types.Result.GetResult<Prisma.$ServicePayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions> | Null, Null, ExtArgs, GlobalOmitOptions>;
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): runtime.Types.Utils.JsPromise<TResult1 | TResult2>;
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): runtime.Types.Utils.JsPromise<T | TResult>;
    finally(onfinally?: (() => void) | undefined | null): runtime.Types.Utils.JsPromise<T>;
}
export interface ServiceDependencyFieldRefs {
    readonly id: Prisma.FieldRef<"ServiceDependency", 'String'>;
    readonly dependentId: Prisma.FieldRef<"ServiceDependency", 'String'>;
    readonly dependencyId: Prisma.FieldRef<"ServiceDependency", 'String'>;
    readonly dependencyType: Prisma.FieldRef<"ServiceDependency", 'String'>;
    readonly criticality: Prisma.FieldRef<"ServiceDependency", 'String'>;
    readonly createdAt: Prisma.FieldRef<"ServiceDependency", 'DateTime'>;
}
export type ServiceDependencyFindUniqueArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    select?: Prisma.ServiceDependencySelect<ExtArgs> | null;
    omit?: Prisma.ServiceDependencyOmit<ExtArgs> | null;
    include?: Prisma.ServiceDependencyInclude<ExtArgs> | null;
    where: Prisma.ServiceDependencyWhereUniqueInput;
};
export type ServiceDependencyFindUniqueOrThrowArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    select?: Prisma.ServiceDependencySelect<ExtArgs> | null;
    omit?: Prisma.ServiceDependencyOmit<ExtArgs> | null;
    include?: Prisma.ServiceDependencyInclude<ExtArgs> | null;
    where: Prisma.ServiceDependencyWhereUniqueInput;
};
export type ServiceDependencyFindFirstArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    select?: Prisma.ServiceDependencySelect<ExtArgs> | null;
    omit?: Prisma.ServiceDependencyOmit<ExtArgs> | null;
    include?: Prisma.ServiceDependencyInclude<ExtArgs> | null;
    where?: Prisma.ServiceDependencyWhereInput;
    orderBy?: Prisma.ServiceDependencyOrderByWithRelationInput | Prisma.ServiceDependencyOrderByWithRelationInput[];
    cursor?: Prisma.ServiceDependencyWhereUniqueInput;
    take?: number;
    skip?: number;
    distinct?: Prisma.ServiceDependencyScalarFieldEnum | Prisma.ServiceDependencyScalarFieldEnum[];
};
export type ServiceDependencyFindFirstOrThrowArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    select?: Prisma.ServiceDependencySelect<ExtArgs> | null;
    omit?: Prisma.ServiceDependencyOmit<ExtArgs> | null;
    include?: Prisma.ServiceDependencyInclude<ExtArgs> | null;
    where?: Prisma.ServiceDependencyWhereInput;
    orderBy?: Prisma.ServiceDependencyOrderByWithRelationInput | Prisma.ServiceDependencyOrderByWithRelationInput[];
    cursor?: Prisma.ServiceDependencyWhereUniqueInput;
    take?: number;
    skip?: number;
    distinct?: Prisma.ServiceDependencyScalarFieldEnum | Prisma.ServiceDependencyScalarFieldEnum[];
};
export type ServiceDependencyFindManyArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    select?: Prisma.ServiceDependencySelect<ExtArgs> | null;
    omit?: Prisma.ServiceDependencyOmit<ExtArgs> | null;
    include?: Prisma.ServiceDependencyInclude<ExtArgs> | null;
    where?: Prisma.ServiceDependencyWhereInput;
    orderBy?: Prisma.ServiceDependencyOrderByWithRelationInput | Prisma.ServiceDependencyOrderByWithRelationInput[];
    cursor?: Prisma.ServiceDependencyWhereUniqueInput;
    take?: number;
    skip?: number;
    distinct?: Prisma.ServiceDependencyScalarFieldEnum | Prisma.ServiceDependencyScalarFieldEnum[];
};
export type ServiceDependencyCreateArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    select?: Prisma.ServiceDependencySelect<ExtArgs> | null;
    omit?: Prisma.ServiceDependencyOmit<ExtArgs> | null;
    include?: Prisma.ServiceDependencyInclude<ExtArgs> | null;
    data: Prisma.XOR<Prisma.ServiceDependencyCreateInput, Prisma.ServiceDependencyUncheckedCreateInput>;
};
export type ServiceDependencyCreateManyArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    data: Prisma.ServiceDependencyCreateManyInput | Prisma.ServiceDependencyCreateManyInput[];
};
export type ServiceDependencyCreateManyAndReturnArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    select?: Prisma.ServiceDependencySelectCreateManyAndReturn<ExtArgs> | null;
    omit?: Prisma.ServiceDependencyOmit<ExtArgs> | null;
    data: Prisma.ServiceDependencyCreateManyInput | Prisma.ServiceDependencyCreateManyInput[];
    include?: Prisma.ServiceDependencyIncludeCreateManyAndReturn<ExtArgs> | null;
};
export type ServiceDependencyUpdateArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    select?: Prisma.ServiceDependencySelect<ExtArgs> | null;
    omit?: Prisma.ServiceDependencyOmit<ExtArgs> | null;
    include?: Prisma.ServiceDependencyInclude<ExtArgs> | null;
    data: Prisma.XOR<Prisma.ServiceDependencyUpdateInput, Prisma.ServiceDependencyUncheckedUpdateInput>;
    where: Prisma.ServiceDependencyWhereUniqueInput;
};
export type ServiceDependencyUpdateManyArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    data: Prisma.XOR<Prisma.ServiceDependencyUpdateManyMutationInput, Prisma.ServiceDependencyUncheckedUpdateManyInput>;
    where?: Prisma.ServiceDependencyWhereInput;
    limit?: number;
};
export type ServiceDependencyUpdateManyAndReturnArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    select?: Prisma.ServiceDependencySelectUpdateManyAndReturn<ExtArgs> | null;
    omit?: Prisma.ServiceDependencyOmit<ExtArgs> | null;
    data: Prisma.XOR<Prisma.ServiceDependencyUpdateManyMutationInput, Prisma.ServiceDependencyUncheckedUpdateManyInput>;
    where?: Prisma.ServiceDependencyWhereInput;
    limit?: number;
    include?: Prisma.ServiceDependencyIncludeUpdateManyAndReturn<ExtArgs> | null;
};
export type ServiceDependencyUpsertArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    select?: Prisma.ServiceDependencySelect<ExtArgs> | null;
    omit?: Prisma.ServiceDependencyOmit<ExtArgs> | null;
    include?: Prisma.ServiceDependencyInclude<ExtArgs> | null;
    where: Prisma.ServiceDependencyWhereUniqueInput;
    create: Prisma.XOR<Prisma.ServiceDependencyCreateInput, Prisma.ServiceDependencyUncheckedCreateInput>;
    update: Prisma.XOR<Prisma.ServiceDependencyUpdateInput, Prisma.ServiceDependencyUncheckedUpdateInput>;
};
export type ServiceDependencyDeleteArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    select?: Prisma.ServiceDependencySelect<ExtArgs> | null;
    omit?: Prisma.ServiceDependencyOmit<ExtArgs> | null;
    include?: Prisma.ServiceDependencyInclude<ExtArgs> | null;
    where: Prisma.ServiceDependencyWhereUniqueInput;
};
export type ServiceDependencyDeleteManyArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    where?: Prisma.ServiceDependencyWhereInput;
    limit?: number;
};
export type ServiceDependencyDefaultArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    select?: Prisma.ServiceDependencySelect<ExtArgs> | null;
    omit?: Prisma.ServiceDependencyOmit<ExtArgs> | null;
    include?: Prisma.ServiceDependencyInclude<ExtArgs> | null;
};
export {};
