import * as dotenv from "dotenv";
import express from "express";
import cors from "cors";
import { z } from "zod";

// ---- Genkit 1.21 imports ----
import { genkit } from "genkit";
import { googleAI } from "@genkit-ai/google-genai";
import { expressHandler } from "@genkit-ai/express";

import { YoutubeTranscript } from "youtube-transcript";

import axios from "axios";

dotenv.config();

// setGlobalOptions({
//   region: "asia-south1",
//   timeoutSeconds: 120,
//   memory: "512MiB",
//   maxInstances: 10,
// });

// ---- Initialize Genkit ----
const ai = genkit({
  plugins: [googleAI()],
  model: googleAI.model("gemini-2.5-flash", {
    temperature: 0.8,
  }),
});

// ---- Helper: extract YouTube video ID ----
function extractVideoId(input: string): string | null {
  try {
    if (/^[\w-]{11}$/.test(input)) return input;
    const url = new URL(input);
    if (url.hostname.includes("youtu.be")) return url.pathname.slice(1);
    const v = url.searchParams.get("v");
    if (v) return v;
    const parts = url.pathname.split("/");
    const idx = parts.indexOf("embed");
    if (idx >= 0 && parts[idx + 1]) return parts[idx + 1];
    return null;
  } catch {
    return null;
  }
}


// ---- Helper: fetch video transcript or fallback to description ----
async function fetchTranscript(videoId: string): Promise<string | null> {
  // 1️⃣ Try youtube-transcript first
  try {
    const texts = await YoutubeTranscript.fetchTranscript(videoId, { lang: "en" });
    if (texts.length) {
      return texts.map((t) => t.text).join(" ");
    }
  } catch (err) {
    console.warn("Primary transcript not available:");
  }

  // 2️⃣ Try without specifying language
  try {
    const fallback = await YoutubeTranscript.fetchTranscript(videoId);
    if (fallback.length) {
      return fallback.map((t) => t.text).join(" ");
    }
  } catch (err) {
    console.warn("Fallback transcript not available:");
  }

  // 3️⃣ FINAL FALLBACK: Use YouTube Data API to get video description
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    console.warn("YOUTUBE_API_KEY not set; skipping metadata fallback.");
    return null;
  }

  try {
    const url = `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${videoId}&key=${apiKey}`;
    const res = await axios.get(url);
    const item = res.data.items?.[0];
    if (item) {
      const { title, description } = item.snippet;
      console.log(`✅ Fallback to video description for: ${title}`);
      return `${title}\n${description}`;
    }
  } catch (err) {
    console.error("Error fetching YouTube metadata:");
  }

  return null;
}

// ---- Helper: chunk long transcripts ----
function chunk(text: string, maxLen = 8000): string[] {
  const parts: string[] = [];
  let buf = "";
  for (const piece of text.split(/(?<=[.!?])\s+/)) {
    if ((buf + " " + piece).length > maxLen) {
      parts.push(buf.trim());
      buf = piece;
    } else {
      buf += (buf ? " " : "") + piece;
    }
  }
  if (buf.trim()) parts.push(buf.trim());
  return parts;
}

// ---- Zod Schemas ----
const inputSchema = z.object({
  urlOrId: z.string().min(1),
});

// Output schema with description and strict enforcement of allowed properties
const summarizeOutputSchema = z
  .object({
    title: z.string().describe("The title of the YouTube video or summary."),
    summary: z.string().describe("A concise paragraph summarizing the video content."),
    bullets: z.array(z.string()).describe("Key bullet points extracted from the video."),
    warnings: z.array(z.string()).optional().describe("Optional warnings related to the transcript."),
  })
  .strict();

