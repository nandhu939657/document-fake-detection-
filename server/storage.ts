import { createClient } from "@supabase/supabase-js";
import { ENV } from "./_core/env";

const BUCKET_NAME = "veritylens";

function getSupabaseAdmin() {
  if (!ENV.supabaseUrl || !ENV.supabaseServiceRoleKey) {
    throw new Error("Supabase config missing: set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  }
  return createClient(ENV.supabaseUrl, ENV.supabaseServiceRoleKey, {
    auth: { persistSession: false },
  });
}

function normalizeKey(relKey: string): string {
  return relKey.replace(/^\/+/, "");
}

function appendHashSuffix(relKey: string): string {
  const hash = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  const lastDot = relKey.lastIndexOf(".");
  if (lastDot === -1) return `${relKey}_${hash}`;
  return `${relKey.slice(0, lastDot)}_${hash}${relKey.slice(lastDot)}`;
}

let _bucketEnsured = false;
async function ensureBucket(supabase: ReturnType<typeof getSupabaseAdmin>) {
  if (_bucketEnsured) return;
  try {
    const { data: buckets } = await supabase.storage.listBuckets();
    const exists = buckets?.some((b) => b.name === BUCKET_NAME);
    if (!exists) {
      await supabase.storage.createBucket(BUCKET_NAME, { public: true });
    }
    _bucketEnsured = true;
  } catch (err) {
    console.warn("[Storage] Bucket provisioning check:", err);
  }
}

export async function storagePut(
  relKey: string,
  data: Buffer | Uint8Array | string,
  contentType = "application/octet-stream"
): Promise<{ key: string; url: string }> {
  const supabase = getSupabaseAdmin();
  await ensureBucket(supabase);
  const key = appendHashSuffix(normalizeKey(relKey));

  const buffer = typeof data === "string" ? Buffer.from(data) : Buffer.from(data);

  const { error } = await supabase.storage.from(BUCKET_NAME).upload(key, buffer, {
    contentType,
    upsert: true,
  });

  if (error) {
    console.error("[Storage] Supabase upload failed:", error);
    throw new Error(`Storage upload failed: ${error.message}`);
  }

  const { data: publicUrlData } = supabase.storage.from(BUCKET_NAME).getPublicUrl(key);

  return { key, url: publicUrlData.publicUrl };
}

export async function storageGet(relKey: string): Promise<{ key: string; url: string }> {
  const supabase = getSupabaseAdmin();
  const key = normalizeKey(relKey);
  const { data: publicUrlData } = supabase.storage.from(BUCKET_NAME).getPublicUrl(key);
  return { key, url: publicUrlData.publicUrl };
}

export async function storageGetSignedUrl(relKey: string): Promise<string> {
  const supabase = getSupabaseAdmin();
  const key = normalizeKey(relKey);
  const { data, error } = await supabase.storage.from(BUCKET_NAME).createSignedUrl(key, 3600);

  if (error || !data?.signedUrl) {
    // Fallback to public URL
    const { data: publicUrlData } = supabase.storage.from(BUCKET_NAME).getPublicUrl(key);
    return publicUrlData.publicUrl;
  }

  return data.signedUrl;
}
