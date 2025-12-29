export class CreateAlertDto {
  source?: string;
  externalId?: string;
  severity?: 'low' | 'medium' | 'high' | 'critical';
  title!: string;
  description?: string;
  sourceUrl?: string;
  rawPayload?: Record<string, unknown>;
}
