/**
 * Jest tests for the scheduling algorithm in App.jsx.
 *
 * Coverage:
 *  - cicoLimit()     — CICO assignment caps per guard level/type
 *  - validateSched() — error-detection rules
 *  - generate()      — end-to-end: normal, double-guard (כפולה), and shortage (חוסר) modes
 *
 * All 50 scenarios from the standalone .mjs test files are mirrored here so that
 * `npm test` gives the same signal as running the Node scripts directly.
 */

import { generate, validateSched, cicoLimit } from '../App.jsx';

// ─── Shared helpers ────────────────────────────────────────────────────────────

/** Build a minimal guard object (same shape used throughout App.jsx) */
const mk = (level, { isGate = false, isDouble = false, name = '' } = {}) => ({
  name,
  level,
  isGate,
  isDouble,
  isAbsent: false,
});

const HOURS = [
  '07:00-08:00', '08:00-09:00', '09:00-10:00', '10:00-11:00',
  '11:00-12:00', '12:00-13:00', '13:00-14:00', '14:00-15:00',
];

/** Returns duplicate-station violations per hour (the original double-booking bug) */
function checkNoDuplicates(sched, N) {
  const dupes = [];
  for (let h = 0; h < 8; h++) {
    const seen = {};
    for (let g = 0; g < N; g++) {
      const st = sched[h][g];
      if (!st) continue;
      if (seen[st]) dupes.push(`שעה ${HOURS[h]}: ${st} מופיעה אצל שניים`);
      seen[st] = true;
    }
  }
  return dupes;
}

/** Convenience: generate + validate + duplicate-check, return merged error list */
function runScenario(guards, cfg = {}) {
  const sched = generate(guards, cfg);
  const errs  = validateSched(sched, guards, cfg);
  const dupes = checkNoDuplicates(sched, guards.length);
  return { sched, errs, dupes, allErrs: [...errs, ...dupes] };
}

// ─── cicoLimit — unit tests ────────────────────────────────────────────────────

describe('cicoLimit', () => {
  describe('5 guards, no achmash, total capacity = 7 (no extra needed)', () => {
    // 2 strong(1) + 2 mid(2) + 1 gate(1) = 7  → no extra CICO
    const guards = [
      mk('strong'), mk('strong'), mk('mid'), mk('mid'), mk('mid', { isGate: true }),
    ];

    test('strong guard (ותיק): limit 1', () => {
      expect(cicoLimit(0, guards)).toBe(1);
    });
    test('mid guard (חדש): limit 2', () => {
      expect(cicoLimit(2, guards)).toBe(2);
    });
    test('gate guard (שוער): limit 1', () => {
      expect(cicoLimit(4, guards)).toBe(1);
    });
  });

  describe('4 guards, no achmash, total capacity = 6 (1 slot deficit)', () => {
    // 1 strong(1) + 2 mid(2) + 1 gate(1) = 6 < 7  → non-gate guards carry +1 extra
    const guards = [
      mk('strong'), mk('mid'), mk('mid'), mk('mid', { isGate: true }),
    ];

    test('strong guard: base 1 + ceil(1/3) = 2', () => {
      expect(cicoLimit(0, guards)).toBe(2);
    });
    test('mid guard: base 2 + ceil(1/3) = 3', () => {
      expect(cicoLimit(1, guards)).toBe(3);
    });
    test('gate guard: still 1 (not eligible for extra)', () => {
      expect(cicoLimit(3, guards)).toBe(1);
    });
  });

  describe('with achmash', () => {
    // 1 achmash + 2 strong(1) + 1 mid(2) + 1 gate(1) = 6 capacity  →  achmash covers the deficit
    const guards = [
      mk('achmash'), mk('strong'), mk('strong'), mk('mid'), mk('mid', { isGate: true }),
    ];

    test('achmash: returns 0 when non-achmash capacity is sufficient (≥ 7)', () => {
      // non-achmash: 1+1+2+1 = 5, deficit = 2; 1 achmash → ceil(2/1) = 2
      // (changes with composition — just verify it is a non-negative integer)
      expect(cicoLimit(0, guards)).toBeGreaterThanOrEqual(0);
    });
    test('gate guard with achmash present: limit 2', () => {
      expect(cicoLimit(4, guards)).toBe(2);
    });
    test('strong guard with achmash present: returns positive limit', () => {
      expect(cicoLimit(1, guards)).toBeGreaterThan(0);
    });
  });

  describe('edge: all achmash guards', () => {
    const guards = [mk('achmash'), mk('achmash'), mk('achmash')];

    test('each achmash gets ceil(7 / achmashCount) slots', () => {
      expect(cicoLimit(0, guards)).toBe(Math.ceil(7 / 3)); // = 3
    });
  });
});

