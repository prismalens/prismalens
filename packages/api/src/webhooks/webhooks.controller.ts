import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  Headers,
  Logger,
} from '@nestjs/common';
import { WebhooksService } from './webhooks.service.js';
import { GenericWebhookDto, GithubWebhookDto, RenderWebhookDto } from './dto/index.js';

@Controller('webhooks')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(private readonly webhooksService: WebhooksService) {}

  @Post('generic')
  @HttpCode(HttpStatus.CREATED)
  async handleGenericWebhook(@Body() dto: GenericWebhookDto): Promise<{
    success: boolean;
    alertId: string;
    analysisRunId?: string;
    analysisQueued: boolean;
  }> {
    this.logger.log('Received generic webhook');

    const result = await this.webhooksService.processGenericWebhook(dto);

    return {
      success: true,
      alertId: result.alert.id,
      analysisRunId: result.analysisRunId,
      analysisQueued: result.analysisQueued,
    };
  }

  @Post('github')
  @HttpCode(HttpStatus.CREATED)
  async handleGithubWebhook(
    @Headers('x-github-event') eventType: string,
    @Headers('x-github-delivery') deliveryId: string,
    @Body() dto: GithubWebhookDto,
  ): Promise<{
    success: boolean;
    alertId: string;
    analysisRunId?: string;
    analysisQueued: boolean;
  }> {
    this.logger.log(`Received GitHub webhook: ${eventType} (${deliveryId})`);

    const result = await this.webhooksService.processGithubWebhook(dto);

    return {
      success: true,
      alertId: result.alert.id,
      analysisRunId: result.analysisRunId,
      analysisQueued: result.analysisQueued,
    };
  }

  @Post('render')
  @HttpCode(HttpStatus.CREATED)
  async handleRenderWebhook(@Body() dto: RenderWebhookDto): Promise<{
    success: boolean;
    alertId: string;
    analysisRunId?: string;
    analysisQueued: boolean;
  }> {
    this.logger.log(`Received Render webhook: ${dto.type}`);

    const result = await this.webhooksService.processRenderWebhook(dto);

    return {
      success: true,
      alertId: result.alert.id,
      analysisRunId: result.analysisRunId,
      analysisQueued: result.analysisQueued,
    };
  }
}
