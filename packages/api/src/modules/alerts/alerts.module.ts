import { Module, forwardRef } from '@nestjs/common';
import { AlertsController } from './alerts.controller.js';
import { AlertsService } from './alerts.service.js';
import { CorrelationModule } from '../correlation/correlation.module.js';

@Module({
  imports: [
    forwardRef(() => CorrelationModule),
    // QueueModule is @Global, no need to import - QueueService is available globally
  ],
  controllers: [AlertsController],
  providers: [AlertsService],
  exports: [AlertsService],
})
export class AlertsModule {}
