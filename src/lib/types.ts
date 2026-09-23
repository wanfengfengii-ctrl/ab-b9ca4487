/** 求解器与校验层共享的数据结构 */

/** 锚点：用 0 基下标定位，value 为该格的真实相位 */
export interface Anchor {
  r: number;
  c: number;
  value: number;
}

/** 已通过校验的求解参数 */
export interface Params {
  rows: number;
  cols: number;
  /** 整数读数矩阵 */
  readings: number[][];
  /** 周期（正整数） */
  period: number;
  /** 允许使用的圈数，升序且连续，长度 1..3 */
  cycles: number[];
  /** 相邻真实值之差绝对值的上限 */
  maxJump: number;
  anchor: Anchor;
}

export interface LocatedError {
  scope: 'cell' | 'param' | 'anchor' | 'import';
  /** 1 基坐标，便于页面定位 */
  r?: number;
  c?: number;
  field?: string;
  message: string;
}

export interface Candidate {
  /** 逐格圈数 */
  cycles: number[][];
  /** 逐格真实相位 = 读数 + 圈数 × 周期 */
  unwrapped: number[][];
}

export interface SolveOk extends Candidate {
  kind: 'ok';
  /** 目标一：全部横纵连续三格的二阶差分绝对值之和 */
  objective1: number;
  /** 目标二：全部横纵相邻差绝对值之和 */
  objective2: number;
  /** 目标一、二并列时字典序次小的见证解；无并列则为 null */
  witness: Candidate | null;
}

export interface InfeasibleEdge {
  r1: number;
  c1: number;
  r2: number;
  c2: number;
  /** 两端在给定圈数区间内能取到的最小绝对差 */
  minAbs: number;
}

export interface SolveFail {
  kind: 'infeasible';
  anchorImpossible: boolean;
  /** 局部就无法满足的相邻边（含坐标，1 基） */
  edges: InfeasibleEdge[];
  /** 每条边局部可行但二元约束整体无联立解 */
  globallyInconsistent: boolean;
}

export type SolveResult = SolveOk | SolveFail;
