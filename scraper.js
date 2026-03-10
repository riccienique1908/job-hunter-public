/**
 * src/scraper.js
 * Multi-source job scraper, profile-aware, location-first ordering.
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
      timeout: 14000,
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

// ── Remotive ──────────────────────────────────────────────────────────────────
async function fetchRemotive(profile) {
  const jobs = [];
  const terms = searchTerms(profile).slice(0, 3);
  for (const t of terms) {
    try {
      const r = await fetchUrl(`https://remotive.com/api/remote-jobs?search=${encodeURIComponent(t)}&limit=15`);
      if (r.status !== 200) continue;
      for (const j of (JSON.parse(r.body).jobs || [])) {
        jobs.push(norm({
          id: `remotive-${j.id}`,
          title: j.title, company: j.company_name,
          location: j.candidate_required_location || "Remote",
          description: (j.description || "").replace(/<[^>]*>/g, "").slice(0, 500),
          url: j.url, tags: j.tags || [],
          source: "Remotive", type: "Remote", posted: j.publication_date,
        }));
      }
    } catch {}
  }
  return jobs;
}

// ── The Muse ──────────────────────────────────────────────────────────────────
async function fetchTheMuse() {
  const jobs = [];
  try {
    const r = await fetchUrl("https://www.themuse.com/api/public/jobs?category=Quality%20Assurance&level=Senior%20Level&level=Mid%20Level&page=1&descended=true");
    if (r.status !== 200) return jobs;
    for (const j of (JSON.parse(r.body).results || []).slice(0, 12)) {
      const loc = j.locations?.[0]?.name || "Remote";
      jobs.push(norm({
        id: `muse-${j.id}`, title: j.name,
        company: j.company?.name || "Unknown", location: loc,
        description: (j.contents || "").replace(/<[^>]*>/g, "").slice(0, 500),
        url: j.refs?.landing_page || "", tags: j.categories?.map(c => c.name) || [],
        source: "The Muse",
        type: loc.toLowerCase().includes("remote") ? "Remote" : "On-site",
        posted: j.publication_date,
      }));
    }
  } catch {}
  return jobs;
}

// ── Arbeitnow ─────────────────────────────────────────────────────────────────
async function fetchArbeitnow(profile) {
  const jobs = [];
  try {
    const term = searchTerms(profile)[0] || "QA Engineer";
    const r = await fetchUrl(`https://www.arbeitnow.com/api/job-board-api?search=${encodeURIComponent(term)}&remote=true`);
    if (r.status !== 200) return jobs;
    for (const j of (JSON.parse(r.body).data || []).slice(0, 12)) {
      jobs.push(norm({
        id: `arbeitnow-${j.slug}`, title: j.title, company: j.company_name,
        location: j.location || "Remote",
        description: (j.description || "").replace(/<[^>]*>/g, "").slice(0, 500),
        url: j.url, tags: j.tags || [],
        source: "Arbeitnow", type: j.remote ? "Remote" : "On-site",
        posted: new Date((j.created_at || 0) * 1000).toISOString(),
      }));
    }
  } catch {}
  return jobs;
}

// ── RSS feeds ─────────────────────────────────────────────────────────────────
async function fetchRSS(name, url, type) {
  const jobs = [];
  try {
    const r = await fetchUrl(url);
    if (r.status !== 200) return jobs;
    const parser = new XMLParser({ ignoreAttributes: false });
    const root = parser.parse(r.body);
    const items = root?.rss?.channel?.item || root?.feed?.entry || [];
    const list  = Array.isArray(items) ? items : [items];
    for (const item of list.slice(0, 10)) {
      const title = item.title?.["#text"] || item.title || "";
      const link  = item.link?.["@_href"] || item.link || item.guid || "";
      const desc  = item.description || item.summary || item.content || "";
      const clean = (typeof desc === "string" ? desc : desc?.["#text"] || "")
        .replace(/<[^>]*>/g, "").slice(0, 500);
      if (!title) continue;
      jobs.push(norm({
        id: `rss-${name}-${Buffer.from(String(title)).toString("base64").slice(0, 12)}`,
        title: String(typeof title === "string" ? title : title?.["#text"] || ""),
        company: item.source || name, location: type === "Remote" ? "Remote" : "",
        description: clean, url: typeof link === "string" ? link : "",
        tags: [], source: name, type, posted: item.pubDate || item.published || new Date().toISOString(),
      }));
    }
  } catch {}
  return jobs;
}

async function fetchAllRSS(profile) {
  const t = encodeURIComponent((profile.titles?.[0] || "QA Engineer") + " remote");
  const feeds = [
    { name: "Indeed",         url: `https://www.indeed.com/rss?q=${t}&l=remote&sort=date`, type: "Remote" },
    { name: "RemoteOK",       url: "https://remoteok.com/remote-qa-jobs.rss", type: "Remote" },
    { name: "WeWorkRemotely", url: "https://weworkremotely.com/categories/remote-qa-jobs.rss", type: "Remote" },
  ];
  const results = await Promise.allSettled(feeds.map(f => fetchRSS(f.name, f.url, f.type)));
  return results.flatMap(r => r.status === "fulfilled" ? r.value : []);
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function searchTerms(profile) {
  return [...new Set([
    ...(profile.titles || []).slice(0, 2),
    ...(profile.targetTitles || []).slice(0, 2),
    "QA Engineer", "Quality Assurance", "Test Engineer",
  ])];
}

function norm(j) {
  return {
    ...j,
    title: String(j.title || "").trim(),
    company: String(j.company || "").trim(),
    location: String(j.location || "").trim(),
    description: String(j.description || "").trim() + (j.description?.length >= 500 ? "…" : ""),
  };
}

function dedupe(jobs) {
  const seen = new Set();
  return jobs.filter(j => {
    const k = `${j.title.toLowerCase().slice(0,40)}-${j.company.toLowerCase().slice(0,20)}`;
    if (seen.has(k)) return false;
    seen.add(k); return true;
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function scrapeForProfile(profile) {
  console.log(`🔍 Scraping for ${profile.titles?.[0] || "QA"} — state: ${profile.state || "any"}`);

  const [remotive, muse, arbeitnow, rss] = await Promise.allSettled([
    fetchRemotive(profile),
    fetchTheMuse(),
    fetchArbeitnow(profile),
    fetchAllRSS(profile),
  ]);

  const all = [
    ...(remotive.status  === "fulfilled" ? remotive.value  : []),
    ...(muse.status      === "fulfilled" ? muse.value      : []),
    ...(arbeitnow.status === "fulfilled" ? arbeitnow.value : []),
    ...(rss.status       === "fulfilled" ? rss.value       : []),
  ];

  const scored = dedupe(all)
    .map(j => ({ ...j, score: scoreJob(j, profile) }))
    .filter(j => j.score.stars >= 1);

  const tierOrder = { local:0, remote:1, national:2, international:3 };
  scored.sort((a, b) => {
    const td = (tierOrder[a.score.locationTier] ?? 3) - (tierOrder[b.score.locationTier] ?? 3);
    return td !== 0 ? td : b.score.stars - a.score.stars;
  });

  console.log(`✅ ${scored.length} curated jobs`);
  return scored;
}

module.exports = { scrapeForProfile };
