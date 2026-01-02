import { Module, forwardRef } from '@nestjs/common';
import { InvestigationsController } from './investigations.controller.js';
import { InvestigationsService } from './investigations.service.js';
import { TimelineModule } from '../timeline/timeline.module.js';
import { InternalGuard } from '../../infrastructure/internal/guards/internal.guard.js';

@Module({
  imports: [forwardRef(() => TimelineModule)],
  controllers: [InvestigationsController],
  providers: [InvestigationsService, InternalGuard],
  exports: [InvestigationsService],
})
export class InvestigationsModule {}
