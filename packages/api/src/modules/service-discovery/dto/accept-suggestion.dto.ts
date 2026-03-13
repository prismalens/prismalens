/**
 * DTO for accepting a service suggestion and creating a Service.
 */
export class AcceptSuggestionDto {
  // Optional overrides for the suggested values
  name?: string; // Service name (defaults to suggestedName)
  displayName?: string; // Display name
  description?: string; // Description
  type?: string; // Service type (defaults to "service")
  team?: string; // Team responsible
  linkedServiceId?: string; // Link deployment to existing service instead of creating new
}
