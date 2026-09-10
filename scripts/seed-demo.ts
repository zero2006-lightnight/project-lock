/**
 * CLI: npm run seed
 * Wipes and re-creates the demo student (Alex) with realistic data relative
 * to today's date. Run any time you want a fresh, alive dashboard.
 */
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { createDemoUser, seedDemoCurriculum, DEMO_EMAIL } from "@/lib/db/demo";

async function main() {
  const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, DEMO_EMAIL)).all();
  for (const u of existing) {
    await db.delete(users).where(eq(users.id, u.id)).run();
  }
  const userId = await createDemoUser();
  await seedDemoCurriculum(userId);
  console.log(`✓ Demo student seeded: ${DEMO_EMAIL} / demo1234`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});