import * as runtime from "@prisma/client/runtime/client";
import type * as Prisma from "./prismaNamespace.js";
export type LogOptions<ClientOptions extends Prisma.PrismaClientOptions> =
	"log" extends keyof ClientOptions
		? ClientOptions["log"] extends Array<Prisma.LogLevel | Prisma.LogDefinition>
			? Prisma.GetEvents<ClientOptions["log"]>
			: never
		: never;
export interface PrismaClientConstructor {
	new <
		Options extends Prisma.PrismaClientOptions = Prisma.PrismaClientOptions,
		LogOpts extends LogOptions<Options> = LogOptions<Options>,
		OmitOpts extends Prisma.PrismaClientOptions["omit"] = Options extends {
			omit: infer U;
		}
			? U
			: Prisma.PrismaClientOptions["omit"],
		ExtArgs extends
			runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
	>(
		options: Prisma.Subset<Options, Prisma.PrismaClientOptions>,
	): PrismaClient<LogOpts, OmitOpts, ExtArgs>;
}
export interface PrismaClient<
	in LogOpts extends Prisma.LogLevel = never,
	in out OmitOpts extends Prisma.PrismaClientOptions["omit"] = undefined,
	in out ExtArgs extends
		runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs,
> {
	[K: symbol]: {
		types: Prisma.TypeMap<ExtArgs>["other"];
	};
	$on<V extends LogOpts>(
		eventType: V,
		callback: (
			event: V extends "query" ? Prisma.QueryEvent : Prisma.LogEvent,
		) => void,
	): PrismaClient;
	$connect(): runtime.Types.Utils.JsPromise<void>;
	$disconnect(): runtime.Types.Utils.JsPromise<void>;
	$executeRaw<T = unknown>(
		query: TemplateStringsArray | Prisma.Sql,
		...values: any[]
	): Prisma.PrismaPromise<number>;
	$executeRawUnsafe<T = unknown>(
		query: string,
		...values: any[]
	): Prisma.PrismaPromise<number>;
	$queryRaw<T = unknown>(
		query: TemplateStringsArray | Prisma.Sql,
		...values: any[]
	): Prisma.PrismaPromise<T>;
	$queryRawUnsafe<T = unknown>(
		query: string,
		...values: any[]
	): Prisma.PrismaPromise<T>;
	$transaction<P extends Prisma.PrismaPromise<any>[]>(
		arg: [...P],
		options?: {
			isolationLevel?: Prisma.TransactionIsolationLevel;
		},
	): runtime.Types.Utils.JsPromise<runtime.Types.Utils.UnwrapTuple<P>>;
	$transaction<R>(
		fn: (
			prisma: Omit<PrismaClient, runtime.ITXClientDenyList>,
		) => runtime.Types.Utils.JsPromise<R>,
		options?: {
			maxWait?: number;
			timeout?: number;
			isolationLevel?: Prisma.TransactionIsolationLevel;
		},
	): runtime.Types.Utils.JsPromise<R>;
	$extends: runtime.Types.Extensions.ExtendsHook<
		"extends",
		Prisma.TypeMapCb<OmitOpts>,
		ExtArgs,
		runtime.Types.Utils.Call<
			Prisma.TypeMapCb<OmitOpts>,
			{
				extArgs: ExtArgs;
			}
		>
	>;
	get user(): Prisma.UserDelegate<
		ExtArgs,
		{
			omit: OmitOpts;
		}
	>;
	get service(): Prisma.ServiceDelegate<
		ExtArgs,
		{
			omit: OmitOpts;
		}
	>;
	get serviceDependency(): Prisma.ServiceDependencyDelegate<
		ExtArgs,
		{
			omit: OmitOpts;
		}
	>;
	get event(): Prisma.EventDelegate<
		ExtArgs,
		{
			omit: OmitOpts;
		}
	>;
	get alert(): Prisma.AlertDelegate<
		ExtArgs,
		{
			omit: OmitOpts;
		}
	>;
	get incident(): Prisma.IncidentDelegate<
		ExtArgs,
		{
			omit: OmitOpts;
		}
	>;
	get investigation(): Prisma.InvestigationDelegate<
		ExtArgs,
		{
			omit: OmitOpts;
		}
	>;
	get agentExecution(): Prisma.AgentExecutionDelegate<
		ExtArgs,
		{
			omit: OmitOpts;
		}
	>;
	get toolExecution(): Prisma.ToolExecutionDelegate<
		ExtArgs,
		{
			omit: OmitOpts;
		}
	>;
	get recommendation(): Prisma.RecommendationDelegate<
		ExtArgs,
		{
			omit: OmitOpts;
		}
	>;
	get timelineEntry(): Prisma.TimelineEntryDelegate<
		ExtArgs,
		{
			omit: OmitOpts;
		}
	>;
	get postmortem(): Prisma.PostmortemDelegate<
		ExtArgs,
		{
			omit: OmitOpts;
		}
	>;
	get correlationRule(): Prisma.CorrelationRuleDelegate<
		ExtArgs,
		{
			omit: OmitOpts;
		}
	>;
	get setting(): Prisma.SettingDelegate<
		ExtArgs,
		{
			omit: OmitOpts;
		}
	>;
	get integrationDefinition(): Prisma.IntegrationDefinitionDelegate<
		ExtArgs,
		{
			omit: OmitOpts;
		}
	>;
	get integrationConnection(): Prisma.IntegrationConnectionDelegate<
		ExtArgs,
		{
			omit: OmitOpts;
		}
	>;
	get serviceIntegration(): Prisma.ServiceIntegrationDelegate<
		ExtArgs,
		{
			omit: OmitOpts;
		}
	>;
	get alertMappingRule(): Prisma.AlertMappingRuleDelegate<
		ExtArgs,
		{
			omit: OmitOpts;
		}
	>;
	get serviceSuggestion(): Prisma.ServiceSuggestionDelegate<
		ExtArgs,
		{
			omit: OmitOpts;
		}
	>;
	get licenseInfo(): Prisma.LicenseInfoDelegate<
		ExtArgs,
		{
			omit: OmitOpts;
		}
	>;
}
export declare function getPrismaClientClass(): PrismaClientConstructor;
