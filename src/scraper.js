/**
 * src/scraper.js
 * Multi-source job scraper — US-first, then LATAM, then Europe.
 *
 * Sources:
 *  - Remotive API        (US + worldwide remote QA jobs)
 *  - RemoteOK RSS        (US-leaning remote tech jobs)
 *  - WeWorkRemotely RSS  (US-leaning remote jobs)
 *  - Jobicy API          (global remote, filter to QA)
 *  - The Muse API        (US company jobs)
 *  - Himalayas API       (global remote QA, free)
 *  - Arbeitnow API       (global, kept but de-prioritized by scoring)
 */

const https = require("https");
const http  = require("http");
const { XMLParser } = require("fast-xml-parser");
const { scoreJob }  = require("./scoring");

// ── HTTP fetch ────────────────────────────────────────────────────────────────
function fetchUrl(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https") ? https : http;
    const req = lib.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; JobHunterBot/1.0)",
        Accept: "application/json, text/xml, */*",
        ...opts.headers,
      },
      timeout: 15000,
    }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchUrl(res.headers.location, opts).then(resolve).catch(reject);
      }
      let d = "";
      res.on("data", c => (d += c));
      res.on("end", () => resolve({ status: res.statusCode, body: d }));
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
  });
}

// ── Remotive API ──────────────────────────────────────────────────────────────
// Strong US remote focus. Search multiple QA terms.
async function fetchRemotive(profile) {
  const jobs = [];
  const terms = buildTerms(profile);
  for (const t of terms.slice(0, 4)) {
    try {
      const r = await fetchUrl(`https://remotive.com/api/remote-jobs?search=${encodeURIComponent(t)}&limit=20`);
      if (r.status !== 200) continue;
      for (const j of (JSON.parse(r.body).jobs || [])) {
        jobs.push(norm({
          id: `remotive-${j.id}`,
          title: j.title,
          company: j.company_name,
          location: j.candidate_required_location || "Remote",
          description: stripHtml(j.description || "").slice(0, 600),
          url: j.url,
          tags: j.tags || [],
          source: "Remotive",
          type: "Remote",
          posted: j.publication_date,
        }));
      }
    } catch (e) { console.log("Remotive error:", e.message); }
  }
  return jobs;
}

// ── Jobicy API ────────────────────────────────────────────────────────────────
// Free, no auth, global remote jobs — good QA coverage
async function fetchJobicy(profile) {
  const jobs = [];
  try {
    const r = await fetchUrl("https://jobicy.com/api/v2/remote-jobs?count=50&tag=qa,testing,quality-assurance");
    if (r.status !== 200) return jobs;
    const data = JSON.parse(r.body);
    for (const j of (data.jobs || [])) {
      jobs.push(norm({
        id: `jobicy-${j.id}`,
        title: j.jobTitle,
        company: j.companyName,
        location: j.jobGeo || "Remote",
        description: stripHtml(j.jobExcerpt || j.jobDescription || "").slice(0, 600),
        url: j.url,
        tags: (j.jobIndustry || []).concat(j.jobType || []),
        source: "Jobicy",
        type: "Remote",
        posted: j.pubDate,
      }));
    }
  } catch (e) { console.log("Jobicy error:", e.message); }
  return jobs;
}

// ── Himalayas API ─────────────────────────────────────────────────────────────
// Free remote job board, strong US companies
async function fetchHimalayas(profile) {
  const jobs = [];
  const terms = buildTerms(profile).slice(0, 2);
  for (const t of terms) {
    try {
      const r = await fetchUrl(`https://himalayas.app/jobs/api?q=${encodeURIComponent(t)}&limit=20`);
      if (r.status !== 200) continue;
      const data = JSON.parse(r.body);
      for (const j of (data.jobs || [])) {
        jobs.push(norm({
          id: `himalayas-${j.slug || j.id}`,
          title: j.title,
          company: j.company?.name || "Unknown",
          location: j.locationRestrictions?.join(", ") || "Remote",
          description: stripHtml(j.description || j.excerpt || "").slice(0, 600),
          url: j.applicationLink || j.url || `https://himalayas.app/jobs/${j.slug}`,
          tags: j.skills || [],
          source: "Himalayas",
          type: "Remote",
          posted: j.publishedAt,
        }));
      }
    } catch (e) { console.log("Himalayas error:", e.message); }
  }
  return jobs;
}

// ── The Muse API ──────────────────────────────────────────────────────────────
// US company focused
async function fetchTheMuse() {
  const jobs = [];
  try {
    const r = await fetchUrl("https://www.themuse.com/api/public/jobs?category=Quality%20Assurance&page=1&descended=true");
    if (r.status !== 200) return jobs;
    for (const j of (JSON.parse(r.body).results || []).slice(0, 15)) {
      const loc = j.locations?.[0]?.name || "US";
      jobs.push(norm({
        id: `muse-${j.id}`,
        title: j.name,
        company: j.company?.name || "Unknown",
        location: loc,
        description: stripHtml(j.contents || "").slice(0, 600),
        url: j.refs?.landing_page || "",
        tags: (j.categories || []).map(c => c.name),
        source: "The Muse",
        type: loc.toLowerCase().includes("remote") ? "Remote" : "On-site",
        posted: j.publication_date,
      }));
    }
  } catch (e) { console.log("The Muse error:", e.message); }
  return jobs;
}

