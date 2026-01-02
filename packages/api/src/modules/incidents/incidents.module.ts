import { Module, forwardRef } from '@nestjs/common';
import { IncidentsController } from './incidents.controller.js';
import { IncidentsService } from './incidents.service.js';
import { InvestigationsModule } from '../investigations/investigations.module.js';
import { TimelineModule } from '../timeline/timeline.module.js';

@Module({
  imports: [
    forwardRef(() => InvestigationsModule),
    forwardRef(() => TimelineModule),
    // QueueModule is @Global, no need to import - QueueService is available globally
  ],
  controllers: [IncidentsController],
  providers: [IncidentsService],
  exports: [IncidentsService],
})
export class IncidentsModule {}
