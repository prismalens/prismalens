import { Module } from '@nestjs/common'
import { OpenAPIController } from './openapi.controller.js'
import { ConfigModule } from '@nestjs/config'

@Module({
  imports: [ConfigModule],
  controllers: [OpenAPIController],
})
export class OpenAPIModule {}
