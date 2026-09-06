# VerityLens - Project Report

## What is this?

VerityLens is a website where someone can upload a photo or scan of a
document (like a receipt, form, or certificate), and the site tries to tell
them whether the text on it looks like it's been edited or tampered with.
It shows a prediction ("genuine" or "forged"), highlights the suspicious
area on the image in red, and writes a short paragraph explaining what it
found.

Think of it as a first-pass screening tool, not a final verdict. It's meant
to flag documents that might deserve a closer human look -- it does **not**
replace checking with the actual issuing organization.

## How it works, in plain terms

1. You upload a document image.
2. The site runs it through a model that was trained to spot edited text
   (things like a changed number, a pasted-in word, or an altered date).
3. It draws a red highlight over whatever area looks suspicious.
4. A second, separate program writes a plain-English paragraph describing
   the result -- e.g. "this area looks edited because..."
5. Everything is saved so you can look back at past uploads later.

Both of those programs run entirely on the computer hosting the site --
nothing gets sent to an outside company like OpenAI or Google to analyze
your document. That was a deliberate choice: no third-party service sees
your uploaded documents, and there's no per-use cost to an outside API.

## What it's actually good at right now, honestly

- It can run a real analysis on a document and give you *something* --
  a score, a highlighted region, and a written explanation.
- It's genuinely private (self-contained, nothing sent to third parties).
- The plain-English explanation is written by a real small AI model running
  locally, not a canned copy-paste template.

## What it's not good at yet -- please read this part

- **The tampered-text detector is weak.** It was trained on a small amount
  of data and on CPU-only hardware, so its accuracy is limited. It can
  produce wrong answers, including missing real tampering and flagging
  genuine documents as suspicious.
- **It only looks at edited text.** It does not check whether a signature,
  seal, stamp, or logo is fake or copied -- that's a separate, unbuilt
  feature. We have gathered data for it but haven't trained or wired in a
  model for it yet.
- **It's not certified or legally recognized.** No government body,
  institution, or court would accept this as proof a document is fake or
  real. It's a research prototype.
- **Several training attempts failed during development**, and that's worth
  being upfront about: two attempts at a general genuine-vs-forged model
  ended up "cheating" (learning to recognize which practice dataset an
  image came from, rather than actual signs of tampering) instead of really
  working, and a follow-up attempt on better data was too small to train
  reliably. Those broken attempts were deleted rather than shipped. The one
  model actually in use today is a real, working, but still fairly weak
  model -- not a polished, thoroughly validated detector.

## What's technically inside (kept simple)

- **The website itself**: built with common web tools (React for what you
  see, a Node.js server behind it).
- **The document checker**: a small image-recognition model (an
  "EfficientNet-based U-Net," if you want the exact name), written in
  Python, running on the same machine as the website.
- **The AI writer**: a small, free, locally-installed language model
  (Llama 3.2, run through a tool called Ollama) -- similar idea to
  ChatGPT, but smaller, free, and running on this machine instead of in
  the cloud.
- **Where things are stored**: uploaded images and results are saved in a
  database and file storage hosted by Supabase (a free-tier-friendly
  hosting service).

## Where it stands today

- Running and testable locally, and currently reachable from anywhere via
  a temporary free public link (a "tunnel" from this machine).
- Also prepared (but not yet actually deployed) for hosting on Render, a
  paid cloud hosting service, for a more permanent setup -- that costs
  real money per month because of how much memory the AI models need.
- The project's code is on GitHub, with setup instructions written so
  anyone can copy the project and run it themselves from scratch.

## Bottom line

VerityLens works as a demonstration of the idea: upload a document, get an
AI-assisted screening with a plain-English explanation, no outside services
involved. It is not yet accurate or complete enough to rely on for real
decisions about whether a document is genuine -- especially anything
involving signatures, seals, or stamps, which it doesn't look at at all.
The honest next steps would be: gathering better, more realistic training
data (ideally real examples of the kind of documents it needs to check),
retraining the detector properly, and building the separate
signature/seal-checking feature before treating this as more than a
prototype.
