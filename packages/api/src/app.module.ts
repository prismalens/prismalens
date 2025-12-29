import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { AppController } from './app.controller.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { HealthModule } from './health/health.module.js';
import { QueueModule } from './queue/queue.module.js';
import { AlertsModule } from './alerts/alerts.module.js';
import { AnalysisModule } from './analysis/analysis.module.js';
import { WebhooksModule } from './webhooks/webhooks.module.js';
import { RecommendationsModule } from './recommendations/recommendations.module.js';
import configuration from '../config/configuration.js';

@Module({
  imports: [
    // Configuration
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      ignoreEnvFile: true
    }),

    // Database
    PrismaModule,

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

    // Core modules
    HealthModule,
    QueueModule,

    // Feature modules
    AlertsModule,
    AnalysisModule,
    WebhooksModule,
    RecommendationsModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
