// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Template-field-driven credential form.
 *
 * Renders form fields from TemplateField[] (from @prismalens/integrations templates).
 * Each field is a Field, in the same language as Resolve.
 */

import type { TemplateField } from "@prismalens/contracts/schemas";
import { Upload } from "lucide-react";
import { useState } from "react";
import { CopyButton } from "@/components/shared/CopyButton";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { validateFieldValues } from "@/lib/credential-schema";
import { Field } from "./Field";

interface Props {
	fields: TemplateField[];
	values: Record<string, string>;
	onChange: (values: Record<string, string>) => void;
	/** Show validation errors (call after attempted submit) */
	showErrors?: boolean;
	/** A quiet note beside every label, as "blank keeps the saved value" on edit. */
	note?: string;
}

export function DynamicCredentialForm({
	fields,
	values,
	onChange,
	showErrors = false,
	note,
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
				const isReadonly = field.readonly === true;
				const id = `cred-${field.name}`;

				if (isReadonly) {
					const displayValue = values[field.name] ?? field.default ?? "";
					return (
						<Field
							key={field.name}
							label={field.label}
							hint={field.description}
						>
							<div className="flex min-w-0 items-center gap-2">
								<code className="min-w-0 flex-1 truncate rounded-control bg-surface-3 px-2.5 py-1 font-mono text-meta text-text-1">
									{displayValue}
								</code>
								{displayValue && <CopyButton value={displayValue} />}
							</div>
						</Field>
					);
				}

				return (
					<Field
						key={field.name}
						label={field.label}
						note={note}
						htmlFor={id}
						hint={field.description}
						error={shouldShowError ? error : undefined}
					>
						{(describedBy) =>
							field.type === "textarea" ? (
								<>
									<Textarea
										id={id}
										value={values[field.name] ?? ""}
										onChange={(e) => handleChange(field.name, e.target.value)}
										onBlur={() => handleBlur(field.name)}
										placeholder={field.placeholder ?? field.example}
										rows={4}
										className="resize-none font-mono text-meta"
										aria-invalid={shouldShowError ? true : undefined}
										aria-describedby={describedBy}
									/>
									<label className="inline-flex cursor-pointer items-center gap-1.5 text-meta text-text-2 hover:text-text-1">
										<Upload className="size-3.5" />
										<span>Upload a file</span>
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
									id={id}
									type={
										field.type === "password" || field.sensitive
											? "password"
											: "text"
									}
									value={values[field.name] ?? ""}
									onChange={(e) => handleChange(field.name, e.target.value)}
									onBlur={() => handleBlur(field.name)}
									placeholder={field.placeholder ?? field.example}
									aria-invalid={shouldShowError ? true : undefined}
									aria-describedby={describedBy}
								/>
							)
						}
					</Field>
				);
			})}
		</div>
	);
}
