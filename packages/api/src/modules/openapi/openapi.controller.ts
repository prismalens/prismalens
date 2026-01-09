import { Controller, Get, Header, Res } from '@nestjs/common'
import type { Response } from 'express'
import { OpenAPIGenerator } from '@orpc/openapi'
import { ZodToJsonSchemaConverter } from '@orpc/zod'
import { contract } from '@prismalens/contracts'
import { EnvironmentVariables } from '@prismalens/config'
import { ConfigService } from '@nestjs/config/dist/index.js'

@Controller()
export class OpenAPIController {
  private cachedSpec: object | null = null

  constructor(private configService: ConfigService<EnvironmentVariables>) { }

  @Get('openapi.json')
  @Header('Content-Type', 'application/json')
  async getOpenAPISpec() {
    if (this.cachedSpec) {
      return this.cachedSpec
    }

    const generator = new OpenAPIGenerator({
      schemaConverters: [new ZodToJsonSchemaConverter()],
    })

    const spec = await generator.generate(contract, {
      info: {
        title: 'PrismaLens API',
        version: '1.0.0',
        description:
          'PrismaLens Community Edition API - Incident management and root cause analysis platform',
        contact: {
          name: 'PrismaLens Team',
          url: 'https://github.com/prismalens-org/prismalens',
        },
        license: {
          name: 'ELv2',
          url: 'https://www.elastic.co/licensing/elastic-license',
        },
      },
      servers: [
        {
          url: `${this.configService.get('PRISMALENS_PROTOCOL')}://${this.configService.get('PRISMALENS_HOST')}:${this.configService.get('PRISMALENS_PORT')}/api`,
          description: 'Current server',
        },
        {
          url: '/api',
          description: 'Relative path',
        },
      ],
      tags: [
        { name: 'alerts', description: 'Alert management' },
        { name: 'incidents', description: 'Incident management' },
        { name: 'investigations', description: 'AI-powered investigations' },
        { name: 'recommendations', description: 'Recommendations management' },
        { name: 'services', description: 'Service catalog management' },
        { name: 'webhooks', description: 'Webhook ingestion endpoints' },
        { name: 'events', description: 'Event management' },
        { name: 'timeline', description: 'Incident timeline entries' },
        { name: 'correlation', description: 'Alert correlation rules' },
        { name: 'integrations', description: 'External integrations' },
        { name: 'service-discovery', description: 'Service discovery suggestions' },
        { name: 'alert-mapping', description: 'Alert to service mapping rules' },
      ],
    })

    this.cachedSpec = spec
    return spec
  }

  @Get('docs')
  @Header('Content-Type', 'text/html')
  async getScalarDocs(@Res() res: Response) {
    const html = `
<!DOCTYPE html>
<html>
  <head>
    <title>PrismaLens API Reference</title>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>P</text></svg>" />
    <style>
      body { margin: 0; padding: 0; }
    </style>
  </head>
  <body>
    <div id="app"></div>
    <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
    <script>
      Scalar.createApiReference('#app', {
        url: '/api/openapi.json',
        theme: 'purple',
        layout: 'modern',
        defaultHttpClient: {
          targetKey: 'javascript',
          clientKey: 'fetch',
        },
      })
    </script>
  </body>
</html>
    `
    res.send(html)
  }
}
