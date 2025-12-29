import { Module } from '@nestjs/common';
import { AnalysisController } from './analysis.controller.js';
import { AnalysisService } from './analysis.service.js';

@Module({
  controllers: [AnalysisController],
  providers: [AnalysisService],
  exports: [AnalysisService],
})
export class AnalysisModule {}
