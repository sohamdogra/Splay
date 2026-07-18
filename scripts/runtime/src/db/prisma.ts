import { isTestMode } from "../config/runtimeMode.ts";

type PrismaClientLike = {
  $disconnect(): Promise<void>;
  socialPost: unknown;
  metricSnapshot: unknown;
  postScore: unknown;
  feedbackLesson: unknown;
};

let prisma: PrismaClientLike | null = null;

export function isDatabaseConfigured(): boolean {
  return !isTestMode() && Boolean(process.env.DATABASE_URL);
}

export async function getPrisma(): Promise<PrismaClientLike> {
  if (isTestMode()) {
    throw new Error("Database access is disabled while SOCIAL_AGENT_TEST_MODE=1.");
  }
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required for feedback-loop database operations.");
  }
  if (!prisma) {
    const [{ PrismaClient }, { PrismaPg }] = await Promise.all([
      import("@prisma/client"),
      import("@prisma/adapter-pg")
    ]);
    const caPath = process.env.DATABASE_CA_CERT_PATH;
    let adapterConfig: ConstructorParameters<typeof PrismaPg>[0] = { connectionString };

    if (caPath) {
      const [{ readFile }, { resolve }] = await Promise.all([
        import("node:fs/promises"),
        import("node:path")
      ]);
      const ca = await readFile(resolve(caPath), "utf8");
      const verifiedUrl = new URL(connectionString);
      verifiedUrl.searchParams.delete("sslmode");
      adapterConfig = {
        connectionString: verifiedUrl.toString(),
        ssl: { ca, rejectUnauthorized: true }
      };
    }

    const adapter = new PrismaPg(adapterConfig);
    prisma = new PrismaClient({ adapter }) as PrismaClientLike;
  }
  return prisma;
}

export async function disconnectPrisma(): Promise<void> {
  if (!prisma) return;
  await prisma.$disconnect();
  prisma = null;
}
