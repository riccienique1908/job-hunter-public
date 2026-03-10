/**
 * src/scoring.js
 * Location-aware job scoring against a user's extracted profile.
 * Tier order: local state → remote → national US → international
 */

const US_STATES = {
  "alabama":"AL","alaska":"AK","arizona":"AZ","arkansas":"AR","california":"CA",
  "colorado":"CO","connecticut":"CT","delaware":"DE","florida":"FL","georgia":"GA",
  "hawaii":"HI","idaho":"ID","illinois":"IL","indiana":"IN","iowa":"IA",
  "kansas":"KS","kentucky":"KY","louisiana":"LA","maine":"ME","maryland":"MD",
  "massachusetts":"MA","michigan":"MI","minnesota":"MN","mississippi":"MS",
  "missouri":"MO","montana":"MT","nebraska":"NE","nevada":"NV","new hampshire":"NH",
  "new jersey":"NJ","new mexico":"NM","new york":"NY","north carolina":"NC",
  "north dakota":"ND","ohio":"OH","oklahoma":"OK","oregon":"OR","pennsylvania":"PA",
  "rhode island":"RI","south carolina":"SC","south dakota":"SD","tennessee":"TN",
  "texas":"TX","utah":"UT","vermont":"VT","virginia":"VA","washington":"WA",
  "west virginia":"WV","wisconsin":"WI","wyoming":"WY",
};

function normalizeState(str) {
  if (!str) return null;
  const s = str.toLowerCase().trim();
  if (US_STATES[s]) return US_STATES[s];
  const abbr = s.toUpperCase();
  if (Object.values(US_STATES).includes(abbr)) return abbr;
  // Handle "Downers Grove, IL" style
  const parts = str.split(/[,\s]+/);
  for (const p of parts) {
    const a = p.trim().toUpperCase();
    if (Object.values(US_STATES).includes(a)) return a;
    if (US_STATES[p.trim().toLowerCase()]) return US_STATES[p.trim().toLowerCase()];
  }
  return null;
}

function scoreJob(job, profile) {
  const text = `${job.title} ${job.description} ${(job.tags || []).join(" ")}`.toLowerCase();
  const titleLower = (job.title || "").toLowerCase();
  const jobType = (job.type || "").toLowerCase();
  const jobLoc  = (job.location || "").toLowerCase();
  const isRemote = jobType.includes("remote") || jobLoc.includes("remote");

  let score = 0;
  const reasons = [];

  // ── 1. Location (max 2 pts) ────────────────────────────────────────────────
  const userState = normalizeState(profile.state || profile.location || "");
  const jobState  = normalizeState(job.location || "");
  let locationTier = "international";

  if (isRemote) {
    locationTier = "remote";
    score += 1.5;
    reasons.push("Remote");
  } else if (userState && jobState && userState === jobState) {
    locationTier = "local";
    score += 2;
    reasons.push(`Local — ${userState}`);
  } else if (
    jobLoc.includes("united states") || jobLoc.includes("usa") ||
    jobLoc.includes(" us ") || /\b[A-Z]{2}\b/.test(job.location || "")
  ) {
    locationTier = "national";
    score += 0.8;
    reasons.push("US-based");
  }

  // ── 2. Title match (max 2 pts) ─────────────────────────────────────────────
  const allTitles = [...(profile.titles || []), ...(profile.targetTitles || [])];
  const tMatches  = allTitles.filter(k => titleLower.includes(k.toLowerCase()));
  if (tMatches.length >= 2) { score += 2; reasons.push(`Title: ${tMatches[0]}`); }
  else if (tMatches.length === 1) { score += 1.2; reasons.push(`Title: ${tMatches[0]}`); }

  // ── 3. Skills match (max 2 pts) ────────────────────────────────────────────
  const skills  = profile.skills || [];
  const sHits   = skills.filter(s => text.includes(s.toLowerCase()));
  const skillPts = Math.min(Math.floor(sHits.length / 2), 2);
  if (skillPts > 0) {
    score += skillPts;
    reasons.push(`Skills: ${sHits.slice(0, 3).join(", ")}`);
  }

  // ── 4. Seniority (+0.5) ───────────────────────────────────────────────────
  const yrs = parseInt(profile.experienceYears) || 0;
  if (yrs >= 7 && (text.includes("senior") || text.includes("lead") || text.includes("sr."))) score += 0.5;
  else if (yrs >= 3 && yrs < 7 && text.includes("mid")) score += 0.5;
  else if (yrs < 3 && (text.includes("junior") || text.includes("entry"))) score += 0.5;

  // ── 5. Industry (+0.5) ────────────────────────────────────────────────────
  if ((profile.industries || []).some(i => text.includes(i.toLowerCase()))) {
    score += 0.5;
    reasons.push("Industry match");
  }

  // ── 6. Work preference bonus (+0.5) ──────────────────────────────────────
  const pref = (profile.workPreference || "").toLowerCase();
  if (pref.includes("remote") && isRemote) score += 0.5;
  if (pref.includes("hybrid") && jobType.includes("hybrid")) score += 0.5;

  // ── 7. Domain penalty ────────────────────────────────────────────────────
  const hasDomain = ["qa","quality","test","sdet","automation"].some(w => text.includes(w));
  if (!hasDomain) score = Math.max(score - 1.5, 0);

  return {
    stars: Math.round(Math.min(Math.max(score, 0), 5)),
    reasons: reasons.slice(0, 3),
    locationTier,
  };
}

module.exports = { scoreJob, normalizeState };
