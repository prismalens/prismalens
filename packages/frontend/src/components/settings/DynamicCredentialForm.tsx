/**
 * Template-field-driven credential form.
 *
 * Renders form fields from TemplateField[] (from @prismalens/integrations templates).
 * Uses shadcn/ui components consistent with the rest of the frontend.
 */

import type { TemplateField } from "@prismalens/contracts/schemas";
import { Copy, Upload } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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

	// Filter out hidden fields entirely
	const visibleFields = fields.filter((f) => !f.hidden);

	return (
		<div className="space-y-4">
			{visibleFields.map((field) => {
				const error = errors[field.name];
				const shouldShowError =
					error && (showErrors || touched.has(field.name));
				const isRequired = field.required === true;
				const isReadonly = field.readonly === true;

				const ariaDescribedBy =
					[
						shouldShowError ? `cred-${field.name}-error` : "",
						field.description ? `cred-${field.name}-desc` : "",
					]
						.filter(Boolean)
						.join(" ") || undefined;

				// Readonly fields: show as code block with copy button
				if (isReadonly) {
					const displayValue = values[field.name] ?? field.default ?? "";
					return (
						<div key={field.name} className="space-y-2">
							<Label>{field.label}</Label>
							<div className="flex items-center gap-2">
								<code className="flex-1 text-xs bg-muted p-2 rounded break-all">
									{displayValue}
								</code>
								{displayValue && (
									<Button
										variant="ghost"
										size="sm"
										type="button"
										onClick={() => navigator.clipboard.writeText(displayValue)}
									>
										<Copy className="h-4 w-4" />
									</Button>
								)}
							</div>
							{field.description && (
								<p className="text-xs text-muted-foreground">
									{field.description}
								</p>
							)}
						</div>
					);
				}

				return (
					<div key={field.name} className="space-y-2">
						<Label htmlFor={`cred-${field.name}`}>
							{field.label}
							{isRequired && <span className="text-destructive ml-1">*</span>}
						</Label>
						{field.type === "textarea" ? (
							<>
								<Textarea
									id={`cred-${field.name}`}
									value={values[field.name] ?? ""}
									onChange={(e) => handleChange(field.name, e.target.value)}
									onBlur={() => handleBlur(field.name)}
									placeholder={field.placeholder ?? field.example}
									rows={6}
									className="font-mono text-xs"
									aria-describedby={ariaDescribedBy}
									aria-invalid={shouldShowError ? true : undefined}
								/>
								<label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground cursor-pointer">
									<Upload className="h-3.5 w-3.5" />
									<span>Upload file</span>
									<input
										type="file"
										className="hidden"
										accept=".pem,.key"
										onChange={(e) => {
											const file = e.target.files?.[0];
											if (file) {
												const reader = new FileReader();
												reader.onload = () =>
													handleChange(field.name, reader.result as string);
												reader.readAsText(file);
											}
										}}
									/>
								</label>
							</>
						) : (
							<Input
								id={`cred-${field.name}`}
								type={
									field.type === "password" || field.sensitive
										? "password"
										: "text"
								}
								value={values[field.name] ?? ""}
								onChange={(e) => handleChange(field.name, e.target.value)}
								onBlur={() => handleBlur(field.name)}
								placeholder={field.placeholder ?? field.example}
								aria-describedby={ariaDescribedBy}
								aria-invalid={shouldShowError ? true : undefined}
							/>
						)}
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
