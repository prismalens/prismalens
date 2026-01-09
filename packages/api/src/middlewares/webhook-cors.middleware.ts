/**
 * Webhook CORS Middleware
 *
 * Permissive CORS for webhook endpoints only.
 * Webhooks are typically server-to-server (Prometheus, GitHub, etc.) so CORS doesn't apply,
 * but this allows browser-based testing tools (Postman web, custom dashboards) to POST.
 *
 * Security: NO credentials (cookies) are allowed - webhooks use API keys/signatures.
 */

import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

@Injectable()
export class WebhookCorsMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    // Only set CORS headers if Origin header is present (browser requests)
    if (req.headers.origin) {
      // Mirror the requesting origin (permissive for webhooks)
      res.header('Access-Control-Allow-Origin', req.headers.origin);

      // Webhooks only accept POST
      res.header('Access-Control-Allow-Methods', 'POST, OPTIONS');

      // Allow common webhook headers
      res.header(
        'Access-Control-Allow-Headers',
        'Content-Type, X-GitHub-Event, X-GitHub-Delivery, X-Hub-Signature-256',
      );

      // CRITICAL: No credentials for webhooks - they use API keys, not cookies
      // This prevents CSRF attacks even with permissive origin policy
      res.header('Access-Control-Allow-Credentials', 'false');

      // Cache preflight for 5 minutes
      res.header('Access-Control-Max-Age', '300');
    }

    // Handle preflight requests
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }

    next();
  }
}
