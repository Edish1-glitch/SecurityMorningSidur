import { useState, useCallback, useMemo, useRef } from "react";
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
// ─── Scheduling Logic (unchanged) ────────────────────────────────────────────
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
  if (g.level === "achmash") return 0;
  const hasAchmash = guards.some(x => x.level === "achmash" && !x.isGate);
  if (g.isGate) return hasAchmash ? 2 : 1;
  if (hasAchmash) {
    const eligible = guards.filter(x => x.level !== "achmash").length;
    if (eligible === 0) return 0;
    return Math.ceil(7 / eligible);
  }
  return g.level === "strong" ? 1 : 2;
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
  if (sched[h].some((s, gi) => gi !== g && s === st)) return false;
  return true;
}
function validateSched(sched, guards) {
  const errs = [];
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
    const cc = row.filter(s => s === "cico").length;
    const lim = cicoLimit(g, guards);
    if (cc > lim) errs.push(`${gName}: ${cc} CICO (מקס׳ ${lim})`);
    if (guard.isDouble && row[7] !== "cico")
      errs.push(`${gName}: כפולה חייב CICO בשעה האחרונה`);
    for (let h = 0; h < 7; h++) {
      if (row[h] === "malshinon" && row[h + 1] === "malshinon")
        errs.push(`${gName}: מלשינון רצוף@${HOURS[h]}`);
    }
    if (guard.level === "achmash") {
      ["lenel", "bosh", "malshinon", "break"].forEach(r => {
        if (!row.includes(r)) errs.push(`${gName}: חסר ${SL[r] || r}`);
      });
    } else if (guard.isGate) {
      if (!row.includes("cico")) errs.push(`${gName}: חסר CICO`);
    } else {
      ["lenel", "bosh", "cico", "malshinon", "break"].forEach(r => {
        if (!row.includes(r)) errs.push(`${gName}: חסר ${SL[r] || r}`);
      });
    }
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
  const cicoGuards = shuffle(Array.from({ length: N }, (_, i) => i))
    .filter(g => guards[g].level !== "achmash");
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
    const cands = shuffle(Array.from({ length: N }, (_, i) => i)).filter(g =>
      free(h, g) && !needsBreak(h, g)
    );
    if (cands.length) sched[h][cands[0]] = "malshinon";
  }
  for (let h = 0; h < 8; h++) {
    for (let g = 0; g < N; g++) {
      if (!sched[h][g]) sched[h][g] = "break";
    }
  }
  return sched;
}
function postFix(sched, guards) {
  for (let iter = 0; iter < 10; iter++) {
    let improved = false;
    const errs = validateSched(sched, guards);
    if (!errs.length) break;
    for (let g = 0; g < guards.length; g++) {
      for (const need of ["lenel", "bosh", "malshinon", "cico", "break"]) {
        if (sched.map(r => r[g]).includes(need)) continue;
        for (let h = 0; h < 8; h++) {
          const cur = sched[h][g];
          if (cur === "shaar" || cur === need) continue;
          sched[h][g] = need;
          if (canPlaceFix(h, g, need, sched, guards)) {
            if (validateSched(sched, guards).length <= errs.length) { improved = true; break; }
          }
          sched[h][g] = cur;
        }
        if (improved) break;
      }
      if (improved) break;
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
  return bestSched ?? Array.from({ length: 8 }, () => Array(guards.length).fill(""));
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
  { name: "", level: "strong", isDouble: false, isGate: false },
  { name: "", level: "strong", isDouble: false, isGate: false },
  { name: "", level: "mid",    isDouble: false, isGate: false },
  { name: "", level: "mid",    isDouble: false, isGate: false },
  { name: "", level: "mid",    isDouble: false, isGate: true  },
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
function GuardSetup({ guards, setGuards, onGenerate, generating }) {
  const updateGuard = (i, field, val) =>
    setGuards(prev => prev.map((g, idx) => idx === i ? { ...g, [field]: val } : g));
  return (
    <div className="rounded-2xl p-4 mb-4" style={{ backgroundColor: "#161b22", border: "1px solid #30363d" }}>
      <h2 className="text-sm font-bold mb-3 text-right" style={{ color: "#f0a500" }}>⚙️ הגדרת הצוות</h2>
      {guards.map((g, i) => (
        <div key={i} className="rounded-xl p-3 mb-2" style={{ backgroundColor: "#1c2330", border: "1px solid #30363d" }}>
          <input
            className="w-full text-center font-bold text-sm pb-1.5 mb-2 bg-transparent outline-none"
            style={{ color: "#e6edf3", borderBottom: "1px solid #30363d" }}
            value={g.name}
            onChange={e => updateGuard(i, "name", e.target.value)}
            placeholder={guardPlaceholder(i, guards.length)}
          />
          <div className="flex flex-row-reverse items-center justify-between mb-1">
            {i < guards.length - 1 ? (
              <>
                <span className="text-xs" style={{ color: "#8b949e" }}>רמה:</span>
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
              </>
            ) : (
              <span className="text-xs font-medium" style={{ color: "#f85149" }}>מאבטח שער (קבוע)</span>
            )}
          </div>
          {i < guards.length - 1 && (
            <div className="flex flex-row-reverse mt-1">
              <button
                className="text-xs px-2 py-1 rounded transition-all"
                style={{ color: g.isDouble ? "#f0a500" : "#8b949e" }}
                onClick={() => updateGuard(i, "isDouble", !g.isDouble)}
              >
                {g.isDouble ? "✓" : "○"} כפולה
              </button>
            </div>
          )}
        </div>
      ))}
      <button
        className="w-full py-3 rounded-xl font-extrabold text-sm mt-2 transition-all active:scale-95"
        style={{ backgroundColor: "#f0a500", color: "#000" }}
        onClick={onGenerate}
        disabled={generating}
      >
        {generating ? "⏳ מחשב..." : "⚡ צור סידור אוטומטי"}
      </button>
    </div>
  );
}
function ValidationPanel({ errors }) {
  if (errors.length === 0) {
    return (
      <div className="rounded-xl p-3 mb-4 text-center text-sm font-medium" style={{ backgroundColor: "#0f1f10", border: "1px solid #1a4a1a", color: "#3fb950" }}>
        ✅ הסידור תקין — כל הכללים מולאו!
      </div>
    );
  }
  return (
    <div className="rounded-xl p-3 mb-4" style={{ backgroundColor: "#1a1010", border: "1px solid #4a1515" }}>
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
            <div className="text-xs text-center mb-2" style={{ color: lc }}>
              {levelLabel(g.level)}{g.isDouble ? " · כפ" : ""}{g.isGate ? " · שע" : ""}
            </div>
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
function ScheduleTable({ sched, guards, onCellPress }) {
  return (
    <div className="rounded-2xl p-3 mb-4 overflow-x-auto" style={{ backgroundColor: "#161b22", border: "1px solid #30363d" }}>
      <div className="flex flex-row-reverse items-center justify-between mb-3">
        <h2 className="text-sm font-bold" style={{ color: "#f0a500" }}>📋 טבלת השיבוץ</h2>
      </div>
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
function CellEditModal({ visible, hour, guardIdx, guards, onSelect, onClose }) {
  if (!visible) return null;
  const menuOpts = hour !== null ? [...new Set([...assignable(hour), "shaar"])] : [];
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
// ─── Export Table (rendered off-screen → PNG → share) ────────────────────────
function ExportTable({ sched, guards }) {
  const today = new Date().toLocaleDateString("he-IL", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  });
  const TOTAL_W = 560;
  const TIME_W  = 68;
  const colW    = Math.floor((TOTAL_W - TIME_W) / guards.length);
  const cell = (s) => ({ width: colW, flexShrink: 0, padding: "3px" });

  return (
    <div style={{ width: TOTAL_W, backgroundColor: "#0d1117", padding: "20px",
                  fontFamily: "Arial, Helvetica, sans-serif", direction: "rtl" }}>
      {/* Title */}
      <div style={{ textAlign: "center", marginBottom: "14px" }}>
        <div style={{ color: "#f0a500", fontSize: "22px", fontWeight: "900", marginBottom: "6px" }}>
          טבלת השיבוץ
        </div>
        <div style={{ color: "#8b949e", fontSize: "12px" }}>{today}</div>
        <div style={{ color: "#8b949e", fontSize: "11px", marginTop: "2px" }}>משמרת בוקר 07:00–15:00</div>
        <div style={{ width: "40px", height: "2px", backgroundColor: "#f0a500", margin: "10px auto 0" }} />
      </div>

      {/* Grid */}
      <div style={{ borderRadius: "10px", overflow: "hidden", border: "1px solid #30363d" }}>
        {/* Header row */}
        <div style={{ display: "flex", backgroundColor: "#1c2330", borderBottom: "2px solid #30363d" }}>
          <div style={{ width: TIME_W, flexShrink: 0, textAlign: "center", padding: "10px 4px",
                        color: "#8b949e", fontSize: "12px", fontWeight: "bold" }}>שעה</div>
          {guards.map((g, gi) => (
            <div key={gi} style={{ width: colW, flexShrink: 0, textAlign: "center", padding: "10px 4px",
                                   color: "#e6edf3", fontSize: "11px", fontWeight: "bold",
                                   borderRight: "1px solid #30363d", overflow: "hidden" }}>
              {guardDisplayName(g, gi, guards.length)}
            </div>
          ))}
        </div>

        {/* Hour rows */}
        {HOURS.map((hr, h) => (
          <div key={h} style={{ display: "flex", borderBottom: h < 7 ? "1px solid #21262d" : "none" }}>
            <div style={{ width: TIME_W, flexShrink: 0, backgroundColor: "#1c2330",
                          display: "flex", alignItems: "center", justifyContent: "center", padding: "4px" }}>
              <span style={{ color: "#8b949e", fontSize: "11px", fontWeight: "600" }}>
                {hr.split("-")[0]}
              </span>
            </div>
            {guards.map((_, gi) => {
              const st  = sched[h][gi];
              const col = st ? SC[st] : null;
              return (
                <div key={gi} style={cell(st)}>
                  <div style={{ height: "100%", display: "flex", alignItems: "center",
                                justifyContent: "center", borderRadius: "6px",
                                padding: "8px 2px", minHeight: "36px",
                                backgroundColor: col ? col.bg : "transparent",
                                border: `1px solid ${col ? col.border : "#30363d"}` }}>
                    <span style={{ color: col ? col.text : "#8b949e",
                                   fontSize: "11px", fontWeight: "bold" }}>
                      {st ? SL[st] : "—"}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {/* Watermark */}
      <div style={{ textAlign: "center", marginTop: "10px", color: "#30363d", fontSize: "10px" }}>
        מנהל משמרות אבטחה · 07:00–15:00
      </div>
    </div>
  );
}
// ─── Fullscreen Table ─────────────────────────────────────────────────────────
function FullscreenTable({ sched, guards, onClose }) {
  return (
    <div
      className="fixed inset-0 z-50 flex flex-col"
      style={{ backgroundColor: "#0d1117", height: "100dvh", width: "100dvw" }}
    >
      {/* Compact header — safe area: top (Dynamic Island portrait) + sides (camera landscape) */}
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

      {/* Table — fills all remaining height, no scroll, respects side + bottom safe areas */}
      <div
        className="flex-1 flex flex-col overflow-hidden"
        style={{
          direction: "rtl",
          paddingLeft: "env(safe-area-inset-left)",
          paddingRight: "env(safe-area-inset-right)",
          paddingBottom: "env(safe-area-inset-bottom)",
        }}
      >
        {/* Column headers */}
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

        {/* Hour rows — each takes equal share of remaining height */}
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
  const exportRef = useRef(null);
  const handleGenerate = useCallback(() => {
    setGenerating(true);
    setTimeout(() => {
      const s = generate(guards);
      setSched(s);
      setErrors(validateSched(s, guards));
      setGenerating(false);
    }, 10);
  }, [guards]);
  const handleCellPress = useCallback((h, g) => {
    if (guards[g].isGate && h < 3) return;
    setSelCell({ h, g });
    setMenuVisible(true);
  }, [guards]);
  const handleShare = useCallback(async () => {
    if (!exportRef.current || !sched) return;
    setSharing(true);
    try {
      const html2canvas = (await import("html2canvas")).default;
      const canvas = await html2canvas(exportRef.current, {
        backgroundColor: "#0d1117",
        scale: 2,
        useCORS: true,
        logging: false,
      });
      const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
      const file = new File([blob], "sidur-avtaha.png", { type: "image/png" });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: "טבלת השיבוץ" });
      } else {
        // Desktop fallback: download
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
  }, [sched]);

  const handleSetCell = useCallback((st) => {
    if (!selCell || !sched) return;
    const { h, g } = selCell;
    const ns = sched.map(r => [...r]);
    ns[h][g] = st;
    setSched(ns);
    setErrors(validateSched(ns, guards));
    setMenuVisible(false);
  }, [selCell, sched, guards]);
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
        <button
          className="w-full rounded-xl p-3 mb-4 text-right text-xs transition-all"
          style={{ backgroundColor: "#1c2330", border: "1px solid #30363d", color: "#8b949e" }}
          onClick={() => setShowRules(!showRules)}
        >
          <span style={{ color: "#e6edf3", fontWeight: 700 }}>📖 כללים </span>
          <span>{showRules ? "▲" : "▼"}</span>
          {showRules && (
            <p className="mt-2 leading-5" style={{ color: "#8b949e" }}>
              CICO לא פעיל 07–08 · מלשינון לא פעיל 08–10 · שער 07–10 בלבד · מקס׳ 3 שעות ברצף · אחרי CICO → הפסקה חובה · אחמ״ש: ללא CICO · CICO מתחלק שווה · כפולה: CICO בשעה האחרונה · אין מלשינון רצוף · אין כפילויות · איזון הפסקות (פער מקס׳ 1)
            </p>
          )}
        </button>
        {/* Guard Setup */}
        <GuardSetup guards={guards} setGuards={setGuards} onGenerate={handleGenerate} generating={generating} />
        {/* Validation */}
        {sched && <ValidationPanel errors={errors} />}
        {/* Stats */}
        {sched && <StatsRow sched={sched} guards={guards} />}
        {/* Schedule Table */}
        {sched && (
          <>
            <ScheduleTable sched={sched} guards={guards} onCellPress={handleCellPress} />
            {/* Fullscreen button */}
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
              style={{ backgroundColor: "#1c2330", border: "1px solid #30363d", color: "#e6edf3" }}
              onClick={handleGenerate}
            >
              🔄 צור מחדש
            </button>
            <button
              className="flex-1 py-2.5 rounded-xl text-xs font-semibold transition-all active:scale-95"
              style={{ backgroundColor: "#1c2330", border: "1px solid #30363d", color: "#e6edf3" }}
              onClick={() => setErrors(validateSched(sched, guards))}
            >
              ✔️ בדוק כללים
            </button>
          </div>
        )}
        {/* Share button */}
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
        guards={guards}
        onSelect={handleSetCell}
        onClose={() => setMenuVisible(false)}
      />
      {/* Fullscreen */}
      {sched && fullscreen && (
        <FullscreenTable sched={sched} guards={guards} onClose={() => setFullscreen(false)} />
      )}
      {/* Hidden export target — rendered off-screen for image generation */}
      {sched && (
        <div style={{ position: "fixed", top: "-9999px", left: "-9999px",
                      zIndex: -1, pointerEvents: "none" }}>
          <div ref={exportRef}>
            <ExportTable sched={sched} guards={guards} />
          </div>
        </div>
      )}
    </div>
  );
}
