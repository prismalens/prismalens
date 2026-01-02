import { Module } from '@nestjs/common';
import { TimelineController } from './timeline.controller.js';
import { TimelineService } from './timeline.service.js';

@Module({
  controllers: [TimelineController],
  providers: [TimelineService],
  exports: [TimelineService],
})
export class TimelineModule {}
