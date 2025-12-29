import { Module, Global } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { QueueService } from './queue.service.js';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [QueueService],
  exports: [QueueService],
})
export class QueueModule {}
