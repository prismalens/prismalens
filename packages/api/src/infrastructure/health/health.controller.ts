import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { EnvironmentVariables } from '@prismalens/config';

interface HealthResponse {
  status: 'ok' | 'degraded' | 'error';
  timestamp: string;
  version: string;
  edition: string;
  services: {
    api: boolean;
    queue: boolean;
  };
}

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly configService: ConfigService<EnvironmentVariables>) {}

  @Get()
  health(): HealthResponse {

    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: '0.1.0',
      edition: 'community', // TODO: Dynamically set based on license
      services: {
        api: true,
        queue: true, // TODO: Check actual queue connection
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
