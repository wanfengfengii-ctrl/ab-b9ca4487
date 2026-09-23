import { useDeferredValue, useMemo, useState } from 'react';
import { parseImport, validate, type RawState } from './lib/validate';
import { solve } from './lib/solver';
import type { LocatedError, Params, SolveFail, SolveOk } from './lib/types';

type Output =
  | { status: 'invalid'; errors: LocatedError[] }
  | { status: 'infeasible'; fail: SolveFail; params: Params }
  | { status: 'ok'; result: SolveOk; params: Params };

const compute = (raw: RawState): Output => {
  const v = validate(raw);
  if (v.errors.length > 0 || !v.params) return { status: 'invalid', errors: v.errors };
  const res = solve(v.params);
  return res.kind === 'infeasible'
    ? { status: 'infeasible', fail: res, params: v.params }
    : { status: 'ok', result: res, params: v.params };
};

const initialCells = (): string[][] => [
  ['0', '5', '5'],
  ['5', '7', '3'],
];

const fmtK = (k: number) => (k > 0 ? `+${k}` : `${k}`);

export function App() {
  const [cells, setCells] = useState<string[][]>(initialCells);
  const [rows, setRows] = useState(2);
  const [cols, setCols] = useState(3);
  const [periodText, setPeriodText] = useState('10');
  const [cycleMinText, setCycleMinText] = useState('-1');
  const [cycleMaxText, setCycleMaxText] = useState('1');
  const [maxJumpText, setMaxJumpText] = useState('6');
  const [anchorRow, setAnchorRow] = useState(1);
  const [anchorCol, setAnchorCol] = useState(1);
  const [anchorValueText, setAnchorValueText] = useState('0');
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [importError, setImportError] = useState<string | null>(null);

  const raw: RawState = useMemo(
    () => ({
      cells,
      periodText,
      cycleMinText,
      cycleMaxText,
      maxJumpText,
      anchorRow,
      anchorCol,
      anchorValueText,
    }),
    [cells, periodText, cycleMinText, cycleMaxText, maxJumpText, anchorRow, anchorCol, anchorValueText],
  );

  // 输入变化时立即撤下旧结果（面板显示重算中），裁决在延迟值上后台进行，不阻塞继续输入
  const deferredRaw = useDeferredValue(raw);
  const isRecalculating = deferredRaw !== raw;
  const output: Output = useMemo(() => compute(deferredRaw), [deferredRaw]);

  const invalidCells = useMemo(() => {
    if (output.status !== 'invalid') return new Set<string>();
    return new Set(
      output.errors.filter((e) => e.scope === 'cell').map((e) => `${e.r},${e.c}`),
    );
  }, [output]);

  const errorList = output.status === 'invalid' ? output.errors : [];

  const resize = (newRows: number, newCols: number) => {
    const nr = Math.min(24, Math.max(2, newRows));
    const nc = Math.min(4, Math.max(2, newCols));
    setRows(nr);
    setCols(nc);
    setCells((prev) => {
      const next: string[][] = [];
      for (let r = 0; r < nr; r++) {
        const row: string[] = [];
        for (let c = 0; c < nc; c++) row.push(prev[r]?.[c] ?? '0');
        next.push(row);
      }
      return next;
    });
    setAnchorRow((v) => Math.min(v, nr));
    setAnchorCol((v) => Math.min(v, nc));
  };

  const setCell = (r: number, c: number, text: string) => {
    setCells((prev) => prev.map((row, ri) => (ri === r ? row.map((v, ci) => (ci === c ? text : v)) : row)));
  };

  const chooseAnchor = (r: number, c: number) => {
    setAnchorRow(r + 1);
    setAnchorCol(c + 1);
    const v = cells[r]?.[c];
    if (v !== undefined && /^[+-]?\d+$/.test(v.trim())) setAnchorValueText(v.trim());
  };

  const doImport = () => {
    const parsed = parseImport(importText);
    if (!Array.isArray(parsed)) {
      setImportError(parsed.error.message);
      return;
    }
    setImportError(null);
    setImportOpen(false);
    setImportText('');
    setRows(parsed.length);
    setCols(parsed[0].length);
    setCells(parsed.map((row) => row.map(String)));
    setAnchorRow(1);
    setAnchorCol(1);
    setAnchorValueText(String(parsed[0][0]));
  };

  return (
    <div className="page">
      <header className="topbar">
        <h1>二维相位展开裁决台</h1>
        <p className="subtitle">
          每格真实相位 = 读数 + 圈数 × 周期；裁决满足锚点与全部横纵相邻约束，依次最小化
          二阶差分绝对和、相邻差绝对和，再取行优先圈数序列字典序最小者。
        </p>
      </header>

      <div className="layout">
        <section className="panel">
          <h2>① 读数矩阵（{rows} 行 × {cols} 列）</h2>
          <div className="row-actions">
            <button type="button" onClick={() => resize(rows + 1, cols)} disabled={rows >= 24}>
              ＋ 行
            </button>
            <button type="button" onClick={() => resize(rows - 1, cols)} disabled={rows <= 2}>
              － 行
            </button>
            <button type="button" onClick={() => resize(rows, cols + 1)} disabled={cols >= 4}>
              ＋ 列
            </button>
            <button type="button" onClick={() => resize(rows, cols - 1)} disabled={cols <= 2}>
              － 列
            </button>
            <button type="button" className="secondary" onClick={() => setImportOpen(true)}>
              导入矩阵…
            </button>
          </div>
          <div className="grid-wrap">
            <table className="editor">
              <thead>
                <tr>
                  <th className="corner" />
                  {Array.from({ length: cols }, (_, c) => (
                    <th key={c}>列 {c + 1}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {cells.map((row, r) => (
                  <tr key={r}>
                    <th>行 {r + 1}</th>
                    {row.map((text, c) => {
                      const isAnchor = anchorRow === r + 1 && anchorCol === c + 1;
                      const bad = invalidCells.has(`${r + 1},${c + 1}`);
                      return (
                        <td key={c}>
                          <input
                            className={[bad ? 'bad' : '', isAnchor ? 'anchor' : '']
                              .filter(Boolean)
                              .join(' ')}
                            value={text}
                            inputMode="numeric"
                            aria-label={`第 ${r + 1} 行第 ${c + 1} 列读数`}
                            onChange={(e) => setCell(r, c, e.target.value)}
                            onFocus={() => chooseAnchor(r, c)}
                            title={bad ? '非法整数' : isAnchor ? '当前锚点格' : '点击设为锚点格'}
                          />
                          {isAnchor && <span className="anchor-tag">锚</span>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="hint">点击单元格可将锚点移至该格（并以其读数作为锚点真实相位初值）。</p>

          <h2>② 参数</h2>
          <div className="params">
            <label>
              周期
              <input value={periodText} inputMode="numeric" onChange={(e) => setPeriodText(e.target.value)} />
            </label>
            <label>
              圈数区间下界
              <input value={cycleMinText} inputMode="numeric" onChange={(e) => setCycleMinText(e.target.value)} />
            </label>
            <label>
              圈数区间上界
              <input value={cycleMaxText} inputMode="numeric" onChange={(e) => setCycleMaxText(e.target.value)} />
            </label>
            <label>
              相邻跳变上限
              <input value={maxJumpText} inputMode="numeric" onChange={(e) => setMaxJumpText(e.target.value)} />
            </label>
            <label>
              锚点行（1–{rows}）
              <input
                value={anchorRow}
                inputMode="numeric"
                onChange={(e) => setAnchorRow(Number(e.target.value))}
              />
            </label>
            <label>
              锚点列（1–{cols}）
              <input
                value={anchorCol}
                inputMode="numeric"
                onChange={(e) => setAnchorCol(Number(e.target.value))}
              />
            </label>
            <label>
              锚点真实相位
              <input
                value={anchorValueText}
                inputMode="numeric"
                onChange={(e) => setAnchorValueText(e.target.value)}
              />
            </label>
          </div>
          <p className="hint">圈数区间为连续整数，最多包含 3 个值。</p>
        </section>

        <section className="panel results" aria-live="polite">
          {isRecalculating && (
            <div className="notice info">输入已变更，旧结果已撤下，正在重新裁决…</div>
          )}

          {!isRecalculating && output.status === 'invalid' && (
            <>
              <div className="notice error">
                输入存在 {errorList.length} 项问题，已停止裁决。请按下列定位修正：
              </div>
              <ul className="error-list">
                {errorList.map((e, i) => (
                  <li key={i} className={e.scope}>
                    {e.scope === 'cell' && (
                      <button
                        type="button"
                        className="loc"
                        onClick={() => {
                          const el = document.querySelector<HTMLInputElement>(
                            `input[aria-label="第 ${e.r} 行第 ${e.c} 列读数"]`,
                          );
                          el?.focus();
                          el?.select();
                        }}
                      >
                        定位至 第{e.r}行·第{e.c}列
                      </button>
                    )}
                    <span>{e.message}</span>
                  </li>
                ))}
              </ul>
            </>
          )}

          {!isRecalculating && output.status === 'infeasible' && <InfeasibleView output={output} />}

          {!isRecalculating && output.status === 'ok' && <ResultView output={output} />}
        </section>
      </div>

      {importOpen && (
        <div className="modal-mask" onClick={() => setImportOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>导入整数读数矩阵</h3>
            <p className="hint">
              2–24 行、每行 2–4 个整数；支持空格、制表符、逗号或分号分隔，每行一个记录。
            </p>
            <textarea
              rows={10}
              placeholder={'0, 7, 1\n8, 2, 6'}
              value={importText}
              onChange={(e) => {
                setImportText(e.target.value);
                setImportError(null);
              }}
            />
            {importError && <div className="notice error">{importError}</div>}
            <div className="modal-actions">
              <button type="button" className="secondary" onClick={() => setImportOpen(false)}>
                取消
              </button>
              <button type="button" onClick={doImport}>
                导入
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function InfeasibleView({ output }: { output: Extract<Output, { status: 'infeasible' }> }) {
  const { fail, params } = output;
  return (
    <>
      <div className="notice error">无满足全部约束的圈数指派。</div>
      <ul className="error-list">
        {fail.anchorImpossible && (
          <li>
            锚点（第 {params.anchor.r + 1} 行·第 {params.anchor.c + 1} 列）的真实相位{' '}
            <b>{params.anchor.value}</b> 无法写成「读数 + 圈数 × 周期」：
            读数 {params.readings[params.anchor.r][params.anchor.c]}、周期 {params.period}、
            圈数 ∈ {`{${params.cycles.join(', ')}}`}。
          </li>
        )}
        {fail.edges.map((e, i) => (
          <li key={i}>
            相邻边 第{e.r1}行·第{e.c1}列 ↔ 第{e.r2}行·第{e.c2}列 在圈数区间内最小可能绝对差为{' '}
            <b>{e.minAbs}</b>，大于上限 <b>{params.maxJump}</b>。
          </li>
        ))}
        {fail.globallyInconsistent && (
          <li>
            每条相邻边单独看都存在可行端点组合，但全部横纵约束无联立解（约束网络整体不一致）。
          </li>
        )}
      </ul>
    </>
  );
}

function MatrixCard({
  title,
  rows,
  cols,
  badge,
  badgeTitle,
}: {
  title: string;
  rows: number[][];
  cols: number;
  badge?: number[][];
  badgeTitle?: string;
}) {
  return (
    <div className="matrix-card">
      <h4>{title}</h4>
      <table className="result-matrix">
        <tbody>
          {rows.map((row, r) => (
            <tr key={r}>
              {row.map((v, c) => (
                <td key={c} style={{ minWidth: cols >= 4 ? 64 : 84 }}>
                  <span className="value">{v}</span>
                  {badge && (
                    <span className="kbadge" title={badgeTitle}>
                      k={fmtK(badge[r][c])}
                    </span>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ResultView({ output }: { output: Extract<Output, { status: 'ok' }> }) {
  const { result, params } = output;
  return (
    <>
      <div className="objectives">
        <div className="obj">
          <div className="obj-label">目标一 · Σ|横纵二阶差分|</div>
          <div className="obj-value">{result.objective1}</div>
        </div>
        <div className="obj">
          <div className="obj-label">目标二 · Σ|横纵相邻差|</div>
          <div className="obj-value">{result.objective2}</div>
        </div>
      </div>
      <div className="notice ok">裁决成功：锚点与全部相邻约束均已满足。</div>

      <MatrixCard
        title="展开矩阵（逐格真实相位，角标为该格圈数）"
        rows={result.unwrapped}
        cols={params.cols}
        badge={result.cycles}
        badgeTitle="该格使用的圈数"
      />
      <MatrixCard title="逐格圈数" rows={result.cycles} cols={params.cols} />

      {result.witness ? (
        <div className="witness">
          <h3>并列见证（第二小字典序解）</h3>
          <p className="hint">
            存在另一个圈数指派，其目标一、目标二与最优解完全相同；下列为其中行优先字典序次小者，
            与最优解并列，供计量员复核折返歧义。
          </p>
          <MatrixCard
            title="见证 · 展开矩阵（角标为圈数）"
            rows={result.witness.unwrapped}
            cols={params.cols}
            badge={result.witness.cycles}
            badgeTitle="见证解该格使用的圈数"
          />
          <MatrixCard title="见证 · 逐格圈数" rows={result.witness.cycles} cols={params.cols} />
        </div>
      ) : (
        <p className="hint">前两项目标下无其他并列圈数指派，字典序裁决唯一。</p>
      )}
    </>
  );
}
