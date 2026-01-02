import { Module } from '@nestjs/common';
import { ServiceDiscoveryService } from './service-discovery.service.js';
import { ServiceDiscoveryController } from './service-discovery.controller.js';
import { PrismaModule } from '../../core/prisma/prisma.module.js';

@Module({
  imports: [PrismaModule],
  providers: [ServiceDiscoveryService],
  controllers: [ServiceDiscoveryController],
  exports: [ServiceDiscoveryService],
})
export class ServiceDiscoveryModule {}
