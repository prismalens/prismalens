import { IsEmail, IsNotEmpty, MinLength } from "class-validator";

export class CreateUserDto {
	@IsEmail()
	@IsNotEmpty()
	email: string;

	@IsNotEmpty()
	@MinLength(8)
	password: string;

	@IsNotEmpty()
	firstName: string;

	@IsNotEmpty()
	lastName: string;
}
