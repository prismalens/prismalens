/**
 * Schema-driven credential form.
 *
 * Renders form fields from a JSON Schema (IntegrationDefinition.credentialSchema).
 * Uses shadcn/ui components consistent with the rest of the frontend.
 */

import { useState } from "react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type {
  CredentialSchema,
} from "@/lib/credential-schema"
import { validateCredentials } from "@/lib/credential-schema"

interface Props {
  schema: CredentialSchema
  values: Record<string, string>
  onChange: (values: Record<string, string>) => void
  /** Show validation errors (call after attempted submit) */
  showErrors?: boolean
}

export function DynamicCredentialForm({
  schema,
  values,
  onChange,
  showErrors = false,
}: Props) {
  const [touched, setTouched] = useState<Set<string>>(new Set())
  const errors = validateCredentials(schema, values)
  const required = new Set(schema.required ?? [])

  const handleChange = (key: string, value: string) => {
    onChange({ ...values, [key]: value })
  }

  const handleBlur = (key: string) => {
    setTouched((prev) => new Set(prev).add(key))
  }

  return (
    <div className="space-y-4">
      {Object.entries(schema.properties ?? {}).map(([key, prop]) => {
        const error = errors[key]
        const shouldShowError = error && (showErrors || touched.has(key))

        return (
          <div key={key} className="space-y-2">
            <Label htmlFor={`cred-${key}`}>
              {prop.title ?? key}
              {required.has(key) && (
                <span className="text-destructive ml-1">*</span>
              )}
            </Label>
            <Input
              id={`cred-${key}`}
              type={prop.format === "password" ? "password" : "text"}
              value={values[key] ?? ""}
              onChange={(e) => handleChange(key, e.target.value)}
              onBlur={() => handleBlur(key)}
              placeholder={prop.placeholder}
              aria-describedby={[
                shouldShowError ? `cred-${key}-error` : "",
                prop.description ? `cred-${key}-desc` : "",
              ].filter(Boolean).join(" ") || undefined}
              aria-invalid={shouldShowError ? true : undefined}
            />
            {shouldShowError && (
              <p id={`cred-${key}-error`} role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            {prop.description && (
              <p id={`cred-${key}-desc`} className="text-xs text-muted-foreground">
                {prop.description}
              </p>
            )}
          </div>
        )
      })}
    </div>
  )
}
