import { describe, expect, it } from 'vitest';
import { solve, objectives, cmpLex } from './solver';
import type { Candidate, Params } from './types';
import { parseImport, validate, type RawState } from './validate';

const mkParams = (
  readings: number[][],
  opts: Partial<Pick<Params, 'period' | 'cycles' | 'maxJump'>> & {
    anchor?: Params['anchor'];
  } = {},
): Params => ({
  rows: readings.length,
  cols: readings[0].length,
  readings,
  period: opts.period ?? 10,
  cycles: opts.cycles ?? [0, 1],
  maxJump: opts.maxJump ?? 6,
  anchor: opts.anchor ?? { r: 0, c: 0, value: readings[0][0] },
});

/** 穷举全部圈数指派，作为裁决的对照实现 */
function bruteForce(p: Params) {
  const N = p.rows * p.cols;
  const feasible: Array<{ flat: number[]; cand: Candidate; o1: number; o2: number }> = [];
  const rec = (i: number, flat: number[]) => {
    if (i === N) {
      const cycles: number[][] = [];
      const unwrapped: number[][] = [];
      for (let r = 0; r < p.rows; r++) {
        cycles.push(flat.slice(r * p.cols, (r + 1) * p.cols));
        unwrapped.push(
          cycles[r].map((k, c) => p.readings[r][c] + k * p.period),
        );
      }
      const cand = { cycles, unwrapped };
      // 锚点
      const a = p.anchor;
      if (unwrapped[a.r][a.c] !== a.value) return;
      // 相邻约束
      for (let r = 0; r < p.rows; r++) {
        for (let c = 0; c < p.cols; c++) {
          if (c + 1 < p.cols && Math.abs(unwrapped[r][c] - unwrapped[r][c + 1]) > p.maxJump) return;
          if (r + 1 < p.rows && Math.abs(unwrapped[r][c] - unwrapped[r + 1][c]) > p.maxJump) return;
        }
      }
      const [o1, o2] = objectives(p, cand);
      feasible.push({ flat: flat.slice(), cand, o1, o2 });
      return;
    }
    for (const k of p.cycles) {
      flat.push(k);
      rec(i + 1, flat);
      flat.pop();
    }
  };
  rec(0, []);
  feasible.sort((x, y) => x.o1 - y.o1 || x.o2 - y.o2 || cmpLex(x.flat, y.flat));
  return feasible;
}

const lexArr = (m: number[][]) => m.flat();

describe('裁决顺序（与穷举对照）', () => {
  const cases: Array<{ readings: number[][]; period?: number; maxJump?: number; cycles?: number[] }> = [
    { readings: [[0, 3, 1], [4, 2, 6]], maxJump: 6 },
    { readings: [[0, 4], [3, 1], [5, 2]], maxJump: 6 },
    { readings: [[0, 4, 9, 2], [3, 1, 6, 8]], maxJump: 6 },
    { readings: [[3, -4, 2], [-7, 1, -3]], maxJump: 9, cycles: [-1, 0, 1] },
    // 并列：前两维相同但圈数序列不同（含横纵三格）
    { readings: [[0, 5, 5], [5, 7, 3]], maxJump: 6, cycles: [-1, 0, 1] },
    // 并列：2x2 无三格（o1 空和恒 0）
    { readings: [[0, 5], [5, 0]], maxJump: 6, cycles: [0, 1] },
    { readings: [[2, 4], [1, 5], [3, 0], [4, 2]], maxJump: 8, cycles: [-1, 0, 1] },
  ];

  for (const cs of cases) {
    it(`${cs.readings.length}x${cs.readings[0].length} 与穷举最优一致`, () => {
      const p = mkParams(cs.readings, {
        period: cs.period,
        maxJump: cs.maxJump,
        cycles: cs.cycles,
      });
      const all = bruteForce(p);
      const res = solve(p);
      expect(all.length, '对照穷举应至少有一个可行解').toBeGreaterThan(0);
      expect(res.kind).toBe('ok');
      if (res.kind !== 'ok') return;
      const want = all[0];
      expect(res.objective1).toBe(want.o1);
      expect(res.objective2).toBe(want.o2);
      expect(lexArr(res.cycles)).toEqual(want.flat);

      // 并列见证：前两维并列且存在不同圈数序列时，应给出字典序次小者
      const ties = all.filter((x) => x.o1 === want.o1 && x.o2 === want.o2);
      if (ties.length > 1) {
        expect(res.witness).not.toBeNull();
        expect(lexArr(res.witness!.cycles)).toEqual(ties[1].flat);
        const [w1, w2] = objectives(p, res.witness!);
        expect(w1).toBe(want.o1);
        expect(w2).toBe(want.o2);
        expect(cmpLex(lexArr(res.witness!.cycles), lexArr(res.cycles)) > 0).toBe(true);
      } else {
        expect(res.witness).toBeNull();
      }
    });
  }

  it('无并列时 witness 为 null', () => {
    // 单元素圈数区间：唯一可行指派（若存在）
    const p = mkParams([[0, 1], [2, 3]], { cycles: [0], maxJump: 10 });
    const res = solve(p);
    expect(res.kind).toBe('ok');
    if (res.kind === 'ok') expect(res.witness).toBeNull();
  });
});

