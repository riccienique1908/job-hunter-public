/**
 * netlify/functions/analyze.js
 * POST /api/analyze
 * Accepts multipart resume upload, extracts text, calls Gemini to parse
 * profile AND generate questions in ONE single API call to minimize quota usage.
 *
 * Model: gemini-2.5-flash-lite-preview-06-17
 * Free tier: 15 RPM, 1,000 requests/day — highest free quota available (Mar 2026)
 */

const { GoogleGenerativeAI } = require("@google/generative-ai");

// gemini-2.5-flash-lite has the most generous free tier (1,000 req/day)
const GEMINI_MODEL = "gemini-2.5-flash-lite-preview-06-17";

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };

  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY not configured");

    // ── Parse multipart body ───────────────────────────────────────────────────
    const body = event.isBase64Encoded
      ? Buffer.from(event.body, "base64")
      : Buffer.from(event.body || "", "utf8");

    const contentType = event.headers["content-type"] || event.headers["Content-Type"] || "";
    const boundary = contentType.split("boundary=")[1]?.trim();

    let resumeText = "";
    let fileName   = "";

    if (boundary) {
      const parts = splitMultipart(body, boundary);
      for (const part of parts) {
        const dispMatch = part.header.match(/filename="([^"]+)"/i);
        if (dispMatch) {
          fileName = dispMatch[1];
          if (fileName.match(/\.pdf$/i)) {
            try {
              const pdfParse = require("pdf-parse");
              const result   = await pdfParse(part.data);
              resumeText = result.text;
            } catch (e) {
              throw new Error("Could not parse PDF: " + e.message);
            }
          } else {
            resumeText = part.data.toString("utf8");
          }
        }
      }
    } else {
      resumeText = body.toString("utf8");
    }

    if (!resumeText || resumeText.trim().length < 40) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "Could not extract text from the uploaded file. Please try a text-based PDF." }),
      };
    }

    // ── Single Gemini call — profile + questions together ──────────────────────
    // Combining both into ONE call cuts quota usage by 50%
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: GEMINI_MODEL });

    const prompt = `You are a resume parser and job search assistant. Read this resume carefully, then return ONLY valid JSON with NO markdown, NO code fences, NO explanation — just the raw JSON object.

Return this exact structure:
{
  "profile": {
    "name": "full name",
    "email": "email if present, else null",
    "location": "city/state/country as written in resume",
    "state": "US state name or 2-letter abbreviation if US-based, else null",
    "country": "country name, default US",
    "titles": ["current and recent job titles, max 3"],
    "targetTitles": ["most likely job titles they would search for, max 5"],
    "skills": ["technical skills, tools, platforms, max 20 most impactful"],
    "experienceYears": <number>,
    "industries": ["industries worked in, max 5"],
    "workPreference": "Remote or Hybrid or On-site or Any",
    "languages": ["Language - Level, e.g. English - Native"],
    "education": ["Degree - Institution - Year, max 3"],
    "summary": "2-sentence professional summary based on resume",
    "strengths": ["3-5 key professional strengths as short phrases"]
  },
  "questions": [
    {
      "id": "q1",
      "question": "What is your preferred work arrangement?",
      "type": "single",
      "options": ["Remote", "Hybrid", "On-site", "Open to any"]
    },
    {
      "id": "q2",
      "question": "Which job titles are you targeting? (select all that apply)",
      "type": "multi",
      "options": ["<title from resume>", "<title from resume>", "<related title>", "<related title>", "<related title>"]
    },
    {
      "id": "q3",
      "question": "Which US state do you want to prioritize for local jobs?",
      "type": "text",
      "options": []
    },
    {
      "id": "q4",
      "question": "What seniority level are you targeting?",
      "type": "single",
      "options": ["Junior (0-2 yrs)", "Mid-level (3-5 yrs)", "Senior (6-9 yrs)", "Lead / Staff (10+ yrs)"]
    },
    {
      "id": "q5",
      "question": "Which industries do you prefer? (select all that apply)",
      "type": "multi",
      "options": ["<industry from resume>", "<industry from resume>", "Fintech", "Healthtech", "E-commerce", "SaaS / Enterprise software", "Gaming", "Open to any"]
    }
  ]
}

Important for questions:
- q2 options: use real titles from their resume + 2-3 closely related ones
- q5 options: include industries from resume + realistic alternatives
- Keep all options short (1-5 words each)
- q3 is always a text input (options stays empty array)

Resume to parse:
${resumeText.slice(0, 5000)}`;

    const result = await model.generateContent(prompt);
    const raw    = result.response.text().replace(/```json\n?|\n?```/g, "").trim();

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      // Sometimes model wraps in extra text — try to extract JSON object
      const match = raw.match(/\{[\s\S]*\}/);
      if (!match) throw new Error("Gemini returned invalid JSON. Please try again.");
      parsed = JSON.parse(match[0]);
    }

    const { profile, questions } = parsed;
    if (!profile || !questions) throw new Error("Incomplete response from AI. Please try again.");

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ profile, questions }),
    };

  } catch (err) {
    console.error("analyze error:", err.message);

    // Surface quota errors clearly to the user
    const isQuota = err.message?.includes("429") || err.message?.includes("quota");
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: isQuota
          ? "AI service is temporarily rate-limited. Please wait 60 seconds and try again."
          : (err.message || "Analysis failed"),
      }),
    };
  }
};

// ── Minimal multipart parser ───────────────────────────────────────────────────
function splitMultipart(buffer, boundary) {
  const sep   = Buffer.from("--" + boundary);
  const parts = [];
  let start   = 0;

  while (start < buffer.length) {
    const idx = buffer.indexOf(sep, start);
    if (idx === -1) break;
    const end = buffer.indexOf(sep, idx + sep.length);
    if (end === -1) break;

    const partBuf  = buffer.slice(idx + sep.length + 2, end - 2);
    const headerEnd = partBuf.indexOf("\r\n\r\n");
    if (headerEnd === -1) { start = end; continue; }

    const header = partBuf.slice(0, headerEnd).toString("utf8");
    const data   = partBuf.slice(headerEnd + 4);
    parts.push({ header, data });
    start = end;
  }
  return parts;
}
