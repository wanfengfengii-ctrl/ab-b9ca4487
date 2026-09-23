import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { App } from './App';

describe('App 渲染冒烟', () => {
  it('初始状态可完整渲染为 HTML（含编辑区、参数与结果面板）', () => {
    const html = renderToString(<App />);
    expect(html).toContain('二维相位展开裁决台');
    expect(html).toContain('读数矩阵');
    expect(html).toContain('相邻跳变上限');
    expect(html).toContain('锚点真实相位');
  });
});
