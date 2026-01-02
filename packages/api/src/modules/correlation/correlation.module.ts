import { Module, forwardRef } from '@nestjs/common';
import { CorrelationController } from './correlation.controller.js';
import { CorrelationService } from './correlation.service.js';
import { IncidentsModule } from '../incidents/incidents.module.js';

@Module({
  imports: [forwardRef(() => IncidentsModule)],
  controllers: [CorrelationController],
  providers: [CorrelationService],
  exports: [CorrelationService],
})
export class CorrelationModule {}
