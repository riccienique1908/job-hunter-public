/**
 * src/scraper.js
 * Multi-source job scraper — US-first, then LATAM, then Europe.
 * Returns { jobs, sourceDiagnostics } so callers know what worked/failed.
 */

const https = require("https");
const http  = require("http");
const { XMLParser } = require("fast-xml-parser");
const { scoreJob }  = require("./scoring");

// ── HTTP fetch ────────────────────────────────────────────────────────────────
function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https") ? https : http;
    const req = lib.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "application/json, text/html, text/xml, */*",
        "Accept-Language": "en-US,en;q=0.9",
      },
      timeout: 12000,
    }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchUrl(res.headers.location).then(resolve).catch(reject);
      }
      let d = "";
      res.on("data", c => (d += c));
      res.on("end", () => resolve({ status: res.statusCode, body: d }));
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("timeout after 12s")); });
  });
}

// ── Remotive ──────────────────────────────────────────────────────────────────
async function fetchRemotive(profile) {
  const jobs = [];
  const terms = buildTerms(profile).slice(0, 3);
  for (const t of terms) {
    const r = await fetchUrl(`https://remotive.com/api/remote-jobs?search=${encodeURIComponent(t)}&limit=20`);
    if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
    const data = JSON.parse(r.body);
    for (const j of (data.jobs || [])) {
      jobs.push(norm({
        id: `remotive-${j.id}`,
        title: j.title,
        company: j.company_name,
        location: j.candidate_required_location || "Worldwide",
        description: stripHtml(j.description || "").slice(0, 600),
        url: j.url,
        tags: j.tags || [],
        source: "Remotive",
        type: "Remote",
        posted: j.publication_date,
      }));
    }
  }
  return jobs;
}

// ── Jobicy ────────────────────────────────────────────────────────────────────
async function fetchJobicy() {
  const jobs = [];
  // Try multiple tag combinations
  const urls = [
    "https://jobicy.com/api/v2/remote-jobs?count=50&tag=qa-engineer",
    "https://jobicy.com/api/v2/remote-jobs?count=50&tag=quality-assurance",
    "https://jobicy.com/api/v2/remote-jobs?count=30&tag=software-testing",
  ];
  for (const url of urls) {
    const r = await fetchUrl(url);
    if (r.status !== 200) continue;
    const data = JSON.parse(r.body);
    for (const j of (data.jobs || [])) {
      jobs.push(norm({
        id: `jobicy-${j.id}`,
        title: j.jobTitle,
        company: j.companyName,
        location: j.jobGeo || "Worldwide",
        description: stripHtml(j.jobExcerpt || j.jobDescription || "").slice(0, 600),
        url: j.url,
        tags: [].concat(j.jobIndustry || [], j.jobType || []),
        source: "Jobicy",
        type: "Remote",
        posted: j.pubDate,
      }));
    }
  }
  if (!jobs.length) throw new Error("No jobs returned from any Jobicy tag");
  return jobs;
}

// ── Himalayas ─────────────────────────────────────────────────────────────────
async function fetchHimalayas(profile) {
  const jobs = [];
  const terms = buildTerms(profile).slice(0, 2);
  for (const t of terms) {
    const r = await fetchUrl(`https://himalayas.app/jobs/api?q=${encodeURIComponent(t)}&limit=20`);
    if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
    const data = JSON.parse(r.body);
    for (const j of (data.jobs || [])) {
      jobs.push(norm({
        id: `himalayas-${j.slug || j.id}`,
        title: j.title,
        company: j.company?.name || "Unknown",
        location: (j.locationRestrictions || []).join(", ") || "Worldwide",
        description: stripHtml(j.description || j.excerpt || "").slice(0, 600),
        url: j.applicationLink || `https://himalayas.app/jobs/${j.slug}`,
        tags: j.skills || [],
        source: "Himalayas",
        type: "Remote",
        posted: j.publishedAt,
      }));
    }
  }
  return jobs;
}

