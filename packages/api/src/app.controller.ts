import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Controller()
export class AppController {
  constructor(private readonly configService: ConfigService) {}

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
      edition: this.configService.get('PRISMALENS_EDITION', 'COMMUNITY'),
      docs: '/api',
    };
  }
}
