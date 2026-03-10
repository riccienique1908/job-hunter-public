/**
 * src/emailBuilder.js
 * Builds the HTML email digest sent to users after job results load.
 */

function stars(n) {
  return "★".repeat(n) + "☆".repeat(5 - n);
}

function matchLabel(n) {
  return { 5:"Perfect Match",4:"Strong Match",3:"Good Match",2:"Partial Match",1:"Low Match" }[n] || "Match";
}

function matchColors(n) {
  return {
    5: { bg:"#dcfce7", color:"#15803d" },
    4: { bg:"#d1fae5", color:"#065f46" },
    3: { bg:"#fef9c3", color:"#854d0e" },
    2: { bg:"#ffedd5", color:"#9a3412" },
    1: { bg:"#fee2e2", color:"#991b1b" },
  }[n] || { bg:"#f3f4f6", color:"#374151" };
}

function tierLabel(tier) {
  return { local:"📍 Local", remote:"🌐 Remote", national:"🇺🇸 National", international:"🌍 International" }[tier] || "";
}

function fmtDate(str) {
  try {
    return new Date(str).toLocaleDateString("en-US", { month:"short", day:"numeric", year:"numeric" });
  } catch { return "Recent"; }
}

const SOURCE_COLORS = {
  "LinkedIn":"#0077b5","Indeed":"#003A9B","Remotive":"#6366f1",
  "The Muse":"#ef4444","Arbeitnow":"#10b981","RemoteOK":"#1a1a2e",
  "WeWorkRemotely":"#4a90d9","ZipRecruiter":"#00b140",
};

function jobCard(job) {
  const s = job.score?.stars ?? 0;
  const mc = matchColors(s);
  const srcColor = SOURCE_COLORS[job.source] || "#6b7280";
  const tier = tierLabel(job.score?.locationTier);
  const reasons = (job.score?.reasons || []).join(" · ");

  return `
  <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:14px;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;background:#fff;">
    <tr><td style="padding:18px 20px;">
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td>
            <p style="margin:0 0 3px;font-size:15px;font-weight:700;color:#111827;">${job.title}</p>
            <p style="margin:0 0 10px;font-size:12px;color:#6b7280;">${job.company || ""}${job.location ? " · 📍 " + job.location : ""}</p>
          </td>
          <td valign="top" align="right" style="padding-left:10px;white-space:nowrap;">
            <span style="background:${mc.bg};color:${mc.color};padding:3px 9px;border-radius:20px;font-size:10px;font-weight:700;text-transform:uppercase;">${matchLabel(s)}</span>
          </td>
        </tr>
      </table>
      <table cellpadding="0" cellspacing="0" style="margin-bottom:10px;">
        <tr>
          <td>
            ${tier ? `<span style="background:#dbeafe;color:#1d4ed8;padding:2px 7px;border-radius:5px;font-size:11px;font-weight:600;margin-right:5px;">${tier}</span>` : ""}
            <span style="background:${srcColor}22;color:${srcColor};padding:2px 7px;border-radius:5px;font-size:11px;font-weight:600;">${job.source}</span>
            <span style="color:#9ca3af;font-size:11px;margin-left:8px;">${fmtDate(job.posted)}</span>
          </td>
        </tr>
      </table>
      <p style="margin:0 0 4px;font-size:16px;letter-spacing:2px;color:${s >= 3 ? "#eab308" : "#d1d5db"};">${stars(s)}</p>
      ${reasons ? `<p style="margin:0 0 10px;font-size:11px;color:#9ca3af;font-style:italic;">${reasons}</p>` : ""}
      <p style="margin:0 0 14px;font-size:13px;color:#4b5563;line-height:1.6;">${(job.description || "").slice(0, 280)}…</p>
      <a href="${job.url || "#"}" style="display:inline-block;background:#1d4ed8;color:#fff;text-decoration:none;padding:8px 18px;border-radius:8px;font-size:13px;font-weight:600;">View Job →</a>
    </td></tr>
  </table>`;
}

