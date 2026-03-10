# 🎯 Job Hunter — Public AI Resume Matcher

> Upload your resume → Google Gemini AI reads it → answer 5 questions → review your profile → get a ranked, location-aware job list on the page AND in your inbox.

**Free to run.** Netlify Functions + Google Gemini (free tier) + Resend (free tier).

---

## ✨ User Flow

1. **Upload** resume (PDF or TXT) + optionally enter email
2. **Gemini AI** extracts profile: skills, titles, location, experience, industries, languages
3. **Answer 5 questions** to confirm/refine (work type, target titles, preferred state, seniority, industry)
4. **Review Profile Summary** — skills chips, education, languages, target roles
5. **Find Jobs** — app scrapes 6+ sources, scores every listing, shows:
   - 📍 **Local first** (same state as user)
   - 🌐 Remote
   - 🇺🇸 Other US
   - 🌍 International
6. **Email digest** sent to user (if provided) — top matches + "See all" link back to the page

---

## 🚀 Deploy to Netlify (~5 min)

### 1 — Clone & push to GitHub

```bash
git clone https://github.com/YOUR_USERNAME/job-hunter-public.git
cd job-hunter-public
git push
```

### 2 — Get your free API keys

**Google Gemini (AI analysis):**
- Go to [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey)
- Create a key — free, no credit card
- Free tier: 15 req/min, 1M tokens/day

**Resend (email):**
- Go to [resend.com](https://resend.com) — sign up free
- Create an API key
- Free tier: 3,000 emails/month

### 3 — Create Netlify site

1. [netlify.com](https://netlify.com) → **Add new site → Import from Git**
2. Connect your GitHub repo
3. Settings auto-detected from `netlify.toml` — just click **Deploy**

### 4 — Add environment variables

In Netlify dashboard → **Site settings → Environment variables**, add:

| Key | Value |
|-----|-------|
| `GEMINI_API_KEY` | Your Google AI Studio key |
| `RESEND_API_KEY` | Your Resend key |
| `FROM_EMAIL` | `Job Hunter <onboarding@resend.dev>` |

That's it — redeploy and your app is live!

---

## 📁 Structure

```
job-hunter-public/
├── netlify.toml                    # Routing: /api/* → functions
├── package.json
├── .env.example
├── public/
│   └── index.html                  # Full 4-step SPA
├── netlify/functions/
│   ├── analyze.js                  # POST /api/analyze — Gemini resume parser
│   ├── jobs.js                     # POST /api/jobs    — scrape + score + email trigger
│   └── send-email.js               # POST /api/send-email — Resend delivery
└── src/
    ├── scoring.js                  # Location-aware match scoring (1–5 stars)
    ├── scraper.js                  # Multi-source scraper (Remotive, Muse, Arbeitnow, RSS)
    ├── mergeAnswers.js             # Merges Q&A answers into final profile
    └── emailBuilder.js             # Builds HTML job digest email
```

---

## 🌍 Location-First Scoring

The scoring engine extracts the user's US state and orders results:

| Tier | Description | Score Bonus |
|------|-------------|-------------|
| 📍 Local | Same US state | +2 pts |
| 🌐 Remote | Explicitly remote role | +1.5 pts |
| 🇺🇸 National | Other US states/cities | +0.8 pts |
| 🌍 International | Outside US | +0 pts |

Within each tier, jobs are ranked by overall match score (skills + title + seniority + industry).

---

## 🆓 Cost

| Service | Free Tier |
|---------|-----------|
| Netlify Functions | 125,000 invocations/month |
| Google Gemini 1.5 Flash | 15 req/min, 1M tokens/day |
| Resend | 3,000 emails/month |
| Job data | Free public APIs & RSS |
| **Total** | **$0/month** |

---

## 🔧 Local Development

```bash
cp .env.example .env
# fill in GEMINI_API_KEY and RESEND_API_KEY

npm install
npm run dev   # starts netlify dev on http://localhost:8888
```
