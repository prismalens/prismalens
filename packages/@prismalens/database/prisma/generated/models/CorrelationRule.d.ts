import type * as runtime from "@prisma/client/runtime/client";
import type * as Prisma from "../internal/prismaNamespace.js";
export type CorrelationRuleModel = runtime.Types.Result.DefaultSelection<Prisma.$CorrelationRulePayload>;
export type AggregateCorrelationRule = {
    _count: CorrelationRuleCountAggregateOutputType | null;
    _avg: CorrelationRuleAvgAggregateOutputType | null;
    _sum: CorrelationRuleSumAggregateOutputType | null;
    _min: CorrelationRuleMinAggregateOutputType | null;
    _max: CorrelationRuleMaxAggregateOutputType | null;
};
export type CorrelationRuleAvgAggregateOutputType = {
    priority: number | null;
    timeWindowMinutes: number | null;
};
export type CorrelationRuleSumAggregateOutputType = {
    priority: number | null;
    timeWindowMinutes: number | null;
};
export type CorrelationRuleMinAggregateOutputType = {
    id: string | null;
    name: string | null;
    description: string | null;
    enabled: boolean | null;
    priority: number | null;
    matchCriteria: string | null;
    timeWindowMinutes: number | null;
    action: string | null;
    createdAt: Date | null;
    updatedAt: Date | null;
};
export type CorrelationRuleMaxAggregateOutputType = {
    id: string | null;
    name: string | null;
    description: string | null;
    enabled: boolean | null;
    priority: number | null;
    matchCriteria: string | null;
    timeWindowMinutes: number | null;
    action: string | null;
    createdAt: Date | null;
    updatedAt: Date | null;
};
export type CorrelationRuleCountAggregateOutputType = {
    id: number;
    name: number;
    description: number;
    enabled: number;
    priority: number;
    matchCriteria: number;
    timeWindowMinutes: number;
    action: number;
    createdAt: number;
    updatedAt: number;
    _all: number;
};
export type CorrelationRuleAvgAggregateInputType = {
    priority?: true;
    timeWindowMinutes?: true;
};
export type CorrelationRuleSumAggregateInputType = {
    priority?: true;
    timeWindowMinutes?: true;
};
export type CorrelationRuleMinAggregateInputType = {
    id?: true;
    name?: true;
    description?: true;
    enabled?: true;
    priority?: true;
    matchCriteria?: true;
    timeWindowMinutes?: true;
    action?: true;
    createdAt?: true;
    updatedAt?: true;
};
export type CorrelationRuleMaxAggregateInputType = {
    id?: true;
    name?: true;
    description?: true;
    enabled?: true;
    priority?: true;
    matchCriteria?: true;
    timeWindowMinutes?: true;
    action?: true;
    createdAt?: true;
    updatedAt?: true;
};
export type CorrelationRuleCountAggregateInputType = {
    id?: true;
    name?: true;
    description?: true;
    enabled?: true;
    priority?: true;
    matchCriteria?: true;
    timeWindowMinutes?: true;
    action?: true;
    createdAt?: true;
    updatedAt?: true;
    _all?: true;
};
export type CorrelationRuleAggregateArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    where?: Prisma.CorrelationRuleWhereInput;
    orderBy?: Prisma.CorrelationRuleOrderByWithRelationInput | Prisma.CorrelationRuleOrderByWithRelationInput[];
    cursor?: Prisma.CorrelationRuleWhereUniqueInput;
    take?: number;
    skip?: number;
    _count?: true | CorrelationRuleCountAggregateInputType;
    _avg?: CorrelationRuleAvgAggregateInputType;
    _sum?: CorrelationRuleSumAggregateInputType;
    _min?: CorrelationRuleMinAggregateInputType;
    _max?: CorrelationRuleMaxAggregateInputType;
};
export type GetCorrelationRuleAggregateType<T extends CorrelationRuleAggregateArgs> = {
    [P in keyof T & keyof AggregateCorrelationRule]: P extends '_count' | 'count' ? T[P] extends true ? number : Prisma.GetScalarType<T[P], AggregateCorrelationRule[P]> : Prisma.GetScalarType<T[P], AggregateCorrelationRule[P]>;
};
export type CorrelationRuleGroupByArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    where?: Prisma.CorrelationRuleWhereInput;
    orderBy?: Prisma.CorrelationRuleOrderByWithAggregationInput | Prisma.CorrelationRuleOrderByWithAggregationInput[];
    by: Prisma.CorrelationRuleScalarFieldEnum[] | Prisma.CorrelationRuleScalarFieldEnum;
    having?: Prisma.CorrelationRuleScalarWhereWithAggregatesInput;
    take?: number;
    skip?: number;
    _count?: CorrelationRuleCountAggregateInputType | true;
    _avg?: CorrelationRuleAvgAggregateInputType;
    _sum?: CorrelationRuleSumAggregateInputType;
    _min?: CorrelationRuleMinAggregateInputType;
    _max?: CorrelationRuleMaxAggregateInputType;
};
export type CorrelationRuleGroupByOutputType = {
    id: string;
    name: string;
    description: string | null;
    enabled: boolean;
    priority: number;
    matchCriteria: string;
    timeWindowMinutes: number;
    action: string;
    createdAt: Date;
    updatedAt: Date;
    _count: CorrelationRuleCountAggregateOutputType | null;
    _avg: CorrelationRuleAvgAggregateOutputType | null;
    _sum: CorrelationRuleSumAggregateOutputType | null;
    _min: CorrelationRuleMinAggregateOutputType | null;
    _max: CorrelationRuleMaxAggregateOutputType | null;
};
type GetCorrelationRuleGroupByPayload<T extends CorrelationRuleGroupByArgs> = Prisma.PrismaPromise<Array<Prisma.PickEnumerable<CorrelationRuleGroupByOutputType, T['by']> & {
    [P in ((keyof T) & (keyof CorrelationRuleGroupByOutputType))]: P extends '_count' ? T[P] extends boolean ? number : Prisma.GetScalarType<T[P], CorrelationRuleGroupByOutputType[P]> : Prisma.GetScalarType<T[P], CorrelationRuleGroupByOutputType[P]>;
}>>;
export type CorrelationRuleWhereInput = {
    AND?: Prisma.CorrelationRuleWhereInput | Prisma.CorrelationRuleWhereInput[];
    OR?: Prisma.CorrelationRuleWhereInput[];
    NOT?: Prisma.CorrelationRuleWhereInput | Prisma.CorrelationRuleWhereInput[];
    id?: Prisma.StringFilter<"CorrelationRule"> | string;
    name?: Prisma.StringFilter<"CorrelationRule"> | string;
    description?: Prisma.StringNullableFilter<"CorrelationRule"> | string | null;
    enabled?: Prisma.BoolFilter<"CorrelationRule"> | boolean;
    priority?: Prisma.IntFilter<"CorrelationRule"> | number;
    matchCriteria?: Prisma.StringFilter<"CorrelationRule"> | string;
    timeWindowMinutes?: Prisma.IntFilter<"CorrelationRule"> | number;
    action?: Prisma.StringFilter<"CorrelationRule"> | string;
    createdAt?: Prisma.DateTimeFilter<"CorrelationRule"> | Date | string;
    updatedAt?: Prisma.DateTimeFilter<"CorrelationRule"> | Date | string;
    incidents?: Prisma.IncidentListRelationFilter;
};
export type CorrelationRuleOrderByWithRelationInput = {
    id?: Prisma.SortOrder;
    name?: Prisma.SortOrder;
    description?: Prisma.SortOrderInput | Prisma.SortOrder;
    enabled?: Prisma.SortOrder;
    priority?: Prisma.SortOrder;
    matchCriteria?: Prisma.SortOrder;
    timeWindowMinutes?: Prisma.SortOrder;
    action?: Prisma.SortOrder;
    createdAt?: Prisma.SortOrder;
    updatedAt?: Prisma.SortOrder;
    incidents?: Prisma.IncidentOrderByRelationAggregateInput;
};
export type CorrelationRuleWhereUniqueInput = Prisma.AtLeast<{
    id?: string;
    name?: string;
    AND?: Prisma.CorrelationRuleWhereInput | Prisma.CorrelationRuleWhereInput[];
    OR?: Prisma.CorrelationRuleWhereInput[];
    NOT?: Prisma.CorrelationRuleWhereInput | Prisma.CorrelationRuleWhereInput[];
    description?: Prisma.StringNullableFilter<"CorrelationRule"> | string | null;
    enabled?: Prisma.BoolFilter<"CorrelationRule"> | boolean;
    priority?: Prisma.IntFilter<"CorrelationRule"> | number;
    matchCriteria?: Prisma.StringFilter<"CorrelationRule"> | string;
    timeWindowMinutes?: Prisma.IntFilter<"CorrelationRule"> | number;
    action?: Prisma.StringFilter<"CorrelationRule"> | string;
    createdAt?: Prisma.DateTimeFilter<"CorrelationRule"> | Date | string;
    updatedAt?: Prisma.DateTimeFilter<"CorrelationRule"> | Date | string;
    incidents?: Prisma.IncidentListRelationFilter;
}, "id" | "name">;
export type CorrelationRuleOrderByWithAggregationInput = {
    id?: Prisma.SortOrder;
    name?: Prisma.SortOrder;
    description?: Prisma.SortOrderInput | Prisma.SortOrder;
    enabled?: Prisma.SortOrder;
    priority?: Prisma.SortOrder;
    matchCriteria?: Prisma.SortOrder;
    timeWindowMinutes?: Prisma.SortOrder;
    action?: Prisma.SortOrder;
    createdAt?: Prisma.SortOrder;
    updatedAt?: Prisma.SortOrder;
    _count?: Prisma.CorrelationRuleCountOrderByAggregateInput;
    _avg?: Prisma.CorrelationRuleAvgOrderByAggregateInput;
    _max?: Prisma.CorrelationRuleMaxOrderByAggregateInput;
    _min?: Prisma.CorrelationRuleMinOrderByAggregateInput;
    _sum?: Prisma.CorrelationRuleSumOrderByAggregateInput;
};
export type CorrelationRuleScalarWhereWithAggregatesInput = {
    AND?: Prisma.CorrelationRuleScalarWhereWithAggregatesInput | Prisma.CorrelationRuleScalarWhereWithAggregatesInput[];
    OR?: Prisma.CorrelationRuleScalarWhereWithAggregatesInput[];
    NOT?: Prisma.CorrelationRuleScalarWhereWithAggregatesInput | Prisma.CorrelationRuleScalarWhereWithAggregatesInput[];
    id?: Prisma.StringWithAggregatesFilter<"CorrelationRule"> | string;
    name?: Prisma.StringWithAggregatesFilter<"CorrelationRule"> | string;
    description?: Prisma.StringNullableWithAggregatesFilter<"CorrelationRule"> | string | null;
    enabled?: Prisma.BoolWithAggregatesFilter<"CorrelationRule"> | boolean;
    priority?: Prisma.IntWithAggregatesFilter<"CorrelationRule"> | number;
    matchCriteria?: Prisma.StringWithAggregatesFilter<"CorrelationRule"> | string;
    timeWindowMinutes?: Prisma.IntWithAggregatesFilter<"CorrelationRule"> | number;
    action?: Prisma.StringWithAggregatesFilter<"CorrelationRule"> | string;
    createdAt?: Prisma.DateTimeWithAggregatesFilter<"CorrelationRule"> | Date | string;
    updatedAt?: Prisma.DateTimeWithAggregatesFilter<"CorrelationRule"> | Date | string;
};
export type CorrelationRuleCreateInput = {
    id?: string;
    name: string;
    description?: string | null;
    enabled?: boolean;
    priority?: number;
    matchCriteria: string;
    timeWindowMinutes?: number;
    action?: string;
    createdAt?: Date | string;
    updatedAt?: Date | string;
    incidents?: Prisma.IncidentCreateNestedManyWithoutCorrelationRuleInput;
};
export type CorrelationRuleUncheckedCreateInput = {
    id?: string;
    name: string;
    description?: string | null;
    enabled?: boolean;
    priority?: number;
    matchCriteria: string;
    timeWindowMinutes?: number;
    action?: string;
    createdAt?: Date | string;
    updatedAt?: Date | string;
    incidents?: Prisma.IncidentUncheckedCreateNestedManyWithoutCorrelationRuleInput;
};
export type CorrelationRuleUpdateInput = {
    id?: Prisma.StringFieldUpdateOperationsInput | string;
    name?: Prisma.StringFieldUpdateOperationsInput | string;
    description?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
    enabled?: Prisma.BoolFieldUpdateOperationsInput | boolean;
    priority?: Prisma.IntFieldUpdateOperationsInput | number;
    matchCriteria?: Prisma.StringFieldUpdateOperationsInput | string;
    timeWindowMinutes?: Prisma.IntFieldUpdateOperationsInput | number;
    action?: Prisma.StringFieldUpdateOperationsInput | string;
    createdAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
    updatedAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
    incidents?: Prisma.IncidentUpdateManyWithoutCorrelationRuleNestedInput;
};
export type CorrelationRuleUncheckedUpdateInput = {
    id?: Prisma.StringFieldUpdateOperationsInput | string;
    name?: Prisma.StringFieldUpdateOperationsInput | string;
    description?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
    enabled?: Prisma.BoolFieldUpdateOperationsInput | boolean;
    priority?: Prisma.IntFieldUpdateOperationsInput | number;
    matchCriteria?: Prisma.StringFieldUpdateOperationsInput | string;
    timeWindowMinutes?: Prisma.IntFieldUpdateOperationsInput | number;
    action?: Prisma.StringFieldUpdateOperationsInput | string;
    createdAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
    updatedAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
    incidents?: Prisma.IncidentUncheckedUpdateManyWithoutCorrelationRuleNestedInput;
};
export type CorrelationRuleCreateManyInput = {
    id?: string;
    name: string;
    description?: string | null;
    enabled?: boolean;
    priority?: number;
    matchCriteria: string;
    timeWindowMinutes?: number;
    action?: string;
    createdAt?: Date | string;
    updatedAt?: Date | string;
};
export type CorrelationRuleUpdateManyMutationInput = {
    id?: Prisma.StringFieldUpdateOperationsInput | string;
    name?: Prisma.StringFieldUpdateOperationsInput | string;
    description?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
    enabled?: Prisma.BoolFieldUpdateOperationsInput | boolean;
    priority?: Prisma.IntFieldUpdateOperationsInput | number;
    matchCriteria?: Prisma.StringFieldUpdateOperationsInput | string;
    timeWindowMinutes?: Prisma.IntFieldUpdateOperationsInput | number;
    action?: Prisma.StringFieldUpdateOperationsInput | string;
    createdAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
    updatedAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
};
export type CorrelationRuleUncheckedUpdateManyInput = {
    id?: Prisma.StringFieldUpdateOperationsInput | string;
    name?: Prisma.StringFieldUpdateOperationsInput | string;
    description?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
    enabled?: Prisma.BoolFieldUpdateOperationsInput | boolean;
    priority?: Prisma.IntFieldUpdateOperationsInput | number;
    matchCriteria?: Prisma.StringFieldUpdateOperationsInput | string;
    timeWindowMinutes?: Prisma.IntFieldUpdateOperationsInput | number;
    action?: Prisma.StringFieldUpdateOperationsInput | string;
    createdAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
    updatedAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
};
export type CorrelationRuleNullableScalarRelationFilter = {
    is?: Prisma.CorrelationRuleWhereInput | null;
    isNot?: Prisma.CorrelationRuleWhereInput | null;
};
export type CorrelationRuleCountOrderByAggregateInput = {
    id?: Prisma.SortOrder;
    name?: Prisma.SortOrder;
    description?: Prisma.SortOrder;
    enabled?: Prisma.SortOrder;
    priority?: Prisma.SortOrder;
    matchCriteria?: Prisma.SortOrder;
    timeWindowMinutes?: Prisma.SortOrder;
    action?: Prisma.SortOrder;
    createdAt?: Prisma.SortOrder;
    updatedAt?: Prisma.SortOrder;
};
export type CorrelationRuleAvgOrderByAggregateInput = {
    priority?: Prisma.SortOrder;
    timeWindowMinutes?: Prisma.SortOrder;
};
export type CorrelationRuleMaxOrderByAggregateInput = {
    id?: Prisma.SortOrder;
    name?: Prisma.SortOrder;
    description?: Prisma.SortOrder;
    enabled?: Prisma.SortOrder;
    priority?: Prisma.SortOrder;
    matchCriteria?: Prisma.SortOrder;
    timeWindowMinutes?: Prisma.SortOrder;
    action?: Prisma.SortOrder;
    createdAt?: Prisma.SortOrder;
    updatedAt?: Prisma.SortOrder;
};
export type CorrelationRuleMinOrderByAggregateInput = {
    id?: Prisma.SortOrder;
    name?: Prisma.SortOrder;
    description?: Prisma.SortOrder;
    enabled?: Prisma.SortOrder;
    priority?: Prisma.SortOrder;
    matchCriteria?: Prisma.SortOrder;
    timeWindowMinutes?: Prisma.SortOrder;
    action?: Prisma.SortOrder;
    createdAt?: Prisma.SortOrder;
    updatedAt?: Prisma.SortOrder;
};
export type CorrelationRuleSumOrderByAggregateInput = {
    priority?: Prisma.SortOrder;
    timeWindowMinutes?: Prisma.SortOrder;
};
export type CorrelationRuleCreateNestedOneWithoutIncidentsInput = {
    create?: Prisma.XOR<Prisma.CorrelationRuleCreateWithoutIncidentsInput, Prisma.CorrelationRuleUncheckedCreateWithoutIncidentsInput>;
    connectOrCreate?: Prisma.CorrelationRuleCreateOrConnectWithoutIncidentsInput;
    connect?: Prisma.CorrelationRuleWhereUniqueInput;
};
export type CorrelationRuleUpdateOneWithoutIncidentsNestedInput = {
    create?: Prisma.XOR<Prisma.CorrelationRuleCreateWithoutIncidentsInput, Prisma.CorrelationRuleUncheckedCreateWithoutIncidentsInput>;
    connectOrCreate?: Prisma.CorrelationRuleCreateOrConnectWithoutIncidentsInput;
    upsert?: Prisma.CorrelationRuleUpsertWithoutIncidentsInput;
    disconnect?: Prisma.CorrelationRuleWhereInput | boolean;
    delete?: Prisma.CorrelationRuleWhereInput | boolean;
    connect?: Prisma.CorrelationRuleWhereUniqueInput;
    update?: Prisma.XOR<Prisma.XOR<Prisma.CorrelationRuleUpdateToOneWithWhereWithoutIncidentsInput, Prisma.CorrelationRuleUpdateWithoutIncidentsInput>, Prisma.CorrelationRuleUncheckedUpdateWithoutIncidentsInput>;
};
export type CorrelationRuleCreateWithoutIncidentsInput = {
    id?: string;
    name: string;
    description?: string | null;
    enabled?: boolean;
    priority?: number;
    matchCriteria: string;
    timeWindowMinutes?: number;
    action?: string;
    createdAt?: Date | string;
    updatedAt?: Date | string;
};
export type CorrelationRuleUncheckedCreateWithoutIncidentsInput = {
    id?: string;
    name: string;
    description?: string | null;
    enabled?: boolean;
    priority?: number;
    matchCriteria: string;
    timeWindowMinutes?: number;
    action?: string;
    createdAt?: Date | string;
    updatedAt?: Date | string;
};
export type CorrelationRuleCreateOrConnectWithoutIncidentsInput = {
    where: Prisma.CorrelationRuleWhereUniqueInput;
    create: Prisma.XOR<Prisma.CorrelationRuleCreateWithoutIncidentsInput, Prisma.CorrelationRuleUncheckedCreateWithoutIncidentsInput>;
};
export type CorrelationRuleUpsertWithoutIncidentsInput = {
    update: Prisma.XOR<Prisma.CorrelationRuleUpdateWithoutIncidentsInput, Prisma.CorrelationRuleUncheckedUpdateWithoutIncidentsInput>;
    create: Prisma.XOR<Prisma.CorrelationRuleCreateWithoutIncidentsInput, Prisma.CorrelationRuleUncheckedCreateWithoutIncidentsInput>;
    where?: Prisma.CorrelationRuleWhereInput;
};
export type CorrelationRuleUpdateToOneWithWhereWithoutIncidentsInput = {
    where?: Prisma.CorrelationRuleWhereInput;
    data: Prisma.XOR<Prisma.CorrelationRuleUpdateWithoutIncidentsInput, Prisma.CorrelationRuleUncheckedUpdateWithoutIncidentsInput>;
};
export type CorrelationRuleUpdateWithoutIncidentsInput = {
    id?: Prisma.StringFieldUpdateOperationsInput | string;
    name?: Prisma.StringFieldUpdateOperationsInput | string;
    description?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
    enabled?: Prisma.BoolFieldUpdateOperationsInput | boolean;
    priority?: Prisma.IntFieldUpdateOperationsInput | number;
    matchCriteria?: Prisma.StringFieldUpdateOperationsInput | string;
    timeWindowMinutes?: Prisma.IntFieldUpdateOperationsInput | number;
    action?: Prisma.StringFieldUpdateOperationsInput | string;
    createdAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
    updatedAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
};
export type CorrelationRuleUncheckedUpdateWithoutIncidentsInput = {
    id?: Prisma.StringFieldUpdateOperationsInput | string;
    name?: Prisma.StringFieldUpdateOperationsInput | string;
    description?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
    enabled?: Prisma.BoolFieldUpdateOperationsInput | boolean;
    priority?: Prisma.IntFieldUpdateOperationsInput | number;
    matchCriteria?: Prisma.StringFieldUpdateOperationsInput | string;
    timeWindowMinutes?: Prisma.IntFieldUpdateOperationsInput | number;
    action?: Prisma.StringFieldUpdateOperationsInput | string;
    createdAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
    updatedAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
};
export type CorrelationRuleCountOutputType = {
    incidents: number;
};
export type CorrelationRuleCountOutputTypeSelect<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    incidents?: boolean | CorrelationRuleCountOutputTypeCountIncidentsArgs;
};
export type CorrelationRuleCountOutputTypeDefaultArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    select?: Prisma.CorrelationRuleCountOutputTypeSelect<ExtArgs> | null;
};
export type CorrelationRuleCountOutputTypeCountIncidentsArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    where?: Prisma.IncidentWhereInput;
};
export type CorrelationRuleSelect<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = runtime.Types.Extensions.GetSelect<{
    id?: boolean;
    name?: boolean;
    description?: boolean;
    enabled?: boolean;
    priority?: boolean;
    matchCriteria?: boolean;
    timeWindowMinutes?: boolean;
    action?: boolean;
    createdAt?: boolean;
    updatedAt?: boolean;
    incidents?: boolean | Prisma.CorrelationRule$incidentsArgs<ExtArgs>;
    _count?: boolean | Prisma.CorrelationRuleCountOutputTypeDefaultArgs<ExtArgs>;
}, ExtArgs["result"]["correlationRule"]>;
export type CorrelationRuleSelectCreateManyAndReturn<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = runtime.Types.Extensions.GetSelect<{
    id?: boolean;
    name?: boolean;
    description?: boolean;
    enabled?: boolean;
    priority?: boolean;
    matchCriteria?: boolean;
    timeWindowMinutes?: boolean;
    action?: boolean;
    createdAt?: boolean;
    updatedAt?: boolean;
}, ExtArgs["result"]["correlationRule"]>;
export type CorrelationRuleSelectUpdateManyAndReturn<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = runtime.Types.Extensions.GetSelect<{
    id?: boolean;
    name?: boolean;
    description?: boolean;
    enabled?: boolean;
    priority?: boolean;
    matchCriteria?: boolean;
    timeWindowMinutes?: boolean;
    action?: boolean;
    createdAt?: boolean;
    updatedAt?: boolean;
}, ExtArgs["result"]["correlationRule"]>;
export type CorrelationRuleSelectScalar = {
    id?: boolean;
    name?: boolean;
    description?: boolean;
    enabled?: boolean;
    priority?: boolean;
    matchCriteria?: boolean;
    timeWindowMinutes?: boolean;
    action?: boolean;
    createdAt?: boolean;
    updatedAt?: boolean;
};
export type CorrelationRuleOmit<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = runtime.Types.Extensions.GetOmit<"id" | "name" | "description" | "enabled" | "priority" | "matchCriteria" | "timeWindowMinutes" | "action" | "createdAt" | "updatedAt", ExtArgs["result"]["correlationRule"]>;
export type CorrelationRuleInclude<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    incidents?: boolean | Prisma.CorrelationRule$incidentsArgs<ExtArgs>;
    _count?: boolean | Prisma.CorrelationRuleCountOutputTypeDefaultArgs<ExtArgs>;
};
export type CorrelationRuleIncludeCreateManyAndReturn<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {};
export type CorrelationRuleIncludeUpdateManyAndReturn<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {};
export type $CorrelationRulePayload<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    name: "CorrelationRule";
    objects: {
        incidents: Prisma.$IncidentPayload<ExtArgs>[];
    };
    scalars: runtime.Types.Extensions.GetPayloadResult<{
        id: string;
        name: string;
        description: string | null;
        enabled: boolean;
        priority: number;
        matchCriteria: string;
        timeWindowMinutes: number;
        action: string;
        createdAt: Date;
        updatedAt: Date;
    }, ExtArgs["result"]["correlationRule"]>;
    composites: {};
};
export type CorrelationRuleGetPayload<S extends boolean | null | undefined | CorrelationRuleDefaultArgs> = runtime.Types.Result.GetResult<Prisma.$CorrelationRulePayload, S>;
export type CorrelationRuleCountArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = Omit<CorrelationRuleFindManyArgs, 'select' | 'include' | 'distinct' | 'omit'> & {
    select?: CorrelationRuleCountAggregateInputType | true;
};
export interface CorrelationRuleDelegate<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs, GlobalOmitOptions = {}> {
    [K: symbol]: {
        types: Prisma.TypeMap<ExtArgs>['model']['CorrelationRule'];
        meta: {
            name: 'CorrelationRule';
        };
    };
    findUnique<T extends CorrelationRuleFindUniqueArgs>(args: Prisma.SelectSubset<T, CorrelationRuleFindUniqueArgs<ExtArgs>>): Prisma.Prisma__CorrelationRuleClient<runtime.Types.Result.GetResult<Prisma.$CorrelationRulePayload<ExtArgs>, T, "findUnique", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>;
    findUniqueOrThrow<T extends CorrelationRuleFindUniqueOrThrowArgs>(args: Prisma.SelectSubset<T, CorrelationRuleFindUniqueOrThrowArgs<ExtArgs>>): Prisma.Prisma__CorrelationRuleClient<runtime.Types.Result.GetResult<Prisma.$CorrelationRulePayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>;
    findFirst<T extends CorrelationRuleFindFirstArgs>(args?: Prisma.SelectSubset<T, CorrelationRuleFindFirstArgs<ExtArgs>>): Prisma.Prisma__CorrelationRuleClient<runtime.Types.Result.GetResult<Prisma.$CorrelationRulePayload<ExtArgs>, T, "findFirst", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>;
    findFirstOrThrow<T extends CorrelationRuleFindFirstOrThrowArgs>(args?: Prisma.SelectSubset<T, CorrelationRuleFindFirstOrThrowArgs<ExtArgs>>): Prisma.Prisma__CorrelationRuleClient<runtime.Types.Result.GetResult<Prisma.$CorrelationRulePayload<ExtArgs>, T, "findFirstOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>;
    findMany<T extends CorrelationRuleFindManyArgs>(args?: Prisma.SelectSubset<T, CorrelationRuleFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<runtime.Types.Result.GetResult<Prisma.$CorrelationRulePayload<ExtArgs>, T, "findMany", GlobalOmitOptions>>;
    create<T extends CorrelationRuleCreateArgs>(args: Prisma.SelectSubset<T, CorrelationRuleCreateArgs<ExtArgs>>): Prisma.Prisma__CorrelationRuleClient<runtime.Types.Result.GetResult<Prisma.$CorrelationRulePayload<ExtArgs>, T, "create", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>;
    createMany<T extends CorrelationRuleCreateManyArgs>(args?: Prisma.SelectSubset<T, CorrelationRuleCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<Prisma.BatchPayload>;
    createManyAndReturn<T extends CorrelationRuleCreateManyAndReturnArgs>(args?: Prisma.SelectSubset<T, CorrelationRuleCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<runtime.Types.Result.GetResult<Prisma.$CorrelationRulePayload<ExtArgs>, T, "createManyAndReturn", GlobalOmitOptions>>;
    delete<T extends CorrelationRuleDeleteArgs>(args: Prisma.SelectSubset<T, CorrelationRuleDeleteArgs<ExtArgs>>): Prisma.Prisma__CorrelationRuleClient<runtime.Types.Result.GetResult<Prisma.$CorrelationRulePayload<ExtArgs>, T, "delete", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>;
    update<T extends CorrelationRuleUpdateArgs>(args: Prisma.SelectSubset<T, CorrelationRuleUpdateArgs<ExtArgs>>): Prisma.Prisma__CorrelationRuleClient<runtime.Types.Result.GetResult<Prisma.$CorrelationRulePayload<ExtArgs>, T, "update", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>;
    deleteMany<T extends CorrelationRuleDeleteManyArgs>(args?: Prisma.SelectSubset<T, CorrelationRuleDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<Prisma.BatchPayload>;
    updateMany<T extends CorrelationRuleUpdateManyArgs>(args: Prisma.SelectSubset<T, CorrelationRuleUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<Prisma.BatchPayload>;
    updateManyAndReturn<T extends CorrelationRuleUpdateManyAndReturnArgs>(args: Prisma.SelectSubset<T, CorrelationRuleUpdateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<runtime.Types.Result.GetResult<Prisma.$CorrelationRulePayload<ExtArgs>, T, "updateManyAndReturn", GlobalOmitOptions>>;
    upsert<T extends CorrelationRuleUpsertArgs>(args: Prisma.SelectSubset<T, CorrelationRuleUpsertArgs<ExtArgs>>): Prisma.Prisma__CorrelationRuleClient<runtime.Types.Result.GetResult<Prisma.$CorrelationRulePayload<ExtArgs>, T, "upsert", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>;
    count<T extends CorrelationRuleCountArgs>(args?: Prisma.Subset<T, CorrelationRuleCountArgs>): Prisma.PrismaPromise<T extends runtime.Types.Utils.Record<'select', any> ? T['select'] extends true ? number : Prisma.GetScalarType<T['select'], CorrelationRuleCountAggregateOutputType> : number>;
    aggregate<T extends CorrelationRuleAggregateArgs>(args: Prisma.Subset<T, CorrelationRuleAggregateArgs>): Prisma.PrismaPromise<GetCorrelationRuleAggregateType<T>>;
    groupBy<T extends CorrelationRuleGroupByArgs, HasSelectOrTake extends Prisma.Or<Prisma.Extends<'skip', Prisma.Keys<T>>, Prisma.Extends<'take', Prisma.Keys<T>>>, OrderByArg extends Prisma.True extends HasSelectOrTake ? {
        orderBy: CorrelationRuleGroupByArgs['orderBy'];
    } : {
        orderBy?: CorrelationRuleGroupByArgs['orderBy'];
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
    }[OrderFields]>(args: Prisma.SubsetIntersection<T, CorrelationRuleGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetCorrelationRuleGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>;
    readonly fields: CorrelationRuleFieldRefs;
}
export interface Prisma__CorrelationRuleClient<T, Null = never, ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs, GlobalOmitOptions = {}> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise";
    incidents<T extends Prisma.CorrelationRule$incidentsArgs<ExtArgs> = {}>(args?: Prisma.Subset<T, Prisma.CorrelationRule$incidentsArgs<ExtArgs>>): Prisma.PrismaPromise<runtime.Types.Result.GetResult<Prisma.$IncidentPayload<ExtArgs>, T, "findMany", GlobalOmitOptions> | Null>;
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): runtime.Types.Utils.JsPromise<TResult1 | TResult2>;
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): runtime.Types.Utils.JsPromise<T | TResult>;
    finally(onfinally?: (() => void) | undefined | null): runtime.Types.Utils.JsPromise<T>;
}
export interface CorrelationRuleFieldRefs {
    readonly id: Prisma.FieldRef<"CorrelationRule", 'String'>;
    readonly name: Prisma.FieldRef<"CorrelationRule", 'String'>;
    readonly description: Prisma.FieldRef<"CorrelationRule", 'String'>;
    readonly enabled: Prisma.FieldRef<"CorrelationRule", 'Boolean'>;
    readonly priority: Prisma.FieldRef<"CorrelationRule", 'Int'>;
    readonly matchCriteria: Prisma.FieldRef<"CorrelationRule", 'String'>;
    readonly timeWindowMinutes: Prisma.FieldRef<"CorrelationRule", 'Int'>;
    readonly action: Prisma.FieldRef<"CorrelationRule", 'String'>;
    readonly createdAt: Prisma.FieldRef<"CorrelationRule", 'DateTime'>;
    readonly updatedAt: Prisma.FieldRef<"CorrelationRule", 'DateTime'>;
}
export type CorrelationRuleFindUniqueArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    select?: Prisma.CorrelationRuleSelect<ExtArgs> | null;
    omit?: Prisma.CorrelationRuleOmit<ExtArgs> | null;
    include?: Prisma.CorrelationRuleInclude<ExtArgs> | null;
    where: Prisma.CorrelationRuleWhereUniqueInput;
};
export type CorrelationRuleFindUniqueOrThrowArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    select?: Prisma.CorrelationRuleSelect<ExtArgs> | null;
    omit?: Prisma.CorrelationRuleOmit<ExtArgs> | null;
    include?: Prisma.CorrelationRuleInclude<ExtArgs> | null;
    where: Prisma.CorrelationRuleWhereUniqueInput;
};
export type CorrelationRuleFindFirstArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    select?: Prisma.CorrelationRuleSelect<ExtArgs> | null;
    omit?: Prisma.CorrelationRuleOmit<ExtArgs> | null;
    include?: Prisma.CorrelationRuleInclude<ExtArgs> | null;
    where?: Prisma.CorrelationRuleWhereInput;
    orderBy?: Prisma.CorrelationRuleOrderByWithRelationInput | Prisma.CorrelationRuleOrderByWithRelationInput[];
    cursor?: Prisma.CorrelationRuleWhereUniqueInput;
    take?: number;
    skip?: number;
    distinct?: Prisma.CorrelationRuleScalarFieldEnum | Prisma.CorrelationRuleScalarFieldEnum[];
};
export type CorrelationRuleFindFirstOrThrowArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    select?: Prisma.CorrelationRuleSelect<ExtArgs> | null;
    omit?: Prisma.CorrelationRuleOmit<ExtArgs> | null;
    include?: Prisma.CorrelationRuleInclude<ExtArgs> | null;
    where?: Prisma.CorrelationRuleWhereInput;
    orderBy?: Prisma.CorrelationRuleOrderByWithRelationInput | Prisma.CorrelationRuleOrderByWithRelationInput[];
    cursor?: Prisma.CorrelationRuleWhereUniqueInput;
    take?: number;
    skip?: number;
    distinct?: Prisma.CorrelationRuleScalarFieldEnum | Prisma.CorrelationRuleScalarFieldEnum[];
};
export type CorrelationRuleFindManyArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    select?: Prisma.CorrelationRuleSelect<ExtArgs> | null;
    omit?: Prisma.CorrelationRuleOmit<ExtArgs> | null;
    include?: Prisma.CorrelationRuleInclude<ExtArgs> | null;
    where?: Prisma.CorrelationRuleWhereInput;
    orderBy?: Prisma.CorrelationRuleOrderByWithRelationInput | Prisma.CorrelationRuleOrderByWithRelationInput[];
    cursor?: Prisma.CorrelationRuleWhereUniqueInput;
    take?: number;
    skip?: number;
    distinct?: Prisma.CorrelationRuleScalarFieldEnum | Prisma.CorrelationRuleScalarFieldEnum[];
};
export type CorrelationRuleCreateArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    select?: Prisma.CorrelationRuleSelect<ExtArgs> | null;
    omit?: Prisma.CorrelationRuleOmit<ExtArgs> | null;
    include?: Prisma.CorrelationRuleInclude<ExtArgs> | null;
    data: Prisma.XOR<Prisma.CorrelationRuleCreateInput, Prisma.CorrelationRuleUncheckedCreateInput>;
};
export type CorrelationRuleCreateManyArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    data: Prisma.CorrelationRuleCreateManyInput | Prisma.CorrelationRuleCreateManyInput[];
};
export type CorrelationRuleCreateManyAndReturnArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    select?: Prisma.CorrelationRuleSelectCreateManyAndReturn<ExtArgs> | null;
    omit?: Prisma.CorrelationRuleOmit<ExtArgs> | null;
    data: Prisma.CorrelationRuleCreateManyInput | Prisma.CorrelationRuleCreateManyInput[];
};
export type CorrelationRuleUpdateArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    select?: Prisma.CorrelationRuleSelect<ExtArgs> | null;
    omit?: Prisma.CorrelationRuleOmit<ExtArgs> | null;
    include?: Prisma.CorrelationRuleInclude<ExtArgs> | null;
    data: Prisma.XOR<Prisma.CorrelationRuleUpdateInput, Prisma.CorrelationRuleUncheckedUpdateInput>;
    where: Prisma.CorrelationRuleWhereUniqueInput;
};
export type CorrelationRuleUpdateManyArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    data: Prisma.XOR<Prisma.CorrelationRuleUpdateManyMutationInput, Prisma.CorrelationRuleUncheckedUpdateManyInput>;
    where?: Prisma.CorrelationRuleWhereInput;
    limit?: number;
};
export type CorrelationRuleUpdateManyAndReturnArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    select?: Prisma.CorrelationRuleSelectUpdateManyAndReturn<ExtArgs> | null;
    omit?: Prisma.CorrelationRuleOmit<ExtArgs> | null;
    data: Prisma.XOR<Prisma.CorrelationRuleUpdateManyMutationInput, Prisma.CorrelationRuleUncheckedUpdateManyInput>;
    where?: Prisma.CorrelationRuleWhereInput;
    limit?: number;
};
export type CorrelationRuleUpsertArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    select?: Prisma.CorrelationRuleSelect<ExtArgs> | null;
    omit?: Prisma.CorrelationRuleOmit<ExtArgs> | null;
    include?: Prisma.CorrelationRuleInclude<ExtArgs> | null;
    where: Prisma.CorrelationRuleWhereUniqueInput;
    create: Prisma.XOR<Prisma.CorrelationRuleCreateInput, Prisma.CorrelationRuleUncheckedCreateInput>;
    update: Prisma.XOR<Prisma.CorrelationRuleUpdateInput, Prisma.CorrelationRuleUncheckedUpdateInput>;
};
export type CorrelationRuleDeleteArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    select?: Prisma.CorrelationRuleSelect<ExtArgs> | null;
    omit?: Prisma.CorrelationRuleOmit<ExtArgs> | null;
    include?: Prisma.CorrelationRuleInclude<ExtArgs> | null;
    where: Prisma.CorrelationRuleWhereUniqueInput;
};
export type CorrelationRuleDeleteManyArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    where?: Prisma.CorrelationRuleWhereInput;
    limit?: number;
};
export type CorrelationRule$incidentsArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    select?: Prisma.IncidentSelect<ExtArgs> | null;
    omit?: Prisma.IncidentOmit<ExtArgs> | null;
    include?: Prisma.IncidentInclude<ExtArgs> | null;
    where?: Prisma.IncidentWhereInput;
    orderBy?: Prisma.IncidentOrderByWithRelationInput | Prisma.IncidentOrderByWithRelationInput[];
    cursor?: Prisma.IncidentWhereUniqueInput;
    take?: number;
    skip?: number;
    distinct?: Prisma.IncidentScalarFieldEnum | Prisma.IncidentScalarFieldEnum[];
};
export type CorrelationRuleDefaultArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    select?: Prisma.CorrelationRuleSelect<ExtArgs> | null;
    omit?: Prisma.CorrelationRuleOmit<ExtArgs> | null;
    include?: Prisma.CorrelationRuleInclude<ExtArgs> | null;
};
export {};
