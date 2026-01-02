import { Module } from '@nestjs/common';
import { AlertMappingService } from './alert-mapping.service.js';
import { AlertMappingController } from './alert-mapping.controller.js';
import { PrismaModule } from '../../core/prisma/prisma.module.js';

@Module({
  imports: [PrismaModule],
  providers: [AlertMappingService],
  controllers: [AlertMappingController],
  exports: [AlertMappingService],
})
export class AlertMappingModule {}
