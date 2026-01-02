import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  Headers,
  Logger,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { WebhooksService, WebhookResult } from './webhooks.service.js';
import { GenericWebhookDto, GithubWebhookDto, RenderWebhookDto } from './dto/index.js';

interface WebhookResponse {
  success: boolean;
  eventId: string;
  alertId: string;
  incidentId?: string;
  incidentNumber?: number;
  isNewIncident: boolean;
  correlationReason?: string;
}

@ApiTags('webhooks')
@Controller('webhooks')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(private readonly webhooksService: WebhooksService) {}

  @Post('generic')
  @HttpCode(HttpStatus.CREATED)
  async handleGenericWebhook(@Body() dto: GenericWebhookDto): Promise<WebhookResponse> {
    this.logger.log('Received generic webhook');

    const result = await this.webhooksService.processGenericWebhook(dto);

    return this.formatResponse(result);
  }

  @Post('github')
  @HttpCode(HttpStatus.CREATED)
  async handleGithubWebhook(
    @Headers('x-github-event') eventType: string,
    @Headers('x-github-delivery') deliveryId: string,
    @Body() dto: GithubWebhookDto,
  ): Promise<WebhookResponse> {
    this.logger.log(`Received GitHub webhook: ${eventType} (${deliveryId})`);

    const result = await this.webhooksService.processGithubWebhook(dto);

    return this.formatResponse(result);
  }

  @Post('render')
  @HttpCode(HttpStatus.CREATED)
  async handleRenderWebhook(@Body() dto: RenderWebhookDto): Promise<WebhookResponse> {
    this.logger.log(`Received Render webhook: ${dto.type}`);

    const result = await this.webhooksService.processRenderWebhook(dto);

    return this.formatResponse(result);
  }

  private formatResponse(result: WebhookResult): WebhookResponse {
    return {
      success: true,
      eventId: result.event.id,
      alertId: result.alert.id,
      incidentId: result.incidentId,
      incidentNumber: result.incidentNumber,
      isNewIncident: result.isNewIncident,
      correlationReason: result.correlationReason,
    };
  }
}
