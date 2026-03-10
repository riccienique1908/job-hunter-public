/**
 * netlify/functions/analyze.js
 * POST /api/analyze
 * Uses Anthropic Claude API (same key as AgentOS project).
 * Model: claude-haiku-4-5-20251001 — fastest and cheapest Claude model.
 */

const https = require("https");

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers, body: "" };
  if (event.httpMethod !== "POST")    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };

  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");

    // ── Parse multipart body ───────────────────────────────────────────────────
    const body = event.isBase64Encoded
      ? Buffer.from(event.body, "base64")
      : Buffer.from(event.body || "", "utf8");

    const contentType = event.headers["content-type"] || event.headers["Content-Type"] || "";
    const boundary = contentType.split("boundary=")[1]?.trim();

    let resumeText = "";

    if (boundary) {
      const parts = splitMultipart(body, boundary);
      for (const part of parts) {
        const dispMatch = part.header.match(/filename="([^"]+)"/i);
        if (dispMatch) {
          const fileName = dispMatch[1];
          if (fileName.match(/\.pdf$/i)) {
            try {
              const pdfParse = require("pdf-parse");
              resumeText = (await pdfParse(part.data)).text;
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
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Could not extract text from the file. Please try a text-based PDF." }) };
    }

    // ── Call Claude — profile + questions in one request ───────────────────────
    const prompt = `You are a resume parser. Read this resume and return ONLY a valid JSON object — no markdown, no explanation, no code fences.

Return exactly this structure:
{
  "profile": {
    "name": "full name",
    "email": "email or null",
    "location": "city/state as written",
    "state": "2-letter US state code or null",
    "country": "country, default US",
    "titles": ["job titles from resume, max 3"],
    "targetTitles": ["job titles they would search for, max 5"],
    "skills": ["technical skills and tools, max 20"],
    "experienceYears": 0,
    "industries": ["industries worked in, max 5"],
    "workPreference": "Remote or Hybrid or On-site or Any",
    "languages": ["Language - Level"],
    "education": ["Degree - School - Year, max 3"],
    "summary": "2-sentence professional summary",
    "strengths": ["3-5 strengths as short phrases"]
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
      "question": "Which job titles are you targeting?",
      "type": "multi",
      "options": ["PUT REAL TITLES FROM RESUME HERE", "AND RELATED TITLES HERE"]
    },
    {
      "id": "q3",
      "question": "Which US state should we prioritize for local jobs?",
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
      "question": "Which industries do you prefer?",
      "type": "multi",
      "options": ["PUT REAL INDUSTRIES FROM RESUME HERE", "Fintech", "Healthtech", "E-commerce", "SaaS", "Open to any"]
    }
  ]
}

For q2: replace the placeholder options with real titles from the resume plus 2-3 related ones.
For q5: replace the placeholder with real industries from the resume plus alternatives.
Return ONLY the JSON object.

Resume:
${resumeText.slice(0, 6000)}`;

    const responseText = await callClaude(apiKey, prompt);
    const clean = responseText.replace(/```json\n?|\n?```/g, "").trim();

    let parsed;
    try {
      parsed = JSON.parse(clean);
    } catch (e) {
      const match = clean.match(/\{[\s\S]*\}/);
      if (!match) throw new Error("AI returned unexpected format. Please try again.");
      parsed = JSON.parse(match[0]);
    }

    if (!parsed.profile || !parsed.questions) {
      throw new Error("Incomplete AI response. Please try again.");
    }

    return { statusCode: 200, headers, body: JSON.stringify(parsed) };

  } catch (err) {
    console.error("analyze error:", err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message || "Analysis failed" }) };
  }
};

// ── Claude API call ────────────────────────────────────────────────────────────
function callClaude(apiKey, prompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 2000,
      messages: [{ role: "user", content: prompt }],
    });

    const req = https.request({
      hostname: "api.anthropic.com",
      path: "/v1/messages",
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
      },
      timeout: 30000,
    }, (res) => {
      let data = "";
      res.on("data", c => (data += c));
      res.on("end", () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          const parsed = JSON.parse(data);
          resolve(parsed.content?.[0]?.text || "");
        } else {
          reject(new Error(`Claude API error ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("Request timed out")); });
    req.write(body);
    req.end();
  });
}

// ── Multipart parser ───────────────────────────────────────────────────────────
function splitMultipart(buffer, boundary) {
  const sep = Buffer.from("--" + boundary);
  const parts = [];
  let start = 0;

  while (start < buffer.length) {
    const idx = buffer.indexOf(sep, start);
    if (idx === -1) break;
    const end = buffer.indexOf(sep, idx + sep.length);
    if (end === -1) break;

    const partBuf = buffer.slice(idx + sep.length + 2, end - 2);
    const headerEnd = partBuf.indexOf("\r\n\r\n");
    if (headerEnd === -1) { start = end; continue; }

    parts.push({
      header: partBuf.slice(0, headerEnd).toString("utf8"),
      data: partBuf.slice(headerEnd + 4),
    });
    start = end;
  }
  return parts;
}
