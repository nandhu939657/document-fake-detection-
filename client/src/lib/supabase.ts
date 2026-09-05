import { createClient } from "@supabase/supabase-js";

const supabaseUrl =
  import.meta.env.VITE_SUPABASE_URL ||
  import.meta.env.NEXT_PUBLIC_SUPABASE_URL ||
  "https://mghpcdhzkiepxhtroqcn.supabase.co";
const supabaseAnonKey =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  import.meta.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1naHBjZGh6a2llcHhodHJvcWNuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgxNTIyNzMsImV4cCI6MjEwMzcyODI3M30.7_ETfHMAiubqmcXD7Mnexee5J7iUBgAVAlz3jPyYfIE";

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
