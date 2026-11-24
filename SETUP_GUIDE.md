# VerityLens Complete Setup & Training Guide

VerityLens is an institutional-grade, explainable document forgery detection web application. It combines:
1. **Local Deep Learning (U-Net)** to segment tampered text regions, forged signatures, and altered seals.
2. **Local AI Model (Ollama LLM)** to generate plain-language, reviewer-friendly explanations.
3. **Interactive Visual Evidence UI** with marked vs. clean original document inspection, red text underlines, and signature/seal circular markers.
4. **Instant Testing Mode** — No sign-in or account creation required; anyone can test immediately.

Everything runs **100% locally on your machine** without sending documents to third-party AI APIs.

---

## 0. Prerequisites Checklist

Install these once on your system before proceeding:

- **Node.js (v20 or v22 LTS)** — [https://nodejs.org](https://nodejs.org)
- **Python (v3.10 or v3.11)** — [https://python.org](https://python.org)  
  *(Windows users: make sure to check **"Add Python to PATH"** during installation)*
- **Ollama** (for local LLM explanations) — [https://ollama.com/download](https://ollama.com/download)
- **Git** — [https://git-scm.com](https://git-scm.com)

Verify your installations in your terminal:

```bash
node --version
python --version
git --version
ollama --version
```

---

## 1. Clone the Repository

Open a terminal and clone the repository:

```bash
git clone https://github.com/nandhu939657/document-fake-detection-.git
cd document-fake-detection-
```

*(If you received the project as a `.zip` or folder, navigate into `fake-documentry-`)*

```bash
cd fake-documentry-
```

---

## 2. Install Node Dependencies

Install `pnpm` and project dependencies:

```bash
npm install -g pnpm
pnpm install
```

---

## 3. Set Up Python ML Environment

Create a dedicated virtual environment under `models/ml/.venv` and install PyTorch with the necessary computer vision dependencies.

### Windows (PowerShell):
```powershell
python -m venv models\ml\.venv
models\ml\.venv\Scripts\python.exe -m pip install --upgrade pip
models\ml\.venv\Scripts\python.exe -m pip install -r scripts\requirements.txt --extra-index-url https://download.pytorch.org/whl/cpu
```

### macOS / Linux (bash):
```bash
python3 -m venv models/ml/.venv
models/ml/.venv/bin/python -m pip install --upgrade pip
models/ml/.venv/bin/python -m pip install -r scripts/requirements.txt --extra-index-url https://download.pytorch.org/whl/cpu
```

> **Note:** The backend automatically locates `models/ml/.venv` at runtime. You do not need to activate the environment manually.

---

## 4. Install & Run the Local LLM (Ollama)

VerityLens uses a local LLM to write transparent explanations of the forensic findings.

1. Start the Ollama application or service on your computer.
2. In your terminal, pull the recommended model:

```bash
ollama pull llama3.2:3b
```

3. Verify that Ollama is responding:

```bash
ollama run llama3.2:3b "Hello, VerityLens!"
```

*(Ollama listens on `http://127.0.0.1:11434` by default. If Ollama is ever offline, the server automatically provides a dynamic fallback explanation without crashing).*

---

## 5. Training or Retraining the ML Model

> **Good News:** The repository already ships with a pre-trained model checkpoint at `models/weights/tamper_unet.pt`. If you just want to run the app, **you do not need to train anything**! Skip to Step 6.

If you want to train your own model or fine-tune on a custom dataset, follow the steps below:

### Architecture
- Model: Compact U-Net with an `efficientnet-b0` backbone (`segmentation_models_pytorch`).
- Objective: Pixel-level binary segmentation of altered or tampered regions.
- Loss: Combined Dice Loss + Binary Cross-Entropy with Sigmoid activations.

### Step 5.1: Dataset Structure
Prepare your training dataset in paired image and mask folders:

```
training_data/
└── my_dataset/
    ├── images/
    │   ├── doc_001.jpg
    │   ├── doc_002.jpg
    │   └── ...
    └── masks/
        ├── doc_001.png
        ├── doc_002.png
        └── ...
```
- Images: RGB document images.
- Masks: 8-bit grayscale / binary PNGs matching the base filenames, where `255` = tampered pixel and `0` = genuine pixel.

### Step 5.2: Run Model Self-Test
Verify that the model definition, loss function, and forward pass hold:

**Windows (PowerShell):**
```powershell
models\ml\.venv\Scripts\python.exe scripts\train.py --self-test
```

**macOS / Linux (bash):**
```bash
models/ml/.venv/bin/python scripts/train.py --self-test
```

You should see: `self-test OK: model forward + loss shapes valid`.

### Step 5.3: Train the Model
Run the training script pointing to your dataset folder:

**Windows (PowerShell):**
```powershell
models\ml\.venv\Scripts\python.exe scripts\train.py --data training_data/my_dataset --out models\weights\tamper_unet.pt --epochs 12 --batch 8 --pretrained
```

**macOS / Linux (bash):**
```bash
models/ml/.venv/bin/python scripts/train.py --data training_data/my_dataset --out models/weights/tamper_unet.pt --epochs 12 --batch 8 --pretrained
```

### Step 5.4: Evaluate on Benchmark Samples
Verify that the model correctly separates fakes from genuine documents on the built-in test suite:

**Windows (PowerShell):**
```powershell
models\ml\.venv\Scripts\python.exe scripts\eval_samples.py
```

**macOS / Linux (bash):**
```bash
models/ml/.venv/bin/python scripts/eval_samples.py
```

---

## 6. Configure Environment Variables (`.env`)

Create your `.env` configuration file in the project root.

Generate a random secret key:
```bash
python -c "import secrets; print(secrets.token_hex(32))"
```

### Windows (PowerShell):
```powershell
@'
DATABASE_URL=postgresql://<user>:<password>@<host>:<port>/<database>
NEXT_PUBLIC_SUPABASE_URL=https://<your-project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<your supabase anon key>
SUPABASE_SERVICE_ROLE_KEY=<your supabase service role key>
JWT_SECRET=replace_with_generated_secret_key
PORT=3000
'@ | Out-File -Encoding utf8 .env
```

### macOS / Linux (bash):
```bash
cat > .env << 'EOF'
DATABASE_URL=postgresql://<user>:<password>@<host>:<port>/<database>
NEXT_PUBLIC_SUPABASE_URL=https://<your-project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<your supabase anon key>
SUPABASE_SERVICE_ROLE_KEY=<your supabase service role key>
JWT_SECRET=replace_with_generated_secret_key
PORT=3000
EOF
```

> **Database Note:** Replace the placeholders with your database credentials (e.g. from a free [Supabase](https://supabase.com) PostgreSQL database or local Postgres instance).

Initialize the database schema:

```bash
pnpm db:push
```

---

## 7. Validate the Entire Stack

Run TypeScript compilation and Vitest tests to ensure all components are wired correctly:

```bash
pnpm check
pnpm test
```

All test suites should pass, confirming that Python subprocess inference, LLM explainability, and database procedures are operational.

---

## 8. Run the Application

Start the development server with live reload:

```bash
pnpm dev
```

Or build and run in production mode:

```bash
pnpm build
pnpm start
```

The terminal will display the local URL:
```
Server running on http://localhost:3000/
```

---

## 9. Instant Document Testing (No Login Required)

1. Open `http://localhost:3000` in your web browser.
2. The app starts immediately in **Instant Testing Mode** — you do not need to sign in!
3. Drag & drop or browse for any document image (PNG, JPG, or WEBP up to 8 MB).
4. Click **"Analyze document"**.
5. Within seconds, the analysis report displays:
   - **Visual Evidence:** Suspect altered text is marked with a clean **red underline**; suspect signatures and seals/logos are marked with **red circles**.
   - **Inspection Toggle:** Switch between **Marked Evidence** and **Clean Original** document view.
   - **Forgery Likelihood Score:** Probability score with institutional status band (Genuine / Human Review / Forgery suspected).
   - **Plain-Language Explanation:** AI-generated narrative detailing specific tampered regions and detected anomalies.
   - **Analysis History:** Click the **Analysis history** tab to review previous test results.

### Ready-to-Test Sample Images Included
You can immediately test using the pre-packaged files in the `samples/` directory:
- **Genuine Letter:** `samples/sample-1-genuine-letter.png`
- **Genuine Invoice:** `samples/sample-4-genuine-invoice.png`
- **Genuine Form:** `samples/sample-5-genuine-form.png`
- **Obvious Forged Document:** `samples/sample-2-fake-obvious.jpg`
- **Forged Signature:** `samples/sample-8-forged-signature.jpg`
- **Altered Invoice:** `samples/sample-15-web-fake-invoice-obvious.png`

---

## 10. Troubleshooting

| Issue | Cause | Solution |
|---|---|---|
| AI explanation reads like a basic template | Ollama is not running or the model wasn't pulled | Run `ollama pull llama3.2:3b` and ensure Ollama desktop app is running. |
| Report shows `visual baseline only` | Python venv missing or requirements incomplete | Re-run Step 3 and ensure PyTorch installed properly into `models/ml/.venv`. |
| `pnpm test` hangs or fails on inference | Python cannot find dependencies | Run `models\ml\.venv\Scripts\python.exe -m pip list` to check `torch` and `segmentation_models_pytorch`. |
| Port 3000 already in use | Another service is using port 3000 | Set `PORT=3001` in your `.env` file or check server logs for the auto-assigned port. |
| Database connection error | Invalid or disconnected Postgres URL | Verify your `DATABASE_URL` in `.env` and run `pnpm db:push`. |
