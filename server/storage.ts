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
    const bucket = buckets?.find((b) => b.name === BUCKET_NAME);
    if (!bucket) {
      await supabase.storage.createBucket(BUCKET_NAME, { public: false });
    } else if (bucket.public) {
      await supabase.storage.updateBucket(BUCKET_NAME, { public: false });
    }
    _bucketEnsured = true;
  } catch (err) {
    console.warn("[Storage] Bucket provisioning check:", err);
  }
}

// Documents are private; the browser reads them through the authenticated-by-
// unguessable-key proxy at /manus-storage/<key>, which redirects to a short-lived
// signed URL. Storing the proxy path keeps saved analyses stable across restarts.
function proxyUrl(key: string): string {
  return `/manus-storage/${key}`;
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

  return { key, url: proxyUrl(key) };
}

export async function storageGet(relKey: string): Promise<{ key: string; url: string }> {
  const key = normalizeKey(relKey);
  return { key, url: proxyUrl(key) };
}

export async function storageGetSignedUrl(relKey: string): Promise<string> {
  const supabase = getSupabaseAdmin();
  const key = normalizeKey(relKey);
  const { data, error } = await supabase.storage.from(BUCKET_NAME).createSignedUrl(key, 300);

  if (error || !data?.signedUrl) {
    throw new Error(`Storage signed URL failed: ${error?.message ?? "unknown error"}`);
  }

  return data.signedUrl;
}
