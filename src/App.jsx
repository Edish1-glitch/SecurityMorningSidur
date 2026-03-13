import { useState, useCallback, useMemo, useEffect } from "react";
// ─── Constants ────────────────────────────────────────────────────────────────
const HOURS = [
  "07:00-08:00","08:00-09:00","09:00-10:00","10:00-11:00",
  "11:00-12:00","12:00-13:00","13:00-14:00","14:00-15:00",
];
const SL = {
  cico: "CICO", lenel: "Lenel", bosh: "Bosh",
  break: "הפסקה", malshinon: "מלשינון", shaar: "שער",
};
const SC = {
  cico:      { bg: "#1a3a4a", text: "#7dd3fc", border: "#0ea5e9" },
  lenel:     { bg: "#1a2f1a", text: "#86efac", border: "#3fb950" },
  bosh:      { bg: "#2a1f3a", text: "#d8b4fe", border: "#bc8cff" },
  break:     { bg: "#3a2a10", text: "#fcd34d", border: "#f0a500" },
  malshinon: { bg: "#1a2535", text: "#93c5fd", border: "#58a6ff" },
  shaar:     { bg: "#2a1515", text: "#fca5a5", border: "#f85149" },
};
const REST = new Set(["break", "malshinon", "shaar"]);

// ─── Scheduling Logic ─────────────────────────────────────────────────────────
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// cfg = { gateDown, cicoDown, isShortage, maxRest }
function assignable(h, cfg = {}) {
  const s = ["lenel", "bosh", "break"];
  if (h > 0 && !cfg.cicoDown) s.push("cico");
  // Malshinon hours shift when gate is down
  if (cfg.gateDown && cfg.cicoDown) {
    s.push("malshinon"); // all hours: gate+CICO both down
  } else if (cfg.gateDown) {
    if (h <= 2) s.push("malshinon"); // gate down only: 07–10
  } else {
    if (h === 0 || h >= 3) s.push("malshinon"); // normal
  }
  if (!cfg.gateDown && h <= 2) s.push("shaar");
  return s;
}

function consec(h, g, sched) {
  let c = 0;
  for (let i = h - 1; i >= 0; i--) {
    if (sched[i][g] && !REST.has(sched[i][g])) c++; else break;
  }
  return c;
}

function cicoLimit(gIdx, guards) {
  const g = guards[gIdx];
  const achmashCount = guards.filter(x => x.level === "achmash").length;
  const nonAchmash = guards.filter(x => x.level !== "achmash");
  const nonAchmashCount = nonAchmash.length;

  if (g.level === "achmash") {
    if (nonAchmashCount === 0) return Math.ceil(7 / achmashCount);
    const nonAchmashCapacity = nonAchmash.reduce((sum, _, i) => {
      const realIdx = guards.indexOf(nonAchmash[i]);
      const isGate = guards[realIdx].isGate;
      const cap = isGate ? 2 : (guards[realIdx].level === "strong" ? 1 : 2);
      return sum + cap;
    }, 0);
    const deficit = Math.max(0, 7 - nonAchmashCapacity);
    if (deficit === 0) return 0;
    return Math.ceil(deficit / achmashCount);
  }

  const hasAchmash = achmashCount > 0;
  if (g.isGate) return hasAchmash ? 2 : 1;
  if (hasAchmash) {
    if (nonAchmashCount === 0) return 0;
    return Math.ceil(7 / nonAchmashCount);
  }

  const baseLimit = g.level === "strong" ? 1 : 2;
  const totalCapacity = guards.reduce((sum, guard) => {
    if (guard.level === "achmash") return sum;
    return sum + (guard.isGate ? 1 : (guard.level === "strong" ? 1 : 2));
  }, 0);
  if (totalCapacity >= 7) return baseLimit;
  const nonGateEligible = guards.filter(x => x.level !== "achmash" && !x.isGate).length;
  if (nonGateEligible === 0) return baseLimit;
  return baseLimit + Math.ceil((7 - totalCapacity) / nonGateEligible);
}

function canPlaceFix(h, g, st, sched, guards, cfg = {}) {
  if (!assignable(h, cfg).includes(st)) return false;
  if (h > 0 && sched[h - 1][g] === "cico" && st !== "break") return false;
  if (!REST.has(st) && consec(h, g, sched) >= 3) return false;
  if (st === "cico") {
    const cnt = sched.map(r => r[g]).filter(s => s === "cico").length;
    if (cnt >= cicoLimit(g, guards)) return false;
  }
  if (st === "malshinon" && h > 0 && sched[h - 1][g] === "malshinon") return false;
  if (st === "malshinon" && h < 7 && sched[h + 1][g] === "malshinon") return false;
  if (st === "break" && h > 0 && sched[h - 1][g] === "break") return false;
  if (sched[h].some((s, gi) => gi !== g && s === st)) return false;
  return true;
}