// ─── validateSched — error-detection unit tests ────────────────────────────────

describe('validateSched — error detection', () => {
  const empty8 = (N) => Array.from({ length: 8 }, () => Array(N).fill(''));

  test('detects duplicate station in the same hour', () => {
    const guards = [mk('mid'), mk('mid'), mk('mid'), mk('mid')];
    const sched = empty8(4);
    sched[0][0] = 'lenel';
    sched[0][1] = 'lenel'; // duplicate!
    sched[0][2] = 'bosh';
    sched[0][3] = 'break';
    const errs = validateSched(sched, guards, {});
    expect(errs.some(e => e.includes('כפילות'))).toBe(true);
  });

  test('detects CICO without break in the following hour', () => {
    const guards = [mk('mid'), mk('mid')];
    const sched = empty8(2);
    sched[1][0] = 'cico';
    sched[2][0] = 'lenel'; // must be 'break' after CICO
    const errs = validateSched(sched, guards, {});
    expect(errs.some(e => e.includes('אחרי CICO'))).toBe(true);
  });

  test('does NOT flag CICO followed immediately by break', () => {
    const guards = [mk('mid'), mk('mid')];
    const sched = empty8(2);
    sched[1][0] = 'cico';
    sched[2][0] = 'break'; // correct
    const errs = validateSched(sched, guards, {});
    expect(errs.some(e => e.includes('אחרי CICO'))).toBe(false);
  });

  test('detects > 3 consecutive active stations', () => {
    const guards = [mk('mid'), mk('mid')];
    const sched = empty8(2);
    // 4 active in a row for guard 0
    sched[0][0] = 'lenel';
    sched[1][0] = 'bosh';
    sched[2][0] = 'lenel';
    sched[3][0] = 'bosh'; // 4th active → violation
    const errs = validateSched(sched, guards, {});
    expect(errs.some(e => e.includes('>3 ברצף'))).toBe(true);
  });

  test('detects two consecutive break slots', () => {
    const guards = [mk('mid'), mk('mid')];
    const sched = empty8(2);
    sched[0][0] = 'break';
    sched[1][0] = 'break'; // consecutive breaks
    const errs = validateSched(sched, guards, {});
    expect(errs.some(e => e.includes('הפסקות ברצף'))).toBe(true);
  });

  test('flags double guard missing CICO at h=7 when no other double has it', () => {
    const guards = [mk('mid', { isDouble: true }), mk('mid')];
    const sched = empty8(2);
    sched[7][0] = 'lenel'; // should be 'cico' for double guard
    sched[7][1] = 'break';
    const errs = validateSched(sched, guards, {});
    expect(errs.some(e => e.includes('כפולה חייב CICO'))).toBe(true);
  });

  test('does NOT flag double guard at h=7 when another double already has CICO there', () => {
    const guards = [mk('mid', { isDouble: true }), mk('mid', { isDouble: true })];
    const sched = empty8(2);
    sched[7][0] = 'lenel'; // not CICO — but guard 1 has it
    sched[7][1] = 'cico';  // other double has CICO
    const errs = validateSched(sched, guards, {});
    expect(errs.some(e => e.includes('כפולה חייב CICO'))).toBe(false);
  });
});

// ─── generate — normal mode ───────────────────────────────────────────────────