describe('锚点', () => {
  it('锚点把首格固定到 +周期 分支', () => {
    const readings = [[0, 2], [3, 1]];
    const p = mkParams(readings, { maxJump: 10, anchor: { r: 0, c: 0, value: 10 } });
    const res = solve(p);
    expect(res.kind).toBe('ok');
    if (res.kind !== 'ok') return;
    expect(res.unwrapped[0][0]).toBe(10);
    expect(res.cycles[0][0]).toBe(1);
  });

  it('锚点值无法由任何圈数达到 -> anchorImpossible', () => {
    const readings = [[0, 2], [3, 1]];
    const p = mkParams(readings, { maxJump: 10, anchor: { r: 0, c: 0, value: 5 } });
    const res = solve(p);
    expect(res.kind).toBe('infeasible');
    if (res.kind === 'infeasible') expect(res.anchorImpossible).toBe(true);
  });
});

describe('不可行定位', () => {
  it('单边局部不可行会被定位（1 基坐标）', () => {
    // 首行两格读数差 9，周期 10，任何圈数差至少 1（绝对值），
    // 取 readings 0 和 9：差 |0-9|=9，加圈数后最小 abs = min(9, 1)=1 ……需要构造最小差 > M
    // 读数 0 与 4，周期 10：可能差 4 或 6，最小 4；M=3 -> 不可行
    const p = mkParams(
      [
        [0, 4],
        [1, 2],
      ],
      { maxJump: 3 },
    );
    const res = solve(p);
    expect(res.kind).toBe('infeasible');
    if (res.kind !== 'infeasible') return;
    expect(res.edges.length).toBeGreaterThan(0);
    expect(res.edges).toContainEqual(
      expect.objectContaining({ r1: 1, c1: 1, r2: 1, c2: 2 }),
    );
  });

  it('各边局部可行但联立无解 -> globallyInconsistent', () => {
    // 读数 0,6,12,18 相邻差恒为 6（P=10,M=5）：每条横边都迫使圈数严格递减 1，
    // 四格需要四个不同圈数，而区间 {-1,0,1} 只有三层 -> 联立无解；
    // 但每条边单独看都有可行端点组合。第二行同读数，纵边为等值约束。
    const readings = [
      [0, 6, 12, 18],
      [0, 6, 12, 18],
    ];
    const p = mkParams(readings, { maxJump: 5, cycles: [-1, 0, 1] });
    const res = solve(p);
    expect(res.kind).toBe('infeasible');
    if (res.kind !== 'infeasible') return;
    expect(res.edges).toEqual([]);
    expect(res.anchorImpossible).toBe(false);
    expect(res.globallyInconsistent).toBe(true);
  });
});

