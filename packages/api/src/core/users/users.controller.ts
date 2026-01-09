import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { CreateUserDto } from './dto/create-user.dto.js';
import { UsersService } from './users.service.js';

@Controller('users')
export class UsersController {
    constructor(
        private readonly usersService: UsersService,
    ) { }

    @Post('setup')
    @HttpCode(HttpStatus.CREATED)
    async setup(@Body() createUserDto: CreateUserDto) {
        const user = await this.usersService.setupOwner(createUserDto);
        return {
            user: {
                id: user.id,
                email: user.email,
                firstName: user.firstName,
                lastName: user.lastName,
                globalRole: user.globalRole,
            },
        };
    }
}
