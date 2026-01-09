import * as runtime from "@prisma/client/runtime/client";
export const PrismaClientKnownRequestError = runtime.PrismaClientKnownRequestError;
export const PrismaClientUnknownRequestError = runtime.PrismaClientUnknownRequestError;
export const PrismaClientRustPanicError = runtime.PrismaClientRustPanicError;
export const PrismaClientInitializationError = runtime.PrismaClientInitializationError;
export const PrismaClientValidationError = runtime.PrismaClientValidationError;
export const sql = runtime.sqltag;
export const empty = runtime.empty;
export const join = runtime.join;
export const raw = runtime.raw;
export const Sql = runtime.Sql;
export const Decimal = runtime.Decimal;
export const getExtensionContext = runtime.Extensions.getExtensionContext;
export const prismaVersion = {
    client: "7.2.0",
    engine: "0c8ef2ce45c83248ab3df073180d5eda9e8be7a3"
};
export const NullTypes = {
    DbNull: runtime.NullTypes.DbNull,
    JsonNull: runtime.NullTypes.JsonNull,
    AnyNull: runtime.NullTypes.AnyNull,
};
export const DbNull = runtime.DbNull;
export const JsonNull = runtime.JsonNull;
export const AnyNull = runtime.AnyNull;
export const ModelName = {
    User: 'User',
    Service: 'Service',
    ServiceDependency: 'ServiceDependency',
    Event: 'Event',
    Alert: 'Alert',
    Incident: 'Incident',
    Investigation: 'Investigation',
    AgentExecution: 'AgentExecution',
    ToolExecution: 'ToolExecution',
    Recommendation: 'Recommendation',
    TimelineEntry: 'TimelineEntry',
    Postmortem: 'Postmortem',
    CorrelationRule: 'CorrelationRule',
    Setting: 'Setting',
    IntegrationDefinition: 'IntegrationDefinition',
    IntegrationConnection: 'IntegrationConnection',
    ServiceIntegration: 'ServiceIntegration',
    AlertMappingRule: 'AlertMappingRule',
    ServiceSuggestion: 'ServiceSuggestion',
    LicenseInfo: 'LicenseInfo'
};
export const TransactionIsolationLevel = runtime.makeStrictEnum({
    Serializable: 'Serializable'
});
export const UserScalarFieldEnum = {
    id: 'id',
    email: 'email',
    firstName: 'firstName',
    lastName: 'lastName',
    role: 'role',
    globalRole: 'globalRole',
    avatarUrl: 'avatarUrl',
    passwordHash: 'passwordHash',
    resetPasswordToken: 'resetPasswordToken',
    resetPasswordExpiration: 'resetPasswordExpiration',
    invitationToken: 'invitationToken',
    isPending: 'isPending',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt',
    lastLoginAt: 'lastLoginAt'
};
export const ServiceScalarFieldEnum = {
    id: 'id',
    name: 'name',
    displayName: 'displayName',
    description: 'description',
    type: 'type',
    tier: 'tier',
    team: 'team',
    slackChannel: 'slackChannel',
    repository: 'repository',
    tags: 'tags',
    metadata: 'metadata',
    discoverySource: 'discoverySource',
    discoveryMetadata: 'discoveryMetadata',
    isDiscovered: 'isDiscovered',
    isConfirmed: 'isConfirmed',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
};
export const ServiceDependencyScalarFieldEnum = {
    id: 'id',
    dependentId: 'dependentId',
    dependencyId: 'dependencyId',
    dependencyType: 'dependencyType',
    criticality: 'criticality',
    createdAt: 'createdAt'
};
export const EventScalarFieldEnum = {
    id: 'id',
    source: 'source',
    sourceEventId: 'sourceEventId',
    eventType: 'eventType',
    payload: 'payload',
    receivedAt: 'receivedAt',
    eventTime: 'eventTime',
    processed: 'processed',
    alertId: 'alertId'
};
export const AlertScalarFieldEnum = {
    id: 'id',
    dedupKey: 'dedupKey',
    fingerprint: 'fingerprint',
    externalId: 'externalId',
    title: 'title',
    description: 'description',
    severity: 'severity',
    status: 'status',
    source: 'source',
    sourceUrl: 'sourceUrl',
    serviceId: 'serviceId',
    tags: 'tags',
    labels: 'labels',
    triggeredAt: 'triggeredAt',
    acknowledgedAt: 'acknowledgedAt',
    resolvedAt: 'resolvedAt',
    occurrenceCount: 'occurrenceCount',
    lastOccurrence: 'lastOccurrence',
    rawPayload: 'rawPayload',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt',
    incidentId: 'incidentId'
};
export const IncidentScalarFieldEnum = {
    id: 'id',
    number: 'number',
    title: 'title',
    description: 'description',
    severity: 'severity',
    status: 'status',
    priority: 'priority',
    serviceId: 'serviceId',
    assignedToId: 'assignedToId',
    correlationReason: 'correlationReason',
    correlationRuleId: 'correlationRuleId',
    tags: 'tags',
    customerImpact: 'customerImpact',
    affectedSystems: 'affectedSystems',
    triggeredAt: 'triggeredAt',
    acknowledgedAt: 'acknowledgedAt',
    resolvedAt: 'resolvedAt',
    alertCount: 'alertCount',
    timeToAcknowledge: 'timeToAcknowledge',
    timeToResolve: 'timeToResolve',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
};
export const InvestigationScalarFieldEnum = {
    id: 'id',
    incidentId: 'incidentId',
    status: 'status',
    startedAt: 'startedAt',
    completedAt: 'completedAt',
    summary: 'summary',
    rootCause: 'rootCause',
    rootCauseCategory: 'rootCauseCategory',
    confidence: 'confidence',
    dataQuality: 'dataQuality',
    analysisMethod: 'analysisMethod',
    dataSourcesUsed: 'dataSourcesUsed',
    rawOutput: 'rawOutput',
    error: 'error',
    agentProgression: 'agentProgression',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
};
export const AgentExecutionScalarFieldEnum = {
    id: 'id',
    investigationId: 'investigationId',
    agentName: 'agentName',
    agentType: 'agentType',
    status: 'status',
    startedAt: 'startedAt',
    completedAt: 'completedAt',
    executionTimeMs: 'executionTimeMs',
    output: 'output',
    confidence: 'confidence',
    inputTokens: 'inputTokens',
    outputTokens: 'outputTokens',
    error: 'error',
    createdAt: 'createdAt'
};
export const ToolExecutionScalarFieldEnum = {
    id: 'id',
    agentExecutionId: 'agentExecutionId',
    toolName: 'toolName',
    toolCategory: 'toolCategory',
    arguments: 'arguments',
    result: 'result',
    status: 'status',
    executionTimeMs: 'executionTimeMs',
    confidence: 'confidence',
    dataQuality: 'dataQuality',
    error: 'error',
    executedAt: 'executedAt'
};
export const RecommendationScalarFieldEnum = {
    id: 'id',
    investigationId: 'investigationId',
    title: 'title',
    description: 'description',
    priority: 'priority',
    category: 'category',
    urgency: 'urgency',
    actionable: 'actionable',
    estimatedEffort: 'estimatedEffort',
    status: 'status',
    implementedAt: 'implementedAt',
    implementedBy: 'implementedBy',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
};
export const TimelineEntryScalarFieldEnum = {
    id: 'id',
    incidentId: 'incidentId',
    type: 'type',
    title: 'title',
    description: 'description',
    metadata: 'metadata',
    source: 'source',
    userId: 'userId',
    occurredAt: 'occurredAt'
};
export const PostmortemScalarFieldEnum = {
    id: 'id',
    incidentId: 'incidentId',
    title: 'title',
    summary: 'summary',
    timeline: 'timeline',
    whatHappened: 'whatHappened',
    whyItHappened: 'whyItHappened',
    whatWeLearned: 'whatWeLearned',
    actionItems: 'actionItems',
    customerImpact: 'customerImpact',
    financialImpact: 'financialImpact',
    status: 'status',
    authorId: 'authorId',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt',
    publishedAt: 'publishedAt'
};
export const CorrelationRuleScalarFieldEnum = {
    id: 'id',
    name: 'name',
    description: 'description',
    enabled: 'enabled',
    priority: 'priority',
    matchCriteria: 'matchCriteria',
    timeWindowMinutes: 'timeWindowMinutes',
    action: 'action',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
};
export const SettingScalarFieldEnum = {
    id: 'id',
    key: 'key',
    value: 'value',
    type: 'type',
    category: 'category',
    description: 'description',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
};
export const IntegrationDefinitionScalarFieldEnum = {
    id: 'id',
    name: 'name',
    displayName: 'displayName',
    description: 'description',
    category: 'category',
    authType: 'authType',
    configSchema: 'configSchema',
    oauthConfig: 'oauthConfig',
    iconUrl: 'iconUrl',
    docsUrl: 'docsUrl',
    maxConnectionsCE: 'maxConnectionsCE',
    isEnabled: 'isEnabled',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
};
export const IntegrationConnectionScalarFieldEnum = {
    id: 'id',
    definitionId: 'definitionId',
    name: 'name',
    description: 'description',
    isGlobal: 'isGlobal',
    status: 'status',
    lastHealthCheck: 'lastHealthCheck',
    lastError: 'lastError',
    authMethod: 'authMethod',
    credentials: 'credentials',
    config: 'config',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
};
export const ServiceIntegrationScalarFieldEnum = {
    id: 'id',
    serviceId: 'serviceId',
    connectionId: 'connectionId',
    priority: 'priority',
    config: 'config',
    isEnabled: 'isEnabled',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
};
export const AlertMappingRuleScalarFieldEnum = {
    id: 'id',
    name: 'name',
    description: 'description',
    priority: 'priority',
    enabled: 'enabled',
    matchCriteria: 'matchCriteria',
    serviceId: 'serviceId',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
};
export const ServiceSuggestionScalarFieldEnum = {
    id: 'id',
    connectionId: 'connectionId',
    suggestedName: 'suggestedName',
    displayName: 'displayName',
    repository: 'repository',
    isMonorepo: 'isMonorepo',
    subPath: 'subPath',
    status: 'status',
    metadata: 'metadata',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
};
export const LicenseInfoScalarFieldEnum = {
    id: 'id',
    licenseKey: 'licenseKey',
    licenseType: 'licenseType',
    tier: 'tier',
    validUntil: 'validUntil',
    activatedAt: 'activatedAt',
    lastValidated: 'lastValidated',
    features: 'features',
    quotas: 'quotas',
    billingCycle: 'billingCycle',
    seats: 'seats',
    cloudInstanceId: 'cloudInstanceId',
    isCloudManaged: 'isCloudManaged',
    customerEmail: 'customerEmail',
    customerName: 'customerName',
    metadata: 'metadata',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
};
export const SortOrder = {
    asc: 'asc',
    desc: 'desc'
};
export const NullsOrder = {
    first: 'first',
    last: 'last'
};
export const defineExtension = runtime.Extensions.defineExtension;
//# sourceMappingURL=prismaNamespace.js.map