describe('随机模糊对拍与规模', () => {
  // 简单确定性 PRNG
  let seed = 1234567;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const ri = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));

  it('300 组随机小矩阵与穷举一致（含见证）', () => {
    for (let t = 0; t < 300; t++) {
      const R = ri(2, 3);
      const C = ri(2, 3);
      const readings = Array.from({ length: R }, () =>
        Array.from({ length: C }, () => ri(-9, 9)),
      );
      const cycChoice = ri(0, 2);
      const cycles = cycChoice === 0 ? [0, 1] : cycChoice === 1 ? [-1, 0, 1] : [0, 1, 2];
      const M = ri(4, 9);
      const P = 10;
      // 让锚点与某可行圈数相容：锚点固定为 readings[0][0]
      const p = mkParams(readings, { period: P, cycles, maxJump: M });
      const all = bruteForce(p);
      const res = solve(p);
      if (all.length === 0) {
        expect(res.kind).toBe('infeasible');
        continue;
      }
      expect(res.kind).toBe('ok');
      if (res.kind !== 'ok') continue;
      const want = all[0];
      expect(res.objective1).toBe(want.o1);
      expect(res.objective2).toBe(want.o2);
      expect(res.cycles.flat()).toEqual(want.flat);
      const ties = all.filter((x) => x.o1 === want.o1 && x.o2 === want.o2);
      if (ties.length > 1) {
        expect(res.witness).not.toBeNull();
        expect(res.witness!.cycles.flat()).toEqual(ties[1].flat);
      } else {
        expect(res.witness).toBeNull();
      }
    }
  });

  it('40 组随机 2..4 行 × 2..4 列、双圈数矩阵与穷举一致', () => {
    for (let t = 0; t < 40; t++) {
      const R = ri(2, 4);
      const C = ri(2, 4);
      const readings = Array.from({ length: R }, () =>
        Array.from({ length: C }, () => ri(-9, 9)),
      );
      const p = mkParams(readings, { period: 10, cycles: ri(0, 1) ? [0, 1] : [-1, 0], maxJump: ri(4, 9) });
      const all = bruteForce(p);
      const res = solve(p);
      expect(res.kind).toBe(all.length === 0 ? 'infeasible' : 'ok');
      if (res.kind !== 'ok' || all.length === 0) continue;
      const want = all[0];
      expect(res.objective1).toBe(want.o1);
      expect(res.objective2).toBe(want.o2);
      expect(res.cycles.flat()).toEqual(want.flat);
      const ties = all.filter((x) => x.o1 === want.o1 && x.o2 === want.o2);
      expect(!!res.witness).toBe(ties.length > 1);
      if (res.witness) expect(res.witness.cycles.flat()).toEqual(ties[1].flat);
    }
  });

  it('24x4、三圈数、宽松上限：可即时求解且目标自洽', () => {
    const R = 24;
    const C = 4;
    const readings = Array.from({ length: R }, (_, r) =>
      Array.from({ length: C }, (_, c) => (r * 7 + c * 3) % 10),
    );
    const p: Params = {
      rows: R,
      cols: C,
      readings,
      period: 10,
      cycles: [-1, 0, 1],
      maxJump: 20,
      anchor: { r: 0, c: 0, value: readings[0][0] },
    };
    const t0 = Date.now();
    const res = solve(p);
    const ms = Date.now() - t0;
    expect(ms).toBeLessThan(5000);
    expect(res.kind).toBe('ok');
    if (res.kind !== 'ok') return;
    const [o1, o2] = objectives(p, res);
    expect(o1).toBe(res.objective1);
    expect(o2).toBe(res.objective2);
  });
});

describe('校验层', () => {
  const baseRaw = (over: Partial<RawState> = {}): RawState => ({
    cells: [
      ['0', '7', '1'],
      ['8', '2', '6'],
    ],
    periodText: '10',
    cycleMinText: '0',
    cycleMaxText: '1',
    maxJumpText: '6',
    anchorRow: 1,
    anchorCol: 1,
    anchorValueText: '0',
    ...over,
  });

  it('合法输入无错误', () => {
    const v = validate(baseRaw());
    expect(v.errors).toEqual([]);
    expect(v.params).toBeDefined();
  });

  it('非法单元逐格定位', () => {
    const v = validate(
      baseRaw({
        cells: [
          ['0', 'x', '1'],
          ['8', '2.5', '6'],
        ],
      }),
    );
    const locs = v.errors.filter((e) => e.scope === 'cell').map((e) => [e.r, e.c]);
    expect(locs).toContainEqual([1, 2]);
    expect(locs).toContainEqual([2, 2]);
  });

  it('圈数区间超过 3 个整数时报错', () => {
    const v = validate(baseRaw({ cycleMinText: '0', cycleMaxText: '3' }));
    expect(v.errors.some((e) => e.field === 'cycles')).toBe(true);
  });

  it('周期非正、上限为负报错', () => {
    expect(validate(baseRaw({ periodText: '0' })).errors.some((e) => e.field === 'period')).toBe(true);
    expect(validate(baseRaw({ maxJumpText: '-1' })).errors.some((e) => e.field === 'maxJump')).toBe(true);
  });

  it('锚点坐标越界报错', () => {
    const v = validate(baseRaw({ anchorRow: 9 }));
    expect(v.errors.some((e) => e.scope === 'anchor')).toBe(true);
  });
});

describe('导入解析', () => {
  it('接受空白/逗号混合分隔', () => {
    const m = parseImport('0, 7 1\n8\t2,6');
    expect(Array.isArray(m)).toBe(true);
    expect(m).toEqual([
      [0, 7, 1],
      [8, 2, 6],
    ]);
  });

  it('行数/列数越界报错', () => {
    const one = parseImport('0 1');
    expect(one).not.toBeInstanceOf(Array);
    const wide = parseImport('0 1 2 3 4\n0 1 2 3 4');
    expect(wide).not.toBeInstanceOf(Array);
  });

  it('行宽不一致报错并带行号', () => {
    const r = parseImport('0 1 2\n3 4');
    expect(r).not.toBeInstanceOf(Array);
    if (!Array.isArray(r)) expect(r.error.r).toBe(2);
  });

  it('非法整数报错', () => {
    const r = parseImport('0 1\n2 abc');
    expect(r).not.toBeInstanceOf(Array);
  });
});
