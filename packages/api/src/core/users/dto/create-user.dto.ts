// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { IsEmail, IsNotEmpty, IsOptional, MinLength } from "class-validator";

export class CreateUserDto {
	@IsEmail()
	@IsNotEmpty()
	email: string;

	@IsNotEmpty()
	@MinLength(8)
	password: string;

	@IsOptional()
	name?: string;
}
