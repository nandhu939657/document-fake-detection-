const isProduction = process.env.NODE_ENV === "production";
const cookieSecret = process.env.JWT_SECRET ?? (isProduction ? "" : "default-local-jwt-secret");
if (isProduction && !cookieSecret) {
  throw new Error("JWT_SECRET must be set in production.");
}

export const ENV = {
  cookieSecret,
  databaseUrl: process.env.DATABASE_URL ?? "",
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "",
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || "",
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  isProduction: process.env.NODE_ENV === "production",
  appId: process.env.VITE_APP_ID ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
};

