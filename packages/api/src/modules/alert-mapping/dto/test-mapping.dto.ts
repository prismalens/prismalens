/**
 * DTO for testing which service an alert would map to.
 */
export class TestMappingDto {
  source?: string;
  labels?: Record<string, string>;
  tags?: string[];
  title: string;
  description?: string;
}
