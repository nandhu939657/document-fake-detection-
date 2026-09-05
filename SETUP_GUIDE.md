# VerityLens Setup Guide

VerityLens is a document-screening web app: upload an image, a locally-run
U-Net model screens it for signs of tampered text, and a locally-run LLM
writes a plain-language explanation. No third-party AI API is called at
runtime -- everything runs on your own machine.

> This is a research prototype, not a certified fraud detector. It only
> screens for edited/altered text regions, does not check signatures, seals,
> or stamps, and should not be treated as legal or institutional proof of
> authenticity.

Every step below is a command block you can paste as-is into your terminal.
Run them in order, top to bottom, from the project's root folder unless
told otherwise. Pick the **Windows (PowerShell)** or **macOS/Linux (bash)**
block that matches your machine wherever they differ.

## 0. Prerequisites (install these first, not paste-able)

- **Node.js 22+** -- https://nodejs.org
- **Python 3.10+** -- https://python.org (make sure "Add to PATH" is checked on Windows)
- **Ollama** -- https://ollama.com/download (for the real, local AI-written
  explanation; the app still runs without it, using a canned template instead)
- **Git**

Verify they're all on your PATH:

```bash
node --version
python --version
git --version
ollama --version
```

## 1. Clone the repo

```bash
git clone https://github.com/nandhuitarang-ops/fake-documentry-.git
cd fake-documentry-
```

## 2. Install pnpm and Node dependencies

```bash
npm install -g pnpm
pnpm install
```

## 3. Create the Python ML virtual environment

**Windows (PowerShell):**
```powershell
python -m venv models\ml\.venv
models\ml\.venv\Scripts\python.exe -m pip install --upgrade pip
models\ml\.venv\Scripts\python.exe -m pip install -r scripts\requirements.txt --extra-index-url https://download.pytorch.org/whl/cpu
```

**macOS/Linux (bash):**
```bash
python3 -m venv models/ml/.venv
models/ml/.venv/bin/python -m pip install --upgrade pip
models/ml/.venv/bin/python -m pip install -r scripts/requirements.txt --extra-index-url https://download.pytorch.org/whl/cpu
```

This installs directly into the venv without needing to "activate" it first
-- `server/pythonRuntime.ts` finds and uses `models/ml/.venv` automatically.
This step downloads PyTorch (~150MB); if you skip it, the app still runs but
every analysis falls back to a non-ML visual heuristic instead of the real
trained model.

## 4. Pull the local LLM model

Make sure the Ollama app/service is running, then:

```bash
ollama pull llama3.2:3b
```

This is a ~2GB download. The server talks to it at `http://127.0.0.1:11434`
by default.

## 5. Create your `.env` file

You need a free [Supabase](https://supabase.com) project for the database
and auth keys. Create one, then go to **Project Settings > API** and
**Project Settings > Database > Connection string** to get the values below.

Generate a random `JWT_SECRET` with this one-liner (works on both platforms
since Python is already installed):

```bash
python -c "import secrets; print(secrets.token_hex(32))"
```

Then create the file:

**Windows (PowerShell):**
```powershell
@'
DATABASE_URL=postgresql://<user>:<password>@<host>:<port>/<database>
NEXT_PUBLIC_SUPABASE_URL=https://<your-project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<your supabase anon key>
SUPABASE_SERVICE_ROLE_KEY=<your supabase service role key>
JWT_SECRET=<paste the random string you generated above>
PORT=3000
'@ | Out-File -Encoding utf8 .env
```

**macOS/Linux (bash):**
```bash
cat > .env << 'EOF'
DATABASE_URL=postgresql://<user>:<password>@<host>:<port>/<database>
NEXT_PUBLIC_SUPABASE_URL=https://<your-project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<your supabase anon key>
SUPABASE_SERVICE_ROLE_KEY=<your supabase service role key>
JWT_SECRET=<paste the random string you generated above>
PORT=3000
EOF
```

Then **open `.env` in an editor and replace every `<...>` placeholder** with
your real values before continuing -- the commands above only create the
file's shape, they can't know your actual Supabase credentials.

`.env` is already in `.gitignore` -- never commit it.

## 6. Set up the database schema

```bash
pnpm db:push
```

## 7. Validate everything works

```bash
pnpm check
pnpm test
```

`pnpm test` takes ~10-15 seconds and includes one real call through the
Python inference pipeline -- if it hangs much longer than that or fails,
re-check step 3.

## 8. Run it

Development mode (hot-reload on file changes):

```bash
pnpm dev
```

Or a production-style run:

```bash
pnpm run build
pnpm start
```

Either prints the URL it's listening on, e.g. `Server running on
http://localhost:3000/`.

## 9. Try it out

1. Open the printed URL in your browser.
2. Click sign in and enter any name/email (no real password check in this
   build -- it's a placeholder auth flow, not production auth).
3. Go to **Analyze document**, upload an image (PNG/JPEG/WEBP, up to 8MB).
4. Wait ~10-20 seconds for the model + LLM to run.
5. Check **Analysis history** to confirm it saved.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Explanation reads like a stiff template, not natural writing | Ollama isn't running or the model wasn't pulled | Check server logs for `[llm] Ollama unavailable`; re-run step 4 |
| Saved report's model version says a fallback/baseline was used | Python venv missing or a package failed to install | Re-run step 3, watch for pip errors |
| `pnpm test` fails on the inference test | Same as above | Re-run step 3; confirm `models/ml/.venv` exists |
| Port already in use | Something else is on 3000 | The server auto-tries the next few ports -- check its startup log line for which one it picked |
| `pnpm db:push` fails to connect | Wrong `DATABASE_URL` | Re-copy the connection string from Supabase's dashboard exactly |
