import { Injectable, Logger } from '@nestjs/common';
import { AlertsService } from '../alerts/alerts.service.js';
import { AnalysisService } from '../analysis/analysis.service.js';
import { QueueService } from '../queue/queue.service.js';
import { GenericWebhookDto, GithubWebhookDto, RenderWebhookDto } from './dto/index.js';
import type { Alert } from '../alerts/alerts.service.js';

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    private readonly alertsService: AlertsService,
    private readonly analysisService: AnalysisService,
    private readonly queueService: QueueService,
  ) {}

  async processGenericWebhook(dto: GenericWebhookDto): Promise<{
    alert: Alert;
    analysisQueued: boolean;
    analysisRunId?: string;
  }> {
    // Create alert
    const alert = await this.alertsService.create({
      title: dto.title,
      description: dto.description,
      severity: dto.severity ?? 'medium',
      source: dto.source ?? 'webhook',
      sourceUrl: dto.sourceUrl,
      externalId: dto.externalId,
      rawPayload: dto.rawPayload,
    });

    this.logger.log(`Created alert from generic webhook: ${alert.id}`);

    // Auto-analyze if requested
    let analysisQueued = false;
    let analysisRunId: string | undefined;

    if (dto.autoAnalyze) {
      const result = await this.queueAnalysis(alert);
      analysisQueued = result.queued;
      analysisRunId = result.analysisRunId;
    }

    return { alert, analysisQueued, analysisRunId };
  }

  async processGithubWebhook(dto: GithubWebhookDto): Promise<{
    alert: Alert;
    analysisQueued: boolean;
    analysisRunId?: string;
  }> {
    // Determine the type of GitHub event
    let title: string;
    let description: string | undefined;
    let severity: 'low' | 'medium' | 'high' | 'critical' = 'medium';
    let sourceUrl: string | undefined;
    let externalId: string | undefined;

    if (dto.alert) {
      // Security alert
      title = `GitHub Security Alert: ${dto.alert.summary ?? 'Unknown'}`;
      description = `Security alert in ${dto.repository?.full_name ?? 'unknown repo'}`;
      severity = this.mapGithubSeverity(dto.alert.severity);
      sourceUrl = dto.alert.html_url;
      externalId = `github-alert-${dto.alert.number}`;
    } else if (dto.issue) {
      // Issue event
      title = `GitHub Issue: ${dto.issue.title}`;
      description = dto.issue.body;
      severity = this.inferSeverityFromLabels(dto.issue.labels);
      sourceUrl = dto.issue.html_url;
      externalId = `github-issue-${dto.repository?.full_name}-${dto.issue.number}`;
    } else if (dto.pull_request) {
      // PR event
      title = `GitHub PR: ${dto.pull_request.title}`;
      description = dto.pull_request.body;
      sourceUrl = dto.pull_request.html_url;
      externalId = `github-pr-${dto.repository?.full_name}-${dto.pull_request.number}`;
    } else {
      title = `GitHub Event: ${dto.action ?? 'unknown'}`;
      description = `Event from ${dto.repository?.full_name ?? 'unknown repo'}`;
    }

    const alert = await this.alertsService.create({
      title,
      description,
      severity,
      source: 'github',
      sourceUrl,
      externalId,
      rawPayload: dto as unknown as Record<string, unknown>,
    });

    this.logger.log(`Created alert from GitHub webhook: ${alert.id}`);

    // Auto-analyze security alerts
    const shouldAutoAnalyze = !!dto.alert;
    let analysisQueued = false;
    let analysisRunId: string | undefined;

    if (shouldAutoAnalyze) {
      const result = await this.queueAnalysis(alert);
      analysisQueued = result.queued;
      analysisRunId = result.analysisRunId;
    }

    return { alert, analysisQueued, analysisRunId };
  }

  async processRenderWebhook(dto: RenderWebhookDto): Promise<{
    alert: Alert;
    analysisQueued: boolean;
    analysisRunId?: string;
  }> {
    const serviceName = dto.service?.name ?? 'unknown';
    const deployStatus = dto.deploy?.status ?? dto.type ?? 'unknown';

    let title: string;
    let severity: 'low' | 'medium' | 'high' | 'critical' = 'medium';
    let shouldAutoAnalyze = false;

    // Determine severity and title based on deploy status
    if (deployStatus === 'deploy_failed' || deployStatus === 'failed') {
      title = `Render Deploy Failed: ${serviceName}`;
      severity = 'high';
      shouldAutoAnalyze = true;
    } else if (deployStatus === 'deactivated') {
      title = `Render Service Deactivated: ${serviceName}`;
      severity = 'high';
      shouldAutoAnalyze = true;
    } else if (deployStatus === 'suspended') {
      title = `Render Service Suspended: ${serviceName}`;
      severity = 'critical';
      shouldAutoAnalyze = true;
    } else {
      title = `Render Event: ${serviceName} - ${deployStatus}`;
      severity = 'low';
    }

    const alert = await this.alertsService.create({
      title,
      description: `Service: ${serviceName}, Status: ${deployStatus}`,
      severity,
      source: 'render',
      externalId: dto.deploy?.id
        ? `render-deploy-${dto.deploy.id}`
        : `render-${dto.service?.id ?? 'unknown'}`,
      rawPayload: dto as unknown as Record<string, unknown>,
    });

    this.logger.log(`Created alert from Render webhook: ${alert.id}`);

    let analysisQueued = false;
    let analysisRunId: string | undefined;

    if (shouldAutoAnalyze) {
      const result = await this.queueAnalysis(alert);
      analysisQueued = result.queued;
      analysisRunId = result.analysisRunId;
    }

    return { alert, analysisQueued, analysisRunId };
  }

  private async queueAnalysis(alert: Alert): Promise<{
    queued: boolean;
    analysisRunId?: string;
  }> {
    try {
      // Update alert status
      await this.alertsService.updateStatus(alert.id, 'analyzing');

      // Create analysis run
      const analysisRun = await this.analysisService.createRun(alert.id);

      // Queue the job
      const jobId = await this.queueService.addAnalysisJob({
        alertId: alert.id,
        analysisRunId: analysisRun.id,
        priority: this.mapSeverityToPriority(alert.severity),
        context: {
          source: alert.source,
          title: alert.title,
        },
      });

      return {
        queued: jobId !== null,
        analysisRunId: analysisRun.id,
      };
    } catch (error) {
      this.logger.error(`Failed to queue analysis for alert ${alert.id}`, error);
      return { queued: false };
    }
  }

  private mapGithubSeverity(
    severity: string | undefined,
  ): 'low' | 'medium' | 'high' | 'critical' {
    switch (severity?.toLowerCase()) {
      case 'critical':
        return 'critical';
      case 'high':
        return 'high';
      case 'medium':
      case 'moderate':
        return 'medium';
      case 'low':
        return 'low';
      default:
        return 'medium';
    }
  }

  private inferSeverityFromLabels(
    labels?: Array<{ name: string }>,
  ): 'low' | 'medium' | 'high' | 'critical' {
    if (!labels) return 'medium';

    const labelNames = labels.map((l) => l.name.toLowerCase());

    if (labelNames.some((l) => l.includes('critical') || l.includes('urgent'))) {
      return 'critical';
    }
    if (labelNames.some((l) => l.includes('high') || l.includes('important'))) {
      return 'high';
    }
    if (labelNames.some((l) => l.includes('low') || l.includes('minor'))) {
      return 'low';
    }
    return 'medium';
  }

  private mapSeverityToPriority(
    severity: string,
  ): 'low' | 'normal' | 'high' | 'critical' {
    switch (severity) {
      case 'critical':
        return 'critical';
      case 'high':
        return 'high';
      case 'medium':
        return 'normal';
      case 'low':
        return 'low';
      default:
        return 'normal';
    }
  }
}
