import type * as runtime from "@prisma/client/runtime/client";
import type * as Prisma from "../internal/prismaNamespace.js";
export type EventModel = runtime.Types.Result.DefaultSelection<Prisma.$EventPayload>;
export type AggregateEvent = {
    _count: EventCountAggregateOutputType | null;
    _min: EventMinAggregateOutputType | null;
    _max: EventMaxAggregateOutputType | null;
};
export type EventMinAggregateOutputType = {
    id: string | null;
    source: string | null;
    sourceEventId: string | null;
    eventType: string | null;
    payload: string | null;
    receivedAt: Date | null;
    eventTime: Date | null;
    processed: boolean | null;
    alertId: string | null;
};
export type EventMaxAggregateOutputType = {
    id: string | null;
    source: string | null;
    sourceEventId: string | null;
    eventType: string | null;
    payload: string | null;
    receivedAt: Date | null;
    eventTime: Date | null;
    processed: boolean | null;
    alertId: string | null;
};
export type EventCountAggregateOutputType = {
    id: number;
    source: number;
    sourceEventId: number;
    eventType: number;
    payload: number;
    receivedAt: number;
    eventTime: number;
    processed: number;
    alertId: number;
    _all: number;
};
export type EventMinAggregateInputType = {
    id?: true;
    source?: true;
    sourceEventId?: true;
    eventType?: true;
    payload?: true;
    receivedAt?: true;
    eventTime?: true;
    processed?: true;
    alertId?: true;
};
export type EventMaxAggregateInputType = {
    id?: true;
    source?: true;
    sourceEventId?: true;
    eventType?: true;
    payload?: true;
    receivedAt?: true;
    eventTime?: true;
    processed?: true;
    alertId?: true;
};
export type EventCountAggregateInputType = {
    id?: true;
    source?: true;
    sourceEventId?: true;
    eventType?: true;
    payload?: true;
    receivedAt?: true;
    eventTime?: true;
    processed?: true;
    alertId?: true;
    _all?: true;
};
export type EventAggregateArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    where?: Prisma.EventWhereInput;
    orderBy?: Prisma.EventOrderByWithRelationInput | Prisma.EventOrderByWithRelationInput[];
    cursor?: Prisma.EventWhereUniqueInput;
    take?: number;
    skip?: number;
    _count?: true | EventCountAggregateInputType;
    _min?: EventMinAggregateInputType;
    _max?: EventMaxAggregateInputType;
};
export type GetEventAggregateType<T extends EventAggregateArgs> = {
    [P in keyof T & keyof AggregateEvent]: P extends '_count' | 'count' ? T[P] extends true ? number : Prisma.GetScalarType<T[P], AggregateEvent[P]> : Prisma.GetScalarType<T[P], AggregateEvent[P]>;
};
export type EventGroupByArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    where?: Prisma.EventWhereInput;
    orderBy?: Prisma.EventOrderByWithAggregationInput | Prisma.EventOrderByWithAggregationInput[];
    by: Prisma.EventScalarFieldEnum[] | Prisma.EventScalarFieldEnum;
    having?: Prisma.EventScalarWhereWithAggregatesInput;
    take?: number;
    skip?: number;
    _count?: EventCountAggregateInputType | true;
    _min?: EventMinAggregateInputType;
    _max?: EventMaxAggregateInputType;
};
export type EventGroupByOutputType = {
    id: string;
    source: string;
    sourceEventId: string | null;
    eventType: string;
    payload: string;
    receivedAt: Date;
    eventTime: Date | null;
    processed: boolean;
    alertId: string | null;
    _count: EventCountAggregateOutputType | null;
    _min: EventMinAggregateOutputType | null;
    _max: EventMaxAggregateOutputType | null;
};
type GetEventGroupByPayload<T extends EventGroupByArgs> = Prisma.PrismaPromise<Array<Prisma.PickEnumerable<EventGroupByOutputType, T['by']> & {
    [P in ((keyof T) & (keyof EventGroupByOutputType))]: P extends '_count' ? T[P] extends boolean ? number : Prisma.GetScalarType<T[P], EventGroupByOutputType[P]> : Prisma.GetScalarType<T[P], EventGroupByOutputType[P]>;
}>>;
export type EventWhereInput = {
    AND?: Prisma.EventWhereInput | Prisma.EventWhereInput[];
    OR?: Prisma.EventWhereInput[];
    NOT?: Prisma.EventWhereInput | Prisma.EventWhereInput[];
    id?: Prisma.StringFilter<"Event"> | string;
    source?: Prisma.StringFilter<"Event"> | string;
    sourceEventId?: Prisma.StringNullableFilter<"Event"> | string | null;
    eventType?: Prisma.StringFilter<"Event"> | string;
    payload?: Prisma.StringFilter<"Event"> | string;
    receivedAt?: Prisma.DateTimeFilter<"Event"> | Date | string;
    eventTime?: Prisma.DateTimeNullableFilter<"Event"> | Date | string | null;
    processed?: Prisma.BoolFilter<"Event"> | boolean;
    alertId?: Prisma.StringNullableFilter<"Event"> | string | null;
    alert?: Prisma.XOR<Prisma.AlertNullableScalarRelationFilter, Prisma.AlertWhereInput> | null;
};
export type EventOrderByWithRelationInput = {
    id?: Prisma.SortOrder;
    source?: Prisma.SortOrder;
    sourceEventId?: Prisma.SortOrderInput | Prisma.SortOrder;
    eventType?: Prisma.SortOrder;
    payload?: Prisma.SortOrder;
    receivedAt?: Prisma.SortOrder;
    eventTime?: Prisma.SortOrderInput | Prisma.SortOrder;
    processed?: Prisma.SortOrder;
    alertId?: Prisma.SortOrderInput | Prisma.SortOrder;
    alert?: Prisma.AlertOrderByWithRelationInput;
};
export type EventWhereUniqueInput = Prisma.AtLeast<{
    id?: string;
    AND?: Prisma.EventWhereInput | Prisma.EventWhereInput[];
    OR?: Prisma.EventWhereInput[];
    NOT?: Prisma.EventWhereInput | Prisma.EventWhereInput[];
    source?: Prisma.StringFilter<"Event"> | string;
    sourceEventId?: Prisma.StringNullableFilter<"Event"> | string | null;
    eventType?: Prisma.StringFilter<"Event"> | string;
    payload?: Prisma.StringFilter<"Event"> | string;
    receivedAt?: Prisma.DateTimeFilter<"Event"> | Date | string;
    eventTime?: Prisma.DateTimeNullableFilter<"Event"> | Date | string | null;
    processed?: Prisma.BoolFilter<"Event"> | boolean;
    alertId?: Prisma.StringNullableFilter<"Event"> | string | null;
    alert?: Prisma.XOR<Prisma.AlertNullableScalarRelationFilter, Prisma.AlertWhereInput> | null;
}, "id">;
export type EventOrderByWithAggregationInput = {
    id?: Prisma.SortOrder;
    source?: Prisma.SortOrder;
    sourceEventId?: Prisma.SortOrderInput | Prisma.SortOrder;
    eventType?: Prisma.SortOrder;
    payload?: Prisma.SortOrder;
    receivedAt?: Prisma.SortOrder;
    eventTime?: Prisma.SortOrderInput | Prisma.SortOrder;
    processed?: Prisma.SortOrder;
    alertId?: Prisma.SortOrderInput | Prisma.SortOrder;
    _count?: Prisma.EventCountOrderByAggregateInput;
    _max?: Prisma.EventMaxOrderByAggregateInput;
    _min?: Prisma.EventMinOrderByAggregateInput;
};
export type EventScalarWhereWithAggregatesInput = {
    AND?: Prisma.EventScalarWhereWithAggregatesInput | Prisma.EventScalarWhereWithAggregatesInput[];
    OR?: Prisma.EventScalarWhereWithAggregatesInput[];
    NOT?: Prisma.EventScalarWhereWithAggregatesInput | Prisma.EventScalarWhereWithAggregatesInput[];
    id?: Prisma.StringWithAggregatesFilter<"Event"> | string;
    source?: Prisma.StringWithAggregatesFilter<"Event"> | string;
    sourceEventId?: Prisma.StringNullableWithAggregatesFilter<"Event"> | string | null;
    eventType?: Prisma.StringWithAggregatesFilter<"Event"> | string;
    payload?: Prisma.StringWithAggregatesFilter<"Event"> | string;
    receivedAt?: Prisma.DateTimeWithAggregatesFilter<"Event"> | Date | string;
    eventTime?: Prisma.DateTimeNullableWithAggregatesFilter<"Event"> | Date | string | null;
    processed?: Prisma.BoolWithAggregatesFilter<"Event"> | boolean;
    alertId?: Prisma.StringNullableWithAggregatesFilter<"Event"> | string | null;
};
export type EventCreateInput = {
    id?: string;
    source: string;
    sourceEventId?: string | null;
    eventType: string;
    payload: string;
    receivedAt?: Date | string;
    eventTime?: Date | string | null;
    processed?: boolean;
    alert?: Prisma.AlertCreateNestedOneWithoutEventsInput;
};
export type EventUncheckedCreateInput = {
    id?: string;
    source: string;
    sourceEventId?: string | null;
    eventType: string;
    payload: string;
    receivedAt?: Date | string;
    eventTime?: Date | string | null;
    processed?: boolean;
    alertId?: string | null;
};
export type EventUpdateInput = {
    id?: Prisma.StringFieldUpdateOperationsInput | string;
    source?: Prisma.StringFieldUpdateOperationsInput | string;
    sourceEventId?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
    eventType?: Prisma.StringFieldUpdateOperationsInput | string;
    payload?: Prisma.StringFieldUpdateOperationsInput | string;
    receivedAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
    eventTime?: Prisma.NullableDateTimeFieldUpdateOperationsInput | Date | string | null;
    processed?: Prisma.BoolFieldUpdateOperationsInput | boolean;
    alert?: Prisma.AlertUpdateOneWithoutEventsNestedInput;
};
export type EventUncheckedUpdateInput = {
    id?: Prisma.StringFieldUpdateOperationsInput | string;
    source?: Prisma.StringFieldUpdateOperationsInput | string;
    sourceEventId?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
    eventType?: Prisma.StringFieldUpdateOperationsInput | string;
    payload?: Prisma.StringFieldUpdateOperationsInput | string;
    receivedAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
    eventTime?: Prisma.NullableDateTimeFieldUpdateOperationsInput | Date | string | null;
    processed?: Prisma.BoolFieldUpdateOperationsInput | boolean;
    alertId?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
};
export type EventCreateManyInput = {
    id?: string;
    source: string;
    sourceEventId?: string | null;
    eventType: string;
    payload: string;
    receivedAt?: Date | string;
    eventTime?: Date | string | null;
    processed?: boolean;
    alertId?: string | null;
};
export type EventUpdateManyMutationInput = {
    id?: Prisma.StringFieldUpdateOperationsInput | string;
    source?: Prisma.StringFieldUpdateOperationsInput | string;
    sourceEventId?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
    eventType?: Prisma.StringFieldUpdateOperationsInput | string;
    payload?: Prisma.StringFieldUpdateOperationsInput | string;
    receivedAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
    eventTime?: Prisma.NullableDateTimeFieldUpdateOperationsInput | Date | string | null;
    processed?: Prisma.BoolFieldUpdateOperationsInput | boolean;
};
export type EventUncheckedUpdateManyInput = {
    id?: Prisma.StringFieldUpdateOperationsInput | string;
    source?: Prisma.StringFieldUpdateOperationsInput | string;
    sourceEventId?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
    eventType?: Prisma.StringFieldUpdateOperationsInput | string;
    payload?: Prisma.StringFieldUpdateOperationsInput | string;
    receivedAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
    eventTime?: Prisma.NullableDateTimeFieldUpdateOperationsInput | Date | string | null;
    processed?: Prisma.BoolFieldUpdateOperationsInput | boolean;
    alertId?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
};
export type EventCountOrderByAggregateInput = {
    id?: Prisma.SortOrder;
    source?: Prisma.SortOrder;
    sourceEventId?: Prisma.SortOrder;
    eventType?: Prisma.SortOrder;
    payload?: Prisma.SortOrder;
    receivedAt?: Prisma.SortOrder;
    eventTime?: Prisma.SortOrder;
    processed?: Prisma.SortOrder;
    alertId?: Prisma.SortOrder;
};
export type EventMaxOrderByAggregateInput = {
    id?: Prisma.SortOrder;
    source?: Prisma.SortOrder;
    sourceEventId?: Prisma.SortOrder;
    eventType?: Prisma.SortOrder;
    payload?: Prisma.SortOrder;
    receivedAt?: Prisma.SortOrder;
    eventTime?: Prisma.SortOrder;
    processed?: Prisma.SortOrder;
    alertId?: Prisma.SortOrder;
};
export type EventMinOrderByAggregateInput = {
    id?: Prisma.SortOrder;
    source?: Prisma.SortOrder;
    sourceEventId?: Prisma.SortOrder;
    eventType?: Prisma.SortOrder;
    payload?: Prisma.SortOrder;
    receivedAt?: Prisma.SortOrder;
    eventTime?: Prisma.SortOrder;
    processed?: Prisma.SortOrder;
    alertId?: Prisma.SortOrder;
};
export type EventListRelationFilter = {
    every?: Prisma.EventWhereInput;
    some?: Prisma.EventWhereInput;
    none?: Prisma.EventWhereInput;
};
export type EventOrderByRelationAggregateInput = {
    _count?: Prisma.SortOrder;
};
export type EventCreateNestedManyWithoutAlertInput = {
    create?: Prisma.XOR<Prisma.EventCreateWithoutAlertInput, Prisma.EventUncheckedCreateWithoutAlertInput> | Prisma.EventCreateWithoutAlertInput[] | Prisma.EventUncheckedCreateWithoutAlertInput[];
    connectOrCreate?: Prisma.EventCreateOrConnectWithoutAlertInput | Prisma.EventCreateOrConnectWithoutAlertInput[];
    createMany?: Prisma.EventCreateManyAlertInputEnvelope;
    connect?: Prisma.EventWhereUniqueInput | Prisma.EventWhereUniqueInput[];
};
export type EventUncheckedCreateNestedManyWithoutAlertInput = {
    create?: Prisma.XOR<Prisma.EventCreateWithoutAlertInput, Prisma.EventUncheckedCreateWithoutAlertInput> | Prisma.EventCreateWithoutAlertInput[] | Prisma.EventUncheckedCreateWithoutAlertInput[];
    connectOrCreate?: Prisma.EventCreateOrConnectWithoutAlertInput | Prisma.EventCreateOrConnectWithoutAlertInput[];
    createMany?: Prisma.EventCreateManyAlertInputEnvelope;
    connect?: Prisma.EventWhereUniqueInput | Prisma.EventWhereUniqueInput[];
};
export type EventUpdateManyWithoutAlertNestedInput = {
    create?: Prisma.XOR<Prisma.EventCreateWithoutAlertInput, Prisma.EventUncheckedCreateWithoutAlertInput> | Prisma.EventCreateWithoutAlertInput[] | Prisma.EventUncheckedCreateWithoutAlertInput[];
    connectOrCreate?: Prisma.EventCreateOrConnectWithoutAlertInput | Prisma.EventCreateOrConnectWithoutAlertInput[];
    upsert?: Prisma.EventUpsertWithWhereUniqueWithoutAlertInput | Prisma.EventUpsertWithWhereUniqueWithoutAlertInput[];
    createMany?: Prisma.EventCreateManyAlertInputEnvelope;
    set?: Prisma.EventWhereUniqueInput | Prisma.EventWhereUniqueInput[];
    disconnect?: Prisma.EventWhereUniqueInput | Prisma.EventWhereUniqueInput[];
    delete?: Prisma.EventWhereUniqueInput | Prisma.EventWhereUniqueInput[];
    connect?: Prisma.EventWhereUniqueInput | Prisma.EventWhereUniqueInput[];
    update?: Prisma.EventUpdateWithWhereUniqueWithoutAlertInput | Prisma.EventUpdateWithWhereUniqueWithoutAlertInput[];
    updateMany?: Prisma.EventUpdateManyWithWhereWithoutAlertInput | Prisma.EventUpdateManyWithWhereWithoutAlertInput[];
    deleteMany?: Prisma.EventScalarWhereInput | Prisma.EventScalarWhereInput[];
};
export type EventUncheckedUpdateManyWithoutAlertNestedInput = {
    create?: Prisma.XOR<Prisma.EventCreateWithoutAlertInput, Prisma.EventUncheckedCreateWithoutAlertInput> | Prisma.EventCreateWithoutAlertInput[] | Prisma.EventUncheckedCreateWithoutAlertInput[];
    connectOrCreate?: Prisma.EventCreateOrConnectWithoutAlertInput | Prisma.EventCreateOrConnectWithoutAlertInput[];
    upsert?: Prisma.EventUpsertWithWhereUniqueWithoutAlertInput | Prisma.EventUpsertWithWhereUniqueWithoutAlertInput[];
    createMany?: Prisma.EventCreateManyAlertInputEnvelope;
    set?: Prisma.EventWhereUniqueInput | Prisma.EventWhereUniqueInput[];
    disconnect?: Prisma.EventWhereUniqueInput | Prisma.EventWhereUniqueInput[];
    delete?: Prisma.EventWhereUniqueInput | Prisma.EventWhereUniqueInput[];
    connect?: Prisma.EventWhereUniqueInput | Prisma.EventWhereUniqueInput[];
    update?: Prisma.EventUpdateWithWhereUniqueWithoutAlertInput | Prisma.EventUpdateWithWhereUniqueWithoutAlertInput[];
    updateMany?: Prisma.EventUpdateManyWithWhereWithoutAlertInput | Prisma.EventUpdateManyWithWhereWithoutAlertInput[];
    deleteMany?: Prisma.EventScalarWhereInput | Prisma.EventScalarWhereInput[];
};
export type EventCreateWithoutAlertInput = {
    id?: string;
    source: string;
    sourceEventId?: string | null;
    eventType: string;
    payload: string;
    receivedAt?: Date | string;
    eventTime?: Date | string | null;
    processed?: boolean;
};
export type EventUncheckedCreateWithoutAlertInput = {
    id?: string;
    source: string;
    sourceEventId?: string | null;
    eventType: string;
    payload: string;
    receivedAt?: Date | string;
    eventTime?: Date | string | null;
    processed?: boolean;
};
export type EventCreateOrConnectWithoutAlertInput = {
    where: Prisma.EventWhereUniqueInput;
    create: Prisma.XOR<Prisma.EventCreateWithoutAlertInput, Prisma.EventUncheckedCreateWithoutAlertInput>;
};
export type EventCreateManyAlertInputEnvelope = {
    data: Prisma.EventCreateManyAlertInput | Prisma.EventCreateManyAlertInput[];
};
export type EventUpsertWithWhereUniqueWithoutAlertInput = {
    where: Prisma.EventWhereUniqueInput;
    update: Prisma.XOR<Prisma.EventUpdateWithoutAlertInput, Prisma.EventUncheckedUpdateWithoutAlertInput>;
    create: Prisma.XOR<Prisma.EventCreateWithoutAlertInput, Prisma.EventUncheckedCreateWithoutAlertInput>;
};
export type EventUpdateWithWhereUniqueWithoutAlertInput = {
    where: Prisma.EventWhereUniqueInput;
    data: Prisma.XOR<Prisma.EventUpdateWithoutAlertInput, Prisma.EventUncheckedUpdateWithoutAlertInput>;
};
export type EventUpdateManyWithWhereWithoutAlertInput = {
    where: Prisma.EventScalarWhereInput;
    data: Prisma.XOR<Prisma.EventUpdateManyMutationInput, Prisma.EventUncheckedUpdateManyWithoutAlertInput>;
};
export type EventScalarWhereInput = {
    AND?: Prisma.EventScalarWhereInput | Prisma.EventScalarWhereInput[];
    OR?: Prisma.EventScalarWhereInput[];
    NOT?: Prisma.EventScalarWhereInput | Prisma.EventScalarWhereInput[];
    id?: Prisma.StringFilter<"Event"> | string;
    source?: Prisma.StringFilter<"Event"> | string;
    sourceEventId?: Prisma.StringNullableFilter<"Event"> | string | null;
    eventType?: Prisma.StringFilter<"Event"> | string;
    payload?: Prisma.StringFilter<"Event"> | string;
    receivedAt?: Prisma.DateTimeFilter<"Event"> | Date | string;
    eventTime?: Prisma.DateTimeNullableFilter<"Event"> | Date | string | null;
    processed?: Prisma.BoolFilter<"Event"> | boolean;
    alertId?: Prisma.StringNullableFilter<"Event"> | string | null;
};
export type EventCreateManyAlertInput = {
    id?: string;
    source: string;
    sourceEventId?: string | null;
    eventType: string;
    payload: string;
    receivedAt?: Date | string;
    eventTime?: Date | string | null;
    processed?: boolean;
};
export type EventUpdateWithoutAlertInput = {
    id?: Prisma.StringFieldUpdateOperationsInput | string;
    source?: Prisma.StringFieldUpdateOperationsInput | string;
    sourceEventId?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
    eventType?: Prisma.StringFieldUpdateOperationsInput | string;
    payload?: Prisma.StringFieldUpdateOperationsInput | string;
    receivedAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
    eventTime?: Prisma.NullableDateTimeFieldUpdateOperationsInput | Date | string | null;
    processed?: Prisma.BoolFieldUpdateOperationsInput | boolean;
};
export type EventUncheckedUpdateWithoutAlertInput = {
    id?: Prisma.StringFieldUpdateOperationsInput | string;
    source?: Prisma.StringFieldUpdateOperationsInput | string;
    sourceEventId?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
    eventType?: Prisma.StringFieldUpdateOperationsInput | string;
    payload?: Prisma.StringFieldUpdateOperationsInput | string;
    receivedAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
    eventTime?: Prisma.NullableDateTimeFieldUpdateOperationsInput | Date | string | null;
    processed?: Prisma.BoolFieldUpdateOperationsInput | boolean;
};
export type EventUncheckedUpdateManyWithoutAlertInput = {
    id?: Prisma.StringFieldUpdateOperationsInput | string;
    source?: Prisma.StringFieldUpdateOperationsInput | string;
    sourceEventId?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
    eventType?: Prisma.StringFieldUpdateOperationsInput | string;
    payload?: Prisma.StringFieldUpdateOperationsInput | string;
    receivedAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
    eventTime?: Prisma.NullableDateTimeFieldUpdateOperationsInput | Date | string | null;
    processed?: Prisma.BoolFieldUpdateOperationsInput | boolean;
};
export type EventSelect<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = runtime.Types.Extensions.GetSelect<{
    id?: boolean;
    source?: boolean;
    sourceEventId?: boolean;
    eventType?: boolean;
    payload?: boolean;
    receivedAt?: boolean;
    eventTime?: boolean;
    processed?: boolean;
    alertId?: boolean;
    alert?: boolean | Prisma.Event$alertArgs<ExtArgs>;
}, ExtArgs["result"]["event"]>;
export type EventSelectCreateManyAndReturn<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = runtime.Types.Extensions.GetSelect<{
    id?: boolean;
    source?: boolean;
    sourceEventId?: boolean;
    eventType?: boolean;
    payload?: boolean;
    receivedAt?: boolean;
    eventTime?: boolean;
    processed?: boolean;
    alertId?: boolean;
    alert?: boolean | Prisma.Event$alertArgs<ExtArgs>;
}, ExtArgs["result"]["event"]>;
export type EventSelectUpdateManyAndReturn<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = runtime.Types.Extensions.GetSelect<{
    id?: boolean;
    source?: boolean;
    sourceEventId?: boolean;
    eventType?: boolean;
    payload?: boolean;
    receivedAt?: boolean;
    eventTime?: boolean;
    processed?: boolean;
    alertId?: boolean;
    alert?: boolean | Prisma.Event$alertArgs<ExtArgs>;
}, ExtArgs["result"]["event"]>;
export type EventSelectScalar = {
    id?: boolean;
    source?: boolean;
    sourceEventId?: boolean;
    eventType?: boolean;
    payload?: boolean;
    receivedAt?: boolean;
    eventTime?: boolean;
    processed?: boolean;
    alertId?: boolean;
};
export type EventOmit<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = runtime.Types.Extensions.GetOmit<"id" | "source" | "sourceEventId" | "eventType" | "payload" | "receivedAt" | "eventTime" | "processed" | "alertId", ExtArgs["result"]["event"]>;
export type EventInclude<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    alert?: boolean | Prisma.Event$alertArgs<ExtArgs>;
};
export type EventIncludeCreateManyAndReturn<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    alert?: boolean | Prisma.Event$alertArgs<ExtArgs>;
};
export type EventIncludeUpdateManyAndReturn<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    alert?: boolean | Prisma.Event$alertArgs<ExtArgs>;
};
export type $EventPayload<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    name: "Event";
    objects: {
        alert: Prisma.$AlertPayload<ExtArgs> | null;
    };
    scalars: runtime.Types.Extensions.GetPayloadResult<{
        id: string;
        source: string;
        sourceEventId: string | null;
        eventType: string;
        payload: string;
        receivedAt: Date;
        eventTime: Date | null;
        processed: boolean;
        alertId: string | null;
    }, ExtArgs["result"]["event"]>;
    composites: {};
};
export type EventGetPayload<S extends boolean | null | undefined | EventDefaultArgs> = runtime.Types.Result.GetResult<Prisma.$EventPayload, S>;
export type EventCountArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = Omit<EventFindManyArgs, 'select' | 'include' | 'distinct' | 'omit'> & {
    select?: EventCountAggregateInputType | true;
};
export interface EventDelegate<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs, GlobalOmitOptions = {}> {
    [K: symbol]: {
        types: Prisma.TypeMap<ExtArgs>['model']['Event'];
        meta: {
            name: 'Event';
        };
    };
    findUnique<T extends EventFindUniqueArgs>(args: Prisma.SelectSubset<T, EventFindUniqueArgs<ExtArgs>>): Prisma.Prisma__EventClient<runtime.Types.Result.GetResult<Prisma.$EventPayload<ExtArgs>, T, "findUnique", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>;
    findUniqueOrThrow<T extends EventFindUniqueOrThrowArgs>(args: Prisma.SelectSubset<T, EventFindUniqueOrThrowArgs<ExtArgs>>): Prisma.Prisma__EventClient<runtime.Types.Result.GetResult<Prisma.$EventPayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>;
    findFirst<T extends EventFindFirstArgs>(args?: Prisma.SelectSubset<T, EventFindFirstArgs<ExtArgs>>): Prisma.Prisma__EventClient<runtime.Types.Result.GetResult<Prisma.$EventPayload<ExtArgs>, T, "findFirst", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>;
    findFirstOrThrow<T extends EventFindFirstOrThrowArgs>(args?: Prisma.SelectSubset<T, EventFindFirstOrThrowArgs<ExtArgs>>): Prisma.Prisma__EventClient<runtime.Types.Result.GetResult<Prisma.$EventPayload<ExtArgs>, T, "findFirstOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>;
    findMany<T extends EventFindManyArgs>(args?: Prisma.SelectSubset<T, EventFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<runtime.Types.Result.GetResult<Prisma.$EventPayload<ExtArgs>, T, "findMany", GlobalOmitOptions>>;
    create<T extends EventCreateArgs>(args: Prisma.SelectSubset<T, EventCreateArgs<ExtArgs>>): Prisma.Prisma__EventClient<runtime.Types.Result.GetResult<Prisma.$EventPayload<ExtArgs>, T, "create", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>;
    createMany<T extends EventCreateManyArgs>(args?: Prisma.SelectSubset<T, EventCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<Prisma.BatchPayload>;
    createManyAndReturn<T extends EventCreateManyAndReturnArgs>(args?: Prisma.SelectSubset<T, EventCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<runtime.Types.Result.GetResult<Prisma.$EventPayload<ExtArgs>, T, "createManyAndReturn", GlobalOmitOptions>>;
    delete<T extends EventDeleteArgs>(args: Prisma.SelectSubset<T, EventDeleteArgs<ExtArgs>>): Prisma.Prisma__EventClient<runtime.Types.Result.GetResult<Prisma.$EventPayload<ExtArgs>, T, "delete", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>;
    update<T extends EventUpdateArgs>(args: Prisma.SelectSubset<T, EventUpdateArgs<ExtArgs>>): Prisma.Prisma__EventClient<runtime.Types.Result.GetResult<Prisma.$EventPayload<ExtArgs>, T, "update", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>;
    deleteMany<T extends EventDeleteManyArgs>(args?: Prisma.SelectSubset<T, EventDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<Prisma.BatchPayload>;
    updateMany<T extends EventUpdateManyArgs>(args: Prisma.SelectSubset<T, EventUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<Prisma.BatchPayload>;
    updateManyAndReturn<T extends EventUpdateManyAndReturnArgs>(args: Prisma.SelectSubset<T, EventUpdateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<runtime.Types.Result.GetResult<Prisma.$EventPayload<ExtArgs>, T, "updateManyAndReturn", GlobalOmitOptions>>;
    upsert<T extends EventUpsertArgs>(args: Prisma.SelectSubset<T, EventUpsertArgs<ExtArgs>>): Prisma.Prisma__EventClient<runtime.Types.Result.GetResult<Prisma.$EventPayload<ExtArgs>, T, "upsert", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>;
    count<T extends EventCountArgs>(args?: Prisma.Subset<T, EventCountArgs>): Prisma.PrismaPromise<T extends runtime.Types.Utils.Record<'select', any> ? T['select'] extends true ? number : Prisma.GetScalarType<T['select'], EventCountAggregateOutputType> : number>;
    aggregate<T extends EventAggregateArgs>(args: Prisma.Subset<T, EventAggregateArgs>): Prisma.PrismaPromise<GetEventAggregateType<T>>;
    groupBy<T extends EventGroupByArgs, HasSelectOrTake extends Prisma.Or<Prisma.Extends<'skip', Prisma.Keys<T>>, Prisma.Extends<'take', Prisma.Keys<T>>>, OrderByArg extends Prisma.True extends HasSelectOrTake ? {
        orderBy: EventGroupByArgs['orderBy'];
    } : {
        orderBy?: EventGroupByArgs['orderBy'];
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
    }[OrderFields]>(args: Prisma.SubsetIntersection<T, EventGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetEventGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>;
    readonly fields: EventFieldRefs;
}
export interface Prisma__EventClient<T, Null = never, ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs, GlobalOmitOptions = {}> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise";
    alert<T extends Prisma.Event$alertArgs<ExtArgs> = {}>(args?: Prisma.Subset<T, Prisma.Event$alertArgs<ExtArgs>>): Prisma.Prisma__AlertClient<runtime.Types.Result.GetResult<Prisma.$AlertPayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>;
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): runtime.Types.Utils.JsPromise<TResult1 | TResult2>;
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): runtime.Types.Utils.JsPromise<T | TResult>;
    finally(onfinally?: (() => void) | undefined | null): runtime.Types.Utils.JsPromise<T>;
}
export interface EventFieldRefs {
    readonly id: Prisma.FieldRef<"Event", 'String'>;
    readonly source: Prisma.FieldRef<"Event", 'String'>;
    readonly sourceEventId: Prisma.FieldRef<"Event", 'String'>;
    readonly eventType: Prisma.FieldRef<"Event", 'String'>;
    readonly payload: Prisma.FieldRef<"Event", 'String'>;
    readonly receivedAt: Prisma.FieldRef<"Event", 'DateTime'>;
    readonly eventTime: Prisma.FieldRef<"Event", 'DateTime'>;
    readonly processed: Prisma.FieldRef<"Event", 'Boolean'>;
    readonly alertId: Prisma.FieldRef<"Event", 'String'>;
}
export type EventFindUniqueArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    select?: Prisma.EventSelect<ExtArgs> | null;
    omit?: Prisma.EventOmit<ExtArgs> | null;
    include?: Prisma.EventInclude<ExtArgs> | null;
    where: Prisma.EventWhereUniqueInput;
};
export type EventFindUniqueOrThrowArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    select?: Prisma.EventSelect<ExtArgs> | null;
    omit?: Prisma.EventOmit<ExtArgs> | null;
    include?: Prisma.EventInclude<ExtArgs> | null;
    where: Prisma.EventWhereUniqueInput;
};
export type EventFindFirstArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    select?: Prisma.EventSelect<ExtArgs> | null;
    omit?: Prisma.EventOmit<ExtArgs> | null;
    include?: Prisma.EventInclude<ExtArgs> | null;
    where?: Prisma.EventWhereInput;
    orderBy?: Prisma.EventOrderByWithRelationInput | Prisma.EventOrderByWithRelationInput[];
    cursor?: Prisma.EventWhereUniqueInput;
    take?: number;
    skip?: number;
    distinct?: Prisma.EventScalarFieldEnum | Prisma.EventScalarFieldEnum[];
};
export type EventFindFirstOrThrowArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    select?: Prisma.EventSelect<ExtArgs> | null;
    omit?: Prisma.EventOmit<ExtArgs> | null;
    include?: Prisma.EventInclude<ExtArgs> | null;
    where?: Prisma.EventWhereInput;
    orderBy?: Prisma.EventOrderByWithRelationInput | Prisma.EventOrderByWithRelationInput[];
    cursor?: Prisma.EventWhereUniqueInput;
    take?: number;
    skip?: number;
    distinct?: Prisma.EventScalarFieldEnum | Prisma.EventScalarFieldEnum[];
};
export type EventFindManyArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    select?: Prisma.EventSelect<ExtArgs> | null;
    omit?: Prisma.EventOmit<ExtArgs> | null;
    include?: Prisma.EventInclude<ExtArgs> | null;
    where?: Prisma.EventWhereInput;
    orderBy?: Prisma.EventOrderByWithRelationInput | Prisma.EventOrderByWithRelationInput[];
    cursor?: Prisma.EventWhereUniqueInput;
    take?: number;
    skip?: number;
    distinct?: Prisma.EventScalarFieldEnum | Prisma.EventScalarFieldEnum[];
};
export type EventCreateArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    select?: Prisma.EventSelect<ExtArgs> | null;
    omit?: Prisma.EventOmit<ExtArgs> | null;
    include?: Prisma.EventInclude<ExtArgs> | null;
    data: Prisma.XOR<Prisma.EventCreateInput, Prisma.EventUncheckedCreateInput>;
};
export type EventCreateManyArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    data: Prisma.EventCreateManyInput | Prisma.EventCreateManyInput[];
};
export type EventCreateManyAndReturnArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    select?: Prisma.EventSelectCreateManyAndReturn<ExtArgs> | null;
    omit?: Prisma.EventOmit<ExtArgs> | null;
    data: Prisma.EventCreateManyInput | Prisma.EventCreateManyInput[];
    include?: Prisma.EventIncludeCreateManyAndReturn<ExtArgs> | null;
};
export type EventUpdateArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    select?: Prisma.EventSelect<ExtArgs> | null;
    omit?: Prisma.EventOmit<ExtArgs> | null;
    include?: Prisma.EventInclude<ExtArgs> | null;
    data: Prisma.XOR<Prisma.EventUpdateInput, Prisma.EventUncheckedUpdateInput>;
    where: Prisma.EventWhereUniqueInput;
};
export type EventUpdateManyArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    data: Prisma.XOR<Prisma.EventUpdateManyMutationInput, Prisma.EventUncheckedUpdateManyInput>;
    where?: Prisma.EventWhereInput;
    limit?: number;
};
export type EventUpdateManyAndReturnArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    select?: Prisma.EventSelectUpdateManyAndReturn<ExtArgs> | null;
    omit?: Prisma.EventOmit<ExtArgs> | null;
    data: Prisma.XOR<Prisma.EventUpdateManyMutationInput, Prisma.EventUncheckedUpdateManyInput>;
    where?: Prisma.EventWhereInput;
    limit?: number;
    include?: Prisma.EventIncludeUpdateManyAndReturn<ExtArgs> | null;
};
export type EventUpsertArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    select?: Prisma.EventSelect<ExtArgs> | null;
    omit?: Prisma.EventOmit<ExtArgs> | null;
    include?: Prisma.EventInclude<ExtArgs> | null;
    where: Prisma.EventWhereUniqueInput;
    create: Prisma.XOR<Prisma.EventCreateInput, Prisma.EventUncheckedCreateInput>;
    update: Prisma.XOR<Prisma.EventUpdateInput, Prisma.EventUncheckedUpdateInput>;
};
export type EventDeleteArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    select?: Prisma.EventSelect<ExtArgs> | null;
    omit?: Prisma.EventOmit<ExtArgs> | null;
    include?: Prisma.EventInclude<ExtArgs> | null;
    where: Prisma.EventWhereUniqueInput;
};
export type EventDeleteManyArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    where?: Prisma.EventWhereInput;
    limit?: number;
};
export type Event$alertArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    select?: Prisma.AlertSelect<ExtArgs> | null;
    omit?: Prisma.AlertOmit<ExtArgs> | null;
    include?: Prisma.AlertInclude<ExtArgs> | null;
    where?: Prisma.AlertWhereInput;
};
export type EventDefaultArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    select?: Prisma.EventSelect<ExtArgs> | null;
    omit?: Prisma.EventOmit<ExtArgs> | null;
    include?: Prisma.EventInclude<ExtArgs> | null;
};
export {};
