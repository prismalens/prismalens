import {
	Body,
	Controller,
	Get,
	HttpCode,
	HttpStatus,
	Post,
} from "@nestjs/common";
import { CreateUserDto } from "./dto/create-user.dto.js";
import { UsersService } from "./users.service.js";

@Controller("users")
export class UsersController {
	constructor(private readonly usersService: UsersService) {}

	/**
	 * Check if initial setup is complete
	 */
	@Get("setup/status")
	async setupStatus() {
		const isComplete = await this.usersService.isSetupComplete();
		return { setupComplete: isComplete };
	}

	/**
	 * Create the first admin account during initial setup
	 */
	@Post("setup")
	@HttpCode(HttpStatus.CREATED)
	async setup(@Body() createUserDto: CreateUserDto) {
		const user = await this.usersService.setupOwner(createUserDto);
		return {
			user: {
				id: user.id,
				email: user.email,
				name: user.name,
				role: user.role,
			},
		};
	}
}
