import type * as runtime from "@prisma/client/runtime/client";
import type * as Prisma from "../internal/prismaNamespace.js";
export type UserModel = runtime.Types.Result.DefaultSelection<Prisma.$UserPayload>;
export type AggregateUser = {
    _count: UserCountAggregateOutputType | null;
    _min: UserMinAggregateOutputType | null;
    _max: UserMaxAggregateOutputType | null;
};
export type UserMinAggregateOutputType = {
    id: string | null;
    email: string | null;
    firstName: string | null;
    lastName: string | null;
    role: string | null;
    globalRole: string | null;
    avatarUrl: string | null;
    passwordHash: string | null;
    resetPasswordToken: string | null;
    resetPasswordExpiration: Date | null;
    invitationToken: string | null;
    isPending: boolean | null;
    createdAt: Date | null;
    updatedAt: Date | null;
    lastLoginAt: Date | null;
};
export type UserMaxAggregateOutputType = {
    id: string | null;
    email: string | null;
    firstName: string | null;
    lastName: string | null;
    role: string | null;
    globalRole: string | null;
    avatarUrl: string | null;
    passwordHash: string | null;
    resetPasswordToken: string | null;
    resetPasswordExpiration: Date | null;
    invitationToken: string | null;
    isPending: boolean | null;
    createdAt: Date | null;
    updatedAt: Date | null;
    lastLoginAt: Date | null;
};
export type UserCountAggregateOutputType = {
    id: number;
    email: number;
    firstName: number;
    lastName: number;
    role: number;
    globalRole: number;
    avatarUrl: number;
    passwordHash: number;
    resetPasswordToken: number;
    resetPasswordExpiration: number;
    invitationToken: number;
    isPending: number;
    createdAt: number;
    updatedAt: number;
    lastLoginAt: number;
    _all: number;
};
export type UserMinAggregateInputType = {
    id?: true;
    email?: true;
    firstName?: true;
    lastName?: true;
    role?: true;
    globalRole?: true;
    avatarUrl?: true;
    passwordHash?: true;
    resetPasswordToken?: true;
    resetPasswordExpiration?: true;
    invitationToken?: true;
    isPending?: true;
    createdAt?: true;
    updatedAt?: true;
    lastLoginAt?: true;
};
export type UserMaxAggregateInputType = {
    id?: true;
    email?: true;
    firstName?: true;
    lastName?: true;
    role?: true;
    globalRole?: true;
    avatarUrl?: true;
    passwordHash?: true;
    resetPasswordToken?: true;
    resetPasswordExpiration?: true;
    invitationToken?: true;
    isPending?: true;
    createdAt?: true;
    updatedAt?: true;
    lastLoginAt?: true;
};
export type UserCountAggregateInputType = {
    id?: true;
    email?: true;
    firstName?: true;
    lastName?: true;
    role?: true;
    globalRole?: true;
    avatarUrl?: true;
    passwordHash?: true;
    resetPasswordToken?: true;
    resetPasswordExpiration?: true;
    invitationToken?: true;
    isPending?: true;
    createdAt?: true;
    updatedAt?: true;
    lastLoginAt?: true;
    _all?: true;
};
export type UserAggregateArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    where?: Prisma.UserWhereInput;
    orderBy?: Prisma.UserOrderByWithRelationInput | Prisma.UserOrderByWithRelationInput[];
    cursor?: Prisma.UserWhereUniqueInput;
    take?: number;
    skip?: number;
    _count?: true | UserCountAggregateInputType;
    _min?: UserMinAggregateInputType;
    _max?: UserMaxAggregateInputType;
};
export type GetUserAggregateType<T extends UserAggregateArgs> = {
    [P in keyof T & keyof AggregateUser]: P extends '_count' | 'count' ? T[P] extends true ? number : Prisma.GetScalarType<T[P], AggregateUser[P]> : Prisma.GetScalarType<T[P], AggregateUser[P]>;
};
export type UserGroupByArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    where?: Prisma.UserWhereInput;
    orderBy?: Prisma.UserOrderByWithAggregationInput | Prisma.UserOrderByWithAggregationInput[];
    by: Prisma.UserScalarFieldEnum[] | Prisma.UserScalarFieldEnum;
    having?: Prisma.UserScalarWhereWithAggregatesInput;
    take?: number;
    skip?: number;
    _count?: UserCountAggregateInputType | true;
    _min?: UserMinAggregateInputType;
    _max?: UserMaxAggregateInputType;
};
export type UserGroupByOutputType = {
    id: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
    role: string;
    globalRole: string;
    avatarUrl: string | null;
    passwordHash: string | null;
    resetPasswordToken: string | null;
    resetPasswordExpiration: Date | null;
    invitationToken: string | null;
    isPending: boolean;
    createdAt: Date;
    updatedAt: Date;
    lastLoginAt: Date | null;
    _count: UserCountAggregateOutputType | null;
    _min: UserMinAggregateOutputType | null;
    _max: UserMaxAggregateOutputType | null;
};
type GetUserGroupByPayload<T extends UserGroupByArgs> = Prisma.PrismaPromise<Array<Prisma.PickEnumerable<UserGroupByOutputType, T['by']> & {
    [P in ((keyof T) & (keyof UserGroupByOutputType))]: P extends '_count' ? T[P] extends boolean ? number : Prisma.GetScalarType<T[P], UserGroupByOutputType[P]> : Prisma.GetScalarType<T[P], UserGroupByOutputType[P]>;
}>>;
export type UserWhereInput = {
    AND?: Prisma.UserWhereInput | Prisma.UserWhereInput[];
    OR?: Prisma.UserWhereInput[];
    NOT?: Prisma.UserWhereInput | Prisma.UserWhereInput[];
    id?: Prisma.StringFilter<"User"> | string;
    email?: Prisma.StringFilter<"User"> | string;
    firstName?: Prisma.StringNullableFilter<"User"> | string | null;
    lastName?: Prisma.StringNullableFilter<"User"> | string | null;
    role?: Prisma.StringFilter<"User"> | string;
    globalRole?: Prisma.StringFilter<"User"> | string;
    avatarUrl?: Prisma.StringNullableFilter<"User"> | string | null;
    passwordHash?: Prisma.StringNullableFilter<"User"> | string | null;
    resetPasswordToken?: Prisma.StringNullableFilter<"User"> | string | null;
    resetPasswordExpiration?: Prisma.DateTimeNullableFilter<"User"> | Date | string | null;
    invitationToken?: Prisma.StringNullableFilter<"User"> | string | null;
    isPending?: Prisma.BoolFilter<"User"> | boolean;
    createdAt?: Prisma.DateTimeFilter<"User"> | Date | string;
    updatedAt?: Prisma.DateTimeFilter<"User"> | Date | string;
    lastLoginAt?: Prisma.DateTimeNullableFilter<"User"> | Date | string | null;
    assignedIncidents?: Prisma.IncidentListRelationFilter;
    timelineEntries?: Prisma.TimelineEntryListRelationFilter;
    postmortems?: Prisma.PostmortemListRelationFilter;
};
export type UserOrderByWithRelationInput = {
    id?: Prisma.SortOrder;
    email?: Prisma.SortOrder;
    firstName?: Prisma.SortOrderInput | Prisma.SortOrder;
    lastName?: Prisma.SortOrderInput | Prisma.SortOrder;
    role?: Prisma.SortOrder;
    globalRole?: Prisma.SortOrder;
    avatarUrl?: Prisma.SortOrderInput | Prisma.SortOrder;
    passwordHash?: Prisma.SortOrderInput | Prisma.SortOrder;
    resetPasswordToken?: Prisma.SortOrderInput | Prisma.SortOrder;
    resetPasswordExpiration?: Prisma.SortOrderInput | Prisma.SortOrder;
    invitationToken?: Prisma.SortOrderInput | Prisma.SortOrder;
    isPending?: Prisma.SortOrder;
    createdAt?: Prisma.SortOrder;
    updatedAt?: Prisma.SortOrder;
    lastLoginAt?: Prisma.SortOrderInput | Prisma.SortOrder;
    assignedIncidents?: Prisma.IncidentOrderByRelationAggregateInput;
    timelineEntries?: Prisma.TimelineEntryOrderByRelationAggregateInput;
    postmortems?: Prisma.PostmortemOrderByRelationAggregateInput;
};
export type UserWhereUniqueInput = Prisma.AtLeast<{
    id?: string;
    email?: string;
    AND?: Prisma.UserWhereInput | Prisma.UserWhereInput[];
    OR?: Prisma.UserWhereInput[];
    NOT?: Prisma.UserWhereInput | Prisma.UserWhereInput[];
    firstName?: Prisma.StringNullableFilter<"User"> | string | null;
    lastName?: Prisma.StringNullableFilter<"User"> | string | null;
    role?: Prisma.StringFilter<"User"> | string;
    globalRole?: Prisma.StringFilter<"User"> | string;
    avatarUrl?: Prisma.StringNullableFilter<"User"> | string | null;
    passwordHash?: Prisma.StringNullableFilter<"User"> | string | null;
    resetPasswordToken?: Prisma.StringNullableFilter<"User"> | string | null;
    resetPasswordExpiration?: Prisma.DateTimeNullableFilter<"User"> | Date | string | null;
    invitationToken?: Prisma.StringNullableFilter<"User"> | string | null;
    isPending?: Prisma.BoolFilter<"User"> | boolean;
    createdAt?: Prisma.DateTimeFilter<"User"> | Date | string;
    updatedAt?: Prisma.DateTimeFilter<"User"> | Date | string;
    lastLoginAt?: Prisma.DateTimeNullableFilter<"User"> | Date | string | null;
    assignedIncidents?: Prisma.IncidentListRelationFilter;
    timelineEntries?: Prisma.TimelineEntryListRelationFilter;
    postmortems?: Prisma.PostmortemListRelationFilter;
}, "id" | "email">;
export type UserOrderByWithAggregationInput = {
    id?: Prisma.SortOrder;
    email?: Prisma.SortOrder;
    firstName?: Prisma.SortOrderInput | Prisma.SortOrder;
    lastName?: Prisma.SortOrderInput | Prisma.SortOrder;
    role?: Prisma.SortOrder;
    globalRole?: Prisma.SortOrder;
    avatarUrl?: Prisma.SortOrderInput | Prisma.SortOrder;
    passwordHash?: Prisma.SortOrderInput | Prisma.SortOrder;
    resetPasswordToken?: Prisma.SortOrderInput | Prisma.SortOrder;
    resetPasswordExpiration?: Prisma.SortOrderInput | Prisma.SortOrder;
    invitationToken?: Prisma.SortOrderInput | Prisma.SortOrder;
    isPending?: Prisma.SortOrder;
    createdAt?: Prisma.SortOrder;
    updatedAt?: Prisma.SortOrder;
    lastLoginAt?: Prisma.SortOrderInput | Prisma.SortOrder;
    _count?: Prisma.UserCountOrderByAggregateInput;
    _max?: Prisma.UserMaxOrderByAggregateInput;
    _min?: Prisma.UserMinOrderByAggregateInput;
};
export type UserScalarWhereWithAggregatesInput = {
    AND?: Prisma.UserScalarWhereWithAggregatesInput | Prisma.UserScalarWhereWithAggregatesInput[];
    OR?: Prisma.UserScalarWhereWithAggregatesInput[];
    NOT?: Prisma.UserScalarWhereWithAggregatesInput | Prisma.UserScalarWhereWithAggregatesInput[];
    id?: Prisma.StringWithAggregatesFilter<"User"> | string;
    email?: Prisma.StringWithAggregatesFilter<"User"> | string;
    firstName?: Prisma.StringNullableWithAggregatesFilter<"User"> | string | null;
    lastName?: Prisma.StringNullableWithAggregatesFilter<"User"> | string | null;
    role?: Prisma.StringWithAggregatesFilter<"User"> | string;
    globalRole?: Prisma.StringWithAggregatesFilter<"User"> | string;
    avatarUrl?: Prisma.StringNullableWithAggregatesFilter<"User"> | string | null;
    passwordHash?: Prisma.StringNullableWithAggregatesFilter<"User"> | string | null;
    resetPasswordToken?: Prisma.StringNullableWithAggregatesFilter<"User"> | string | null;
    resetPasswordExpiration?: Prisma.DateTimeNullableWithAggregatesFilter<"User"> | Date | string | null;
    invitationToken?: Prisma.StringNullableWithAggregatesFilter<"User"> | string | null;
    isPending?: Prisma.BoolWithAggregatesFilter<"User"> | boolean;
    createdAt?: Prisma.DateTimeWithAggregatesFilter<"User"> | Date | string;
    updatedAt?: Prisma.DateTimeWithAggregatesFilter<"User"> | Date | string;
    lastLoginAt?: Prisma.DateTimeNullableWithAggregatesFilter<"User"> | Date | string | null;
};
export type UserCreateInput = {
    id?: string;
    email: string;
    firstName?: string | null;
    lastName?: string | null;
    role?: string;
    globalRole?: string;
    avatarUrl?: string | null;
    passwordHash?: string | null;
    resetPasswordToken?: string | null;
    resetPasswordExpiration?: Date | string | null;
    invitationToken?: string | null;
    isPending?: boolean;
    createdAt?: Date | string;
    updatedAt?: Date | string;
    lastLoginAt?: Date | string | null;
    assignedIncidents?: Prisma.IncidentCreateNestedManyWithoutAssignedToInput;
    timelineEntries?: Prisma.TimelineEntryCreateNestedManyWithoutUserInput;
    postmortems?: Prisma.PostmortemCreateNestedManyWithoutAuthorInput;
};
export type UserUncheckedCreateInput = {
    id?: string;
    email: string;
    firstName?: string | null;
    lastName?: string | null;
    role?: string;
    globalRole?: string;
    avatarUrl?: string | null;
    passwordHash?: string | null;
    resetPasswordToken?: string | null;
    resetPasswordExpiration?: Date | string | null;
    invitationToken?: string | null;
    isPending?: boolean;
    createdAt?: Date | string;
    updatedAt?: Date | string;
    lastLoginAt?: Date | string | null;
    assignedIncidents?: Prisma.IncidentUncheckedCreateNestedManyWithoutAssignedToInput;
    timelineEntries?: Prisma.TimelineEntryUncheckedCreateNestedManyWithoutUserInput;
    postmortems?: Prisma.PostmortemUncheckedCreateNestedManyWithoutAuthorInput;
};
export type UserUpdateInput = {
    id?: Prisma.StringFieldUpdateOperationsInput | string;
    email?: Prisma.StringFieldUpdateOperationsInput | string;
    firstName?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
    lastName?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
    role?: Prisma.StringFieldUpdateOperationsInput | string;
    globalRole?: Prisma.StringFieldUpdateOperationsInput | string;
    avatarUrl?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
    passwordHash?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
    resetPasswordToken?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
    resetPasswordExpiration?: Prisma.NullableDateTimeFieldUpdateOperationsInput | Date | string | null;
    invitationToken?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
    isPending?: Prisma.BoolFieldUpdateOperationsInput | boolean;
    createdAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
    updatedAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
    lastLoginAt?: Prisma.NullableDateTimeFieldUpdateOperationsInput | Date | string | null;
    assignedIncidents?: Prisma.IncidentUpdateManyWithoutAssignedToNestedInput;
    timelineEntries?: Prisma.TimelineEntryUpdateManyWithoutUserNestedInput;
    postmortems?: Prisma.PostmortemUpdateManyWithoutAuthorNestedInput;
};
export type UserUncheckedUpdateInput = {
    id?: Prisma.StringFieldUpdateOperationsInput | string;
    email?: Prisma.StringFieldUpdateOperationsInput | string;
    firstName?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
    lastName?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
    role?: Prisma.StringFieldUpdateOperationsInput | string;
    globalRole?: Prisma.StringFieldUpdateOperationsInput | string;
    avatarUrl?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
    passwordHash?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
    resetPasswordToken?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
    resetPasswordExpiration?: Prisma.NullableDateTimeFieldUpdateOperationsInput | Date | string | null;
    invitationToken?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
    isPending?: Prisma.BoolFieldUpdateOperationsInput | boolean;
    createdAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
    updatedAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
    lastLoginAt?: Prisma.NullableDateTimeFieldUpdateOperationsInput | Date | string | null;
    assignedIncidents?: Prisma.IncidentUncheckedUpdateManyWithoutAssignedToNestedInput;
    timelineEntries?: Prisma.TimelineEntryUncheckedUpdateManyWithoutUserNestedInput;
    postmortems?: Prisma.PostmortemUncheckedUpdateManyWithoutAuthorNestedInput;
};
export type UserCreateManyInput = {
    id?: string;
    email: string;
    firstName?: string | null;
    lastName?: string | null;
    role?: string;
    globalRole?: string;
    avatarUrl?: string | null;
    passwordHash?: string | null;
    resetPasswordToken?: string | null;
    resetPasswordExpiration?: Date | string | null;
    invitationToken?: string | null;
    isPending?: boolean;
    createdAt?: Date | string;
    updatedAt?: Date | string;
    lastLoginAt?: Date | string | null;
};
export type UserUpdateManyMutationInput = {
    id?: Prisma.StringFieldUpdateOperationsInput | string;
    email?: Prisma.StringFieldUpdateOperationsInput | string;
    firstName?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
    lastName?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
    role?: Prisma.StringFieldUpdateOperationsInput | string;
    globalRole?: Prisma.StringFieldUpdateOperationsInput | string;
    avatarUrl?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
    passwordHash?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
    resetPasswordToken?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
    resetPasswordExpiration?: Prisma.NullableDateTimeFieldUpdateOperationsInput | Date | string | null;
    invitationToken?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
    isPending?: Prisma.BoolFieldUpdateOperationsInput | boolean;
    createdAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
    updatedAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
    lastLoginAt?: Prisma.NullableDateTimeFieldUpdateOperationsInput | Date | string | null;
};
export type UserUncheckedUpdateManyInput = {
    id?: Prisma.StringFieldUpdateOperationsInput | string;
    email?: Prisma.StringFieldUpdateOperationsInput | string;
    firstName?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
    lastName?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
    role?: Prisma.StringFieldUpdateOperationsInput | string;
    globalRole?: Prisma.StringFieldUpdateOperationsInput | string;
    avatarUrl?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
    passwordHash?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
    resetPasswordToken?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
    resetPasswordExpiration?: Prisma.NullableDateTimeFieldUpdateOperationsInput | Date | string | null;
    invitationToken?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
    isPending?: Prisma.BoolFieldUpdateOperationsInput | boolean;
    createdAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
    updatedAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
    lastLoginAt?: Prisma.NullableDateTimeFieldUpdateOperationsInput | Date | string | null;
};
export type UserCountOrderByAggregateInput = {
    id?: Prisma.SortOrder;
    email?: Prisma.SortOrder;
    firstName?: Prisma.SortOrder;
    lastName?: Prisma.SortOrder;
    role?: Prisma.SortOrder;
    globalRole?: Prisma.SortOrder;
    avatarUrl?: Prisma.SortOrder;
    passwordHash?: Prisma.SortOrder;
    resetPasswordToken?: Prisma.SortOrder;
    resetPasswordExpiration?: Prisma.SortOrder;
    invitationToken?: Prisma.SortOrder;
    isPending?: Prisma.SortOrder;
    createdAt?: Prisma.SortOrder;
    updatedAt?: Prisma.SortOrder;
    lastLoginAt?: Prisma.SortOrder;
};
export type UserMaxOrderByAggregateInput = {
    id?: Prisma.SortOrder;
    email?: Prisma.SortOrder;
    firstName?: Prisma.SortOrder;
    lastName?: Prisma.SortOrder;
    role?: Prisma.SortOrder;
    globalRole?: Prisma.SortOrder;
    avatarUrl?: Prisma.SortOrder;
    passwordHash?: Prisma.SortOrder;
    resetPasswordToken?: Prisma.SortOrder;
    resetPasswordExpiration?: Prisma.SortOrder;
    invitationToken?: Prisma.SortOrder;
    isPending?: Prisma.SortOrder;
    createdAt?: Prisma.SortOrder;
    updatedAt?: Prisma.SortOrder;
    lastLoginAt?: Prisma.SortOrder;
};
export type UserMinOrderByAggregateInput = {
    id?: Prisma.SortOrder;
    email?: Prisma.SortOrder;
    firstName?: Prisma.SortOrder;
    lastName?: Prisma.SortOrder;
    role?: Prisma.SortOrder;
    globalRole?: Prisma.SortOrder;
    avatarUrl?: Prisma.SortOrder;
    passwordHash?: Prisma.SortOrder;
    resetPasswordToken?: Prisma.SortOrder;
    resetPasswordExpiration?: Prisma.SortOrder;
    invitationToken?: Prisma.SortOrder;
    isPending?: Prisma.SortOrder;
    createdAt?: Prisma.SortOrder;
    updatedAt?: Prisma.SortOrder;
    lastLoginAt?: Prisma.SortOrder;
};
export type UserNullableScalarRelationFilter = {
    is?: Prisma.UserWhereInput | null;
    isNot?: Prisma.UserWhereInput | null;
};
export type StringFieldUpdateOperationsInput = {
    set?: string;
};
export type NullableStringFieldUpdateOperationsInput = {
    set?: string | null;
};
export type NullableDateTimeFieldUpdateOperationsInput = {
    set?: Date | string | null;
};
export type BoolFieldUpdateOperationsInput = {
    set?: boolean;
};
export type DateTimeFieldUpdateOperationsInput = {
    set?: Date | string;
};
export type UserCreateNestedOneWithoutAssignedIncidentsInput = {
    create?: Prisma.XOR<Prisma.UserCreateWithoutAssignedIncidentsInput, Prisma.UserUncheckedCreateWithoutAssignedIncidentsInput>;
    connectOrCreate?: Prisma.UserCreateOrConnectWithoutAssignedIncidentsInput;
    connect?: Prisma.UserWhereUniqueInput;
};
export type UserUpdateOneWithoutAssignedIncidentsNestedInput = {
    create?: Prisma.XOR<Prisma.UserCreateWithoutAssignedIncidentsInput, Prisma.UserUncheckedCreateWithoutAssignedIncidentsInput>;
    connectOrCreate?: Prisma.UserCreateOrConnectWithoutAssignedIncidentsInput;
    upsert?: Prisma.UserUpsertWithoutAssignedIncidentsInput;
    disconnect?: Prisma.UserWhereInput | boolean;
    delete?: Prisma.UserWhereInput | boolean;
    connect?: Prisma.UserWhereUniqueInput;
    update?: Prisma.XOR<Prisma.XOR<Prisma.UserUpdateToOneWithWhereWithoutAssignedIncidentsInput, Prisma.UserUpdateWithoutAssignedIncidentsInput>, Prisma.UserUncheckedUpdateWithoutAssignedIncidentsInput>;
};
export type UserCreateNestedOneWithoutTimelineEntriesInput = {
    create?: Prisma.XOR<Prisma.UserCreateWithoutTimelineEntriesInput, Prisma.UserUncheckedCreateWithoutTimelineEntriesInput>;
    connectOrCreate?: Prisma.UserCreateOrConnectWithoutTimelineEntriesInput;
    connect?: Prisma.UserWhereUniqueInput;
};
export type UserUpdateOneWithoutTimelineEntriesNestedInput = {
    create?: Prisma.XOR<Prisma.UserCreateWithoutTimelineEntriesInput, Prisma.UserUncheckedCreateWithoutTimelineEntriesInput>;
    connectOrCreate?: Prisma.UserCreateOrConnectWithoutTimelineEntriesInput;
    upsert?: Prisma.UserUpsertWithoutTimelineEntriesInput;
    disconnect?: Prisma.UserWhereInput | boolean;
    delete?: Prisma.UserWhereInput | boolean;
    connect?: Prisma.UserWhereUniqueInput;
    update?: Prisma.XOR<Prisma.XOR<Prisma.UserUpdateToOneWithWhereWithoutTimelineEntriesInput, Prisma.UserUpdateWithoutTimelineEntriesInput>, Prisma.UserUncheckedUpdateWithoutTimelineEntriesInput>;
};
export type UserCreateNestedOneWithoutPostmortemsInput = {
    create?: Prisma.XOR<Prisma.UserCreateWithoutPostmortemsInput, Prisma.UserUncheckedCreateWithoutPostmortemsInput>;
    connectOrCreate?: Prisma.UserCreateOrConnectWithoutPostmortemsInput;
    connect?: Prisma.UserWhereUniqueInput;
};
export type UserUpdateOneWithoutPostmortemsNestedInput = {
    create?: Prisma.XOR<Prisma.UserCreateWithoutPostmortemsInput, Prisma.UserUncheckedCreateWithoutPostmortemsInput>;
    connectOrCreate?: Prisma.UserCreateOrConnectWithoutPostmortemsInput;
    upsert?: Prisma.UserUpsertWithoutPostmortemsInput;
    disconnect?: Prisma.UserWhereInput | boolean;
    delete?: Prisma.UserWhereInput | boolean;
    connect?: Prisma.UserWhereUniqueInput;
    update?: Prisma.XOR<Prisma.XOR<Prisma.UserUpdateToOneWithWhereWithoutPostmortemsInput, Prisma.UserUpdateWithoutPostmortemsInput>, Prisma.UserUncheckedUpdateWithoutPostmortemsInput>;
};
export type UserCreateWithoutAssignedIncidentsInput = {
    id?: string;
    email: string;
    firstName?: string | null;
    lastName?: string | null;
    role?: string;
    globalRole?: string;
    avatarUrl?: string | null;
    passwordHash?: string | null;
    resetPasswordToken?: string | null;
    resetPasswordExpiration?: Date | string | null;
    invitationToken?: string | null;
    isPending?: boolean;
    createdAt?: Date | string;
    updatedAt?: Date | string;
    lastLoginAt?: Date | string | null;
    timelineEntries?: Prisma.TimelineEntryCreateNestedManyWithoutUserInput;
    postmortems?: Prisma.PostmortemCreateNestedManyWithoutAuthorInput;
};
export type UserUncheckedCreateWithoutAssignedIncidentsInput = {
    id?: string;
    email: string;
    firstName?: string | null;
    lastName?: string | null;
    role?: string;
    globalRole?: string;
    avatarUrl?: string | null;
    passwordHash?: string | null;
    resetPasswordToken?: string | null;
    resetPasswordExpiration?: Date | string | null;
    invitationToken?: string | null;
    isPending?: boolean;
    createdAt?: Date | string;
    updatedAt?: Date | string;
    lastLoginAt?: Date | string | null;
    timelineEntries?: Prisma.TimelineEntryUncheckedCreateNestedManyWithoutUserInput;
    postmortems?: Prisma.PostmortemUncheckedCreateNestedManyWithoutAuthorInput;
};
export type UserCreateOrConnectWithoutAssignedIncidentsInput = {
    where: Prisma.UserWhereUniqueInput;
    create: Prisma.XOR<Prisma.UserCreateWithoutAssignedIncidentsInput, Prisma.UserUncheckedCreateWithoutAssignedIncidentsInput>;
};
export type UserUpsertWithoutAssignedIncidentsInput = {
    update: Prisma.XOR<Prisma.UserUpdateWithoutAssignedIncidentsInput, Prisma.UserUncheckedUpdateWithoutAssignedIncidentsInput>;
    create: Prisma.XOR<Prisma.UserCreateWithoutAssignedIncidentsInput, Prisma.UserUncheckedCreateWithoutAssignedIncidentsInput>;
    where?: Prisma.UserWhereInput;
};
export type UserUpdateToOneWithWhereWithoutAssignedIncidentsInput = {
    where?: Prisma.UserWhereInput;
    data: Prisma.XOR<Prisma.UserUpdateWithoutAssignedIncidentsInput, Prisma.UserUncheckedUpdateWithoutAssignedIncidentsInput>;
};
export type UserUpdateWithoutAssignedIncidentsInput = {
    id?: Prisma.StringFieldUpdateOperationsInput | string;
    email?: Prisma.StringFieldUpdateOperationsInput | string;
    firstName?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
    lastName?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
    role?: Prisma.StringFieldUpdateOperationsInput | string;
    globalRole?: Prisma.StringFieldUpdateOperationsInput | string;
    avatarUrl?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
    passwordHash?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
    resetPasswordToken?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
    resetPasswordExpiration?: Prisma.NullableDateTimeFieldUpdateOperationsInput | Date | string | null;
    invitationToken?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
    isPending?: Prisma.BoolFieldUpdateOperationsInput | boolean;
    createdAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
    updatedAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
    lastLoginAt?: Prisma.NullableDateTimeFieldUpdateOperationsInput | Date | string | null;
    timelineEntries?: Prisma.TimelineEntryUpdateManyWithoutUserNestedInput;
    postmortems?: Prisma.PostmortemUpdateManyWithoutAuthorNestedInput;
};
export type UserUncheckedUpdateWithoutAssignedIncidentsInput = {
    id?: Prisma.StringFieldUpdateOperationsInput | string;
    email?: Prisma.StringFieldUpdateOperationsInput | string;
    firstName?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
    lastName?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
    role?: Prisma.StringFieldUpdateOperationsInput | string;
    globalRole?: Prisma.StringFieldUpdateOperationsInput | string;
    avatarUrl?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
    passwordHash?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
    resetPasswordToken?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
    resetPasswordExpiration?: Prisma.NullableDateTimeFieldUpdateOperationsInput | Date | string | null;
    invitationToken?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
    isPending?: Prisma.BoolFieldUpdateOperationsInput | boolean;
    createdAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
    updatedAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
    lastLoginAt?: Prisma.NullableDateTimeFieldUpdateOperationsInput | Date | string | null;
    timelineEntries?: Prisma.TimelineEntryUncheckedUpdateManyWithoutUserNestedInput;
    postmortems?: Prisma.PostmortemUncheckedUpdateManyWithoutAuthorNestedInput;
};
export type UserCreateWithoutTimelineEntriesInput = {
    id?: string;
    email: string;
    firstName?: string | null;
    lastName?: string | null;
    role?: string;
    globalRole?: string;
    avatarUrl?: string | null;
    passwordHash?: string | null;
    resetPasswordToken?: string | null;
    resetPasswordExpiration?: Date | string | null;
    invitationToken?: string | null;
    isPending?: boolean;
    createdAt?: Date | string;
    updatedAt?: Date | string;
    lastLoginAt?: Date | string | null;
    assignedIncidents?: Prisma.IncidentCreateNestedManyWithoutAssignedToInput;
    postmortems?: Prisma.PostmortemCreateNestedManyWithoutAuthorInput;
};
export type UserUncheckedCreateWithoutTimelineEntriesInput = {
    id?: string;
    email: string;
    firstName?: string | null;
    lastName?: string | null;
    role?: string;
    globalRole?: string;
    avatarUrl?: string | null;
    passwordHash?: string | null;
    resetPasswordToken?: string | null;
    resetPasswordExpiration?: Date | string | null;
    invitationToken?: string | null;
    isPending?: boolean;
    createdAt?: Date | string;
    updatedAt?: Date | string;
    lastLoginAt?: Date | string | null;
    assignedIncidents?: Prisma.IncidentUncheckedCreateNestedManyWithoutAssignedToInput;
    postmortems?: Prisma.PostmortemUncheckedCreateNestedManyWithoutAuthorInput;
};
export type UserCreateOrConnectWithoutTimelineEntriesInput = {
    where: Prisma.UserWhereUniqueInput;
    create: Prisma.XOR<Prisma.UserCreateWithoutTimelineEntriesInput, Prisma.UserUncheckedCreateWithoutTimelineEntriesInput>;
};
export type UserUpsertWithoutTimelineEntriesInput = {
    update: Prisma.XOR<Prisma.UserUpdateWithoutTimelineEntriesInput, Prisma.UserUncheckedUpdateWithoutTimelineEntriesInput>;
    create: Prisma.XOR<Prisma.UserCreateWithoutTimelineEntriesInput, Prisma.UserUncheckedCreateWithoutTimelineEntriesInput>;
    where?: Prisma.UserWhereInput;
};
export type UserUpdateToOneWithWhereWithoutTimelineEntriesInput = {
    where?: Prisma.UserWhereInput;
    data: Prisma.XOR<Prisma.UserUpdateWithoutTimelineEntriesInput, Prisma.UserUncheckedUpdateWithoutTimelineEntriesInput>;
};
export type UserUpdateWithoutTimelineEntriesInput = {
    id?: Prisma.StringFieldUpdateOperationsInput | string;
    email?: Prisma.StringFieldUpdateOperationsInput | string;
    firstName?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
    lastName?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
    role?: Prisma.StringFieldUpdateOperationsInput | string;
    globalRole?: Prisma.StringFieldUpdateOperationsInput | string;
    avatarUrl?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
    passwordHash?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
    resetPasswordToken?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
    resetPasswordExpiration?: Prisma.NullableDateTimeFieldUpdateOperationsInput | Date | string | null;
    invitationToken?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
    isPending?: Prisma.BoolFieldUpdateOperationsInput | boolean;
    createdAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
    updatedAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
    lastLoginAt?: Prisma.NullableDateTimeFieldUpdateOperationsInput | Date | string | null;
    assignedIncidents?: Prisma.IncidentUpdateManyWithoutAssignedToNestedInput;
    postmortems?: Prisma.PostmortemUpdateManyWithoutAuthorNestedInput;
};
export type UserUncheckedUpdateWithoutTimelineEntriesInput = {
    id?: Prisma.StringFieldUpdateOperationsInput | string;
    email?: Prisma.StringFieldUpdateOperationsInput | string;
    firstName?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
    lastName?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
    role?: Prisma.StringFieldUpdateOperationsInput | string;
    globalRole?: Prisma.StringFieldUpdateOperationsInput | string;
    avatarUrl?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
    passwordHash?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
    resetPasswordToken?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
    resetPasswordExpiration?: Prisma.NullableDateTimeFieldUpdateOperationsInput | Date | string | null;
    invitationToken?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
    isPending?: Prisma.BoolFieldUpdateOperationsInput | boolean;
    createdAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
    updatedAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
    lastLoginAt?: Prisma.NullableDateTimeFieldUpdateOperationsInput | Date | string | null;
    assignedIncidents?: Prisma.IncidentUncheckedUpdateManyWithoutAssignedToNestedInput;
    postmortems?: Prisma.PostmortemUncheckedUpdateManyWithoutAuthorNestedInput;
};
export type UserCreateWithoutPostmortemsInput = {
    id?: string;
    email: string;
    firstName?: string | null;
    lastName?: string | null;
    role?: string;
    globalRole?: string;
    avatarUrl?: string | null;
    passwordHash?: string | null;
    resetPasswordToken?: string | null;
    resetPasswordExpiration?: Date | string | null;
    invitationToken?: string | null;
    isPending?: boolean;
    createdAt?: Date | string;
    updatedAt?: Date | string;
    lastLoginAt?: Date | string | null;
    assignedIncidents?: Prisma.IncidentCreateNestedManyWithoutAssignedToInput;
    timelineEntries?: Prisma.TimelineEntryCreateNestedManyWithoutUserInput;
};
export type UserUncheckedCreateWithoutPostmortemsInput = {
    id?: string;
    email: string;
    firstName?: string | null;
    lastName?: string | null;
    role?: string;
    globalRole?: string;
    avatarUrl?: string | null;
    passwordHash?: string | null;
    resetPasswordToken?: string | null;
    resetPasswordExpiration?: Date | string | null;
    invitationToken?: string | null;
    isPending?: boolean;
    createdAt?: Date | string;
    updatedAt?: Date | string;
    lastLoginAt?: Date | string | null;
    assignedIncidents?: Prisma.IncidentUncheckedCreateNestedManyWithoutAssignedToInput;
    timelineEntries?: Prisma.TimelineEntryUncheckedCreateNestedManyWithoutUserInput;
};
export type UserCreateOrConnectWithoutPostmortemsInput = {
    where: Prisma.UserWhereUniqueInput;
    create: Prisma.XOR<Prisma.UserCreateWithoutPostmortemsInput, Prisma.UserUncheckedCreateWithoutPostmortemsInput>;
};
export type UserUpsertWithoutPostmortemsInput = {
    update: Prisma.XOR<Prisma.UserUpdateWithoutPostmortemsInput, Prisma.UserUncheckedUpdateWithoutPostmortemsInput>;
    create: Prisma.XOR<Prisma.UserCreateWithoutPostmortemsInput, Prisma.UserUncheckedCreateWithoutPostmortemsInput>;
    where?: Prisma.UserWhereInput;
};
export type UserUpdateToOneWithWhereWithoutPostmortemsInput = {
    where?: Prisma.UserWhereInput;
    data: Prisma.XOR<Prisma.UserUpdateWithoutPostmortemsInput, Prisma.UserUncheckedUpdateWithoutPostmortemsInput>;
};
export type UserUpdateWithoutPostmortemsInput = {
    id?: Prisma.StringFieldUpdateOperationsInput | string;
    email?: Prisma.StringFieldUpdateOperationsInput | string;
    firstName?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
    lastName?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
    role?: Prisma.StringFieldUpdateOperationsInput | string;
    globalRole?: Prisma.StringFieldUpdateOperationsInput | string;
    avatarUrl?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
    passwordHash?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
    resetPasswordToken?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
    resetPasswordExpiration?: Prisma.NullableDateTimeFieldUpdateOperationsInput | Date | string | null;
    invitationToken?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
    isPending?: Prisma.BoolFieldUpdateOperationsInput | boolean;
    createdAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
    updatedAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
    lastLoginAt?: Prisma.NullableDateTimeFieldUpdateOperationsInput | Date | string | null;
    assignedIncidents?: Prisma.IncidentUpdateManyWithoutAssignedToNestedInput;
    timelineEntries?: Prisma.TimelineEntryUpdateManyWithoutUserNestedInput;
};
export type UserUncheckedUpdateWithoutPostmortemsInput = {
    id?: Prisma.StringFieldUpdateOperationsInput | string;
    email?: Prisma.StringFieldUpdateOperationsInput | string;
    firstName?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
    lastName?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
    role?: Prisma.StringFieldUpdateOperationsInput | string;
    globalRole?: Prisma.StringFieldUpdateOperationsInput | string;
    avatarUrl?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
    passwordHash?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
    resetPasswordToken?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
    resetPasswordExpiration?: Prisma.NullableDateTimeFieldUpdateOperationsInput | Date | string | null;
    invitationToken?: Prisma.NullableStringFieldUpdateOperationsInput | string | null;
    isPending?: Prisma.BoolFieldUpdateOperationsInput | boolean;
    createdAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
    updatedAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
    lastLoginAt?: Prisma.NullableDateTimeFieldUpdateOperationsInput | Date | string | null;
    assignedIncidents?: Prisma.IncidentUncheckedUpdateManyWithoutAssignedToNestedInput;
    timelineEntries?: Prisma.TimelineEntryUncheckedUpdateManyWithoutUserNestedInput;
};
export type UserCountOutputType = {
    assignedIncidents: number;
    timelineEntries: number;
    postmortems: number;
};
export type UserCountOutputTypeSelect<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    assignedIncidents?: boolean | UserCountOutputTypeCountAssignedIncidentsArgs;
    timelineEntries?: boolean | UserCountOutputTypeCountTimelineEntriesArgs;
    postmortems?: boolean | UserCountOutputTypeCountPostmortemsArgs;
};
export type UserCountOutputTypeDefaultArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    select?: Prisma.UserCountOutputTypeSelect<ExtArgs> | null;
};
export type UserCountOutputTypeCountAssignedIncidentsArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    where?: Prisma.IncidentWhereInput;
};
export type UserCountOutputTypeCountTimelineEntriesArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    where?: Prisma.TimelineEntryWhereInput;
};
export type UserCountOutputTypeCountPostmortemsArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    where?: Prisma.PostmortemWhereInput;
};
export type UserSelect<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = runtime.Types.Extensions.GetSelect<{
    id?: boolean;
    email?: boolean;
    firstName?: boolean;
    lastName?: boolean;
    role?: boolean;
    globalRole?: boolean;
    avatarUrl?: boolean;
    passwordHash?: boolean;
    resetPasswordToken?: boolean;
    resetPasswordExpiration?: boolean;
    invitationToken?: boolean;
    isPending?: boolean;
    createdAt?: boolean;
    updatedAt?: boolean;
    lastLoginAt?: boolean;
    assignedIncidents?: boolean | Prisma.User$assignedIncidentsArgs<ExtArgs>;
    timelineEntries?: boolean | Prisma.User$timelineEntriesArgs<ExtArgs>;
    postmortems?: boolean | Prisma.User$postmortemsArgs<ExtArgs>;
    _count?: boolean | Prisma.UserCountOutputTypeDefaultArgs<ExtArgs>;
}, ExtArgs["result"]["user"]>;
export type UserSelectCreateManyAndReturn<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = runtime.Types.Extensions.GetSelect<{
    id?: boolean;
    email?: boolean;
    firstName?: boolean;
    lastName?: boolean;
    role?: boolean;
    globalRole?: boolean;
    avatarUrl?: boolean;
    passwordHash?: boolean;
    resetPasswordToken?: boolean;
    resetPasswordExpiration?: boolean;
    invitationToken?: boolean;
    isPending?: boolean;
    createdAt?: boolean;
    updatedAt?: boolean;
    lastLoginAt?: boolean;
}, ExtArgs["result"]["user"]>;
export type UserSelectUpdateManyAndReturn<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = runtime.Types.Extensions.GetSelect<{
    id?: boolean;
    email?: boolean;
    firstName?: boolean;
    lastName?: boolean;
    role?: boolean;
    globalRole?: boolean;
    avatarUrl?: boolean;
    passwordHash?: boolean;
    resetPasswordToken?: boolean;
    resetPasswordExpiration?: boolean;
    invitationToken?: boolean;
    isPending?: boolean;
    createdAt?: boolean;
    updatedAt?: boolean;
    lastLoginAt?: boolean;
}, ExtArgs["result"]["user"]>;
export type UserSelectScalar = {
    id?: boolean;
    email?: boolean;
    firstName?: boolean;
    lastName?: boolean;
    role?: boolean;
    globalRole?: boolean;
    avatarUrl?: boolean;
    passwordHash?: boolean;
    resetPasswordToken?: boolean;
    resetPasswordExpiration?: boolean;
    invitationToken?: boolean;
    isPending?: boolean;
    createdAt?: boolean;
    updatedAt?: boolean;
    lastLoginAt?: boolean;
};
export type UserOmit<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = runtime.Types.Extensions.GetOmit<"id" | "email" | "firstName" | "lastName" | "role" | "globalRole" | "avatarUrl" | "passwordHash" | "resetPasswordToken" | "resetPasswordExpiration" | "invitationToken" | "isPending" | "createdAt" | "updatedAt" | "lastLoginAt", ExtArgs["result"]["user"]>;
export type UserInclude<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    assignedIncidents?: boolean | Prisma.User$assignedIncidentsArgs<ExtArgs>;
    timelineEntries?: boolean | Prisma.User$timelineEntriesArgs<ExtArgs>;
    postmortems?: boolean | Prisma.User$postmortemsArgs<ExtArgs>;
    _count?: boolean | Prisma.UserCountOutputTypeDefaultArgs<ExtArgs>;
};
export type UserIncludeCreateManyAndReturn<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {};
export type UserIncludeUpdateManyAndReturn<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {};
export type $UserPayload<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    name: "User";
    objects: {
        assignedIncidents: Prisma.$IncidentPayload<ExtArgs>[];
        timelineEntries: Prisma.$TimelineEntryPayload<ExtArgs>[];
        postmortems: Prisma.$PostmortemPayload<ExtArgs>[];
    };
    scalars: runtime.Types.Extensions.GetPayloadResult<{
        id: string;
        email: string;
        firstName: string | null;
        lastName: string | null;
        role: string;
        globalRole: string;
        avatarUrl: string | null;
        passwordHash: string | null;
        resetPasswordToken: string | null;
        resetPasswordExpiration: Date | null;
        invitationToken: string | null;
        isPending: boolean;
        createdAt: Date;
        updatedAt: Date;
        lastLoginAt: Date | null;
    }, ExtArgs["result"]["user"]>;
    composites: {};
};
export type UserGetPayload<S extends boolean | null | undefined | UserDefaultArgs> = runtime.Types.Result.GetResult<Prisma.$UserPayload, S>;
export type UserCountArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = Omit<UserFindManyArgs, 'select' | 'include' | 'distinct' | 'omit'> & {
    select?: UserCountAggregateInputType | true;
};
export interface UserDelegate<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs, GlobalOmitOptions = {}> {
    [K: symbol]: {
        types: Prisma.TypeMap<ExtArgs>['model']['User'];
        meta: {
            name: 'User';
        };
    };
    findUnique<T extends UserFindUniqueArgs>(args: Prisma.SelectSubset<T, UserFindUniqueArgs<ExtArgs>>): Prisma.Prisma__UserClient<runtime.Types.Result.GetResult<Prisma.$UserPayload<ExtArgs>, T, "findUnique", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>;
    findUniqueOrThrow<T extends UserFindUniqueOrThrowArgs>(args: Prisma.SelectSubset<T, UserFindUniqueOrThrowArgs<ExtArgs>>): Prisma.Prisma__UserClient<runtime.Types.Result.GetResult<Prisma.$UserPayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>;
    findFirst<T extends UserFindFirstArgs>(args?: Prisma.SelectSubset<T, UserFindFirstArgs<ExtArgs>>): Prisma.Prisma__UserClient<runtime.Types.Result.GetResult<Prisma.$UserPayload<ExtArgs>, T, "findFirst", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>;
    findFirstOrThrow<T extends UserFindFirstOrThrowArgs>(args?: Prisma.SelectSubset<T, UserFindFirstOrThrowArgs<ExtArgs>>): Prisma.Prisma__UserClient<runtime.Types.Result.GetResult<Prisma.$UserPayload<ExtArgs>, T, "findFirstOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>;
    findMany<T extends UserFindManyArgs>(args?: Prisma.SelectSubset<T, UserFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<runtime.Types.Result.GetResult<Prisma.$UserPayload<ExtArgs>, T, "findMany", GlobalOmitOptions>>;
    create<T extends UserCreateArgs>(args: Prisma.SelectSubset<T, UserCreateArgs<ExtArgs>>): Prisma.Prisma__UserClient<runtime.Types.Result.GetResult<Prisma.$UserPayload<ExtArgs>, T, "create", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>;
    createMany<T extends UserCreateManyArgs>(args?: Prisma.SelectSubset<T, UserCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<Prisma.BatchPayload>;
    createManyAndReturn<T extends UserCreateManyAndReturnArgs>(args?: Prisma.SelectSubset<T, UserCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<runtime.Types.Result.GetResult<Prisma.$UserPayload<ExtArgs>, T, "createManyAndReturn", GlobalOmitOptions>>;
    delete<T extends UserDeleteArgs>(args: Prisma.SelectSubset<T, UserDeleteArgs<ExtArgs>>): Prisma.Prisma__UserClient<runtime.Types.Result.GetResult<Prisma.$UserPayload<ExtArgs>, T, "delete", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>;
    update<T extends UserUpdateArgs>(args: Prisma.SelectSubset<T, UserUpdateArgs<ExtArgs>>): Prisma.Prisma__UserClient<runtime.Types.Result.GetResult<Prisma.$UserPayload<ExtArgs>, T, "update", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>;
    deleteMany<T extends UserDeleteManyArgs>(args?: Prisma.SelectSubset<T, UserDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<Prisma.BatchPayload>;
    updateMany<T extends UserUpdateManyArgs>(args: Prisma.SelectSubset<T, UserUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<Prisma.BatchPayload>;
    updateManyAndReturn<T extends UserUpdateManyAndReturnArgs>(args: Prisma.SelectSubset<T, UserUpdateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<runtime.Types.Result.GetResult<Prisma.$UserPayload<ExtArgs>, T, "updateManyAndReturn", GlobalOmitOptions>>;
    upsert<T extends UserUpsertArgs>(args: Prisma.SelectSubset<T, UserUpsertArgs<ExtArgs>>): Prisma.Prisma__UserClient<runtime.Types.Result.GetResult<Prisma.$UserPayload<ExtArgs>, T, "upsert", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>;
    count<T extends UserCountArgs>(args?: Prisma.Subset<T, UserCountArgs>): Prisma.PrismaPromise<T extends runtime.Types.Utils.Record<'select', any> ? T['select'] extends true ? number : Prisma.GetScalarType<T['select'], UserCountAggregateOutputType> : number>;
    aggregate<T extends UserAggregateArgs>(args: Prisma.Subset<T, UserAggregateArgs>): Prisma.PrismaPromise<GetUserAggregateType<T>>;
    groupBy<T extends UserGroupByArgs, HasSelectOrTake extends Prisma.Or<Prisma.Extends<'skip', Prisma.Keys<T>>, Prisma.Extends<'take', Prisma.Keys<T>>>, OrderByArg extends Prisma.True extends HasSelectOrTake ? {
        orderBy: UserGroupByArgs['orderBy'];
    } : {
        orderBy?: UserGroupByArgs['orderBy'];
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
    }[OrderFields]>(args: Prisma.SubsetIntersection<T, UserGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetUserGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>;
    readonly fields: UserFieldRefs;
}
export interface Prisma__UserClient<T, Null = never, ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs, GlobalOmitOptions = {}> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise";
    assignedIncidents<T extends Prisma.User$assignedIncidentsArgs<ExtArgs> = {}>(args?: Prisma.Subset<T, Prisma.User$assignedIncidentsArgs<ExtArgs>>): Prisma.PrismaPromise<runtime.Types.Result.GetResult<Prisma.$IncidentPayload<ExtArgs>, T, "findMany", GlobalOmitOptions> | Null>;
    timelineEntries<T extends Prisma.User$timelineEntriesArgs<ExtArgs> = {}>(args?: Prisma.Subset<T, Prisma.User$timelineEntriesArgs<ExtArgs>>): Prisma.PrismaPromise<runtime.Types.Result.GetResult<Prisma.$TimelineEntryPayload<ExtArgs>, T, "findMany", GlobalOmitOptions> | Null>;
    postmortems<T extends Prisma.User$postmortemsArgs<ExtArgs> = {}>(args?: Prisma.Subset<T, Prisma.User$postmortemsArgs<ExtArgs>>): Prisma.PrismaPromise<runtime.Types.Result.GetResult<Prisma.$PostmortemPayload<ExtArgs>, T, "findMany", GlobalOmitOptions> | Null>;
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): runtime.Types.Utils.JsPromise<TResult1 | TResult2>;
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): runtime.Types.Utils.JsPromise<T | TResult>;
    finally(onfinally?: (() => void) | undefined | null): runtime.Types.Utils.JsPromise<T>;
}
export interface UserFieldRefs {
    readonly id: Prisma.FieldRef<"User", 'String'>;
    readonly email: Prisma.FieldRef<"User", 'String'>;
    readonly firstName: Prisma.FieldRef<"User", 'String'>;
    readonly lastName: Prisma.FieldRef<"User", 'String'>;
    readonly role: Prisma.FieldRef<"User", 'String'>;
    readonly globalRole: Prisma.FieldRef<"User", 'String'>;
    readonly avatarUrl: Prisma.FieldRef<"User", 'String'>;
    readonly passwordHash: Prisma.FieldRef<"User", 'String'>;
    readonly resetPasswordToken: Prisma.FieldRef<"User", 'String'>;
    readonly resetPasswordExpiration: Prisma.FieldRef<"User", 'DateTime'>;
    readonly invitationToken: Prisma.FieldRef<"User", 'String'>;
    readonly isPending: Prisma.FieldRef<"User", 'Boolean'>;
    readonly createdAt: Prisma.FieldRef<"User", 'DateTime'>;
    readonly updatedAt: Prisma.FieldRef<"User", 'DateTime'>;
    readonly lastLoginAt: Prisma.FieldRef<"User", 'DateTime'>;
}
export type UserFindUniqueArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    select?: Prisma.UserSelect<ExtArgs> | null;
    omit?: Prisma.UserOmit<ExtArgs> | null;
    include?: Prisma.UserInclude<ExtArgs> | null;
    where: Prisma.UserWhereUniqueInput;
};
export type UserFindUniqueOrThrowArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    select?: Prisma.UserSelect<ExtArgs> | null;
    omit?: Prisma.UserOmit<ExtArgs> | null;
    include?: Prisma.UserInclude<ExtArgs> | null;
    where: Prisma.UserWhereUniqueInput;
};
export type UserFindFirstArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    select?: Prisma.UserSelect<ExtArgs> | null;
    omit?: Prisma.UserOmit<ExtArgs> | null;
    include?: Prisma.UserInclude<ExtArgs> | null;
    where?: Prisma.UserWhereInput;
    orderBy?: Prisma.UserOrderByWithRelationInput | Prisma.UserOrderByWithRelationInput[];
    cursor?: Prisma.UserWhereUniqueInput;
    take?: number;
    skip?: number;
    distinct?: Prisma.UserScalarFieldEnum | Prisma.UserScalarFieldEnum[];
};
export type UserFindFirstOrThrowArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    select?: Prisma.UserSelect<ExtArgs> | null;
    omit?: Prisma.UserOmit<ExtArgs> | null;
    include?: Prisma.UserInclude<ExtArgs> | null;
    where?: Prisma.UserWhereInput;
    orderBy?: Prisma.UserOrderByWithRelationInput | Prisma.UserOrderByWithRelationInput[];
    cursor?: Prisma.UserWhereUniqueInput;
    take?: number;
    skip?: number;
    distinct?: Prisma.UserScalarFieldEnum | Prisma.UserScalarFieldEnum[];
};
export type UserFindManyArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    select?: Prisma.UserSelect<ExtArgs> | null;
    omit?: Prisma.UserOmit<ExtArgs> | null;
    include?: Prisma.UserInclude<ExtArgs> | null;
    where?: Prisma.UserWhereInput;
    orderBy?: Prisma.UserOrderByWithRelationInput | Prisma.UserOrderByWithRelationInput[];
    cursor?: Prisma.UserWhereUniqueInput;
    take?: number;
    skip?: number;
    distinct?: Prisma.UserScalarFieldEnum | Prisma.UserScalarFieldEnum[];
};
export type UserCreateArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    select?: Prisma.UserSelect<ExtArgs> | null;
    omit?: Prisma.UserOmit<ExtArgs> | null;
    include?: Prisma.UserInclude<ExtArgs> | null;
    data: Prisma.XOR<Prisma.UserCreateInput, Prisma.UserUncheckedCreateInput>;
};
export type UserCreateManyArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    data: Prisma.UserCreateManyInput | Prisma.UserCreateManyInput[];
};
export type UserCreateManyAndReturnArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    select?: Prisma.UserSelectCreateManyAndReturn<ExtArgs> | null;
    omit?: Prisma.UserOmit<ExtArgs> | null;
    data: Prisma.UserCreateManyInput | Prisma.UserCreateManyInput[];
};
export type UserUpdateArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    select?: Prisma.UserSelect<ExtArgs> | null;
    omit?: Prisma.UserOmit<ExtArgs> | null;
    include?: Prisma.UserInclude<ExtArgs> | null;
    data: Prisma.XOR<Prisma.UserUpdateInput, Prisma.UserUncheckedUpdateInput>;
    where: Prisma.UserWhereUniqueInput;
};
export type UserUpdateManyArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    data: Prisma.XOR<Prisma.UserUpdateManyMutationInput, Prisma.UserUncheckedUpdateManyInput>;
    where?: Prisma.UserWhereInput;
    limit?: number;
};
export type UserUpdateManyAndReturnArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    select?: Prisma.UserSelectUpdateManyAndReturn<ExtArgs> | null;
    omit?: Prisma.UserOmit<ExtArgs> | null;
    data: Prisma.XOR<Prisma.UserUpdateManyMutationInput, Prisma.UserUncheckedUpdateManyInput>;
    where?: Prisma.UserWhereInput;
    limit?: number;
};
export type UserUpsertArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    select?: Prisma.UserSelect<ExtArgs> | null;
    omit?: Prisma.UserOmit<ExtArgs> | null;
    include?: Prisma.UserInclude<ExtArgs> | null;
    where: Prisma.UserWhereUniqueInput;
    create: Prisma.XOR<Prisma.UserCreateInput, Prisma.UserUncheckedCreateInput>;
    update: Prisma.XOR<Prisma.UserUpdateInput, Prisma.UserUncheckedUpdateInput>;
};
export type UserDeleteArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    select?: Prisma.UserSelect<ExtArgs> | null;
    omit?: Prisma.UserOmit<ExtArgs> | null;
    include?: Prisma.UserInclude<ExtArgs> | null;
    where: Prisma.UserWhereUniqueInput;
};
export type UserDeleteManyArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    where?: Prisma.UserWhereInput;
    limit?: number;
};
export type User$assignedIncidentsArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
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
export type User$timelineEntriesArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    select?: Prisma.TimelineEntrySelect<ExtArgs> | null;
    omit?: Prisma.TimelineEntryOmit<ExtArgs> | null;
    include?: Prisma.TimelineEntryInclude<ExtArgs> | null;
    where?: Prisma.TimelineEntryWhereInput;
    orderBy?: Prisma.TimelineEntryOrderByWithRelationInput | Prisma.TimelineEntryOrderByWithRelationInput[];
    cursor?: Prisma.TimelineEntryWhereUniqueInput;
    take?: number;
    skip?: number;
    distinct?: Prisma.TimelineEntryScalarFieldEnum | Prisma.TimelineEntryScalarFieldEnum[];
};
export type User$postmortemsArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    select?: Prisma.PostmortemSelect<ExtArgs> | null;
    omit?: Prisma.PostmortemOmit<ExtArgs> | null;
    include?: Prisma.PostmortemInclude<ExtArgs> | null;
    where?: Prisma.PostmortemWhereInput;
    orderBy?: Prisma.PostmortemOrderByWithRelationInput | Prisma.PostmortemOrderByWithRelationInput[];
    cursor?: Prisma.PostmortemWhereUniqueInput;
    take?: number;
    skip?: number;
    distinct?: Prisma.PostmortemScalarFieldEnum | Prisma.PostmortemScalarFieldEnum[];
};
export type UserDefaultArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    select?: Prisma.UserSelect<ExtArgs> | null;
    omit?: Prisma.UserOmit<ExtArgs> | null;
    include?: Prisma.UserInclude<ExtArgs> | null;
};
export {};
