import { prisma } from "../packages/@prismalens/database/dist/client.js";

await prisma.$executeRawUnsafe("DELETE FROM session");
await prisma.$executeRawUnsafe("DELETE FROM account");
await prisma.$executeRawUnsafe("DELETE FROM verification");
await prisma.$executeRawUnsafe("DELETE FROM user");
console.log("Auth tables cleared (user, session, account, verification)");
await prisma.$disconnect();
