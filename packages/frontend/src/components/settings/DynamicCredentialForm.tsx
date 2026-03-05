/**
 * Template-field-driven credential form.
 *
 * Renders form fields from TemplateField[] (from @prismalens/integrations templates).
 * Uses shadcn/ui components consistent with the rest of the frontend.
 */

import { useState } from "react";
import type { TemplateField } from "@prismalens/contracts/schemas";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { validateFieldValues } from "@/lib/credential-schema";

interface Props {
	fields: TemplateField[];
	values: Record<string, string>;
	onChange: (values: Record<string, string>) => void;
	/** Show validation errors (call after attempted submit) */
	showErrors?: boolean;
}

export function DynamicCredentialForm({
	fields,
	values,
	onChange,
	showErrors = false,
}: Props) {
	const [touched, setTouched] = useState<Set<string>>(new Set());
	const errors = validateFieldValues(fields, values);

	const handleChange = (key: string, value: string) => {
		onChange({ ...values, [key]: value });
	};

	const handleBlur = (key: string) => {
		setTouched((prev) => new Set(prev).add(key));
	};

	return (
		<div className="space-y-4">
			{fields.map((field) => {
				const error = errors[field.name];
				const shouldShowError = error && (showErrors || touched.has(field.name));
				const isRequired = field.required !== false;

				return (
					<div key={field.name} className="space-y-2">
						<Label htmlFor={`cred-${field.name}`}>
							{field.label}
							{isRequired && (
								<span className="text-destructive ml-1">*</span>
							)}
						</Label>
						<Input
							id={`cred-${field.name}`}
							type={field.type === "password" || field.sensitive ? "password" : "text"}
							value={values[field.name] ?? ""}
							onChange={(e) => handleChange(field.name, e.target.value)}
							onBlur={() => handleBlur(field.name)}
							placeholder={field.placeholder ?? field.example}
							aria-describedby={
								[
									shouldShowError ? `cred-${field.name}-error` : "",
									field.description ? `cred-${field.name}-desc` : "",
								]
									.filter(Boolean)
									.join(" ") || undefined
							}
							aria-invalid={shouldShowError ? true : undefined}
						/>
						{shouldShowError && (
							<p
								id={`cred-${field.name}-error`}
								role="alert"
								className="text-sm text-destructive"
							>
								{error}
							</p>
						)}
						{field.description && (
							<p
								id={`cred-${field.name}-desc`}
								className="text-xs text-muted-foreground"
							>
								{field.description}
							</p>
						)}
					</div>
				);
			})}
		</div>
	);
}
