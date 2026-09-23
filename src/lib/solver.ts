import type {
  Candidate,
  InfeasibleEdge,
  Params,
  SolveFail,
  SolveOk,
  SolveResult,
} from './types';

/** 仅供测试使用的字典序比较 */
export const cmpLex = (a: number[], b: number[]): number => {
  for (let i = 0; i < a.length; i++) {
    if (a[i] < b[i]) return -1;
    if (a[i] > b[i]) return 1;
  }
  return 0;
};

/**
 * 裁决键 (o1, o2, 行优先圈数序列) 为全序：
 *   1. 全部横纵连续三格的二阶差分绝对值之和；
 *   2. 全部横纵相邻差绝对值之和；
 *   3. 圈数序列字典序。
 *
 * 网格列数 ≤ 4、圈数 ≤ 3 个，故一行的圈数组合（行状态）至多 3^4 = 81。
 * 用分层 DAG 上的标号 DP：第 r 层状态为相邻两行 (s_{r-1}, s_r)，
 * 转移枚举 s_{r+1}。同一层同一 pair 状态的未来可行扩展及其成本完全相同，
 * 故每个 pair 只保留裁决键最小的一个前缀标号；
 * 字典序前缀比较具有一致性（前缀较小者拼接任意相同后缀仍较小），
 * 单标号 DP 恰好得到全局最优。见证（前两维并列时的字典序次小解）由
 * 第二趟“相对最优序列字典序严格更大”的双车道 DP 求出。
 */

interface Node {
  o1: number;
  o2: number;
  /** 行优先圈数前缀 */
  lex: number[];
  state: number;
  back: { pairKey: string; lane: 0 | 1 } | null;
}

/** 单标号容器：同键只留裁决序最小者 */
class Labels {
  map = new Map<string, Node>();

  put(node: Node, key: string) {
    const old = this.map.get(key);
    if (
      !old ||
      node.o1 < old.o1 ||
      (node.o1 === old.o1 &&
        (node.o2 < old.o2 || (node.o2 === old.o2 && cmpLex(node.lex, old.lex) < 0)))
    ) {
      this.map.set(key, node);
    }
  }
}

