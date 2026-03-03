/**
 * Shared TOON (Token-Oriented Object Notation) formatter for LLM output.
 *
 * ~40% fewer tokens than JSON for tabular data. Used by OpenApiToolkit
 * and available for other tools (http_request, web_browse) where
 * output is structured/tabular.
 */

import { encode } from "@toon-format/toon"

/**
 * Format structured data as TOON for LLM consumption.
 */
export function formatForLlm(data: unknown): string {
  return encode(data)
}
