/**
 * netlify/functions/send-email.js
 * POST /api/send-email
 * Sends the job digest email to the user via Resend.
 */

const https = require("https");
const { buildUserEmail } = require("../../src/emailBuilder");

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
  };

  if (event.httpMethod !== "POST") return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };

  try {
    const { profile, jobs, email } = JSON.parse(event.body || "{}");
    if (!email) return { statusCode: 400, headers, body: JSON.stringify({ error: "email required" }) };

    const landingUrl = process.env.URL || process.env.DEPLOY_URL || "";
    const { subject, html } = buildUserEmail({ profile, jobs, landingUrl });

    await sendResend({ to: email, subject, html });

    return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
  } catch (err) {
    console.error("send-email error:", err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};

function sendResend({ to, subject, html }) {
  return new Promise((resolve, reject) => {
    const apiKey = process.env.RESEND_API_KEY;
    const from   = process.env.FROM_EMAIL || "Job Hunter <onboarding@resend.dev>";
    const body   = JSON.stringify({ from, to: [to], subject, html });

    const req = https.request({
      hostname: "api.resend.com",
      path: "/emails",
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
      },
      timeout: 15000,
    }, res => {
      let d = "";
      res.on("data", c => (d += c));
      res.on("end", () => {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(JSON.parse(d));
        else reject(new Error(`Resend ${res.statusCode}: ${d}`));
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}