function buildUserEmail({ profile, jobs, landingUrl }) {
  const now = new Date();
  const dateStr = now.toLocaleDateString("en-US", { month:"2-digit", day:"2-digit", year:"2-digit" });
  const subject = `Jobs curated list ${dateStr}`;

  const top     = jobs.filter(j => j.score?.stars >= 4).slice(0, 8);
  const good    = jobs.filter(j => j.score?.stars === 3).slice(0, 6);
  const others  = jobs.filter(j => j.score?.stars <= 2).slice(0, 4);
  const shown   = [...top, ...good, ...others];
  const hidden  = Math.max(0, jobs.length - shown.length);

  const section = (emoji, label, items) => {
    if (!items.length) return "";
    return `
    <tr><td style="padding:20px 28px 6px;">
      <p style="margin:0;font-size:12px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:1px;">${emoji} ${label} (${items.length})</p>
      <hr style="margin:8px 0 14px;border:none;border-top:1px solid #f3f4f6;">
    </td></tr>
    <tr><td style="padding:0 28px;">${items.map(jobCard).join("")}</td></tr>`;
  };

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:'Segoe UI',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:28px 0;">
<tr><td align="center">
<table width="620" cellpadding="0" cellspacing="0" style="max-width:620px;width:100%;">

  <!-- Header -->
  <tr><td style="background:linear-gradient(135deg,#1e3a8a,#2563eb);border-radius:14px 14px 0 0;padding:28px 32px 24px;">
    <p style="margin:0 0 3px;font-size:12px;color:#93c5fd;letter-spacing:2px;font-weight:600;text-transform:uppercase;">Your Job Digest</p>
    <h1 style="margin:0 0 5px;font-size:24px;font-weight:800;color:#fff;">🎯 Jobs curated list ${dateStr}</h1>
    <p style="margin:0;font-size:13px;color:#bfdbfe;">Hi ${profile.name || "there"} · ${profile.titles?.[0] || "QA Engineer"} · ${profile.preferredLocation || profile.state || "US"}</p>
  </td></tr>

  <!-- Stats -->
  <tr><td style="background:#1e40af;padding:10px 32px;">
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td align="center" style="color:#93c5fd;font-size:11px;"><strong style="color:#fff;font-size:18px;">${jobs.length}</strong><br>Found</td>
        <td align="center" style="color:#93c5fd;font-size:11px;border-left:1px solid rgba(255,255,255,.15);border-right:1px solid rgba(255,255,255,.15);">
          <strong style="color:#22c55e;font-size:18px;">${top.length}</strong><br>Top Matches
        </td>
        <td align="center" style="color:#93c5fd;font-size:11px;border-right:1px solid rgba(255,255,255,.15);">
          <strong style="color:#fff;font-size:18px;">${jobs.filter(j=>(j.score?.locationTier)==="local").length}</strong><br>Local
        </td>
        <td align="center" style="color:#93c5fd;font-size:11px;">
          <strong style="color:#fff;font-size:18px;">${jobs.filter(j=>(j.type||"").toLowerCase().includes("remote")).length}</strong><br>Remote
        </td>
      </tr>
    </table>
  </td></tr>

  <!-- Profile strip -->
  <tr><td style="background:#fff;padding:14px 28px;border-top:3px solid #2563eb;">
    <p style="margin:0;font-size:12px;color:#1d4ed8;background:#eff6ff;border-radius:8px;padding:9px 14px;">
      <strong>Matched for:</strong> ${profile.titles?.[0] || "QA Engineer"} · ${profile.experienceYears || "?"}+ yrs · ${(profile.skills || []).slice(0,5).join(" · ")}
    </p>
  </td></tr>

  <!-- Job sections -->
  <tr><td style="background:#fff;padding-bottom:20px;">
    <table width="100%" cellpadding="0" cellspacing="0">
      ${section("🌟","Perfect & Strong Matches", top)}
      ${section("👍","Good Matches", good)}
      ${section("📋","Other Listings", others)}
    </table>
  </td></tr>

  <!-- See all CTA -->
  ${hidden > 0 && landingUrl ? `
  <tr><td style="background:#fff;padding:0 28px 28px;">
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr><td style="background:linear-gradient(135deg,#eff6ff,#dbeafe);border:1px solid #bfdbfe;border-radius:12px;padding:18px 20px;text-align:center;">
        <p style="margin:0 0 5px;font-size:15px;font-weight:700;color:#1e3a8a;">${hidden} more jobs found</p>
        <p style="margin:0 0 14px;font-size:13px;color:#3b82f6;">This email shows your top ${shown.length} picks. See the full list with filters.</p>
        <a href="${landingUrl}" style="display:inline-block;background:linear-gradient(135deg,#1d4ed8,#2563eb);color:#fff;text-decoration:none;padding:11px 26px;border-radius:9px;font-size:14px;font-weight:700;">
          See All ${jobs.length} Jobs →
        </a>
      </td></tr>
    </table>
  </td></tr>` : ""}

  <!-- Footer -->
  <tr><td style="padding:20px 0;text-align:center;">
    <p style="margin:0 0 5px;font-size:12px;color:#9ca3af;">Sent by <strong>Job Hunter Bot</strong> · Powered by Google Gemini AI</p>
    <p style="margin:0;font-size:11px;color:#d1d5db;">Sources: Remotive · The Muse · Arbeitnow · Indeed · RemoteOK · WeWorkRemotely</p>
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;

  return { subject, html };
}

module.exports = { buildUserEmail };
