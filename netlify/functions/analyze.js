/**
 * netlify/functions/analyze.js
 * POST /api/analyze
 * Accepts multipart resume upload, extracts text, calls Gemini to parse profile,
 * then generates clarifying questions.
 *
 * Free tier: Google Gemini 1.5 Flash — 15 req/min, 1 million tokens/day, no credit card.
 */

const { GoogleGenerativeAI } = require("@google/generative-ai");

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

    // ── Parse multipart body ──────────────────────────────────────────────────
    // Netlify passes body as base64 when isBase64Encoded=true
    const body = event.isBase64Encoded
      ? Buffer.from(event.body, "base64")
      : Buffer.from(event.body || "", "utf8");

    const contentType = event.headers["content-type"] || event.headers["Content-Type"] || "";
    const boundary = contentType.split("boundary=")[1]?.trim();

    let resumeText = "";
    let fileName   = "";

    if (boundary) {
      // Manual multipart parsing (no multer in Netlify functions)
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
      // Plain text body fallback
      resumeText = body.toString("utf8");
    }

    if (!resumeText || resumeText.trim().length < 40) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Could not extract text from the uploaded file. Please try a text-based PDF." }) };
    }

    // ── Call Gemini ────────────────────────────────────────────────────────────
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    const profilePrompt = `You are a precise resume parser. Extract structured data from this resume and return ONLY valid JSON (no markdown, no code fences, no explanation).

Return exactly this structure:
{
  "name": "full name",
  "email": "email if present, else null",
  "location": "city/state/country as written in resume",
  "state": "US state name or 2-letter code if US-based, else null",
  "country": "country name, default US",
  "titles": ["current and recent job titles, max 3"],
  "targetTitles": ["most likely job titles they'd search for, max 5"],
  "skills": ["technical skills, tools, platforms — max 20 most impactful"],
  "experienceYears": <number>,
  "industries": ["industries worked in, max 5"],
  "workPreference": "Remote or Hybrid or On-site or Any",
  "languages": ["Language — Level, e.g. English — Native"],
  "education": ["Degree — Institution — Year, max 3"],
  "summary": "2-sentence professional summary",
  "strengths": ["3-5 key professional strengths as short phrases"]
}

Resume:
${resumeText.slice(0, 5000)}`;

    const profileResult = await model.generateContent(profilePrompt);
    const profileRaw    = profileResult.response.text().replace(/```json\n?|\n?```/g, "").trim();
    const profile       = JSON.parse(profileRaw);

    // ── Generate questions based on extracted profile ──────────────────────────
    const questionsPrompt = `Based on this candidate profile, generate exactly 5 clarifying questions to improve job matching accuracy. Return ONLY valid JSON (no markdown, no explanation).

Candidate:
- Name: ${profile.name}
- Titles: ${(profile.titles || []).join(", ")}
- Location: ${profile.location} (State: ${profile.state || "unknown"})
- Experience: ${profile.experienceYears} years
- Skills: ${(profile.skills || []).slice(0, 8).join(", ")}
- Work preference detected: ${profile.workPreference}

Return:
{
  "questions": [
    {
      "id": "q1",
      "question": "question text",
      "type": "single" | "multi" | "text",
      "options": ["option1", "option2", "option3"]
    }
  ]
}

Cover these topics in order:
1. Confirm or refine their preferred work type (Remote / Hybrid / On-site)
2. Confirm their target job titles (show 4-5 realistic options based on resume)
3. Preferred US state or city for local jobs
4. Preferred seniority level for job postings
5. Priority industries (show 5-6 realistic options)

Keep option lists short (3-5 items). Be specific to this person's background.`;

    const qResult  = await model.generateContent(questionsPrompt);
    const qRaw     = qResult.response.text().replace(/```json\n?|\n?```/g, "").trim();
    const { questions } = JSON.parse(qRaw);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ profile, questions: questions || [] }),
    };

  } catch (err) {
    console.error("analyze error:", err.message);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message || "Analysis failed" }),
    };
  }
};

// ── Minimal multipart parser ────────────────────────────────────────────────
function splitMultipart(buffer, boundary) {
  const sep   = Buffer.from("--" + boundary);
  const parts = [];
  let start   = 0;

  while (start < buffer.length) {
    const idx = buffer.indexOf(sep, start);
    if (idx === -1) break;
    const end = buffer.indexOf(sep, idx + sep.length);
    if (end === -1) break;

    const partBuf = buffer.slice(idx + sep.length + 2, end - 2); // skip \r\n
    const headerEnd = partBuf.indexOf("\r\n\r\n");
    if (headerEnd === -1) { start = end; continue; }

    const header = partBuf.slice(0, headerEnd).toString("utf8");
    const data   = partBuf.slice(headerEnd + 4);
    parts.push({ header, data });
    start = end;
  }
  return parts;
}
