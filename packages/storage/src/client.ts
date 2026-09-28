import { S3Client } from "@aws-sdk/client-s3";

let client: S3Client | undefined;

function env() {
  return {
    accountId: process.env.R2_ACCOUNT_ID,
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    bucket: process.env.R2_BUCKET,
  };
}

// True only once all four R2_* vars are set. Callers use this to skip
// uploads/reads quietly in any environment that hasn't configured R2 (local
// dev, by default) instead of throwing.
export function isR2Configured(): boolean {
  const e = env();
  return Boolean(e.accountId && e.accessKeyId && e.secretAccessKey && e.bucket);
}

export function getR2Bucket(): string {
  const bucket = env().bucket;
  if (!bucket) throw new Error("R2_BUCKET is not set");
  return bucket;
}

// Lazily constructed, same reasoning as @govdex/db's getPool(): importing
// this module must never fail just because R2 isn't configured yet.
export function getR2Client(): S3Client {
  if (!client) {
    const { accountId, accessKeyId, secretAccessKey } = env();
    if (!accountId || !accessKeyId || !secretAccessKey) {
      throw new Error("R2_ACCOUNT_ID, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY must be set");
    }
    client = new S3Client({
      region: "auto",
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId, secretAccessKey },
    });
  }
  return client;
}
