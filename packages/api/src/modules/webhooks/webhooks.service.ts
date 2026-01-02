import { Injectable, Logger, Inject, forwardRef, NotFoundException } from '@nestjs/common';
import { AlertsService } from '../alerts/alerts.service.js';
import { EventsService } from '../events/events.service.js';
import { CorrelationService } from '../correlation/correlation.service.js';
import { AlertMappingService } from '../alert-mapping/alert-mapping.service.js';
import { IntegrationsService } from '../integrations/integrations.service.js';
import { GenericWebhookDto, GithubWebhookDto, RenderWebhookDto } from './dto/index.js';
import type { Alert } from '../alerts/alerts.service.js';
import type { Event } from '../events/events.service.js';
import { Severity } from '../../shared/enums/index.js';

export interface WebhookResult {
  event: Event;
  alert: Alert;
  incidentId?: string;
  incidentNumber?: number;
  correlationReason?: string;
  isNewIncident: boolean;
  mappedServiceId?: string;
}

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    @Inject(forwardRef(() => AlertsService))
    private readonly alertsService: AlertsService,
    private readonly eventsService: EventsService,
    @Inject(forwardRef(() => CorrelationService))
    private readonly correlationService: CorrelationService,
    private readonly alertMappingService: AlertMappingService,
    private readonly integrationsService: IntegrationsService,
  ) {}

  async processGenericWebhook(dto: GenericWebhookDto): Promise<WebhookResult> {
    // 1. Validate that a monitoring integration is configured
    const monitoringConnection = await this.integrationsService.findMonitoringConnection();
    if (!monitoringConnection) {
      throw new NotFoundException(
        'No monitoring integration configured. Please set up a monitoring integration first.'
      );
    }

    // 2. Create immutable event record
    const event = await this.eventsService.create({
      source: dto.source ?? 'webhook',
      sourceEventId: dto.sourceEventId,
      eventType: 'alert',
      payload: dto.rawPayload ?? { title: dto.title, description: dto.description },
      eventTime: dto.eventTime,
    });

    this.logger.log(`Created event ${event.id} from generic webhook`);

    // 3. Resolve service using alert mapping rules
    const mappedService = await this.alertMappingService.resolveServiceForAlert({
      source: dto.source ?? 'generic',
      labels: dto.labels,
      tags: dto.tags,
      title: dto.title,
      description: dto.description,
    });

    // 4. Create alert with resolved serviceId
    const alert = await this.alertsService.create({
      title: dto.title,
      description: dto.description,
      severity: dto.severity ?? Severity.MEDIUM,
      source: dto.source ?? 'webhook',
      sourceUrl: dto.sourceUrl,
      sourceAlertId: dto.sourceEventId,
      tags: dto.tags,
      labels: dto.labels,
      serviceId: mappedService?.id,
      rawPayload: dto.rawPayload,
    });

    // 5. Link event to alert
    await this.eventsService.markProcessed(event.id, alert.id);

    // 6. Correlate alert to incident
    const correlationResult = await this.correlationService.correlateAlert(alert);

    return {
      event,
      alert,
      incidentId: correlationResult.incidentId,
      incidentNumber: correlationResult.incidentNumber,
      correlationReason: correlationResult.reason,
      isNewIncident: correlationResult.isNewIncident,
      mappedServiceId: mappedService?.id,
    };
  }

  async processGithubWebhook(dto: GithubWebhookDto): Promise<WebhookResult> {
    // 1. Create immutable event record
    const event = await this.eventsService.create({
      source: 'github',
      sourceEventId: this.extractGithubEventId(dto),
      eventType: this.determineGithubEventType(dto),
      payload: dto as unknown as Record<string, unknown>,
    });

    this.logger.log(`Created event ${event.id} from GitHub webhook`);

    // 2. Extract alert info from GitHub event
    const alertInfo = this.extractGithubAlertInfo(dto);

    // 3. Create alert
    const alert = await this.alertsService.create({
      title: alertInfo.title,
      description: alertInfo.description,
      severity: alertInfo.severity,
      source: 'github',
      sourceUrl: alertInfo.sourceUrl,
      sourceAlertId: alertInfo.externalId,
      rawPayload: dto as unknown as Record<string, unknown>,
    });

    // 4. Link event to alert
    await this.eventsService.markProcessed(event.id, alert.id);

    // 5. Correlate alert to incident
    const correlationResult = await this.correlationService.correlateAlert(alert);

    return {
      event,
      alert,
      incidentId: correlationResult.incidentId,
      incidentNumber: correlationResult.incidentNumber,
      correlationReason: correlationResult.reason,
      isNewIncident: correlationResult.isNewIncident,
    };
  }

  async processRenderWebhook(dto: RenderWebhookDto): Promise<WebhookResult> {
    // 1. Create immutable event record
    const event = await this.eventsService.create({
      source: 'render',
      sourceEventId: dto.deploy?.id ?? dto.service?.id,
      eventType: 'deployment',
      payload: dto as unknown as Record<string, unknown>,
    });

    this.logger.log(`Created event ${event.id} from Render webhook`);

    // 2. Extract alert info from Render event
    const alertInfo = this.extractRenderAlertInfo(dto);

    // 3. Create alert
    const alert = await this.alertsService.create({
      title: alertInfo.title,
      description: alertInfo.description,
      severity: alertInfo.severity,
      source: 'render',
      sourceAlertId: alertInfo.externalId,
      rawPayload: dto as unknown as Record<string, unknown>,
    });

    // 4. Link event to alert
    await this.eventsService.markProcessed(event.id, alert.id);

    // 5. Correlate alert to incident
    const correlationResult = await this.correlationService.correlateAlert(alert);

    return {
      event,
      alert,
      incidentId: correlationResult.incidentId,
      incidentNumber: correlationResult.incidentNumber,
      correlationReason: correlationResult.reason,
      isNewIncident: correlationResult.isNewIncident,
    };
  }

  private extractGithubEventId(dto: GithubWebhookDto): string | undefined {
    if (dto.alert) return `github-alert-${dto.alert.number}`;
    if (dto.issue) return `github-issue-${dto.repository?.full_name}-${dto.issue.number}`;
    if (dto.pull_request) return `github-pr-${dto.repository?.full_name}-${dto.pull_request.number}`;
    return undefined;
  }

  private determineGithubEventType(dto: GithubWebhookDto): string {
    if (dto.alert) return 'security_alert';
    if (dto.issue) return 'issue';
    if (dto.pull_request) return 'pull_request';
    return 'unknown';
  }

  private extractGithubAlertInfo(dto: GithubWebhookDto): {
    title: string;
    description?: string;
    severity: Severity;
    sourceUrl?: string;
    externalId?: string;
  } {
    if (dto.alert) {
      return {
        title: `GitHub Security Alert: ${dto.alert.summary ?? 'Unknown'}`,
        description: `Security alert in ${dto.repository?.full_name ?? 'unknown repo'}`,
        severity: this.mapGithubSeverity(dto.alert.severity),
        sourceUrl: dto.alert.html_url,
        externalId: `github-alert-${dto.alert.number}`,
      };
    }

    if (dto.issue) {
      return {
        title: `GitHub Issue: ${dto.issue.title}`,
        description: dto.issue.body,
        severity: this.inferSeverityFromLabels(dto.issue.labels),
        sourceUrl: dto.issue.html_url,
        externalId: `github-issue-${dto.repository?.full_name}-${dto.issue.number}`,
      };
    }

    if (dto.pull_request) {
      return {
        title: `GitHub PR: ${dto.pull_request.title}`,
        description: dto.pull_request.body,
        severity: Severity.INFO,
        sourceUrl: dto.pull_request.html_url,
        externalId: `github-pr-${dto.repository?.full_name}-${dto.pull_request.number}`,
      };
    }

    return {
      title: `GitHub Event: ${dto.action ?? 'unknown'}`,
      description: `Event from ${dto.repository?.full_name ?? 'unknown repo'}`,
      severity: Severity.INFO,
    };
  }

  private extractRenderAlertInfo(dto: RenderWebhookDto): {
    title: string;
    description: string;
    severity: Severity;
    externalId: string;
  } {
    const serviceName = dto.service?.name ?? 'unknown';
    const deployStatus = dto.deploy?.status ?? dto.type ?? 'unknown';

    let title: string;
    let severity: Severity = Severity.INFO;

    if (deployStatus === 'deploy_failed' || deployStatus === 'failed') {
      title = `Render Deploy Failed: ${serviceName}`;
      severity = Severity.HIGH;
    } else if (deployStatus === 'deactivated') {
      title = `Render Service Deactivated: ${serviceName}`;
      severity = Severity.HIGH;
    } else if (deployStatus === 'suspended') {
      title = `Render Service Suspended: ${serviceName}`;
      severity = Severity.CRITICAL;
    } else {
      title = `Render Event: ${serviceName} - ${deployStatus}`;
      severity = Severity.LOW;
    }

    return {
      title,
      description: `Service: ${serviceName}, Status: ${deployStatus}`,
      severity,
      externalId: dto.deploy?.id
        ? `render-deploy-${dto.deploy.id}`
        : `render-${dto.service?.id ?? 'unknown'}`,
    };
  }

  private mapGithubSeverity(severity: string | undefined): Severity {
    switch (severity?.toLowerCase()) {
      case 'critical':
        return Severity.CRITICAL;
      case 'high':
        return Severity.HIGH;
      case 'medium':
      case 'moderate':
        return Severity.MEDIUM;
      case 'low':
        return Severity.LOW;
      default:
        return Severity.MEDIUM;
    }
  }

  private inferSeverityFromLabels(labels?: Array<{ name: string }>): Severity {
    if (!labels) return Severity.MEDIUM;

    const labelNames = labels.map((l) => l.name.toLowerCase());

    if (labelNames.some((l) => l.includes('critical') || l.includes('urgent'))) {
      return Severity.CRITICAL;
    }
    if (labelNames.some((l) => l.includes('high') || l.includes('important'))) {
      return Severity.HIGH;
    }
    if (labelNames.some((l) => l.includes('low') || l.includes('minor'))) {
      return Severity.LOW;
    }
    return Severity.MEDIUM;
  }
}
