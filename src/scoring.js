/**
 * src/scoring.js
 * Location-aware job scoring.
 * Tier order: local (user's state) → us_remote → us_national → latam → europe → international
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

const LATAM_KEYWORDS = [
  "mexico","méxico","brazil","brasil","argentina","colombia","chile","peru","perú",
  "uruguay","venezuela","ecuador","bolivia","paraguay","costa rica","panama","panamá",
  "latin america","latinoamérica","latam","central america","south america",
];

const EUROPE_KEYWORDS = [
  "germany","deutschland","france","spain","españa","italy","italia","netherlands",
  "poland","portugal","sweden","norway","denmark","finland","austria","switzerland",
  "belgium","czech","romania","hungary","ukraine","europe","european",
  "uk","united kingdom","england","ireland","berlin","amsterdam","paris","madrid",
  "lisbon","warsaw","prague","budapest","remote - europe","emea",
];

const US_KEYWORDS = [
  "united states","usa","u.s.a","u.s.","us only","america","north america",
];

function normalizeState(str) {
  if (!str) return null;
  const parts = str.split(/[,\s/]+/);
  for (const p of parts) {
    const a = p.trim().toUpperCase();
    if (Object.values(US_STATES).includes(a)) return a;
    if (US_STATES[p.trim().toLowerCase()]) return US_STATES[p.trim().toLowerCase()];
  }
  return null;
}

function detectLocationTier(job, userState) {
  const loc  = (job.location || "").toLowerCase();
  const type = (job.type || "").toLowerCase();
  const desc = (job.description || "").toLowerCase().slice(0, 300);

  const isRemote = type.includes("remote") || loc.includes("remote") || loc === "worldwide" || loc === "anywhere";

  // Check for explicit US mention
  const isUS = US_KEYWORDS.some(k => loc.includes(k)) ||
    (isRemote && (loc.includes("us") || loc.includes("usa") || loc === "worldwide" || loc === "anywhere" || loc === "remote"));

  // Check for LATAM
  const isLatam = LATAM_KEYWORDS.some(k => loc.includes(k));

  // Check for Europe
  const isEurope = EUROPE_KEYWORDS.some(k => loc.includes(k));

  // Check for US state in location string
  const jobState = normalizeState(job.location || "");
  if (userState && jobState && userState === jobState) return "local";

  // Remote with US or worldwide → treat as US remote (most QA remote jobs are open to US)
  if (isRemote && !isLatam && !isEurope) return "us_remote";

  // Explicit US non-remote
  if (isUS && !isLatam && !isEurope) return "us_national";

  if (isLatam) return "latam";
  if (isEurope) return "europe";

  // Unknown — if remote, assume US remote (better UX than hiding it)
  if (isRemote) return "us_remote";

  return "international";
}

function scoreJob(job, profile) {
  const text      = `${job.title} ${job.description} ${(job.tags || []).join(" ")}`.toLowerCase();
  const titleLower = (job.title || "").toLowerCase();

  let score = 0;
  const reasons = [];

  // ── 1. Location tier ──────────────────────────────────────────────────────────
  const userState    = normalizeState(profile.state || profile.preferredLocation || profile.location || "");
  const locationTier = detectLocationTier(job, userState);

  const locPoints = {
    local:         2.0,
    us_remote:     1.8,
    us_national:   1.2,
    latam:         0.6,
    europe:        0.2,
    international: 0.0,
  };
  score += locPoints[locationTier] ?? 0;

  if (locationTier === "local")       reasons.push(`📍 Local — ${userState}`);
  else if (locationTier === "us_remote")  reasons.push("🌐 US Remote");
  else if (locationTier === "us_national") reasons.push("🇺🇸 US-based");
  else if (locationTier === "latam")  reasons.push("🌎 LATAM");
  else if (locationTier === "europe") reasons.push("🇪🇺 Europe");

  // ── 2. Title match (max 2.5 pts) ──────────────────────────────────────────────
  const allTitles = [...(profile.titles || []), ...(profile.targetTitles || [])];

  // Also match common QA synonyms even if not in profile
  const qaKeywords = ["qa","qe","sdet","quality assurance","quality engineer",
    "test engineer","automation engineer","test analyst","qa analyst",
    "software tester","software test","manual test","qa lead","qa manager"];

  const titleMatches = allTitles.filter(k => k && titleLower.includes(k.toLowerCase()));
  const qaMatch      = qaKeywords.some(k => titleLower.includes(k));

  if (titleMatches.length >= 2)      { score += 2.5; reasons.push(`Title: ${titleMatches[0]}`); }
  else if (titleMatches.length === 1) { score += 1.5; reasons.push(`Title: ${titleMatches[0]}`); }
  else if (qaMatch)                   { score += 1.0; reasons.push("QA role"); }

  // ── 3. Skills match (max 2 pts) ───────────────────────────────────────────────
  const skills = (profile.skills || []).filter(s => s && s.length > 1);
  const sHits  = skills.filter(s => text.includes(s.toLowerCase()));

  // Also check common QA skills explicitly
  const qaSkills = ["selenium","cypress","postman","rest api","api testing","jira",
    "testrail","sql","manual testing","automation","appium","playwright",
    "cucumber","bdd","agile","scrum","browserstack","xcuitest","maestro"];
  const qaSkillHits = qaSkills.filter(s => text.includes(s));

  const totalSkillHits = [...new Set([...sHits.map(s => s.toLowerCase()), ...qaSkillHits])];
  const skillPts = Math.min(totalSkillHits.length * 0.4, 2);
  if (skillPts > 0) {
    score += skillPts;
    reasons.push(`Skills: ${totalSkillHits.slice(0, 3).join(", ")}`);
  }

  // ── 4. Seniority match (+0.5) ─────────────────────────────────────────────────
  const yrs = parseInt(profile.experienceYears) || 0;
  const seniority = (profile.seniority || "").toLowerCase();
  if (yrs >= 7 || seniority.includes("senior") || seniority.includes("lead")) {
    if (text.includes("senior") || text.includes("lead") || text.includes("sr.") || text.includes("staff")) score += 0.5;
  } else if (yrs >= 3) {
    if (text.includes("mid") || text.includes("intermediate") || (!text.includes("junior") && !text.includes("senior"))) score += 0.3;
  } else {
    if (text.includes("junior") || text.includes("entry") || text.includes("associate")) score += 0.5;
  }

  // ── 5. Industry match (+0.5) ──────────────────────────────────────────────────
  if ((profile.industries || []).some(i => i && text.includes(i.toLowerCase()))) {
    score += 0.5;
    reasons.push("Industry match");
  }

  // ── 6. Work preference bonus (+0.3) ───────────────────────────────────────────
  const pref    = (profile.workPreference || "").toLowerCase();
  const jobType = (job.type || "").toLowerCase();
  if (pref.includes("remote")  && (jobType.includes("remote") || locationTier === "us_remote")) score += 0.3;
  if (pref.includes("hybrid")  && jobType.includes("hybrid")) score += 0.3;

  // ── 7. Domain relevance check (penalty if no QA signal at all) ────────────────
  const domainWords = ["qa","quality","test","sdet","automation","assurance","tester"];
  const hasDomain   = domainWords.some(w => text.includes(w));
  if (!hasDomain) score = Math.max(score - 2, 0);

  return {
    stars: Math.round(Math.min(Math.max(score, 0), 5)),
    reasons: reasons.slice(0, 3),
    locationTier,
  };
}

module.exports = { scoreJob, normalizeState, detectLocationTier };
