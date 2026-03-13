// ─── Scheduling Logic (copied from App.jsx) ───────────────────────────────────
const HOURS = [
  "07:00-08:00","08:00-09:00","09:00-10:00","10:00-11:00",
  "11:00-12:00","12:00-13:00","13:00-14:00","14:00-15:00",
];
const SL = {
  cico: "CICO", lenel: "Lenel", bosh: "Bosh",
  break: "הפסקה", malshinon: "מלשינון", shaar: "שער",
};
const REST = new Set(["break", "malshinon", "shaar"]);

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function assignable(h) {
  const s = ["lenel", "bosh", "break"];
  if (h > 0) s.push("cico");
  if (h === 0 || h >= 3) s.push("malshinon");
  if (h <= 2) s.push("shaar");
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
function canPlaceFix(h, g, st, sched, guards) {
  if (!assignable(h).includes(st)) return false;
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
function guardDisplayName(g, i, total) {
  return g.name || (i === total - 1 ? "מאבטח שער" : `מאבטח ${i + 1}`);
}
function validateSched(sched, guards) {
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
    if (guard.level === "achmash") {
      const required = ["lenel", "bosh", "malshinon", "break"];
      if (achmashCount >= 2) required.push("cico");
      required.forEach(r => {
        if (!row.includes(r)) errs.push(`${gName}: חסר ${SL[r] || r}`);
      });
    } else if (guard.isGate) {
      if (!row.includes("cico")) errs.push(`${gName}: חסר CICO`);
    } else {
      ["lenel", "bosh", "cico", "malshinon", "break"].forEach(r => {
        if (!row.includes(r)) errs.push(`${gName}: חסר ${SL[r] || r}`);
      });
    }
    const restCnt = row.filter(s => s === "break" || s === "malshinon").length;
    if (restCnt > 3) errs.push(`${gName}: ${restCnt} שעות מנוחה (מקס׳ 3)`);
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
function tryGen(seed, guards) {
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
  guards.forEach((g, gi) => {
    if (g.isGate) for (let h = 0; h < 3; h++) sched[h][gi] = "shaar";
    if (g.isDouble) sched[7][gi] = "cico";
  });
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
  for (const h of shuffle([0, 1, 2, 3, 4, 5, 6, 7])) {
    if (sched[h].includes("lenel")) continue;
    const cands = shuffle(Array.from({ length: N }, (_, i) => i)).filter(g =>
      free(h, g) && !needsBreak(h, g) && activeConsec(h, g) < 3
    );
    if (cands.length) sched[h][cands[0]] = "lenel";
  }
  for (const h of shuffle([0, 1, 2, 3, 4, 5, 6, 7])) {
    if (sched[h].includes("bosh")) continue;
    const cands = shuffle(Array.from({ length: N }, (_, i) => i)).filter(g =>
      free(h, g) && !needsBreak(h, g) && activeConsec(h, g) < 3
    );
    if (cands.length) sched[h][cands[0]] = "bosh";
  }
  for (const h of shuffle([0, 3, 4, 5, 6, 7])) {
    if (sched[h].includes("malshinon")) continue;
    const cands = shuffle(Array.from({ length: N }, (_, i) => i)).filter(g => {
      if (!free(h, g) || needsBreak(h, g)) return false;
      const curMals   = sched.map(r => r[g]).filter(s => s === "malshinon").length;
      const curBreaks = sched.map(r => r[g]).filter(s => s === "break").length;
      const emptySlots = sched.map(r => r[g]).filter(s => !s).length;
      return (curMals + 1) + curBreaks + (emptySlots - 1) <= 3;
    });
    if (cands.length) sched[h][cands[0]] = "malshinon";
  }
  for (let h = 0; h < 8; h++) {
    for (let g = 0; g < N; g++) {
      if (sched[h][g]) continue;
      const hourBreakTaken = sched[h].some((s, gi) => gi !== g && s === "break");
      const hourMalsTaken  = sched[h].some((s, gi) => gi !== g && s === "malshinon");
      const prevMals       = h > 0 && sched[h - 1][g] === "malshinon";
      const prevBreak      = h > 0 && sched[h - 1][g] === "break";
      const nextMals       = h < 7 && sched[h + 1][g] === "malshinon";
      const malsValid = (h === 0 || h >= 3) && !prevMals && !nextMals && !hourMalsTaken;
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
function postFix(sched, guards) {
  for (let iter = 0; iter < 20; iter++) {
    let improved = false;
    const errs = validateSched(sched, guards);
    if (!errs.length) break;

    const achmashCount = guards.filter(x => x.level === "achmash").length;
    for (let g = 0; g < guards.length && !improved; g++) {
      const needed = guards[g].level === "achmash"
        ? (achmashCount >= 2 ? ["lenel", "bosh", "malshinon", "break", "cico"] : ["lenel", "bosh", "malshinon", "break"])
        : guards[g].isGate
          ? ["cico"]
          : ["lenel", "bosh", "malshinon", "cico", "break"];
      for (const need of needed) {
        if (sched.map(r => r[g]).includes(need)) continue;
        for (let h = 0; h < 8; h++) {
          const cur = sched[h][g];
          if (cur === "shaar" || cur === need) continue;
          sched[h][g] = need;
          if (canPlaceFix(h, g, need, sched, guards) &&
              validateSched(sched, guards).length < errs.length) {
            improved = true; break;
          }
          sched[h][g] = cur;
        }
        if (improved) break;
      }
    }

    for (let h = 0; h < 8 && !improved; h++) {
      const breakGuards = sched[h].map((s, gi) => gi).filter(gi => sched[h][gi] === "break");
      if (breakGuards.length <= 1) continue;
      for (let k = 1; k < breakGuards.length && !improved; k++) {
        const g = breakGuards[k];
        if (sched[h][g] === "shaar") continue;
        const prev = sched[h][g];
        sched[h][g] = "malshinon";
        if (canPlaceFix(h, g, "malshinon", sched, guards) &&
            validateSched(sched, guards).length < errs.length) {
          improved = true;
        } else {
          sched[h][g] = prev;
        }
      }
    }

    for (let g = 0; g < guards.length && !improved; g++) {
      const restCnt = sched.map(r => r[g]).filter(s => s === "break" || s === "malshinon").length;
      if (restCnt <= 3) continue;
      for (let h = 0; h < 8 && !improved; h++) {
        const curSt = sched[h][g];
        if (curSt !== "break" && curSt !== "malshinon") continue;
        for (let g2 = 0; g2 < guards.length && !improved; g2++) {
          if (g2 === g) continue;
          const st2 = sched[h][g2];
          if (!st2 || REST.has(st2)) continue;
          const rested2 = sched.map(r => r[g2]).filter(s => s === "break" || s === "malshinon").length;
          if (rested2 >= 3) continue;
          sched[h][g]  = st2;
          sched[h][g2] = curSt;
          if (validateSched(sched, guards).length < errs.length) { improved = true; break; }
          sched[h][g]  = curSt;
          sched[h][g2] = st2;
        }
      }
    }

    for (let g = 0; g < guards.length && !improved; g++) {
      for (let h = 1; h < 8 && !improved; h++) {
        if (sched[h][g] !== "break" || sched[h - 1][g] !== "break") continue;
        if (assignable(h).includes("malshinon") &&
            !sched[h].some((s, gi) => gi !== g && s === "malshinon") &&
            !(h < 7 && sched[h + 1][g] === "malshinon")) {
          sched[h][g] = "malshinon";
          if (validateSched(sched, guards).length < errs.length) { improved = true; break; }
          sched[h][g] = "break";
        }
        if (!improved &&
            assignable(h - 1).includes("malshinon") &&
            !sched[h - 1].some((s, gi) => gi !== g && s === "malshinon") &&
            !(h > 1 && sched[h - 2][g] === "malshinon")) {
          sched[h - 1][g] = "malshinon";
          if (validateSched(sched, guards).length < errs.length) { improved = true; break; }
          sched[h - 1][g] = "break";
        }
      }
    }

    for (let h = 0; h < 8 && !improved; h++) {
      for (let g = 0; g < guards.length && !improved; g++) {
        for (let g2 = g + 1; g2 < guards.length && !improved; g2++) {
          const s1 = sched[h][g], s2 = sched[h][g2];
          if (!s1 || !s2 || s1 === s2) continue;
          if (s1 === "shaar" || s2 === "shaar") continue;
          sched[h][g] = s2; sched[h][g2] = s1;
          if (canPlaceFix(h, g, s2, sched, guards) &&
              canPlaceFix(h, g2, s1, sched, guards) &&
              validateSched(sched, guards).length < errs.length) {
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
function generate(guards) {
  let bestSched = null;
  let bestErrs = 9999;
  for (let seed = 0; seed < 3000; seed++) {
    const s = tryGen(seed, guards);
    postFix(s, guards);
    const e = validateSched(s, guards).length;
    if (e < bestErrs) { bestErrs = e; bestSched = s.map(r => [...r]); }
    if (bestErrs === 0) break;
  }
  return { sched: bestSched ?? Array.from({ length: 8 }, () => Array(guards.length).fill("")), errs: bestErrs };
}

// ─── Test Runner ──────────────────────────────────────────────────────────────
function mk(level, isGate = false, isDouble = false, name = "") {
  return { name, level, isGate, isDouble };
}

const scenarios = [
  // ── Classic compositions ──
  {
    name: "קלאסי: 2 ותיק + 2 חדש + שער (חדש)",
    guards: [mk("strong"), mk("strong"), mk("mid"), mk("mid"), mk("mid", true)],
  },
  {
    name: "קלאסי + כפולה על ותיק",
    guards: [mk("strong", false, true), mk("strong"), mk("mid"), mk("mid"), mk("mid", true)],
  },
  {
    name: "קלאסי + כפולה על חדש",
    guards: [mk("strong"), mk("strong"), mk("mid", false, true), mk("mid"), mk("mid", true)],
  },
  // ── All-same compositions ──
  {
    name: "כל ותיקים: 4 ותיק + שער (ותיק)",
    guards: [mk("strong"), mk("strong"), mk("strong"), mk("strong"), mk("strong", true)],
  },
  {
    name: "כל חדשים: 4 חדש + שער (חדש)",
    guards: [mk("mid"), mk("mid"), mk("mid"), mk("mid"), mk("mid", true)],
  },
  // ── Non-classic without achmash ──
  {
    name: "3 ותיק + 1 חדש + שער (חדש)",
    guards: [mk("strong"), mk("strong"), mk("strong"), mk("mid"), mk("mid", true)],
  },
  {
    name: "1 ותיק + 3 חדש + שער (חדש)",
    guards: [mk("strong"), mk("mid"), mk("mid"), mk("mid"), mk("mid", true)],
  },
  {
    name: "3 ותיק + 1 חדש + שער (ותיק)",
    guards: [mk("strong"), mk("strong"), mk("strong"), mk("mid"), mk("strong", true)],
  },
  {
    name: "2 ותיק + 2 חדש + שער (ותיק)",
    guards: [mk("strong"), mk("strong"), mk("mid"), mk("mid"), mk("strong", true)],
  },
  // ── Achmash compositions ──
  {
    name: "1 אחמ\"ש + 2 ותיק + 1 חדש + שער",
    guards: [mk("achmash"), mk("strong"), mk("strong"), mk("mid"), mk("mid", true)],
  },
  {
    name: "2 אחמ\"ש + 1 ותיק + 1 חדש + שער",
    guards: [mk("achmash"), mk("achmash"), mk("strong"), mk("mid"), mk("mid", true)],
  },
  {
    name: "2 אחמ\"ש + 2 ותיק + שער",
    guards: [mk("achmash"), mk("achmash"), mk("strong"), mk("strong"), mk("strong", true)],
  },
  {
    name: "1 אחמ\"ש + 3 ותיק + שער",
    guards: [mk("achmash"), mk("strong"), mk("strong"), mk("strong"), mk("mid", true)],
  },
  // ── Edge cases ──
  {
    name: "4 ותיק בלי שער",
    guards: [mk("strong"), mk("strong"), mk("strong"), mk("strong")],
  },
  {
    name: "4 חדש בלי שער",
    guards: [mk("mid"), mk("mid"), mk("mid"), mk("mid")],
  },
  {
    name: "2 ותיק + 1 חדש + שער (4 שומרים)",
    guards: [mk("strong"), mk("strong"), mk("mid"), mk("mid", true)],
  },
  {
    name: "1 אחמ\"ש + 1 ותיק + 1 חדש + שער (4 שומרים)",
    guards: [mk("achmash"), mk("strong"), mk("mid"), mk("mid", true)],
  },
];

// ─── Run ──────────────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;

console.log("═══════════════════════════════════════════════════════════");
console.log("         בדיקת כל תרחישי הרכב הצוות (מצב רגיל)");
console.log("═══════════════════════════════════════════════════════════\n");

for (const scenario of scenarios) {
  const { sched, errs } = generate(scenario.guards);
  const validationErrors = validateSched(sched, scenario.guards);
  const ok = validationErrors.length === 0;

  if (ok) {
    console.log(`✅ PASS | ${scenario.name}`);
    passed++;
  } else {
    console.log(`❌ FAIL | ${scenario.name}`);
    validationErrors.forEach(e => console.log(`         ⚠ ${e}`));
    failed++;
  }
}

console.log("\n═══════════════════════════════════════════════════════════");
console.log(`סיכום: ${passed} עברו ✅  |  ${failed} נכשלו ❌  |  סה"כ ${scenarios.length}`);
console.log("═══════════════════════════════════════════════════════════");
if (failed === 0) {
  console.log("\n🎉 כל התרחישים עברו בהצלחה — הקוד מוכן לפיתוח חוסר!");
} else {
  console.log("\n⛔ יש תרחישים שנכשלו — יש לתקן לפני פיתוח חוסר.");
}