function validateSched(sched, guards, cfg = {}) {
  const maxRest = cfg.maxRest || 3;
  const errs = [];
  const achmashCount = guards.filter(x => x.level === "achmash").length;

  for (let h = 0; h < 8; h++) {
    const seen = {};
    sched[h].forEach((s) => {
      if (!s) return;
      if (seen[s]) errs.push(`כפילות ב-${HOURS[h]}: ${SL[s] || s}`);
      seen[s] = true;
    });
  }

  guards.forEach((guard, g) => {
    const gName = guardDisplayName(guard, g, guards.length);
    const row = sched.map(r => r[g]);
    let c = 0;
    row.forEach((s, h) => {
      if (s && !REST.has(s)) c++; else c = 0;
      if (c > 3) errs.push(`${gName}: >3 ברצף@${HOURS[h]}`);
    });
    for (let h = 0; h < 7; h++) {
      if (row[h] === "cico" && row[h + 1] && row[h + 1] !== "break")
        errs.push(`${gName}: אחרי CICO ללא הפסקה`);
    }
    for (let h = 0; h < 7; h++) {
      if (row[h] === "break" && row[h + 1] === "break")
        errs.push(`${gName}: הפסקות ברצף@${HOURS[h]}`);
    }
    const cc = row.filter(s => s === "cico").length;
    const lim = cicoLimit(g, guards);
    if (cc > lim) errs.push(`${gName}: ${cc} CICO (מקס׳ ${lim})`);
    if (guard.isDouble && guard.level !== "achmash" && row[7] !== "cico")
      errs.push(`${gName}: כפולה חייב CICO בשעה האחרונה`);
    for (let h = 0; h < 7; h++) {
      if (row[h] === "malshinon" && row[h + 1] === "malshinon")
        errs.push(`${gName}: מלשינון רצוף@${HOURS[h]}`);
    }

    // Required stations per guard (shortage mode relaxes malshinon requirement)
    if (guard.level === "achmash") {
      const required = ["lenel", "bosh", "break"];
      if (achmashCount >= 2 && !cfg.cicoDown) required.push("cico");
      if (!cfg.isShortage) required.push("malshinon");
      required.forEach(r => {
        if (!row.includes(r)) errs.push(`${gName}: חסר ${SL[r] || r}`);
      });
    } else if (guard.isGate) {
      if (!cfg.cicoDown && !row.includes("cico")) errs.push(`${gName}: חסר CICO`);
    } else {
      const required = ["lenel", "bosh", "break"];
      if (!cfg.cicoDown) required.push("cico");
      if (!cfg.isShortage) required.push("malshinon");
      required.forEach(r => {
        if (!row.includes(r)) errs.push(`${gName}: חסר ${SL[r] || r}`);
      });
    }

    // In shortage mode the rest cap is omitted — fewer guards means more rest is unavoidable.
    // The balance check (below) ensures fairness between guards.
    const restCnt = row.filter(s => s === "break" || s === "malshinon").length;
    if (!cfg.isShortage && restCnt > maxRest)
      errs.push(`${gName}: ${restCnt} שעות מנוחה (מקס׳ ${maxRest})`);
  });

  for (let h = 0; h < 8; h++) {
    if (!sched[h].includes("lenel")) errs.push(`${HOURS[h]}: Lenel לא מאויישת`);
    if (!sched[h].includes("bosh"))  errs.push(`${HOURS[h]}: Bosh לא מאויישת`);
  }

  const nonGate = guards.map((g, i) => ({ g, i })).filter(({ g }) => !g.isGate);
  if (nonGate.length > 1) {
    const restCounts = nonGate.map(({ i }) => {
      const row = sched.map(r => r[i]);
      return row.filter(s => s === "break" || s === "malshinon").length;
    });
    const mx = Math.max(...restCounts);
    const mn = Math.min(...restCounts);
    if (mx - mn > 1) errs.push(`חוסר איזון בהפסקות: פער של ${mx - mn} שעות`);
  }
  return errs;
}

