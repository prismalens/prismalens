import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../users/users.service.js';

@Injectable()
export class AuthService {
    constructor(
        private usersService: UsersService,
        private jwtService: JwtService,
    ) { }

    async validateUser(email: string, pass: string): Promise<any> {
        const user = await this.usersService.findOne(email);
        // TODO: Implement bcrypt compare here when password hashing is active
        // For setup/install flow, we trust the newly created user
        if (user && user.passwordHash === pass) {
            const { ...result } = user;
            return result;
        }
        return null;
    }

    async login(user: any) {
        const payload = { email: user.email, sub: user.id, role: user.globalRole };
        return {
            access_token: this.jwtService.sign(payload),
        };
    }

    signToken(user: any) {
        const payload = { email: user.email, sub: user.id, role: user.globalRole };
        return this.jwtService.sign(payload);
    }
}
