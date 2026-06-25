import {
  type MiddlewareConsumer,
  Module,
  type NestModule,
} from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD, REQUEST } from '@nestjs/core';
// oRPC imports
import { ORPCError, ORPCModule, onError } from '@orpc/nest';
import { experimental_RethrowHandlerPlugin as RethrowHandlerPlugin } from '@orpc/server/plugins';
import { getConfig } from '@prismalens/config';
import { LoggerModule } from '@prismalens/logger/nestjs';
import { Logger } from '@prismalens/logger';
import type { Request } from 'express';
import { AppController } from './app.controller.js';
import { WebhookCorsMiddleware } from './middlewares/webhook-cors.middleware.js';

// Extend oRPC global context for type safety
declare module '@orpc/nest' {
  interface ORPCGlobalContext {
    request: Request;
  }
}

import { AuthModule, AuthGuard } from './core/auth/index.js';
import { LicenseModule } from './core/license/license.module.js';
// Core modules
import { CheckpointerModule } from './core/checkpointer/checkpointer.module.js';
import { PrismaModule } from './core/prisma/prisma.module.js';
import { SettingsModule } from './core/settings/settings.module.js';
import { SetupModule } from './core/setup/setup.module.js';
import { UsersModule } from './core/users/users.module.js';

// Infrastructure modules
import { HealthModule } from './infrastructure/health/health.module.js';
import { InternalModule } from './infrastructure/internal/internal.module.js';
import { QueueModule } from './infrastructure/queue/queue.module.js';
import { AlertMappingModule } from './modules/alert-mapping/alert-mapping.module.js';
// Feature modules
import { AlertsModule } from './modules/alerts/alerts.module.js';
import { CorrelationModule } from './modules/correlation/correlation.module.js';
import { EventsModule } from './modules/events/events.module.js';
import { IncidentsModule } from './modules/incidents/incidents.module.js';
import { IntegrationsModule } from './modules/integrations/integrations.module.js';
import { InvestigationsModule } from './modules/investigations/investigations.module.js';
import { OpenAPIModule } from './modules/openapi/openapi.module.js';
import { RecommendationsModule } from './modules/recommendations/recommendations.module.js';
import { DeploymentsModule } from './modules/deployments/deployments.module.js';
import { RepositoriesModule } from './modules/repositories/repositories.module.js';
import { ServiceDiscoveryModule } from './modules/service-discovery/service-discovery.module.js';
import { ServicesModule } from './modules/services/services.module.js';
import { TimelineModule } from './modules/timeline/timeline.module.js';
import { PostmortemsModule } from './modules/postmortems/postmortems.module.js';
import { WebhooksModule } from './modules/webhooks/webhooks.module.js';

// Create a logger instance for oRPC error handling
const orpcLogger = new Logger({ context: 'oRPC' });

@Module({
  imports: [
    // Configuration
    ConfigModule.forRoot({
      ignoreEnvFile: true,
      load: [getConfig],
    }),

    // Logger Module - wide events logging with tail sampling
    LoggerModule.forRoot({
      service: {
        name: 'prismalens-api',
        version: '0.1.0',
        environment: process.env.NODE_ENV ?? 'development',
      },
    }),

    // oRPC Module - provides end-to-end type safety
    ORPCModule.forRootAsync({
      useFactory: (request: Request) => ({
        interceptors: [
          onError((error) => {
            // Log oRPC errors for debugging
            orpcLogger.error(`oRPC Error: ${error.message}`, error);
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

    // Rate limiting
    ThrottlerModule.forRoot({
      throttlers: [
        {
          name: 'short',
          ttl: 1000,
          limit: 10,
        },
        {
          name: 'medium',
          ttl: 60000,
          limit: 60,
        },
      ],
    }),

    // Core
    PrismaModule,
    CheckpointerModule,
    AuthModule, // Better Auth for authentication
    UsersModule,
    SetupModule, // Initial setup (oRPC)
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
    RepositoriesModule, // Repository management
    DeploymentsModule, // Deployment management
    AlertsModule, // Alert processing
    AlertMappingModule, // Alert mapping rules
    CorrelationModule, // Alert → Incident correlation
    IncidentsModule, // Incident management (primary entity)
    InvestigationsModule, // AI investigation (replaces AnalysisModule)
    TimelineModule, // Incident timeline
    PostmortemsModule, // Postmortem management
    WebhooksModule, // Webhook ingestion
    RecommendationsModule,
    IntegrationsModule, // External tool integrations (GitHub, Prometheus, Slack)
    ServiceDiscoveryModule, // Service discovery from integrations
    OpenAPIModule, // OpenAPI spec and documentation
  ],
  controllers: [AppController],
  providers: [{ provide: APP_GUARD, useClass: AuthGuard }],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // Apply permissive CORS middleware only to webhook routes
    // This allows browser-based testing tools while keeping main API restricted
    if (getConfig().PRISMALENS_CORS_WEBHOOK_OPEN) {
      consumer.apply(WebhookCorsMiddleware).forRoutes('webhooks/*path');
    }
  }
}