function tryGen(seed, guards, cfg = {}) {
  const rand = mulberry32(seed);
  const N = guards.length;
  const sched = Array.from({ length: 8 }, () => Array(N).fill(""));
  const shuffle = (arr) => {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  const free = (h, g) => !sched[h][g];
  const needsBreak = (h, g) => h > 0 && sched[h - 1][g] === "cico";
  const activeConsec = (h, g) => {
    let c = 0;
    for (let i = h - 1; i >= 0; i--) {
      if (sched[i][g] && !REST.has(sched[i][g])) c++; else break;
    }
    return c;
  };

  // Gate guard gets shaar only if station is active
  guards.forEach((g, gi) => {
    if (g.isGate && !cfg.gateDown) for (let h = 0; h < 3; h++) sched[h][gi] = "shaar";
    if (g.isDouble) sched[7][gi] = "cico";
  });

  // CICO assignment (skip entirely if cicoDown)
  if (!cfg.cicoDown) {
    const achmashCount = guards.filter(x => x.level === "achmash").length;
    const cicoGuards = shuffle(Array.from({ length: N }, (_, i) => i))
      .filter(g => guards[g].level !== "achmash" || achmashCount >= 2);
    for (const g of cicoGuards) {
      const lim = cicoLimit(g, guards);
      const cur = sched.map(r => r[g]).filter(s => s === "cico").length;
      const need = lim - cur;
      if (need <= 0) continue;
      const validHours = shuffle([1, 2, 3, 4, 5, 6, 7]).filter(h =>
        free(h, g) && !sched[h].includes("cico") && activeConsec(h, g) < 3
      );
      let assigned = 0;
      for (const h of validHours) {
        if (assigned >= need) break;
        if (h < 7 && !free(h + 1, g) && sched[h + 1][g] !== "break") continue;
        if (h < 7 && free(h + 1, g) && sched[h + 1].includes("break")) continue;
        sched[h][g] = "cico";
        if (h < 7 && free(h + 1, g)) sched[h + 1][g] = "break";
        assigned++;
      }
    }
  }

  // Lenel
  for (const h of shuffle([0, 1, 2, 3, 4, 5, 6, 7])) {
    if (sched[h].includes("lenel")) continue;
    const cands = shuffle(Array.from({ length: N }, (_, i) => i)).filter(g =>
      free(h, g) && !needsBreak(h, g) && activeConsec(h, g) < 3
    );
    if (cands.length) sched[h][cands[0]] = "lenel";
  }

  // Bosh
  for (const h of shuffle([0, 1, 2, 3, 4, 5, 6, 7])) {
    if (sched[h].includes("bosh")) continue;
    const cands = shuffle(Array.from({ length: N }, (_, i) => i)).filter(g =>
      free(h, g) && !needsBreak(h, g) && activeConsec(h, g) < 3
    );
    if (cands.length) sched[h][cands[0]] = "bosh";
  }

  // Malshinon — hours depend on cfg
  const malsHours = cfg.gateDown && cfg.cicoDown
    ? [0, 1, 2, 3, 4, 5, 6, 7]
    : cfg.gateDown
      ? [0, 1, 2]
      : [0, 3, 4, 5, 6, 7];

  const maxRest = cfg.maxRest || 3;
  for (const h of shuffle(malsHours)) {
    if (sched[h].includes("malshinon")) continue;
    const cands = shuffle(Array.from({ length: N }, (_, i) => i)).filter(g => {
      if (!free(h, g) || needsBreak(h, g)) return false;
      const curMals   = sched.map(r => r[g]).filter(s => s === "malshinon").length;
      const curBreaks = sched.map(r => r[g]).filter(s => s === "break").length;
      const emptySlots = sched.map(r => r[g]).filter(s => !s).length;
      return (curMals + 1) + curBreaks + (emptySlots - 1) <= maxRest;
    });
    if (cands.length) sched[h][cands[0]] = "malshinon";
  }

  // Fill remaining empty slots
  for (let h = 0; h < 8; h++) {
    for (let g = 0; g < N; g++) {
      if (sched[h][g]) continue;
      const hourBreakTaken = sched[h].some((s, gi) => gi !== g && s === "break");
      const hourMalsTaken  = sched[h].some((s, gi) => gi !== g && s === "malshinon");
      const prevMals       = h > 0 && sched[h - 1][g] === "malshinon";
      const prevBreak      = h > 0 && sched[h - 1][g] === "break";
      const nextMals       = h < 7 && sched[h + 1][g] === "malshinon";
      const malsValid = malsHours.includes(h) && !prevMals && !nextMals && !hourMalsTaken;
      if (malsValid && prevBreak) {
        sched[h][g] = "malshinon";
      } else if (!hourBreakTaken && !prevBreak) {
        sched[h][g] = "break";
      } else if (malsValid) {
        sched[h][g] = "malshinon";
      } else {
        sched[h][g] = "break";
      }
    }
  }
  return sched;
}

function postFix(sched, guards, cfg = {}) {
  const maxRest = cfg.maxRest || 3;
  for (let iter = 0; iter < 20; iter++) {
    let improved = false;
    const errs = validateSched(sched, guards, cfg);
    if (!errs.length) break;

    // Pass 1: assign missing required stations per guard
    const achmashCount = guards.filter(x => x.level === "achmash").length;
    for (let g = 0; g < guards.length && !improved; g++) {
      let needed;
      if (guards[g].level === "achmash") {
        needed = ["lenel", "bosh", "break"];
        if (achmashCount >= 2 && !cfg.cicoDown) needed.push("cico");
        if (!cfg.isShortage) needed.push("malshinon");
      } else if (guards[g].isGate) {
        needed = cfg.cicoDown ? [] : ["cico"];
      } else {
        needed = ["lenel", "bosh", "break"];
        if (!cfg.cicoDown) needed.push("cico");
        if (!cfg.isShortage) needed.push("malshinon");
      }
      for (const need of needed) {
        if (sched.map(r => r[g]).includes(need)) continue;
        for (let h = 0; h < 8; h++) {
          const cur = sched[h][g];
          if (cur === "shaar" || cur === need) continue;
          sched[h][g] = need;
          if (canPlaceFix(h, g, need, sched, guards, cfg) &&
              validateSched(sched, guards, cfg).length < errs.length) {
            improved = true; break;
          }
          sched[h][g] = cur;
        }
        if (improved) break;
      }
    }

    // Pass 2: fix simultaneous breaks → swap to malshinon
    for (let h = 0; h < 8 && !improved; h++) {
      const breakGuards = sched[h].map((s, gi) => gi).filter(gi => sched[h][gi] === "break");
      if (breakGuards.length <= 1) continue;
      for (let k = 1; k < breakGuards.length && !improved; k++) {
        const g = breakGuards[k];
        if (sched[h][g] === "shaar") continue;
        const prev = sched[h][g];
        sched[h][g] = "malshinon";
        if (canPlaceFix(h, g, "malshinon", sched, guards, cfg) &&
            validateSched(sched, guards, cfg).length < errs.length) {
          improved = true;
        } else {
          sched[h][g] = prev;
        }
      }
    }

    // Pass 3: fix rest-limit violations via swap
    for (let g = 0; g < guards.length && !improved; g++) {
      const restCnt = sched.map(r => r[g]).filter(s => s === "break" || s === "malshinon").length;
      if (restCnt <= maxRest) continue;
      for (let h = 0; h < 8 && !improved; h++) {
        const curSt = sched[h][g];
        if (curSt !== "break" && curSt !== "malshinon") continue;
        for (let g2 = 0; g2 < guards.length && !improved; g2++) {
          if (g2 === g) continue;
          const st2 = sched[h][g2];
          if (!st2 || REST.has(st2)) continue;
          const rested2 = sched.map(r => r[g2]).filter(s => s === "break" || s === "malshinon").length;
          if (rested2 >= maxRest) continue;
          sched[h][g]  = st2;
          sched[h][g2] = curSt;
          if (validateSched(sched, guards, cfg).length < errs.length) { improved = true; break; }
          sched[h][g]  = curSt;
          sched[h][g2] = st2;
        }
      }
    }

    // Pass 4: fix consecutive breaks → replace with malshinon
    for (let g = 0; g < guards.length && !improved; g++) {
      for (let h = 1; h < 8 && !improved; h++) {
        if (sched[h][g] !== "break" || sched[h - 1][g] !== "break") continue;
        if (assignable(h, cfg).includes("malshinon") &&
            !sched[h].some((s, gi) => gi !== g && s === "malshinon") &&
            !(h < 7 && sched[h + 1][g] === "malshinon")) {
          sched[h][g] = "malshinon";
          if (validateSched(sched, guards, cfg).length < errs.length) { improved = true; break; }
          sched[h][g] = "break";
        }
        if (!improved &&
            assignable(h - 1, cfg).includes("malshinon") &&
            !sched[h - 1].some((s, gi) => gi !== g && s === "malshinon") &&
            !(h > 1 && sched[h - 2][g] === "malshinon")) {
          sched[h - 1][g] = "malshinon";
          if (validateSched(sched, guards, cfg).length < errs.length) { improved = true; break; }
          sched[h - 1][g] = "break";
        }
      }
    }

    // Pass 5: generic pairwise swap in same hour
    for (let h = 0; h < 8 && !improved; h++) {
      for (let g = 0; g < guards.length && !improved; g++) {
        for (let g2 = g + 1; g2 < guards.length && !improved; g2++) {
          const s1 = sched[h][g], s2 = sched[h][g2];
          if (!s1 || !s2 || s1 === s2) continue;
          if (s1 === "shaar" || s2 === "shaar") continue;
          sched[h][g] = s2; sched[h][g2] = s1;
          if (canPlaceFix(h, g, s2, sched, guards, cfg) &&
              canPlaceFix(h, g2, s1, sched, guards, cfg) &&
              validateSched(sched, guards, cfg).length < errs.length) {
            improved = true;
          } else {
            sched[h][g] = s1; sched[h][g2] = s2;
          }
        }
      }
    }

    if (!improved) break;
  }
}

function generate(guards, cfg = {}) {
  const tryWith = (mr) => {
    const c = { ...cfg, maxRest: mr };
    let best = null, bestE = 9999;
    for (let seed = 0; seed < 3000; seed++) {
      const s = tryGen(seed, guards, c);
      postFix(s, guards, c);
      const e = validateSched(s, guards, c).length;
      if (e < bestE) { bestE = e; best = s.map(r => [...r]); }
      if (bestE === 0) break;
    }
    return { sched: best, errs: bestE };
  };

  // In shortage mode: no hard rest cap (validateSched skips it).
  // Use a high maxRest so tryGen doesn't over-constrain malshinon assignment.
  // Fairness is enforced by the balance check in validateSched.
  if (cfg.isShortage) {
    const r = tryWith(8);
    return r.sched ?? Array.from({ length: 8 }, () => Array(guards.length).fill(""));
  }

  const r = tryWith(cfg.maxRest || 3);
  return r.sched ?? Array.from({ length: 8 }, () => Array(guards.length).fill(""));
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function levelColor(level) {
  return level === "strong" ? "#3fb950" : level === "achmash" ? "#58a6ff" : "#f0a500";
}
function levelLabel(level) {
  return level === "strong" ? "ותיק" : level === "achmash" ? "אחמ״ש" : "חדש";
}
function guardPlaceholder(i, total) {
  return i === total - 1 ? "מאבטח שער" : `מאבטח ${i + 1}`;
}
function guardDisplayName(g, i, total) {
  return g.name || guardPlaceholder(i, total);
}
const DEFAULT_GUARDS = [
  { name: "", level: "strong", isDouble: false, isGate: false, isAbsent: false },
  { name: "", level: "strong", isDouble: false, isGate: false, isAbsent: false },
  { name: "", level: "mid",    isDouble: false, isGate: false, isAbsent: false },
  { name: "", level: "mid",    isDouble: false, isGate: false, isAbsent: false },
  { name: "", level: "mid",    isDouble: false, isGate: true,  isAbsent: false },
];

// ─── Components ───────────────────────────────────────────────────────────────
function StationBadge({ station, size = "md" }) {
  const col = SC[station];
  if (!col) return null;
  const sz = size === "sm" ? "text-xs px-2 py-0.5" : "text-sm px-3 py-1.5";
  return (
    <span
      className={`${sz} rounded-md font-bold inline-block text-center`}
      style={{ backgroundColor: col.bg, color: col.text, border: `1px solid ${col.border}` }}
    >
      {SL[station]}
    </span>
  );
}

function Legend() {
  return (
    <div className="flex flex-row-reverse flex-wrap gap-2 justify-center mb-3">
      {Object.entries(SL).map(([k, v]) => (
        <div key={k} className="flex items-center gap-1.5 flex-row-reverse">
          <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: SC[k]?.border }} />
          <span className="text-xs" style={{ color: "#8b949e" }}>{v}</span>
        </div>
      ))}
    </div>
  );
}