export function solve(p: Params): SolveResult {
  const { rows: R, cols: C, readings, period: P, cycles, maxJump: M, anchor } = p;
  const B = cycles.length;
  const stateCount = B ** C;

  // code = Σ idx_c · B^c；digit[s][c] 为状态 s 第 c 列圈数在 cycles 中的下标
  const digit: number[][] = new Array(stateCount);
  const stateCycles: number[][] = new Array(stateCount);
  for (let s = 0; s < stateCount; s++) {
    const ds: number[] = [];
    const ks: number[] = [];
    let x = s;
    for (let c = 0; c < C; c++) {
      ds.push(x % B);
      ks.push(cycles[x % B]);
      x = Math.floor(x / B);
    }
    digit[s] = ds;
    stateCycles[s] = ks;
  }

  // ---- 快速不可行诊断（1 基坐标） ----
  let anchorImpossible = false;
  if (!cycles.some((k) => readings[anchor.r][anchor.c] + k * P === anchor.value)) {
    anchorImpossible = true;
  }
  const badEdges: InfeasibleEdge[] = [];
  const examinePair = (r1: number, c1: number, r2: number, c2: number) => {
    let min = Infinity;
    let ok = false;
    for (const k1 of cycles) {
      const v1 = readings[r1][c1] + k1 * P;
      for (const k2 of cycles) {
        const d = Math.abs(v1 - (readings[r2][c2] + k2 * P));
        if (d < min) min = d;
        if (d <= M) ok = true;
      }
    }
    if (!ok) badEdges.push({ r1: r1 + 1, c1: c1 + 1, r2: r2 + 1, c2: c2 + 1, minAbs: min });
  };
  for (let r = 0; r < R; r++) {
    for (let c = 0; c < C; c++) {
      if (c + 1 < C) examinePair(r, c, r, c + 1);
      if (r + 1 < R) examinePair(r, c, r + 1, c);
    }
  }
  if (anchorImpossible || badEdges.length > 0) {
    const fail: SolveFail = {
      kind: 'infeasible',
      anchorImpossible,
      edges: badEdges,
      globallyInconsistent: false,
    };
    return fail;
  }

  // ---- 逐行状态可行性与横向成本 ----
  const rowOk = Array.from({ length: R }, () => new Array<boolean>(stateCount));
  const rowH1 = Array.from({ length: R }, () => new Array<number>(stateCount));
  const rowH2 = Array.from({ length: R }, () => new Array<number>(stateCount));
  for (let r = 0; r < R; r++) {
    for (let s = 0; s < stateCount; s++) {
      const ds = digit[s];
      let ok = true;
      let e2 = 0;
      let e1 = 0;
      for (let c = 0; c + 1 < C; c++) {
        const va = readings[r][c] + cycles[ds[c]] * P;
        const vb = readings[r][c + 1] + cycles[ds[c + 1]] * P;
        const d = va - vb;
        if (Math.abs(d) > M) ok = false;
        e2 += Math.abs(d);
        if (c + 2 < C) {
          const vc = readings[r][c + 2] + cycles[ds[c + 2]] * P;
          e1 += Math.abs(va - 2 * vb + vc);
        }
      }
      if (anchor.r === r && readings[r][anchor.c] + cycles[ds[anchor.c]] * P !== anchor.value) {
        ok = false;
      }
      rowOk[r][s] = ok;
      rowH1[r][s] = e1;
      rowH2[r][s] = e2;
    }
  }
  const feasibleAt = (r: number): number[] => {
    const out: number[] = [];
    for (let s = 0; s < stateCount; s++) if (rowOk[r][s]) out.push(s);
    return out;
  };

  // ---- 纵向边/三元成本的按列预算表（圈数下标维度 ≤ 3） ----
  // edgeCol[r][c][i][j] = 第 r 行与 r+1 行同列、圈数下标 i,j 的绝对差（Infinity 表示越限）
  const edgeCol: number[][][][] = [];
  for (let r = 0; r + 1 < R; r++) {
    const byCol: number[][][] = [];
    for (let c = 0; c < C; c++) {
      const tab: number[][] = [];
      for (let i = 0; i < B; i++) {
        const row: number[] = [];
        for (let j = 0; j < B; j++) {
          const d = Math.abs(readings[r][c] + cycles[i] * P - (readings[r + 1][c] + cycles[j] * P));
          row.push(d <= M ? d : Infinity);
        }
        tab.push(row);
      }
      byCol.push(tab);
    }
    edgeCol.push(byCol);
  }
  // tripleCol[r][c][i][j][k] = 第 r,r+1,r+2 行同列纵向二阶差分绝对值
  const tripleCol: number[][][][][] = [];
  for (let r = 0; r + 2 < R; r++) {
    const byCol: number[][][][] = [];
    for (let c = 0; c < C; c++) {
      const tab: number[][][] = [];
      for (let i = 0; i < B; i++) {
        const plane: number[][] = [];
        for (let j = 0; j < B; j++) {
          const row: number[] = [];
          for (let k = 0; k < B; k++) {
            row.push(
              Math.abs(
                readings[r][c] + cycles[i] * P -
                  2 * (readings[r + 1][c] + cycles[j] * P) +
                  (readings[r + 2][c] + cycles[k] * P),
              ),
            );
          }
          plane.push(row);
        }
        tab.push(plane);
      }
      byCol.push(tab);
    }
    tripleCol.push(byCol);
  }

  const vertEdgeCost = (rTop: number, sTop: number, sBot: number): number => {
    const a = digit[sTop];
    const b = digit[sBot];
    let sum = 0;
    for (let c = 0; c < C; c++) {
      const v = edgeCol[rTop][c][a[c]][b[c]];
      if (v === Infinity) return Infinity;
      sum += v;
    }
    return sum;
  };
  const vertTripleCost = (rTop: number, sA: number, sB: number, sC: number): number => {
    const a = digit[sA];
    const b = digit[sB];
    const cc = digit[sC];
    let sum = 0;
    for (let c = 0; c < C; c++) {
      sum += tripleCol[rTop][c][a[c]][b[c]][cc[c]];
    }
    return sum;
  };

  // ---- 第一趟：全局裁决序最小者（车道 0 = 唯一车道） ----
  interface Snap {
    labels: Map<string, Node>;
  }
  const snapshots: Snap[] = [];

  let layer = new Labels();
  const s0list = feasibleAt(0);
  for (const s0 of s0list) {
    layer.put(
      { o1: rowH1[0][s0], o2: rowH2[0][s0], lex: stateCycles[s0].slice(), state: s0, back: null },
      `${s0},-1`,
    );
  }
  snapshots.push({ labels: layer.map });

  for (let r = 1; r < R; r++) {
    const next = new Labels();
    const cur = feasibleAt(r);
    for (const [oldKey, node] of layer.map) {
      const [pa, pb] = oldKey.split(',').map(Number);
      const sPrev = r === 1 ? pa : pb;
      const sPrev2 = r === 1 ? -1 : pa;
      for (const sc of cur) {
        const e2 = vertEdgeCost(r - 1, sPrev, sc);
        if (e2 === Infinity) continue;
        const e1 = r >= 2 ? vertTripleCost(r - 2, sPrev2, sPrev, sc) : 0;
        next.put(
          {
            o1: node.o1 + e1 + rowH1[r][sc],
            o2: node.o2 + e2 + rowH2[r][sc],
            lex: node.lex.concat(stateCycles[sc]),
            state: sc,
            back: { pairKey: oldKey, lane: 0 },
          },
          `${sPrev},${sc}`,
        );
      }
    }
    layer = next;
    snapshots.push({ labels: layer.map });
    if (layer.map.size === 0) {
      const fail: SolveFail = {
        kind: 'infeasible',
        anchorImpossible: false,
        edges: [],
        globallyInconsistent: true,
      };
      return fail;
    }
  }

  let winner: Node | null = null;
  for (const n of layer.map.values()) {
    if (
      !winner ||
      n.o1 < winner.o1 ||
      (n.o1 === winner.o1 &&
        (n.o2 < winner.o2 || (n.o2 === winner.o2 && cmpLex(n.lex, winner.lex) < 0)))
    ) {
      winner = n;
    }
  }
  if (!winner) {
    const fail: SolveFail = {
      kind: 'infeasible',
      anchorImpossible: false,
      edges: [],
      globallyInconsistent: true,
    };
    return fail;
  }
  const O1 = winner.o1;
  const O2 = winner.o2;
  const Lstar = winner.lex;

  // ---- 第二趟：o1=O1、o2=O2 且圈数序列字典序严格大于 L* 的最小者（见证） ----
  // lane 0：前缀与 L* 完全相等；lane 1：已在首个差异位严格更大（更小者直接剪去）。
  // 每趟保存各层快照用于回溯。
  interface Node2 {
    o1: number;
    o2: number;
    state: number;
    lex: number[];
    back: { pairKey: string; lane: 0 | 1 } | null;
  }
  type Layer2 = Map<string, [Node2 | null, Node2 | null]>;
  type Entry2 = [Node2 | null, Node2 | null];
  const keyOf = (a: number, b: number) => `${a},${b}`;
  const better = (x: Node2, y: Node2): boolean =>
    x.o1 < y.o1 ||
    (x.o1 === y.o1 && (x.o2 < y.o2 || (x.o2 === y.o2 && cmpLex(x.lex, y.lex) < 0)));

  /** 行 r=0 的初始车道：-1 表示相对 L* 已更小（须剪去），0 相等，1 更大 */
  const initialLane = (s: number): -1 | 0 | 1 => {
    for (let c = 0; c < C; c++) {
      const k = stateCycles[s][c];
      if (k !== Lstar[c]) return k < Lstar[c] ? -1 : 1;
    }
    return 0;
  };

  const saved2: Layer2[] = [];
  let layer2: Layer2 = new Map();
  for (const s0 of s0list) {
    const init = initialLane(s0);
    if (init === -1) continue;
    const lane: 0 | 1 = init;
    const key = keyOf(s0, -1);
    const entry: Entry2 = layer2.get(key) ?? [null, null];
    const n: Node2 = {
      o1: rowH1[0][s0],
      o2: rowH2[0][s0],
      state: s0,
      lex: stateCycles[s0].slice(),
      back: null,
    };
    if (!entry[lane] || better(n, entry[lane]!)) entry[lane] = n;
    layer2.set(key, entry);
  }
  saved2.push(layer2);

  for (let r = 1; r < R; r++) {
    const next: Layer2 = new Map();
    const cur = feasibleAt(r);
    const extend = (oldKey: string, prev: Node2, prevLane: 0 | 1, sc: number) => {
      const e2 = vertEdgeCost(r - 1, prev.state, sc);
      if (e2 === Infinity) return;
      // oldKey 位于第 r-1 层，形如 "s_{r-2},s_{r-1}"（r=1 时为 "s0,-1"）
      const ppa = Number(oldKey.slice(0, oldKey.indexOf(',')));
      const sPrev2 = r === 1 ? -1 : ppa;
      const e1 = r >= 2 ? vertTripleCost(r - 2, sPrev2, prev.state, sc) : 0;
      const no1 = prev.o1 + e1 + rowH1[r][sc];
      const no2 = prev.o2 + e2 + rowH2[r][sc];
      if (no1 > O1 || (no1 === O1 && no2 > O2)) return;
      let lane: 0 | 1 = prevLane;
      if (prevLane === 0) {
        for (let c = 0; c < C; c++) {
          const k = stateCycles[sc][c];
          const lk = Lstar[r * C + c];
          if (k !== lk) {
            if (k < lk) return; // 字典序已小于最优，永非见证
            lane = 1;
            break;
          }
        }
      }
      const n: Node2 = {
        o1: no1,
        o2: no2,
        state: sc,
        lex: prev.lex.concat(stateCycles[sc]),
        back: { pairKey: oldKey, lane: prevLane },
      };
      const nk = keyOf(prev.state, sc);
      const entry: Entry2 = next.get(nk) ?? [null, null];
      if (!entry[lane] || better(n, entry[lane]!)) entry[lane] = n;
      next.set(nk, entry);
    };
    for (const [oldKey, [nEq, nGt]] of layer2) {
      for (const sc of cur) {
        if (nEq) extend(oldKey, nEq, 0, sc);
        if (nGt) extend(oldKey, nGt, 1, sc);
      }
    }
    layer2 = next;
    saved2.push(layer2);
  }

  let witnessNode: Node2 | null = null;
  for (const [, [, nGt]] of saved2[R - 1]) {
    if (!nGt || nGt.o1 !== O1 || nGt.o2 !== O2) continue;
    if (!witnessNode || cmpLex(nGt.lex, witnessNode.lex) < 0) witnessNode = nGt;
  }

  // ---- 回溯 ----
  const rebuildWinner = (end: Node): Candidate => {
    const rowStates = new Array<number>(R);
    let r = R - 1;
    let node: Node | null = end;
    while (node) {
      rowStates[r] = node.state;
      if (!node.back) break;
      node = snapshots[r - 1].labels.get(node.back.pairKey) ?? null;
      r--;
    }
    const cyclesMat: number[][] = [];
    const unwrapped: number[][] = [];
    for (let rr = 0; rr < R; rr++) {
      const ks = stateCycles[rowStates[rr]];
      cyclesMat.push(ks.slice());
      unwrapped.push(ks.map((k, c) => readings[rr][c] + k * P));
    }
    return { cycles: cyclesMat, unwrapped };
  };

  const rebuildWitness = (end: Node2): Candidate => {
    const rowStates = new Array<number>(R);
    let r = R - 1;
    let node: Node2 | null = end;
    while (node) {
      rowStates[r] = node.state;
      if (!node.back) break;
      const entry = saved2[r - 1].get(node.back.pairKey);
      const prev: Node2 | null | undefined =
        node.back.lane === 0 ? entry?.[0] : entry?.[1];
      if (!prev) throw new Error('内部错误：见证回溯链断裂');
      node = prev;
      r--;
    }
    const cyclesMat: number[][] = [];
    const unwrapped: number[][] = [];
    for (let rr = 0; rr < R; rr++) {
      const ks = stateCycles[rowStates[rr]];
      cyclesMat.push(ks.slice());
      unwrapped.push(ks.map((k, c) => readings[rr][c] + k * P));
    }
    return { cycles: cyclesMat, unwrapped };
  };

  const ok: SolveOk = {
    kind: 'ok',
    ...rebuildWinner(winner),
    objective1: O1,
    objective2: O2,
    witness: witnessNode ? rebuildWitness(witnessNode) : null,
  };
  return ok;
}

/** 仅供测试/调试使用的纯目标计算 */
export function objectives(p: Params, candidate: Candidate): [number, number] {
  const { rows, cols } = p;
  const u = candidate.unwrapped;
  let o1 = 0;
  let o2 = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (c + 1 < cols) o2 += Math.abs(u[r][c] - u[r][c + 1]);
      if (r + 1 < rows) o2 += Math.abs(u[r + 1][c] - u[r][c]);
      if (c + 2 < cols) o1 += Math.abs(u[r][c] - 2 * u[r][c + 1] + u[r][c + 2]);
      if (r + 2 < rows) o1 += Math.abs(u[r][c] - 2 * u[r + 1][c] + u[r + 2][c]);
    }
  }
  return [o1, o2];
}
