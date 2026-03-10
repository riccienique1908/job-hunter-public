/**
 * src/mergeAnswers.js
 * Merges user question answers into the extracted profile for better job matching.
 */

function mergeAnswers(profile, answers) {
  if (!answers || typeof answers !== "object") return profile;
  const p = { ...profile };

  for (const [qId, answer] of Object.entries(answers)) {
    const val = Array.isArray(answer) ? answer.join(", ") : String(answer || "").trim();
    if (!val) continue;
    const id = qId.toLowerCase();

    // Work type preference
    if (id === "q1" || id.includes("work") || /remote|hybrid|on.?site/i.test(val)) {
      p.workPreference = val;
    }
    // Target titles
    if (id === "q2" || id.includes("title") || id.includes("role")) {
      const extras = val.split(/[,/]/).map(s => s.trim()).filter(Boolean);
      p.targetTitles = [...new Set([...(p.targetTitles || []), ...extras])];
    }
    // Preferred location / state
    if (id === "q3" || id.includes("state") || id.includes("location") || id.includes("city")) {
      p.preferredLocation = val;
      // Extract state abbreviation or full name
      const abbr = val.match(/\b([A-Z]{2})\b/)?.[1];
      const full = val.match(/\b(Illinois|Texas|California|Florida|New York|Georgia|Washington|Colorado|Ohio|Virginia|Pennsylvania|Minnesota|Arizona|Nevada|Oregon|Michigan)\b/i)?.[1];
      if (abbr) p.state = abbr;
      else if (full) p.state = full;
    }
    // Seniority
    if (id === "q4" || id.includes("senior") || id.includes("level") || id.includes("experience")) {
      p.seniority = val;
    }
    // Industry
    if (id === "q5" || id.includes("industry") || id.includes("sector")) {
      const extras = val.split(/,/).map(s => s.trim()).filter(Boolean);
      p.industries = [...new Set([...(p.industries || []), ...extras])];
    }
  }

  return p;
}

module.exports = { mergeAnswers };