function GuardSetup({ guards, setGuards }) {
  const updateGuard = (i, field, val) =>
    setGuards(prev => prev.map((g, idx) => idx === i ? { ...g, [field]: val } : g));

  const toggleAbsent = (i) =>
    setGuards(prev => prev.map((g, idx) => ({
      ...g,
      isAbsent: idx === i ? !g.isAbsent : false,
    })));

  return (
    <div className="rounded-2xl p-4 mb-4" style={{ backgroundColor: "#161b22", border: "1px solid #30363d" }}>
      <h2 className="text-sm font-bold mb-3 text-center" style={{ color: "#f0a500" }}>⚙️ הגדרת הצוות</h2>
      {guards.map((g, i) => (
        <div
          key={i}
          className="rounded-xl p-3 mb-2 transition-all"
          style={{
            backgroundColor: g.isAbsent ? "#1a0a0a" : "#1c2330",
            border: `1px solid ${g.isAbsent ? "#f85149" : "#30363d"}`,
            opacity: g.isAbsent ? 0.75 : 1,
          }}
        >
          {/* Name — full width */}
          <input
            className="w-full text-center font-bold pb-1.5 mb-2 bg-transparent outline-none"
            style={{
              color: g.isAbsent ? "#888" : "#e6edf3",
              borderBottom: "1px solid #30363d",
              fontSize: 16,
            }}
            value={g.name}
            onChange={e => updateGuard(i, "name", e.target.value)}
            placeholder={guardPlaceholder(i, guards.length)}
          />

          {/* Controls row: [level buttons on left] | [כפולה + חוסר on right] */}
          <div className="flex flex-row-reverse items-center justify-between">
            {/* Right group: כפולה + חוסר */}
            <div className="flex items-center gap-2">
              <button
                className="flex items-center gap-1.5 text-xs rounded px-1 py-0.5 transition-all"
                style={{ color: g.isDouble ? "#f0a500" : "#8b949e" }}
                onClick={() => updateGuard(i, "isDouble", !g.isDouble)}
              >
                <span className="font-medium">כפולה</span>
                <span
                  className="w-4 h-4 rounded flex-shrink-0 flex items-center justify-center"
                  style={{
                    border: `1.5px solid ${g.isDouble ? "#f0a500" : "#30363d"}`,
                    backgroundColor: g.isDouble ? "#f0a500" : "transparent",
                    color: "#000",
                    fontSize: 10,
                    fontWeight: "bold",
                  }}
                >
                  {g.isDouble ? "✓" : ""}
                </span>
              </button>

              {/* Divider */}
              <div style={{ width: 1, height: 14, backgroundColor: "#30363d" }} />

              {/* חוסר toggle */}
              <button
                className="text-xs px-2.5 py-1 rounded-md font-medium transition-all active:scale-95"
                style={{
                  border: `1px solid ${g.isAbsent ? "#f85149" : "#30363d"}`,
                  backgroundColor: g.isAbsent ? "#f8514920" : "transparent",
                  color: g.isAbsent ? "#f85149" : "#6e7681",
                  minWidth: 44,
                }}
                onClick={() => toggleAbsent(i)}
              >
                {g.isAbsent ? "✕ חוסר" : "חוסר"}
              </button>
            </div>

            {/* Left group: level buttons (non-gate only) */}
            {i < guards.length - 1 && (
              <div className="flex gap-1.5">
                {["strong", "mid", "achmash"].map(lv => (
                  <button
                    key={lv}
                    className="px-2.5 py-1 rounded-md text-xs font-medium transition-all"
                    style={{
                      border: `1px solid ${g.level === lv ? levelColor(lv) : "#30363d"}`,
                      backgroundColor: g.level === lv ? levelColor(lv) + "25" : "transparent",
                      color: g.level === lv ? levelColor(lv) : "#8b949e",
                    }}
                    onClick={() => updateGuard(i, "level", lv)}
                  >
                    {levelLabel(lv)}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Shortage Panel ───────────────────────────────────────────────────────────
function ShortagePanel({ absentGuard, absentIdx, totalGuards, gateDown, cicoDown, onCicoToggle }) {
  const absentName = guardDisplayName(absentGuard, absentIdx, totalGuards);

  const infoText = gateDown && cicoDown
    ? "מלשינון פעיל בכל שעות המשמרת · Lenel ו-Bosh בלבד"
    : gateDown
      ? "שער ירד · מלשינון פעיל 07–10 · CICO, Lenel, Bosh פעילים כרגיל"
      : cicoDown
        ? "CICO ירד · שאר העמדות פעילות · מלשינון כרגיל"
        : "כל העמדות פעילות · 4 שומרים פעילים";

  return (
    <div
      className="rounded-xl p-4 mb-4"
      style={{ direction: "rtl", backgroundColor: "#140c00", border: "1px solid #f0a500" }}
    >
      {/* Header */}
      <div className="flex items-center gap-2 mb-1">
        <span style={{ fontSize: 16 }}>⚠️</span>
        <span className="font-bold text-sm" style={{ color: "#f0a500" }}>מצב חוסר</span>
      </div>
      <p className="text-xs mb-4" style={{ color: "#8b949e" }}>
        {absentName} לא מגיע/ה למשמרת
      </p>

      {/* Toggles */}
      <div className="text-xs mb-2 font-medium" style={{ color: "#8b949e" }}>הורד עמדות:</div>
      <div className="flex gap-3 flex-wrap mb-3">

        {/* Gate toggle — auto-on when gate guard absent, dimmed otherwise */}
        <div
          className="flex items-center gap-2 px-3 py-2 rounded-lg"
          style={{
            border: `1px solid ${gateDown ? "#f0a500" : "#30363d"}`,
            backgroundColor: gateDown ? "#f0a50012" : "transparent",
            opacity: absentGuard.isGate ? 1 : 0.4,
          }}
        >
          <span
            className="w-4 h-4 rounded flex items-center justify-center flex-shrink-0"
            style={{
              backgroundColor: gateDown ? "#f0a500" : "transparent",
              border: `1.5px solid ${gateDown ? "#f0a500" : "#555"}`,
              color: "#000", fontSize: 10, fontWeight: "bold",
            }}
          >
            {gateDown ? "✓" : ""}
          </span>
          <span className="text-xs font-medium" style={{ color: gateDown ? "#f0a500" : "#8b949e" }}>
            שער{absentGuard.isGate ? " (אוטומטי)" : ""}
          </span>
        </div>

        {/* CICO toggle */}
        <button
          className="flex items-center gap-2 px-3 py-2 rounded-lg transition-all active:scale-95"
          style={{
            border: `1px solid ${cicoDown ? "#f0a500" : "#30363d"}`,
            backgroundColor: cicoDown ? "#f0a50012" : "transparent",
          }}
          onClick={onCicoToggle}
        >
          <span
            className="w-4 h-4 rounded flex items-center justify-center flex-shrink-0"
            style={{
              backgroundColor: cicoDown ? "#f0a500" : "transparent",
              border: `1.5px solid ${cicoDown ? "#f0a500" : "#555"}`,
              color: "#000", fontSize: 10, fontWeight: "bold",
            }}
          >
            {cicoDown ? "✓" : ""}
          </span>
          <span className="text-xs font-medium" style={{ color: cicoDown ? "#f0a500" : "#8b949e" }}>CICO</span>
        </button>
      </div>

      {/* Info */}
      <div
        className="text-xs px-3 py-2 rounded-lg"
        style={{ backgroundColor: "#1a1000", color: "#8b949e", border: "1px solid #2a1800" }}
      >
        ℹ️ {infoText}
      </div>
    </div>
  );
}

function ValidationPanel({ errors, isShortage }) {
  if (errors.length === 0) {
    return (
      <div className="rounded-xl p-3 mb-4 text-sm font-medium text-right" style={{ direction: "rtl", backgroundColor: "#0f1f10", border: "1px solid #1a4a1a", color: "#3fb950" }}>
        ✅ {isShortage ? "סידור חוסר תקין" : "הסידור תקין"} — כל הכללים מולאו!
      </div>
    );
  }
  return (
    <div className="rounded-xl p-3 mb-4" style={{ direction: "rtl", backgroundColor: "#1a1010", border: "1px solid #4a1515" }}>
      <h3 className="text-sm font-bold mb-2 text-right" style={{ color: "#f85149" }}>⚠️ אזהרות</h3>
      {errors.map((e, i) => (
        <div key={i} className="text-xs py-0.5 text-right" style={{ color: "#fca5a5" }}>⚠️ {e}</div>
      ))}
    </div>
  );
}

function StatsRow({ sched, guards }) {
  return (
    <div className="flex overflow-x-auto gap-2 mb-4 pb-2" style={{ direction: "rtl" }}>
      {guards.map((g, gi) => {
        const row = sched.map(r => r[gi]).filter(Boolean);
        const lc = levelColor(g.level);
        return (
          <div key={gi} className="rounded-xl p-3 flex-shrink-0" style={{ backgroundColor: "#161b22", border: "1px solid #30363d", minWidth: 130 }}>
            <div className="text-xs font-bold text-center mb-0.5" style={{ color: lc }}>{guardDisplayName(g, gi, guards.length)}</div>
            {(g.isDouble || g.isGate) && (
              <div className="text-xs text-center mb-2" style={{ color: lc }}>
                {[g.isGate && "שער", g.isDouble && "כפולה"].filter(Boolean).join(" · ")}
              </div>
            )}
            {Object.keys(SL).map(station => {
              const cnt = row.filter(x => x === station).length;
              return (
                <div key={station} className="flex items-center gap-1 mb-1" style={{ direction: "rtl" }}>
                  <span className="text-xs w-10 text-right flex-shrink-0" style={{ color: "#8b949e" }}>{SL[station]}</span>
                  <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: "#30363d" }}>
                    <div className="h-full rounded-full transition-all" style={{ width: `${(cnt / 8) * 100}%`, backgroundColor: SC[station]?.border }} />
                  </div>
                  <span className="text-xs w-4 text-center flex-shrink-0" style={{ color: "#8b949e" }}>{cnt}</span>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

function ScheduleTable({ sched, guards, onCellPress, isShortage }) {
  return (
    <div className="rounded-2xl p-3 mb-4 overflow-x-auto" style={{ backgroundColor: "#161b22", border: "1px solid #30363d" }}>
      <h2 className="text-sm font-bold text-center mb-3" style={{ color: "#f0a500" }}>
        📋 טבלת השיבוץ{isShortage ? " · ⚠️ חוסר" : ""}
      </h2>
      <Legend />
      <div style={{ direction: "rtl", minWidth: guards.length * 65 + 70 }}>
        {/* Header */}
        <div className="flex" style={{ borderBottom: "1px solid #30363d" }}>
          <div className="flex-shrink-0 flex items-center justify-center py-2" style={{ width: 70, backgroundColor: "#1c2330" }}>
            <span className="text-xs font-bold" style={{ color: "#8b949e" }}>שעות</span>
          </div>
          {guards.map((g, gi) => (
            <div key={gi} className="flex-1 flex items-center justify-center py-2 min-w-0" style={{ backgroundColor: "#1c2330", borderRight: "1px solid #30363d" }}>
              <span className="text-xs font-bold truncate px-1" style={{ color: "#e6edf3" }}>{guardDisplayName(g, gi, guards.length)}</span>
            </div>
          ))}
        </div>
        {/* Rows */}
        {HOURS.map((hr, h) => (
          <div key={h} className="flex" style={{ borderBottom: "1px solid #21262d" }}>
            <div className="flex-shrink-0 flex items-center justify-center py-1" style={{ width: 70, backgroundColor: "#1c2330" }}>
              <span className="text-xs font-semibold" style={{ color: "#8b949e" }}>{hr}</span>
            </div>
            {guards.map((_, gi) => {
              const cell = sched[h][gi];
              const col = cell ? SC[cell] : null;
              return (
                <button
                  key={gi}
                  className="flex-1 flex items-center justify-center m-0.5 rounded-lg transition-all active:scale-95"
                  style={{
                    minHeight: 40,
                    backgroundColor: col ? col.bg : "transparent",
                    border: `1px solid ${col ? col.border : "#30363d"}`,
                    minWidth: 55,
                  }}
                  onClick={() => onCellPress(h, gi)}
                >
                  <span className="text-xs font-bold" style={{ color: col ? col.text : "#8b949e" }}>
                    {cell ? SL[cell] : "—"}
                  </span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function CellEditModal({ visible, hour, guardIdx, guards, cfg, onSelect, onClose }) {
  if (!visible) return null;
  const base = hour !== null ? assignable(hour, cfg || {}) : [];
  const menuOpts = hour !== null
    ? [...new Set([...base, ...((cfg?.gateDown) ? [] : ["shaar"])])]
    : [];
  return (
    <div
      className="fixed inset-0 flex items-center justify-center z-50"
      style={{ backgroundColor: "rgba(0,0,0,0.75)" }}
      onClick={onClose}
    >
      <div
        className="rounded-2xl p-4"
        style={{ backgroundColor: "#161b22", border: "1px solid #30363d", minWidth: 200 }}
        onClick={e => e.stopPropagation()}
      >
        <h3 className="text-sm font-bold text-center mb-3" style={{ color: "#e6edf3" }}>בחר עמדה</h3>
        <div className="flex flex-col gap-2">
          {menuOpts.map(option => {
            const col = SC[option];
            if (!col) return null;
            return (
              <button
                key={option}
                className="py-2.5 px-4 rounded-lg font-bold text-sm text-center transition-all active:scale-95"
                style={{ backgroundColor: col.bg, color: col.text, border: `1px solid ${col.border}` }}
                onClick={() => onSelect(option)}
              >
                {SL[option]}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Canvas Image Generator ───────────────────────────────────────────────────
function rrect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y,     x + w, y + r,     r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x,     y + h, x,     y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x,     y,     x + r, y,          r);
  ctx.closePath();
}

function buildScheduleCanvas(sched, guards) {
  const SCALE  = 2;
  const W      = 840;
  const PAD    = 20;
  const TW     = 76;
  const ROW_H  = 46;
  const HDR_H  = 38;
  const CP     = 3;
  const N      = guards.length;
  const guardW = (W - 2 * PAD - TW) / N;

  const GRID_X  = PAD;
  const TIME_X  = GRID_X + N * guardW;
  const GRID_W  = TW + N * guardW;
  const GRID_Y  = PAD + 90;
  const GRID_H  = HDR_H + 2 + ROW_H * 8;
  const H       = GRID_Y + GRID_H + 36;

  const canvas  = document.createElement("canvas");
  canvas.width  = W * SCALE;
  canvas.height = H * SCALE;
  const ctx     = canvas.getContext("2d");
  ctx.scale(SCALE, SCALE);

  ctx.fillStyle = "#0d1117";
  ctx.fillRect(0, 0, W, H);

  ctx.textAlign    = "center";
  ctx.textBaseline = "middle";

  ctx.fillStyle = "#f0a500";
  ctx.font      = "bold 24px Arial";
  ctx.fillText("טבלת השיבוץ", W / 2, PAD + 16);

  const today = new Date().toLocaleDateString("he-IL", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  });
  ctx.fillStyle = "#8b949e";
  ctx.font      = "13px Arial";
  ctx.fillText(today, W / 2, PAD + 42);
  ctx.font      = "11px Arial";
  ctx.fillText("משמרת בוקר 07:00–15:00", W / 2, PAD + 59);

  ctx.fillStyle = "#f0a500";
  ctx.fillRect(W / 2 - 28, PAD + 72, 56, 2);

  ctx.fillStyle = "#1c2330";
  ctx.fillRect(GRID_X, GRID_Y, GRID_W, HDR_H);

  guards.forEach((g, gi) => {
    const colX = GRID_X + (N - 1 - gi) * guardW;
    const cx   = colX + guardW / 2;

    ctx.fillStyle = "#30363d";
    ctx.fillRect(colX, GRID_Y, 1, HDR_H);

    let name = guardDisplayName(g, gi, guards.length);
    ctx.font = "bold 12px Arial";
    while (ctx.measureText(name).width > guardW - 10 && name.length > 2)
      name = name.slice(0, -1);
    if (name !== guardDisplayName(g, gi, guards.length)) name += "…";

    ctx.fillStyle    = "#e6edf3";
    ctx.textAlign    = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(name, cx, GRID_Y + HDR_H / 2);
  });

  ctx.fillStyle = "#30363d";
  ctx.fillRect(TIME_X, GRID_Y, 1, HDR_H);
  ctx.fillStyle    = "#8b949e";
  ctx.font         = "bold 12px Arial";
  ctx.textAlign    = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("שעה", TIME_X + TW / 2, GRID_Y + HDR_H / 2);

  ctx.fillStyle = "#30363d";
  ctx.fillRect(GRID_X, GRID_Y + HDR_H, GRID_W, 2);

  HOURS.forEach((hr, h) => {
    const ry = GRID_Y + HDR_H + 2 + h * ROW_H;

    if (h > 0) { ctx.fillStyle = "#21262d"; ctx.fillRect(GRID_X, ry, GRID_W, 1); }

    ctx.fillStyle = "#1c2330";
    ctx.fillRect(TIME_X, ry, TW, ROW_H);
    ctx.fillStyle    = "#8b949e";
    ctx.font         = "600 12px Arial";
    ctx.textAlign    = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(hr.split("-")[0], TIME_X + TW / 2, ry + ROW_H / 2);

    guards.forEach((_, gi) => {
      const st   = sched[h][gi];
      const col  = st ? SC[st] : null;
      const colX = GRID_X + (N - 1 - gi) * guardW;
      const ix = colX + CP, iy = ry + CP, iw = guardW - CP * 2, ih = ROW_H - CP * 2;

      if (col) {
        ctx.fillStyle = col.bg;
        rrect(ctx, ix, iy, iw, ih, 6); ctx.fill();
        ctx.strokeStyle = col.border; ctx.lineWidth = 1;
        rrect(ctx, ix + .5, iy + .5, iw - 1, ih - 1, 6); ctx.stroke();
        ctx.fillStyle    = col.text;
        ctx.font         = "bold 12px Arial";
        ctx.textAlign    = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(SL[st], colX + guardW / 2, ry + ROW_H / 2);
      } else {
        ctx.strokeStyle = "#30363d"; ctx.lineWidth = 1;
        rrect(ctx, ix + .5, iy + .5, iw - 1, ih - 1, 6); ctx.stroke();
      }
    });
  });

  ctx.strokeStyle = "#30363d"; ctx.lineWidth = 1;
  ctx.strokeRect(GRID_X + .5, GRID_Y + .5, GRID_W - 1, GRID_H - 1);

  ctx.fillStyle    = "#30363d";
  ctx.font         = "10px Arial";
  ctx.textAlign    = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("מנהל משמרות אבטחה ©", W / 2, GRID_Y + GRID_H + 18);

  return canvas;
}

// ─── Fullscreen Table ─────────────────────────────────────────────────────────
function FullscreenTable({ sched, guards, onClose }) {
  return (
    <div
      className="fixed inset-0 z-50 flex flex-col"
      style={{ backgroundColor: "#0d1117", height: "100dvh", width: "100dvw" }}
    >
      <div
        className="flex items-center justify-between flex-shrink-0"
        style={{
          direction: "rtl",
          borderBottom: "1px solid #30363d",
          paddingTop: "calc(env(safe-area-inset-top) + 6px)",
          paddingBottom: "6px",
          paddingLeft: "calc(env(safe-area-inset-left) + 12px)",
          paddingRight: "calc(env(safe-area-inset-right) + 12px)",
        }}
      >
        <span className="font-extrabold text-xs" style={{ color: "#f0a500" }}>📋 טבלת השיבוץ</span>
        <button
          className="w-7 h-7 rounded-full flex items-center justify-center font-black text-white text-xs"
          style={{ backgroundColor: "#f85149" }}
          onClick={onClose}
        >✕</button>
      </div>

      <div
        className="flex-1 flex flex-col overflow-hidden"
        style={{
          direction: "rtl",
          paddingLeft: "env(safe-area-inset-left)",
          paddingRight: "env(safe-area-inset-right)",
          paddingBottom: "env(safe-area-inset-bottom)",
        }}
      >
        <div className="flex flex-shrink-0" style={{ borderBottom: "1px solid #30363d" }}>
          <div
            className="flex-shrink-0 flex items-center justify-center py-1"
            style={{ width: 64, backgroundColor: "#1c2330" }}
          >
            <span className="text-xs font-bold" style={{ color: "#8b949e" }}>שעה</span>
          </div>
          {guards.map((g, gi) => (
            <div
              key={gi}
              className="flex-1 flex items-center justify-center py-1 min-w-0"
              style={{ backgroundColor: "#1c2330", borderRight: "1px solid #30363d" }}
            >
              <span className="font-bold truncate px-1" style={{ color: "#e6edf3", fontSize: 11 }}>
                {guardDisplayName(g, gi, guards.length)}
              </span>
            </div>
          ))}
        </div>

        {HOURS.map((hr, h) => (
          <div key={h} className="flex flex-1" style={{ borderBottom: "1px solid #21262d" }}>
            <div
              className="flex-shrink-0 flex items-center justify-center"
              style={{ width: 64, backgroundColor: "#1c2330" }}
            >
              <span className="font-semibold" style={{ color: "#8b949e", fontSize: 10 }}>
                {hr.split("-")[0]}
              </span>
            </div>
            {guards.map((_, gi) => {
              const cell = sched[h][gi];
              const col = cell ? SC[cell] : null;
              return (
                <div
                  key={gi}
                  className="flex-1 flex items-center justify-center m-0.5 rounded"
                  style={{
                    backgroundColor: col ? col.bg : "transparent",
                    border: `1px solid ${col ? col.border : "#30363d"}`,
                  }}
                >
                  <span className="font-bold text-center leading-tight px-0.5" style={{ color: col ? col.text : "#8b949e", fontSize: 10 }}>
                    {cell ? SL[cell] : "—"}
                  </span>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [guards, setGuards] = useState(DEFAULT_GUARDS.map(g => ({ ...g })));
  const [sched, setSched] = useState(null);
  const [errors, setErrors] = useState([]);
  const [generating, setGenerating] = useState(false);
  const [selCell, setSelCell] = useState(null);
  const [menuVisible, setMenuVisible] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [origSched, setOrigSched] = useState(null);
  const [cicoDown, setCicoDown] = useState(false);

  // Derived: active guards (those not absent) and shortage config
  const absentGuard = useMemo(() => guards.find(g => g.isAbsent) ?? null, [guards]);
  const absentIdx   = useMemo(() => guards.findIndex(g => g.isAbsent), [guards]);
  const isShortage  = !!absentGuard;
  const displayGuards = useMemo(() => guards.filter(g => !g.isAbsent), [guards]);
  const effectiveCfg  = useMemo(() => ({
    gateDown:   absentGuard?.isGate ?? false,
    cicoDown,
    isShortage,
  }), [absentGuard, cicoDown, isShortage]);

  // Clear schedule when active guard count changes (absence toggled)
  const activeCount = displayGuards.length;
  useEffect(() => {
    setSched(null);
    setErrors([]);
    setOrigSched(null);
  }, [activeCount]);

  const handleGenerate = useCallback(() => {
    setGenerating(true);
    setTimeout(() => {
      const s = generate(displayGuards, effectiveCfg);
      setSched(s);
      setOrigSched(s.map(r => [...r]));
      setErrors(validateSched(s, displayGuards, effectiveCfg));
      setGenerating(false);
    }, 10);
  }, [displayGuards, effectiveCfg]);

  const handleReset = useCallback(() => {
    if (!origSched) return;
    const s = origSched.map(r => [...r]);
    setSched(s);
    setErrors(validateSched(s, displayGuards, effectiveCfg));
  }, [origSched, displayGuards, effectiveCfg]);

  const handleCellPress = useCallback((h, g) => {
    if (displayGuards[g]?.isGate && h < 3 && !effectiveCfg.gateDown) return;
    setSelCell({ h, g });
    setMenuVisible(true);
  }, [displayGuards, effectiveCfg]);

  const handleShare = useCallback(async () => {
    if (!sched) return;
    setSharing(true);
    try {
      const canvas = buildScheduleCanvas(sched, displayGuards);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
      const file = new File([blob], "sidur-avtaha.png", { type: "image/png" });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: "טבלת השיבוץ" });
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url; a.download = "sidur-avtaha.png"; a.click();
        URL.revokeObjectURL(url);
      }
    } catch (err) {
      if (err.name !== "AbortError") console.error("Share error:", err);
    } finally {
      setSharing(false);
    }
  }, [sched, displayGuards]);

  const handleSetCell = useCallback((st) => {
    if (!selCell || !sched) return;
    const { h, g } = selCell;
    const ns = sched.map(r => [...r]);
    ns[h][g] = st;
    setSched(ns);
    setErrors(validateSched(ns, displayGuards, effectiveCfg));
    setMenuVisible(false);
  }, [selCell, sched, displayGuards, effectiveCfg]);

  return (
    <div className="min-h-screen" style={{ backgroundColor: "#0d1117", fontFamily: "'Segoe UI', Tahoma, sans-serif" }}>
      <div className="max-w-lg mx-auto px-3 py-4 pb-20">
        {/* Header */}
        <div className="rounded-2xl p-5 mb-4 text-center relative overflow-hidden" style={{ backgroundColor: "#161b22", border: "1px solid #30363d" }}>
          <div className="absolute top-0 left-0 right-0 h-1" style={{ backgroundColor: "#f0a500" }} />
          <h1 className="text-xl font-black" style={{ color: "#e6edf3" }}>🛡️ מנהל משמרות אבטחה</h1>
          <p className="text-xs mt-1" style={{ color: "#8b949e" }}>שיבוץ אוטומטי חכם · משמרת בוקר 07:00–15:00</p>
        </div>

        {/* Collapsible Rules */}
        <div className="rounded-xl mb-4" style={{ backgroundColor: "#1c2330", border: "1px solid #30363d" }}>
          <button
            className="w-full p-3 text-center text-xs transition-all"
            style={{ color: "#8b949e" }}
            onClick={() => setShowRules(!showRules)}
          >
            <span style={{ color: "#e6edf3", fontWeight: 700 }}>📖 כללים </span>
            <span>{showRules ? "▲" : "▼"}</span>
          </button>
          {showRules && (
            <div className="px-3 pb-3" style={{ direction: "rtl" }}>
              {[
                "CICO לא פעיל 07–08",
                "מלשינון לא פעיל 08–10",
                "שער 07–10 בלבד",
                "מקס׳ 3 שעות ברצף",
                "אחרי CICO → הפסקה חובה",
                "אחמ״ש: ללא CICO",
                "CICO מתחלק שווה",
                "כפולה: CICO בשעה האחרונה",
                "אין מלשינון רצוף",
                "אין כפילויות",
                "איזון הפסקות (פער מקס׳ 1)",
                "חוסר: מלשינון עובר ל-07–10 כששער יורד",
              ].map((rule, i) => (
                <div key={i} className="flex items-center gap-1.5 py-0.5">
                  <span className="text-xs">✅</span>
                  <span className="text-xs leading-5" style={{ color: "#8b949e" }}>{rule}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Guard Setup */}
        <GuardSetup guards={guards} setGuards={setGuards} />

        {/* Shortage Panel (shown when exactly 1 guard is absent) */}
        {isShortage && (
          <ShortagePanel
            absentGuard={absentGuard}
            absentIdx={absentIdx}
            totalGuards={guards.length}
            gateDown={effectiveCfg.gateDown}
            cicoDown={cicoDown}
            onCicoToggle={() => setCicoDown(v => !v)}
          />
        )}

        {/* Generate Button */}
        <button
          className="w-full py-3 rounded-xl font-extrabold text-sm mb-4 transition-all active:scale-95"
          style={{ backgroundColor: "#f0a500", color: "#000" }}
          onClick={handleGenerate}
          disabled={generating}
        >
          {generating
            ? "⏳ מחשב..."
            : isShortage
              ? "⚡ צור סידור חוסר"
              : "⚡ צור סידור אוטומטי"}
        </button>

        {/* Stats */}
        {sched && <StatsRow sched={sched} guards={displayGuards} />}

        {/* Schedule Table */}
        {sched && (
          <>
            <ScheduleTable
              sched={sched}
              guards={displayGuards}
              onCellPress={handleCellPress}
              isShortage={isShortage}
            />
            <div className="flex justify-center mb-4">
              <button
                className="px-5 py-2 rounded-xl text-xs font-bold transition-all active:scale-95"
                style={{ backgroundColor: "#1c2330", border: "1px solid #f0a500", color: "#f0a500" }}
                onClick={() => setFullscreen(true)}
              >
                🔲 מסך מלא
              </button>
            </div>
          </>
        )}

        {/* Action buttons */}
        {sched && (
          <div className="flex gap-2 mb-3" style={{ direction: "rtl" }}>
            <button
              className="flex-1 py-2.5 rounded-xl text-xs font-semibold transition-all active:scale-95"
              style={{ backgroundColor: "#1c2330", border: "1px solid #30363d", color: origSched ? "#e6edf3" : "#555" }}
              onClick={handleReset}
              disabled={!origSched}
            >
              ↩️ איפס שינוי ידני
            </button>
            <button
              className="flex-1 py-2.5 rounded-xl text-xs font-semibold transition-all active:scale-95"
              style={{ backgroundColor: "#1c2330", border: "1px solid #30363d", color: "#e6edf3" }}
              onClick={() => setErrors(validateSched(sched, displayGuards, effectiveCfg))}
            >
              ✔️ בדוק כללים
            </button>
          </div>
        )}

        {/* Validation */}
        {sched && <ValidationPanel errors={errors} isShortage={isShortage} />}

        {/* Share */}
        {sched && (
          <button
            className="w-full py-3 rounded-xl text-sm font-extrabold mb-4 transition-all active:scale-95"
            style={{
              backgroundColor: sharing ? "#1a3a25" : "#25d366",
              border: "1px solid #25d366",
              color: "#fff",
              opacity: sharing ? 0.8 : 1,
            }}
            onClick={handleShare}
            disabled={sharing}
          >
            {sharing ? "⏳ מכין תמונה..." : "📤 שתף סידור"}
          </button>
        )}
      </div>

      {/* Cell Edit Modal */}
      <CellEditModal
        visible={menuVisible}
        hour={selCell?.h}
        guardIdx={selCell?.g}
        guards={displayGuards}
        cfg={effectiveCfg}
        onSelect={handleSetCell}
        onClose={() => setMenuVisible(false)}
      />

      {/* Fullscreen */}
      {sched && fullscreen && (
        <FullscreenTable sched={sched} guards={displayGuards} onClose={() => setFullscreen(false)} />
      )}
    </div>
  );
}
