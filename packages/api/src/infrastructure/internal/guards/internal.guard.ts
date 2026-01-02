import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class InternalGuard implements CanActivate {
  constructor(private configService: ConfigService) { }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const internalSecret = request.headers['x-internal-secret'];
    const configuredSecret = this.configService.get<string>('PRISMALENS_INTERNAL_SECRET');

    if (!internalSecret || internalSecret !== configuredSecret) {
      throw new UnauthorizedException('Invalid internal secret');
    }

    return true;
  }
}
