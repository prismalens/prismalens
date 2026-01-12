import {
	Logger,
	type MiddlewareConsumer,
	Module,
	type NestModule,
} from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { REQUEST } from "@nestjs/core";
// oRPC imports
import { ORPCError, ORPCModule, onError } from "@orpc/nest";
import { experimental_RethrowHandlerPlugin as RethrowHandlerPlugin } from "@orpc/server/plugins";
import { getConfig } from "@prismalens/config";
import type { Request } from "express";
import { AppController } from "./app.controller.js";
import { WebhookCorsMiddleware } from "./middlewares/webhook-cors.middleware.js";

// Extend oRPC global context for type safety
declare module "@orpc/nest" {
	interface ORPCGlobalContext {
		request: Request;
	}
}

import { AuthModule } from "./core/auth/auth.module.js";
import { LicenseModule } from "./core/license/license.module.js";
// Core modules
import { PrismaModule } from "./core/prisma/prisma.module.js";
import { SettingsModule } from "./core/settings/settings.module.js";
import { UsersModule } from "./core/users/users.module.js";

// Infrastructure modules
import { HealthModule } from "./infrastructure/health/health.module.js";
import { InternalModule } from "./infrastructure/internal/internal.module.js";
import { QueueModule } from "./infrastructure/queue/queue.module.js";
import { AlertMappingModule } from "./modules/alert-mapping/alert-mapping.module.js";
// Feature modules
import { AlertsModule } from "./modules/alerts/alerts.module.js";
import { CorrelationModule } from "./modules/correlation/correlation.module.js";
import { EventsModule } from "./modules/events/events.module.js";
import { IncidentsModule } from "./modules/incidents/incidents.module.js";
import { IntegrationsModule } from "./modules/integrations/integrations.module.js";
import { InvestigationsModule } from "./modules/investigations/investigations.module.js";
import { OpenAPIModule } from "./modules/openapi/openapi.module.js";
import { RecommendationsModule } from "./modules/recommendations/recommendations.module.js";
import { ServiceDiscoveryModule } from "./modules/service-discovery/service-discovery.module.js";
import { ServicesModule } from "./modules/services/services.module.js";
import { TimelineModule } from "./modules/timeline/timeline.module.js";
import { WebhooksModule } from "./modules/webhooks/webhooks.module.js";

@Module({
	imports: [
		// Configuration
		ConfigModule.forRoot({
			ignoreEnvFile: true,
			load: [getConfig],
		}),

		// oRPC Module - provides end-to-end type safety
		ORPCModule.forRootAsync({
			useFactory: (request: Request) => ({
				interceptors: [
					onError((error) => {
						// Log oRPC errors for debugging
						const logger = new Logger("oRPC");
						logger.error(`oRPC Error: ${error.message}`, error.stack);
					}),
				],
				context: { request }, // Make request available in handlers
				plugins: [
					new RethrowHandlerPlugin({
						filter: (error) => {
							// Rethrow non-oRPC errors to NestJS exception filters
							return !(error instanceof ORPCError);
						},
					}),
				],
			}),
			inject: [REQUEST],
		}),

		// Core
		PrismaModule,
		AuthModule, // Better Auth for authentication
		UsersModule,
		SettingsModule,
		LicenseModule,

		// Infrastructure
		HealthModule,
		QueueModule.forRoot(),
		InternalModule,

		// Note: Frontend is now served by TanStack Start via Caddy reverse proxy
		// ServeStaticModule removed - Caddy routes /api/* to this service, /* to frontend

		// Feature modules (incident-centric architecture)
		EventsModule, // Raw event ingestion
		ServicesModule, // Service catalog
		AlertsModule, // Alert processing
		AlertMappingModule, // Alert mapping rules
		CorrelationModule, // Alert → Incident correlation
		IncidentsModule, // Incident management (primary entity)
		InvestigationsModule, // AI investigation (replaces AnalysisModule)
		TimelineModule, // Incident timeline
		WebhooksModule, // Webhook ingestion
		RecommendationsModule,
		IntegrationsModule, // External tool integrations (GitHub, Prometheus, Slack)
		ServiceDiscoveryModule, // Service discovery from integrations
		OpenAPIModule, // OpenAPI spec and documentation
	],
	controllers: [AppController],
})
export class AppModule implements NestModule {
	configure(consumer: MiddlewareConsumer) {
		// Apply permissive CORS middleware only to webhook routes
		// This allows browser-based testing tools while keeping main API restricted
		if (getConfig().PRISMALENS_CORS_WEBHOOK_OPEN) {
			consumer.apply(WebhookCorsMiddleware).forRoutes("webhooks/*");
		}
	}
}
