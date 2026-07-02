/**
 * Credential schema types and validation.
 *
 * Uses TemplateField[] from @prismalens/integrations templates.
 */

import type { TemplateField } from "@prismalens/contracts/schemas";

// =============================================================================
// TEMPLATE FIELD VALIDATION
// =============================================================================

/**
 * Validate credential values against TemplateField[].
 * Returns a map of field name → error message, or empty object if valid.
 */
export function validateFieldValues(
	fields: TemplateField[],
	values: Record<string, string>,
): Record<string, string> {
	const errors: Record<string, string> = {};

	for (const field of fields) {
		const value = values[field.name]?.trim();
		if (field.required === true && !value) {
			errors[field.name] = `${field.label} is required`;
		} else if (value && field.pattern) {
			const regex = new RegExp(field.pattern);
			if (!regex.test(value)) {
				errors[field.name] =
					field.description ?? `${field.label} has an invalid format`;
			}
		}
	}

	return errors;
}
