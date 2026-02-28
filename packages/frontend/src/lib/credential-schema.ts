/**
 * Credential schema types and validation.
 *
 * Parses JSON Schema from IntegrationDefinition.credentialSchema
 * into typed form field descriptors for DynamicCredentialForm.
 */

export interface CredentialSchemaProperty {
  type: string
  title?: string
  format?: string
  placeholder?: string
  description?: string
}

export interface CredentialSchema {
  type: "object"
  required?: string[]
  properties?: Record<string, CredentialSchemaProperty>
}

/**
 * Parse a credentialSchema string from the API into a typed object.
 * Returns null if the schema is missing or invalid.
 */
export function parseCredentialSchema(
  raw: string | null | undefined,
): CredentialSchema | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as CredentialSchema
    if (parsed.type !== "object" || !parsed.properties) return null
    return parsed
  } catch {
    return null
  }
}

/**
 * Validate credential values against a schema.
 * Returns a map of field name → error message, or empty object if valid.
 */
export function validateCredentials(
  schema: CredentialSchema,
  values: Record<string, string>,
): Record<string, string> {
  const errors: Record<string, string> = {}
  const required = new Set(schema.required ?? [])

  for (const key of Object.keys(schema.properties ?? {})) {
    if (required.has(key) && !values[key]?.trim()) {
      const title = schema.properties?.[key]?.title ?? key
      errors[key] = `${title} is required`
    }
  }

  return errors
}
