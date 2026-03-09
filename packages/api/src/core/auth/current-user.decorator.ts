/**
 * CurrentUser Decorator
 *
 * Extract the authenticated user from the request.
 * Use with @CurrentUser() in controller methods after AuthGuard.
 */

import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

export const CurrentUser = createParamDecorator(
  (data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<Request>();
    return request.user;
  },
);

export const CurrentSession = createParamDecorator(
  (data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<Request>();
    return request.session;
  },
);
