import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface HealthResponse {
  status: 'ok' | 'degraded' | 'error';
  timestamp: string;
  version: string;
  edition: string;
  services: {
    api: boolean;
    queue: boolean;
    redis: boolean;
  };
}

@Controller('health')
export class HealthController {
  constructor(private readonly configService: ConfigService) {}

  @Get()
  health(): HealthResponse {
    const edition = this.configService.get('PRISMALENS_EDITION', 'COMMUNITY');

    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: '0.1.0',
      edition,
      services: {
        api: true,
        queue: true, // TODO: Check actual queue connection
        redis: !!this.configService.get('REDIS_URL'),
      },
    };
  }

  @Get('ready')
  ready(): { ready: boolean } {
    return { ready: true };
  }

  @Get('live')
  live(): { live: boolean } {
    return { live: true };
  }
}
