/**
 * netlify/functions/jobs.js
 * POST /api/jobs
 * Scrapes job sources, scores results, returns them + triggers email.
 * Returns detailed error info so frontend can show what happened.
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

    console.log("📋 Profile state:", finalProfile.state);
    console.log("📋 Profile titles:", finalProfile.titles);
    console.log("📋 Profile skills:", (finalProfile.skills || []).slice(0, 5));

    // Scrape with full source diagnostics
    const { jobs, sourceDiagnostics } = await scrapeForProfile(finalProfile);

    console.log("📊 Source results:", JSON.stringify(sourceDiagnostics));
    console.log("✅ Total jobs after scoring:", jobs.length);

    // Fire email async if provided
    if (email && process.env.RESEND_API_KEY && jobs.length > 0) {
      const baseUrl = process.env.URL || process.env.DEPLOY_URL || "";
      fetch(`${baseUrl}/.netlify/functions/send-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile: finalProfile, jobs, email }),
      }).catch(e => console.error("email error:", e.message));
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        jobs,
        profile: finalProfile,
        total: jobs.length,
        sourceDiagnostics,
        generated: new Date().toISOString(),
      }),
    };
  } catch (err) {
    console.error("jobs function error:", err.message, err.stack);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message || "Failed to fetch jobs" }),
    };
  }
};