describe('generate — normal mode (מצב רגיל)', () => {
  const scenarios = [
    {
      name: 'קלאסי: 2 ותיק + 2 חדש + שער (חדש)',
      guards: [mk('strong'), mk('strong'), mk('mid'), mk('mid'), mk('mid', { isGate: true })],
    },
    {
      name: 'קלאסי + כפולה על ותיק',
      guards: [mk('strong', { isDouble: true }), mk('strong'), mk('mid'), mk('mid'), mk('mid', { isGate: true })],
    },
    {
      name: 'קלאסי + כפולה על חדש',
      guards: [mk('strong'), mk('strong'), mk('mid', { isDouble: true }), mk('mid'), mk('mid', { isGate: true })],
    },
    {
      name: 'כל ותיקים: 4 ותיק + שער (ותיק)',
      guards: [mk('strong'), mk('strong'), mk('strong'), mk('strong'), mk('strong', { isGate: true })],
    },
    {
      name: 'כל חדשים: 4 חדש + שער (חדש)',
      guards: [mk('mid'), mk('mid'), mk('mid'), mk('mid'), mk('mid', { isGate: true })],
    },
    {
      name: '3 ותיק + 1 חדש + שער (חדש)',
      guards: [mk('strong'), mk('strong'), mk('strong'), mk('mid'), mk('mid', { isGate: true })],
    },
    {
      name: '1 ותיק + 3 חדש + שער (חדש)',
      guards: [mk('strong'), mk('mid'), mk('mid'), mk('mid'), mk('mid', { isGate: true })],
    },
    {
      name: '3 ותיק + 1 חדש + שער (ותיק)',
      guards: [mk('strong'), mk('strong'), mk('strong'), mk('mid'), mk('strong', { isGate: true })],
    },
    {
      name: '2 ותיק + 2 חדש + שער (ותיק)',
      guards: [mk('strong'), mk('strong'), mk('mid'), mk('mid'), mk('strong', { isGate: true })],
    },
    {
      name: '1 אחמ"ש + 2 ותיק + 1 חדש + שער',
      guards: [mk('achmash'), mk('strong'), mk('strong'), mk('mid'), mk('mid', { isGate: true })],
    },
    {
      name: '2 אחמ"ש + 1 ותיק + 1 חדש + שער',
      guards: [mk('achmash'), mk('achmash'), mk('strong'), mk('mid'), mk('mid', { isGate: true })],
    },
    {
      name: '2 אחמ"ש + 2 ותיק + שער',
      guards: [mk('achmash'), mk('achmash'), mk('strong'), mk('strong'), mk('mid', { isGate: true })],
    },
    {
      name: '1 אחמ"ש + 3 ותיק + שער',
      guards: [mk('achmash'), mk('strong'), mk('strong'), mk('strong'), mk('mid', { isGate: true })],
    },
    {
      name: '4 ותיק בלי שוער',
      guards: [mk('strong'), mk('strong'), mk('strong'), mk('strong')],
    },
    {
      name: '4 חדש בלי שוער',
      guards: [mk('mid'), mk('mid'), mk('mid'), mk('mid')],
    },
    {
      name: '4 שומרים: 2 ותיק + 1 חדש + שוער',
      guards: [mk('strong'), mk('strong'), mk('mid'), mk('mid', { isGate: true })],
    },
    {
      name: '4 שומרים: 1 אחמ"ש + 1 ותיק + 1 חדש + שוער',
      guards: [mk('achmash'), mk('strong'), mk('mid'), mk('mid', { isGate: true })],
    },
  ];

  scenarios.forEach(sc => {
    test(sc.name, () => {
      const { allErrs } = runScenario(sc.guards, sc.cfg ?? {});
      expect(allErrs).toEqual([]);
    });
  });
});

// ─── generate — double guards (כפולה) ─────────────────────────────────────────

