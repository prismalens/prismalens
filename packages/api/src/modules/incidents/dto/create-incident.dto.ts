/**
 * DTO for creating an incident
 */
export class CreateIncidentDto {
  /** Incident title */
  title!: string;

  /** Detailed description */
  description?: string;

  /** Severity: critical, high, medium, low, info */
  severity?: 'critical' | 'high' | 'medium' | 'low' | 'info';

  /** Priority: p1, p2, p3, p4, p5 */
  priority?: 'p1' | 'p2' | 'p3' | 'p4' | 'p5';

  /** Primary affected service ID */
  serviceId?: string;

  /** Why alerts were grouped together */
  correlationReason?: string;

  /** Tags for categorization */
  tags?: string[];

  /** Description of customer impact */
  customerImpact?: string;
}
