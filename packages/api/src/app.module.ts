import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { AppController } from './app.controller.js';

// Core modules
import { PrismaModule } from './core/prisma/prisma.module.js';
import { AuthModule } from './core/auth/auth.module.js';
import { UsersModule } from './core/users/users.module.js';
import { SettingsModule } from './core/settings/settings.module.js';

// Infrastructure modules
import { HealthModule } from './infrastructure/health/health.module.js';
import { QueueModule } from './infrastructure/queue/queue.module.js';
import { InternalModule } from './infrastructure/internal/internal.module.js';

// Feature modules
import { AlertsModule } from './modules/alerts/alerts.module.js';
import { EventsModule } from './modules/events/events.module.js';
import { ServicesModule } from './modules/services/services.module.js';
import { IncidentsModule } from './modules/incidents/incidents.module.js';
import { InvestigationsModule } from './modules/investigations/investigations.module.js';
import { TimelineModule } from './modules/timeline/timeline.module.js';
import { CorrelationModule } from './modules/correlation/correlation.module.js';
import { WebhooksModule } from './modules/webhooks/webhooks.module.js';
import { RecommendationsModule } from './modules/recommendations/recommendations.module.js';
import { IntegrationsModule } from './modules/integrations/integrations.module.js';
import { AlertMappingModule } from './modules/alert-mapping/alert-mapping.module.js';
import { ServiceDiscoveryModule } from './modules/service-discovery/service-discovery.module.js';

import configuration from '../config/configuration.js';

@Module({
  imports: [
    // Configuration
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      ignoreEnvFile: true
    }),

    // Core
    PrismaModule,
    AuthModule,
    UsersModule,
    SettingsModule,

    // Infrastructure
    HealthModule,
    QueueModule.forRoot(),
    InternalModule,

    // Serve Next.js frontend in production
    ServeStaticModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const isProduction = configService.get('NODE_ENV') === 'production';
        const frontendPath = configService.get(
          'FRONTEND_PATH',
          join(__dirname, '..', '..', 'frontend', 'out'),
        );

        if (!isProduction) {
          // In development, don't serve static files (frontend runs separately)
          return [];
        }

        return [
          {
            rootPath: frontendPath,
            exclude: ['/api/*', '/health'],
          },
        ];
      },
    }),

    // Feature modules (incident-centric architecture)
    EventsModule,        // Raw event ingestion
    ServicesModule,      // Service catalog
    AlertsModule,        // Alert processing
    AlertMappingModule,  // Alert mapping rules
    CorrelationModule,   // Alert → Incident correlation
    IncidentsModule,     // Incident management (primary entity)
    InvestigationsModule,// AI investigation (replaces AnalysisModule)
    TimelineModule,      // Incident timeline
    WebhooksModule,      // Webhook ingestion
    RecommendationsModule,
    IntegrationsModule,  // External tool integrations (GitHub, Prometheus, Slack)
    ServiceDiscoveryModule, // Service discovery from integrations
  ],
  controllers: [AppController],
})
export class AppModule { }
