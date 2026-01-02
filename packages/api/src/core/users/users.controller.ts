import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { UsersService } from './users.service.js';
import { CreateUserDto } from './dto/create-user.dto.js';
import { AuthService } from '../auth/auth.service.js';

@Controller('users')
export class UsersController {
    constructor(
        private readonly usersService: UsersService,
        private readonly authService: AuthService,
    ) { }

    @Post('setup')
    @HttpCode(HttpStatus.CREATED)
    async setup(@Body() createUserDto: CreateUserDto) {
        const user = await this.usersService.setupOwner(createUserDto);
        // Auto-login after setup
        const token = await this.authService.signToken(user);
        return {
            user: {
                id: user.id,
                email: user.email,
                firstName: user.firstName,
                lastName: user.lastName,
                globalRole: user.globalRole,
            },
            access_token: token,
        };
    }
}