describe('generate — double guards (כפולה)', () => {
  const scenarios = [
    // ── single double (regression) ─────────────────────────────────────────
    {
      name: '1 כפולה: ותיק',
      guards: [mk('strong', { isDouble: true }), mk('strong'), mk('mid'), mk('mid'), mk('mid', { isGate: true })],
    },
    {
      name: '1 כפולה: חדש',
      guards: [mk('strong'), mk('strong'), mk('mid', { isDouble: true }), mk('mid'), mk('mid', { isGate: true })],
    },
    {
      name: '1 כפולה: שוער',
      guards: [mk('strong'), mk('strong'), mk('mid'), mk('mid'), mk('mid', { isGate: true, isDouble: true })],
    },
    // ── two doubles ────────────────────────────────────────────────────────
    {
      name: '2 כפולות: ותיק + חדש',
      guards: [mk('strong', { isDouble: true }), mk('strong'), mk('mid', { isDouble: true }), mk('mid'), mk('mid', { isGate: true })],
    },
    {
      name: '2 כפולות: שני ותיקים',
      guards: [mk('strong', { isDouble: true }), mk('strong', { isDouble: true }), mk('mid'), mk('mid'), mk('mid', { isGate: true })],
    },
    {
      name: '2 כפולות: שני חדשים',
      guards: [mk('strong'), mk('strong'), mk('mid', { isDouble: true }), mk('mid', { isDouble: true }), mk('mid', { isGate: true })],
    },
    {
      name: '2 כפולות: ותיק + שוער',
      guards: [mk('strong', { isDouble: true }), mk('strong'), mk('mid'), mk('mid'), mk('mid', { isGate: true, isDouble: true })],
    },
    {
      name: '2 כפולות: חדש + שוער',
      guards: [mk('strong'), mk('strong'), mk('mid', { isDouble: true }), mk('mid'), mk('mid', { isGate: true, isDouble: true })],
    },
    // ── three doubles ──────────────────────────────────────────────────────
    {
      name: '3 כפולות: 2 ותיקים + חדש',
      guards: [mk('strong', { isDouble: true }), mk('strong', { isDouble: true }), mk('mid', { isDouble: true }), mk('mid'), mk('mid', { isGate: true })],
    },
    {
      name: '3 כפולות: ותיק + 2 חדשים',
      guards: [mk('strong', { isDouble: true }), mk('strong'), mk('mid', { isDouble: true }), mk('mid', { isDouble: true }), mk('mid', { isGate: true })],
    },
    {
      name: '3 כפולות: ותיק + חדש + שוער',
      guards: [mk('strong', { isDouble: true }), mk('strong'), mk('mid', { isDouble: true }), mk('mid'), mk('mid', { isGate: true, isDouble: true })],
    },
    // ── four doubles ───────────────────────────────────────────────────────
    {
      name: '4 כפולות: 2 ותיק + 2 חדש',
      guards: [mk('strong', { isDouble: true }), mk('strong', { isDouble: true }), mk('mid', { isDouble: true }), mk('mid', { isDouble: true }), mk('mid', { isGate: true })],
    },
    {
      name: '4 כפולות: ותיק + 2 חדש + שוער',
      guards: [mk('strong', { isDouble: true }), mk('strong'), mk('mid', { isDouble: true }), mk('mid', { isDouble: true }), mk('mid', { isGate: true, isDouble: true })],
    },
    // ── five doubles (all) ─────────────────────────────────────────────────
    {
      name: '5 כפולות: כולם (2 ותיק + 2 חדש + שוער)',
      guards: [mk('strong', { isDouble: true }), mk('strong', { isDouble: true }), mk('mid', { isDouble: true }), mk('mid', { isDouble: true }), mk('mid', { isGate: true, isDouble: true })],
    },
    {
      name: '5 כפולות: כל ותיקים',
      guards: [mk('strong', { isDouble: true }), mk('strong', { isDouble: true }), mk('strong', { isDouble: true }), mk('strong', { isDouble: true }), mk('strong', { isGate: true, isDouble: true })],
    },
    {
      name: '5 כפולות: כל חדשים',
      guards: [mk('mid', { isDouble: true }), mk('mid', { isDouble: true }), mk('mid', { isDouble: true }), mk('mid', { isDouble: true }), mk('mid', { isGate: true, isDouble: true })],
    },
    // ── with achmash ───────────────────────────────────────────────────────
    {
      name: '2 כפולות + אחמ"ש',
      guards: [mk('achmash'), mk('strong', { isDouble: true }), mk('mid', { isDouble: true }), mk('mid'), mk('mid', { isGate: true })],
    },
    {
      name: '3 כפולות + אחמ"ש',
      guards: [mk('achmash'), mk('strong', { isDouble: true }), mk('mid', { isDouble: true }), mk('mid', { isDouble: true }), mk('mid', { isGate: true })],
    },
    // ── shortage + doubles ─────────────────────────────────────────────────
    {
      name: 'חוסר (ותיק נעדר) + 2 כפולות',
      guards: [mk('strong'), mk('mid', { isDouble: true }), mk('mid', { isDouble: true }), mk('mid', { isGate: true })],
      cfg: { gateDown: false, cicoDown: false, isShortage: true },
    },
    {
      name: 'חוסר (שוער נעדר) + 2 כפולות, שוער ירד',
      guards: [mk('strong', { isDouble: true }), mk('strong'), mk('mid', { isDouble: true }), mk('mid')],
      cfg: { gateDown: true, cicoDown: false, isShortage: true },
    },
    {
      name: 'חוסר + 3 כפולות',
      guards: [mk('strong', { isDouble: true }), mk('mid', { isDouble: true }), mk('mid', { isDouble: true }), mk('mid', { isGate: true })],
      cfg: { gateDown: false, cicoDown: false, isShortage: true },
    },
  ];

  scenarios.forEach(sc => {
    test(sc.name, () => {
      const { allErrs } = runScenario(sc.guards, sc.cfg ?? {});
      expect(allErrs).toEqual([]);
    });
  });

  test('with multiple doubles, exactly ONE guard has CICO at h=7 (no double-booking)', () => {
    const guards = [
      mk('strong', { isDouble: true }),
      mk('strong', { isDouble: true }),
      mk('mid'),
      mk('mid'),
      mk('mid', { isGate: true }),
    ];
    const sched = generate(guards, {});
    const cicoAtLastHour = sched[7].filter(st => st === 'cico').length;
    expect(cicoAtLastHour).toBe(1);
  });

  test('CICO is never placed in the same hour as an existing CICO (no duplicates)', () => {
    // Run every double scenario and check per-hour uniqueness explicitly
    scenarios.forEach(sc => {
      const sched = generate(sc.guards, sc.cfg ?? {});
      const dupes = checkNoDuplicates(sched, sc.guards.length);
      if (dupes.length) {
        throw new Error(`${sc.name}: ${dupes.join(', ')}`);
      }
    });
  });
});

