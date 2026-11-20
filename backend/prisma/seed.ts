import 'dotenv/config';
import { prisma } from '../src/lib/prisma.js';
import { getEnv } from '../src/config/env.js';
import { runSeed } from './seed/run.js';

async function main() {
  const env = getEnv();
  await runSeed(prisma, {
    nodeEnv: env.NODE_ENV,
    demo: env.SEED_DEMO_DATA,
    admin: {
      email: env.ADMIN_EMAIL,
      password: env.ADMIN_PASSWORD,
      firstName: env.ADMIN_FIRST_NAME,
      lastName: env.ADMIN_LAST_NAME,
    },
    argon2: {
      memoryCost: env.ARGON2_MEMORY_COST,
      timeCost: env.ARGON2_TIME_COST,
      parallelism: env.ARGON2_PARALLELISM,
    },
    log: (m) => console.log(m),
  });
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
