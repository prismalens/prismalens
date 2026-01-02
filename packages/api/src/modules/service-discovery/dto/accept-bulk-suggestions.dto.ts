/**
 * DTO for bulk accepting service suggestions.
 */
export class AcceptBulkSuggestionsDto {
  // Array of suggestion IDs to accept
  suggestionIds: string[];

  // Optional overrides applied to all accepted suggestions
  overrides?: {
    type?: string;
    team?: string;
  };
}
