/**
 * DTO for updating an incident
 */
export class UpdateIncidentDto {
  title?: string;
  description?: string;
  severity?: 'critical' | 'high' | 'medium' | 'low' | 'info';
  status?: 'triggered' | 'investigating' | 'identified' | 'monitoring' | 'resolved' | 'closed';
  priority?: 'p1' | 'p2' | 'p3' | 'p4' | 'p5';
  serviceId?: string;
  correlationReason?: string;
  tags?: string[];
  customerImpact?: string;
  assignedToId?: string;
}
