import type { LocatedError, Params } from './types';

export interface RawState {
  /** 逐格字符串，矩形 rows × cols */
  cells: string[][];
  periodText: string;
  /** 圈数区间下界/上界文本 */
  cycleMinText: string;
  cycleMaxText: string;
  maxJumpText: string;
  anchorRow: number;
  anchorCol: number;
  anchorValueText: string;
}

export interface Validated {
  params?: Params;
  errors: LocatedError[];
}

const intRe = /^[+-]?\d+$/;

const parseBig = (s: string): number | null => {
  const t = s.trim();
  if (!intRe.test(t)) return null;
  const n = Number(t);
  return Number.isSafeInteger(n) ? n : null;
};

/** 解析并校验全部输入；只有 errors 为空时 params 才可用 */
export function validate(raw: RawState): Validated {
  const errors: LocatedError[] = [];
  const { rows, cols } = { rows: raw.cells.length, cols: raw.cells[0]?.length ?? 0 };

  if (rows < 2 || rows > 24) {
    errors.push({ scope: 'param', field: 'rows', message: `行数须在 2–24 之间（当前 ${rows}）` });
  }
  if (cols < 2 || cols > 4) {
    errors.push({ scope: 'param', field: 'cols', message: `列数须在 2–4 之间（当前 ${cols}）` });
  }

  const readings: number[][] = [];
  if (rows >= 2 && rows <= 24 && cols >= 2 && cols <= 4) {
    for (let r = 0; r < rows; r++) {
      const row: number[] = [];
      for (let c = 0; c < cols; c++) {
        const text = raw.cells[r]?.[c] ?? '';
        const v = parseBig(text);
        if (v === null) {
          errors.push({
            scope: 'cell',
            r: r + 1,
            c: c + 1,
            message: `第 ${r + 1} 行第 ${c + 1} 列读数非法：须为安全范围内的整数`,
          });
          row.push(0);
        } else {
          row.push(v);
        }
      }
      readings.push(row);
    }
  }

  const period = parseBig(raw.periodText);
  if (period === null || period <= 0) {
    errors.push({ scope: 'param', field: 'period', message: '周期须为正整数' });
  }

  const cLo = parseBig(raw.cycleMinText);
  const cHi = parseBig(raw.cycleMaxText);
  let cycles: number[] = [];
  if (cLo === null || cHi === null) {
    errors.push({ scope: 'param', field: 'cycles', message: '圈数区间上下界须为整数' });
  } else if (cLo > cHi) {
    errors.push({ scope: 'param', field: 'cycles', message: '圈数区间下界不得大于上界' });
  } else {
    const span = cHi - cLo;
    if (span > 2) {
      errors.push({
        scope: 'param',
        field: 'cycles',
        message: `圈数区间最多包含 3 个整数（当前含 ${span + 1} 个）`,
      });
    } else {
      for (let k = cLo; k <= cHi; k++) cycles.push(k);
    }
  }

  const maxJump = parseBig(raw.maxJumpText);
  if (maxJump === null || maxJump < 0) {
    errors.push({ scope: 'param', field: 'maxJump', message: '相邻跳变上限须为非负整数' });
  }

  let anchorValue = 0;
  const ar = raw.anchorRow - 1;
  const ac = raw.anchorCol - 1;
  const anchorPosOk =
    rows >= 2 && rows <= 24 && cols >= 2 && cols <= 4 && ar >= 0 && ar < rows && ac >= 0 && ac < cols;
  if (!anchorPosOk) {
    errors.push({
      scope: 'anchor',
      r: raw.anchorRow,
      c: raw.anchorCol,
      message: `锚点坐标超出矩阵范围（应为 1–${rows} 行、1–${cols} 列）`,
    });
  }
  const av = parseBig(raw.anchorValueText);
  if (av === null) {
    errors.push({ scope: 'anchor', field: 'value', message: '锚点真实相位须为整数' });
  } else {
    anchorValue = av;
  }

  if (errors.length > 0) return { errors };

  // 防止「读数 + 圈数 × 周期」超出安全整数范围
  const maxCycleMag = Math.max(Math.abs(cycles[0]), Math.abs(cycles[cycles.length - 1]));
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (Math.abs(readings[r][c]) + maxCycleMag * period! > Number.MAX_SAFE_INTEGER) {
        errors.push({
          scope: 'cell',
          r: r + 1,
          c: c + 1,
          message: `第 ${r + 1} 行第 ${c + 1} 列读数与圈数×周期之和超出安全整数范围`,
        });
      }
    }
  }
  if (Math.abs(anchorValue) > Number.MAX_SAFE_INTEGER) {
    errors.push({ scope: 'anchor', field: 'value', message: '锚点真实相位超出安全整数范围' });
  }
  if (errors.length > 0) return { errors };

  const params: Params = {
    rows,
    cols,
    readings,
    period: period!,
    cycles,
    maxJump: maxJump!,
    anchor: { r: ar, c: ac, value: anchorValue },
  };
  return { params, errors: [] };
}

/** 解析导入文本：接受空白/逗号/Tab 分隔，按行成矩阵 */
export function parseImport(text: string): number[][] | { error: LocatedError } {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length < 2 || lines.length > 24) {
    return {
      error: { scope: 'import', message: `导入数据须为 2–24 行（当前 ${lines.length} 行）` },
    };
  }
  const matrix: number[][] = [];
  let width = -1;
  for (let r = 0; r < lines.length; r++) {
    const tokens = lines[r].split(/[\s,;，；]+/).filter((t) => t.length > 0);
    if (width === -1) {
      width = tokens.length;
      if (width < 2 || width > 4) {
        return { error: { scope: 'import', message: `列数须在 2–4 之间（当前 ${width} 列）` } };
      }
    } else if (tokens.length !== width) {
      return {
        error: {
          scope: 'import',
          r: r + 1,
          message: `第 ${r + 1} 行列数 ${tokens.length} 与首行 ${width} 不一致`,
        },
      };
    }
    const row: number[] = [];
    for (const t of tokens) {
      const v = parseBig(t);
      if (v === null) {
        return {
          error: {
            scope: 'import',
            r: r + 1,
            message: `第 ${r + 1} 行存在非法整数：“${t}”`,
          },
        };
      }
      row.push(v);
    }
    matrix.push(row);
  }
  return matrix;
}
