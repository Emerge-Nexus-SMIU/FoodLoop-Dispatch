import 'dotenv/config';
import { z } from 'zod';
import { hash } from 'bcryptjs';
import { db } from '../src/server/db';
async function main() {
  const v = z
    .object({
      ADMIN_EMAIL: z.email(),
      ADMIN_NAME: z.string().min(2),
      ADMIN_PASSWORD: z.string().min(16).max(128),
    })
    .parse(process.env);
  await db.user.create({
    data: {
      email: v.ADMIN_EMAIL.toLowerCase(),
      name: v.ADMIN_NAME,
      passwordHash: await hash(v.ADMIN_PASSWORD, 12),
      platformAdmin: true,
    },
  });
  console.log('Administrator created. Remove bootstrap credentials from the environment.');
}
main().finally(() => db.$disconnect());