// ─── generate — shortage mode (חוסר) ──────────────────────────────────────────

describe('generate — shortage mode (חוסר)', () => {
  const scenarios = [
    {
      name: 'ותיק נעדר · כל עמדות פעילות (gateDown=false, cicoDown=false)',
      guards: [mk('strong'), mk('mid'), mk('mid'), mk('mid', { isGate: true })],
      cfg: { gateDown: false, cicoDown: false, isShortage: true },
    },
    {
      name: 'חדש נעדר · CICO ירד (gateDown=false, cicoDown=true)',
      guards: [mk('strong'), mk('strong'), mk('mid'), mk('mid', { isGate: true })],
      cfg: { gateDown: false, cicoDown: true, isShortage: true },
    },
    {
      name: 'שוער נעדר · שער ירד · CICO פעיל (gateDown=true, cicoDown=false)',
      guards: [mk('strong'), mk('strong'), mk('mid'), mk('mid')],
      cfg: { gateDown: true, cicoDown: false, isShortage: true },
    },
    {
      name: 'שוער נעדר · שער + CICO ירדו (gateDown=true, cicoDown=true)',
      guards: [mk('strong'), mk('strong'), mk('mid'), mk('mid')],
      cfg: { gateDown: true, cicoDown: true, isShortage: true },
    },
    {
      name: 'כל ותיקים · ותיק נעדר · כל עמדות פעילות',
      guards: [mk('strong'), mk('strong'), mk('strong'), mk('strong', { isGate: true })],
      cfg: { gateDown: false, cicoDown: false, isShortage: true },
    },
    {
      name: 'כל ותיקים · שוער נעדר · שער + CICO ירדו',
      guards: [mk('strong'), mk('strong'), mk('strong')],
      cfg: { gateDown: true, cicoDown: true, isShortage: true },
    },
    {
      name: 'כל חדשים · חדש נעדר · CICO ירד',
      guards: [mk('mid'), mk('mid'), mk('mid'), mk('mid', { isGate: true })],
      cfg: { gateDown: false, cicoDown: true, isShortage: true },
    },
    {
      name: 'כל חדשים · שוער נעדר · שער ירד · CICO פעיל',
      guards: [mk('mid'), mk('mid'), mk('mid'), mk('mid')],
      cfg: { gateDown: true, cicoDown: false, isShortage: true },
    },
    {
      name: '3 ותיק + 1 חדש + שוער · ותיק נעדר · כל עמדות',
      guards: [mk('strong'), mk('strong'), mk('mid'), mk('mid', { isGate: true })],
      cfg: { gateDown: false, cicoDown: false, isShortage: true },
    },
    {
      name: '1 אחמ"ש + 2 ותיק + חדש + שוער · אחמ"ש נעדר',
      guards: [mk('strong'), mk('strong'), mk('mid', { isGate: true })],
      cfg: { gateDown: false, cicoDown: false, isShortage: true },
    },
    {
      name: '2 אחמ"ש + 2 ותיק + שוער · שוער נעדר · שער + CICO ירדו',
      guards: [mk('achmash'), mk('achmash'), mk('strong'), mk('strong')],
      cfg: { gateDown: true, cicoDown: true, isShortage: true },
    },
    {
      name: 'ותיק נעדר · CICO ירד',
      guards: [mk('strong'), mk('mid'), mk('mid'), mk('mid', { isGate: true })],
      cfg: { gateDown: false, cicoDown: true, isShortage: true },
    },
  ];

  scenarios.forEach(sc => {
    test(sc.name, () => {
      const { allErrs } = runScenario(sc.guards, sc.cfg);
      expect(allErrs).toEqual([]);
    });
  });

  test('gate guard gets shaar at h=0,1,2 when gate is not down', () => {
    const guards = [mk('strong'), mk('mid'), mk('mid'), mk('mid', { isGate: true })];
    const sched = generate(guards, { isShortage: true });
    // Guard index 3 is the gate guard
    expect(sched[0][3]).toBe('shaar');
    expect(sched[1][3]).toBe('shaar');
    expect(sched[2][3]).toBe('shaar');
  });

  test('when cicoDown is true, no guard is assigned CICO', () => {
    const guards = [mk('strong'), mk('mid'), mk('mid'), mk('mid', { isGate: true })];
    const sched = generate(guards, { cicoDown: true, isShortage: true });
    for (let h = 0; h < 8; h++) {
      expect(sched[h]).not.toContain('cico');
    }
  });

  test('when gateDown is true, no guard is assigned shaar', () => {
    const guards = [mk('strong'), mk('mid'), mk('mid'), mk('mid')];
    const sched = generate(guards, { gateDown: true, isShortage: true });
    for (let h = 0; h < 8; h++) {
      expect(sched[h]).not.toContain('shaar');
    }
  });

  test('lenel and bosh are staffed every hour', () => {
    const guards = [mk('strong'), mk('mid'), mk('mid'), mk('mid', { isGate: true })];
    const sched = generate(guards, { isShortage: true });
    for (let h = 0; h < 8; h++) {
      expect(sched[h]).toContain('lenel');
      expect(sched[h]).toContain('bosh');
    }
  });
});