// ── The Muse ──────────────────────────────────────────────────────────────────
async function fetchTheMuse() {
  const jobs = [];
  const r = await fetchUrl("https://www.themuse.com/api/public/jobs?category=Quality%20Assurance&page=1&descended=true");
  if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
  const data = JSON.parse(r.body);
  for (const j of (data.results || []).slice(0, 20)) {
    const loc = j.locations?.[0]?.name || "United States";
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
  return jobs;
}

// ── RSS feeds ─────────────────────────────────────────────────────────────────
async function fetchRSS(name, url) {
  const jobs = [];
  const r = await fetchUrl(url);
  if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
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
      company: name,
      location: "Remote",
      description: stripHtml(desc).slice(0, 600),
      url: typeof link === "string" ? link : "",
      tags: [],
      source: name,
      type: "Remote",
      posted: item.pubDate || item.published || new Date().toISOString(),
    }));
  }
  return jobs;
}

// ── Run source with diagnostics ───────────────────────────────────────────────
async function trySource(name, fn) {
  try {
    const jobs = await fn();
    console.log(`✅ ${name}: ${jobs.length} jobs`);
    return { name, jobs, ok: true, count: jobs.length };
  } catch (err) {
    console.log(`❌ ${name}: ${err.message}`);
    return { name, jobs: [], ok: false, error: err.message };
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function buildTerms(profile) {
  const base = ["QA Engineer", "SDET", "Quality Assurance Engineer", "Test Engineer", "QA Analyst"];
  const from  = [...(profile.titles || []).slice(0, 2), ...(profile.targetTitles || []).slice(0, 2)];
  return [...new Set([...from, ...base])];
}

function stripHtml(str) {
  return String(str || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/\s+/g, " ").trim();
}

function extractText(val) {
  if (!val) return "";
  if (typeof val === "string") return val;
  return val["#text"] || val["_"] || "";
}

function norm(j) {
  return {
    ...j,
    title:       String(j.title || "").trim(),
    company:     String(j.company || "").trim(),
    location:    String(j.location || "").trim(),
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
  console.log(`🔍 Scraping for: ${(profile.titles || []).join(", ")} | state: ${profile.state || "any"}`);

  // Run all sources in parallel, each wrapped in trySource for diagnostics
  const results = await Promise.all([
    trySource("Remotive",        () => fetchRemotive(profile)),
    trySource("Jobicy",          () => fetchJobicy()),
    trySource("Himalayas",       () => fetchHimalayas(profile)),
    trySource("TheMuse",         () => fetchTheMuse()),
    trySource("RemoteOK-QA",     () => fetchRSS("RemoteOK",       "https://remoteok.com/remote-qa-jobs.rss")),
    trySource("WeWorkRemotely",  () => fetchRSS("WeWorkRemotely", "https://weworkremotely.com/categories/remote-qa-jobs.rss")),
    trySource("RemoteOK-SDET",   () => fetchRSS("RemoteOK-SDET",  "https://remoteok.com/remote-sdet-jobs.rss")),
    trySource("RemoteOK-Test",   () => fetchRSS("RemoteOK-Test",  "https://remoteok.com/remote-test-engineer-jobs.rss")),
  ]);

  const sourceDiagnostics = results.map(r => ({
    source: r.name,
    ok: r.ok,
    count: r.count || 0,
    error: r.error || null,
  }));

  const all = results.flatMap(r => r.jobs);
  console.log(`📦 Raw total: ${all.length}`);

  const unique = dedupe(all);
  console.log(`📦 After dedupe: ${unique.length}`);

  // Score every job — keep stars >= 1
  const scored = unique
    .map(j => ({ ...j, score: scoreJob(j, profile) }))
    .filter(j => j.score.stars >= 1);

  console.log(`📦 After scoring filter (>=1 star): ${scored.length}`);

  // Sort: local → us_remote → us_national → latam → europe → international
  const tierOrder = { local:0, us_remote:1, us_national:2, latam:3, europe:4, international:5 };
  scored.sort((a, b) => {
    const td = (tierOrder[a.score.locationTier] ?? 5) - (tierOrder[b.score.locationTier] ?? 5);
    return td !== 0 ? td : b.score.stars - a.score.stars;
  });

  // Log tier breakdown
  const breakdown = {};
  scored.forEach(j => { const t = j.score.locationTier; breakdown[t] = (breakdown[t] || 0) + 1; });
  console.log("📊 Tier breakdown:", JSON.stringify(breakdown));

  return { jobs: scored, sourceDiagnostics };
}

module.exports = { scrapeForProfile };