// ── RSS feeds ─────────────────────────────────────────────────────────────────
async function fetchRSS(name, url, defaultType) {
  const jobs = [];
  try {
    const r = await fetchUrl(url);
    if (r.status !== 200) return jobs;
    const parser = new XMLParser({ ignoreAttributes: false });
    const root   = parser.parse(r.body);
    const items  = root?.rss?.channel?.item || root?.feed?.entry || [];
    const list   = Array.isArray(items) ? items : [items];

    for (const item of list.slice(0, 15)) {
      const title = extractText(item.title);
      const link  = item.link?.["@_href"] || item.link || extractText(item.guid) || "";
      const desc  = extractText(item.description || item.summary || item.content || "");
      if (!title) continue;

      jobs.push(norm({
        id: `rss-${name}-${Buffer.from(title).toString("base64").slice(0, 12)}`,
        title,
        company: extractText(item["dc:creator"] || item.author || item.source) || name,
        location: "Remote",
        description: stripHtml(desc).slice(0, 600),
        url: typeof link === "string" ? link : "",
        tags: [],
        source: name,
        type: defaultType,
        posted: item.pubDate || item.published || new Date().toISOString(),
      }));
    }
  } catch (e) { console.log(`RSS ${name} error:`, e.message); }
  return jobs;
}

async function fetchAllRSS(profile) {
  const t = encodeURIComponent(buildTerms(profile)[0] || "QA Engineer");
  const feeds = [
    { name: "RemoteOK",       url: "https://remoteok.com/remote-qa-jobs.rss",                      type: "Remote" },
    { name: "WeWorkRemotely", url: "https://weworkremotely.com/categories/remote-qa-jobs.rss",      type: "Remote" },
    { name: "RemoteOK-SDET",  url: "https://remoteok.com/remote-sdet-jobs.rss",                     type: "Remote" },
    { name: "RemoteOK-Test",  url: "https://remoteok.com/remote-test-engineer-jobs.rss",            type: "Remote" },
  ];
  const results = await Promise.allSettled(feeds.map(f => fetchRSS(f.name, f.url, f.type)));
  return results.flatMap(r => r.status === "fulfilled" ? r.value : []);
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function buildTerms(profile) {
  // Always include core QA terms + profile-specific titles
  const base = ["QA Engineer", "Quality Assurance Engineer", "SDET", "Test Engineer", "QA Analyst"];
  const from  = [...(profile.titles || []).slice(0, 2), ...(profile.targetTitles || []).slice(0, 2)];
  return [...new Set([...from, ...base])];
}

function stripHtml(str) {
  return String(str || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function extractText(val) {
  if (!val) return "";
  if (typeof val === "string") return val;
  if (typeof val === "object") return val["#text"] || val["_"] || String(val) || "";
  return String(val);
}

function norm(j) {
  return {
    ...j,
    title:       String(j.title       || "").trim(),
    company:     String(j.company     || "").trim(),
    location:    String(j.location    || "").trim(),
    description: String(j.description || "").trim(),
  };
}

function dedupe(jobs) {
  const seen = new Set();
  return jobs.filter(j => {
    const k = `${(j.title || "").toLowerCase().slice(0, 40)}-${(j.company || "").toLowerCase().slice(0, 20)}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// ── Main export ───────────────────────────────────────────────────────────────
async function scrapeForProfile(profile) {
  console.log(`🔍 Scraping — titles: ${(profile.titles || []).join(", ")} — state: ${profile.state || "any"}`);

  const [remotive, jobicy, himalayas, muse, rss] = await Promise.allSettled([
    fetchRemotive(profile),
    fetchJobicy(profile),
    fetchHimalayas(profile),
    fetchTheMuse(),
    fetchAllRSS(profile),
  ]);

  const all = [
    ...(remotive.status   === "fulfilled" ? remotive.value   : []),
    ...(jobicy.status     === "fulfilled" ? jobicy.value     : []),
    ...(himalayas.status  === "fulfilled" ? himalayas.value  : []),
    ...(muse.status       === "fulfilled" ? muse.value       : []),
    ...(rss.status        === "fulfilled" ? rss.value        : []),
  ];

  console.log(`📦 Raw jobs fetched: ${all.length}`);

  // Score every job against this user's profile
  const scored = dedupe(all)
    .map(j => ({ ...j, score: scoreJob(j, profile) }))
    .filter(j => j.score.stars >= 1);

  // Sort: local → us_remote → us_national → latam → europe → international
  // Within each tier: highest stars first
  const tierOrder = {
    local:         0,
    us_remote:     1,
    us_national:   2,
    latam:         3,
    europe:        4,
    international: 5,
  };

  scored.sort((a, b) => {
    const td = (tierOrder[a.score.locationTier] ?? 5) - (tierOrder[b.score.locationTier] ?? 5);
    return td !== 0 ? td : (b.score.stars - a.score.stars);
  });

  console.log(`✅ Curated: ${scored.length} jobs`);

  // Log tier breakdown for debugging
  const breakdown = {};
  scored.forEach(j => {
    const t = j.score.locationTier;
    breakdown[t] = (breakdown[t] || 0) + 1;
  });
  console.log("📊 Tier breakdown:", JSON.stringify(breakdown));

  return scored;
}

module.exports = { scrapeForProfile };
