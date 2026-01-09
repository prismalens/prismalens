import {
	ConflictException,
	ForbiddenException,
	Injectable,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { CreateUserDto } from "./dto/create-user.dto.js";

@Injectable()
export class UsersService {
	constructor(private prisma: PrismaService) {}

	async findOne(email: string) {
		return this.prisma.user.findUnique({ where: { email } });
	}

	async setupOwner(createUserDto: CreateUserDto) {
		// Check if any owner exists
		const existingOwner = await this.prisma.user.findFirst({
			where: { globalRole: "owner" },
		});

		if (existingOwner) {
			throw new ForbiddenException(
				"Instance already set up. Owner account exists.",
			);
		}

		// Create the owner account
		// In a real app, password should be hashed here.
		// user.passwordHash = await bcrypt.hash(createUserDto.password, 10);
		// For now, storing as plain text -> TODO: Enable hashing
		const user = await this.prisma.user.create({
			data: {
				email: createUserDto.email,
				passwordHash: createUserDto.password, // Plain text for now
				firstName: createUserDto.firstName,
				lastName: createUserDto.lastName,
				globalRole: "owner",
				isPending: false,
			},
		});

		return user;
	}
}
