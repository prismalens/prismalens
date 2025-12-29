import { Module } from '@nestjs/common';
import { WebhooksController } from './webhooks.controller.js';
import { WebhooksService } from './webhooks.service.js';
import { AlertsModule } from '../alerts/alerts.module.js';
import { AnalysisModule } from '../analysis/analysis.module.js';

@Module({
  imports: [AlertsModule, AnalysisModule],
  controllers: [WebhooksController],
  providers: [WebhooksService],
  exports: [WebhooksService],
})
export class WebhooksModule {}