// ---- Define Genkit Flow ----
const summarizeYouTube = ai.defineFlow(
  {
    name: "summarizeYouTube",
    inputSchema,
    outputSchema: summarizeOutputSchema,
  },
  async ({ urlOrId }): Promise<z.infer<typeof summarizeOutputSchema>> => {
    const videoId = extractVideoId(urlOrId);
    if (!videoId) {
      return {
        title: "Invalid YouTube URL or ID",
        summary: "The provided input is not a valid YouTube URL or video ID.",
        bullets: [],
        warnings: ["Invalid YouTube URL or ID provided."],
      };
    }

    const transcript = await fetchTranscript(videoId);

    if (!transcript) {
      return {
        title: "Transcript not available",
        summary: "This video has no subtitles or transcript.",
        bullets: [],
        warnings: ["YouTube did not expose captions for this video."],
      };
    }

    // Use a slightly smaller chunk size to give the LLM more room for context
    const parts = chunk(transcript, 6500);

    if (parts.length === 0) {
      return {
        title: "Transcript is empty",
        summary: "The transcript for this video is empty or could not be processed.",
        bullets: [],
        warnings: ["Transcript is empty or invalid."],
      };
    }

    const partials: string[] = [];

    // Step 1: Summarize chunks into bullet points
    for (const [i, section] of parts.entries()) {
      try {
        const res = await ai.generate({
          prompt: `Summarize the following transcript chunk (${i + 1}/${
            parts.length
          }) into 5–8 bullet points. Be concise, specific, and factual.\n\n${section}`,
        });
        if (res.text) {
          partials.push(res.text);
        } else {
          partials.push("");
        }
      } catch (error) {
        partials.push("");
        console.warn(`Error summarizing chunk ${i + 1}:`, error);
      }
    }

    const combinedBullets = partials.filter(Boolean).join("\n");

    if (!combinedBullets) {
      return {
        title: "Summary unavailable",
        summary: "Unable to generate summary from the transcript.",
        bullets: [],
        warnings: ["Failed to generate summary from transcript chunks."],
      };
    }

    // Step 2: Combine and enforce strict JSON output using Zod schema
    try {
      const finalRes = await ai.generate({
        prompt:
          `Combine these bullets into a complete structured summary. ` +
          `Your output MUST strictly follow the provided JSON schema. ` +
          `The summary should be a paragraph combining all key points. ` +
          `The 'bullets' field should be a consolidated list of the most important takeaways from all chunks.\n\n` +
          `Source Bullet Points:\n${combinedBullets}`,
        // 🎯 IMPROVEMENT: Use the Zod schema to enforce structured output
        output: {
          schema: summarizeOutputSchema,
          format: "json",
        },
      });

      if (finalRes && finalRes.output) {
        return finalRes.output;
      } else {
        return {
          title: "Summary unavailable",
          summary: "Unable to generate a valid summary from the transcript.",
          bullets: [],
          warnings: ["Failed to parse final summary output."],
        };
      }
    } catch (error) {
      console.error("Error generating final summary:", error);
      return {
        title: "Summary generation error",
        summary: "An error occurred while generating the summary.",
        bullets: [],
        warnings: ["Exception during final summary generation."],
      };
    }
  }
);

// ---- Express setup ----
const app = express();
app.disable("x-powered-by");
app.use(
  cors({
    origin: [/localhost:\d+$/, /\.web\.app$/, /\.firebaseapp\.com$/],
    methods: ["POST"],
  })
);
app.use(express.json({ limit: "1mb" }));

// optional debugging
app.use((req, _res, next) => {
  console.log("Incoming content-type:", req.headers["content-type"]);
  console.log("Incoming body:", req.body);
  next();
});

// Basic rate limiter
const hits = new Map<string, number[]>();
const WINDOW_MS = 30_000;
const MAX_REQ = 15;

app.use((req, res, next) => {
  const ip = (req.headers["x-forwarded-for"]?.toString().split(",")[0].trim() ||
    req.ip ||
    "unknown") as string;
  const now = Date.now();
  const arr = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  arr.push(now);
  hits.set(ip, arr);
  if (arr.length > MAX_REQ) {
    res.status(429).json({ error: "Too many requests" });
    return;
  }
  next();
  return;
});

// Expose Genkit flow on /api/summarize
app.post("/api/summarize", expressHandler(summarizeYouTube));

// Firebase Function entrypoint
app.listen(8080, () => {
  console.log("Server is running on port 8080");
});
