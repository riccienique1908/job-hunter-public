/**
 * netlify/functions/jobs.js
 * POST /api/jobs
 * Accepts { profile, answers, email }
 * Returns scored, location-ordered job list.
 * Also fires the send-email function async if email is provided.
 */

const { scrapeForProfile } = require("../../src/scraper");
const { mergeAnswers }     = require("../../src/mergeAnswers");

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
    const { profile, answers, email } = JSON.parse(event.body || "{}");
    if (!profile) return { statusCode: 400, headers, body: JSON.stringify({ error: "profile required" }) };

    const finalProfile = answers ? mergeAnswers(profile, answers) : profile;

    // Scrape all sources
    const jobs = await scrapeForProfile(finalProfile);

    // Fire email async — don't wait for it to not block the response
    if (email && process.env.RESEND_API_KEY) {
      const baseUrl = process.env.URL || process.env.DEPLOY_URL || "";
      fetch(`${baseUrl}/.netlify/functions/send-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile: finalProfile, jobs, email }),
      }).catch(e => console.error("email fire failed:", e.message));
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ jobs, profile: finalProfile, total: jobs.length, generated: new Date().toISOString() }),
    };
  } catch (err) {
    console.error("jobs error:", err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message || "Failed to fetch jobs" }) };
  }
};
