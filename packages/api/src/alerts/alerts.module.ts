import { Module, forwardRef } from '@nestjs/common';
import { AlertsController } from './alerts.controller.js';
import { AlertsService } from './alerts.service.js';
import { AnalysisModule } from '../analysis/analysis.module.js';

@Module({
  imports: [forwardRef(() => AnalysisModule)],
  controllers: [AlertsController],
  providers: [AlertsService],
  exports: [AlertsService],
})
export class AlertsModule {}
