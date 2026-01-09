import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EnvironmentVariables } from '@prismalens/config';

@Controller()
export class AppController {
  constructor(private readonly configService: ConfigService<EnvironmentVariables>) {}

  @Get()
  root(): {
    name: string;
    version: string;
    edition: string;
    docs: string;
  } {
    return {
      name: 'PrismaLens API',
      version: '0.1.0',
      edition: 'COMMUNITY', //TODO: Dynamically set based on license
      docs: '/api',
    };
  }
}
