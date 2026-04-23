import { useState, useCallback } from 'react';
import * as XLSX from 'xlsx';
import {
  convertQuotes,
  FUEL_RATE,
  HEAVY_WEIGHT_COLS,
  type RawQuoteRow,
  type ConvertResult,
} from './lib/quote-core';

// 内置公开价数据 (0.5kg ~ 20kg, 从 YDH 2026 公开价.xlsx)
const DEFAULT_PUBLIC_PRICES: [number, number][] = [
  [0.5, 295], [1.0, 370], [1.5, 445], [2.0, 520], [2.5, 595],
  [3.0, 670], [3.5, 745], [4.0, 820], [4.5, 895], [5.0, 970],
  [5.5, 1045], [6.0, 1120], [6.5, 1195], [7.0, 1270], [7.5, 1345],
  [8.0, 1420], [8.5, 1495], [9.0, 1570], [9.5, 1645], [10.0, 1720],
  [10.5, 1795], [11.0, 1870], [11.5, 1945], [12.0, 2020], [12.5, 2095],
  [13.0, 2170], [13.5, 2245], [14.0, 2320], [14.5, 2395], [15.0, 2470],
  [15.5, 2545], [16.0, 2620], [16.5, 2695], [17.0, 2770], [17.5, 2845],
  [18.0, 2920], [18.5, 2995], [19.0, 3070], [19.5, 3145], [20.0, 3220],
];

function buildPublicPriceMap(): Map<number, number> {
  const map = new Map<number, number>();
  for (const [w, p] of DEFAULT_PUBLIC_PRICES) map.set(w, p);
  return map;
}

function App() {
  const [quoteFile, setQuoteFile] = useState<File | null>(null);
  const [publicFile, setPublicFile] = useState<File | null>(null);
  const [status, setStatus] = useState<string>('');
  const [result, setResult] = useState<ConvertResult | null>(null);
  const [previewRows, setPreviewRows] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<'quote' | 'detail' | 'heavy'>('quote');
  const [useDefaultPublicPrice, setUseDefaultPublicPrice] = useState(true);

  // 拖拽上传状态
  const [quoteDragOver, setQuoteDragOver] = useState(false);

  const onQuoteFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) setQuoteFile(e.target.files[0]);
  }, []);

  const onPublicFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) setPublicFile(e.target.files[0]);
  }, []);

  // 拖拽处理
  const onQuoteDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setQuoteDragOver(false);
    if (e.dataTransfer.files?.[0]) setQuoteFile(e.dataTransfer.files[0]);
  }, []);

  const onQuoteDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setQuoteDragOver(true);
  }, []);

  const onQuoteDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setQuoteDragOver(false);
  }, []);

  // 解析公开价表
  const parsePublicPriceFile = async (file: File): Promise<Map<number, number>> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = new Uint8Array(e.target?.result as ArrayBuffer);
          const wb = XLSX.read(data, { type: 'array' });
          const ws = wb.Sheets[wb.SheetNames[0]];
          const json = XLSX.utils.sheet_to_json(ws, { header: ['weight', 'price'] }) as any[];
          const map = new Map<number, number>();
          for (let i = 1; i < json.length; i++) {
            const row = json[i];
            const w = Number(row['weight']);
            const p = Number(row['price']);
            if (!isNaN(w) && !isNaN(p)) map.set(w, p);
          }
          resolve(map);
        } catch (err) {
          reject(err);
        }
      };
      reader.readAsArrayBuffer(file);
    });
  };

  // 解析报价表
  const parseQuoteFile = async (file: File): Promise<RawQuoteRow[]> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = new Uint8Array(e.target?.result as ArrayBuffer);
          const wb = XLSX.read(data, { type: 'array' });
          let sheetName = wb.SheetNames.find(s => s.includes('处理后报价')) || wb.SheetNames[0];
          const ws = wb.Sheets[sheetName];
          const json: RawQuoteRow[] = XLSX.utils.sheet_to_json(ws) as RawQuoteRow[];
          resolve(json);
        } catch (err) {
          reject(err);
        }
      };
      reader.readAsArrayBuffer(file);
    });
  };

  // 执行转换
  const handleConvert = async () => {
    if (!quoteFile) { setStatus('请先选择报价表！'); return; }

    try {
      setStatus('正在加载公开价表...');
      const publicPrices = useDefaultPublicPrice
        ? buildPublicPriceMap()
        : publicFile
          ? await parsePublicPriceFile(publicFile)
          : buildPublicPriceMap();

      setStatus(`正在解析报价表... (${quoteFile.name})`);
      const rawData = await parseQuoteFile(quoteFile);

      setStatus('正在计算折扣率和新价格...');

      setTimeout(() => {
        const convertResult = convertQuotes(rawData, publicPrices);
        setResult(convertResult);
        setPreviewRows(convertResult.quoteData.slice(0, 20));

        const passCount = convertResult.totalRecords - convertResult.verifyResults.length;
        setStatus(
          `完成! 共${convertResult.totalRecords}条记录 | ` +
          `${convertResult.discountCount}条有折扣(0-20kg) | ` +
          `${convertResult.heavyOnlyCount}条仅21kg+ | ` +
          `验证: ${passCount}/${convertResult.totalRecords}通过` +
          (convertResult.verifyResults.length > 0 ? `, ${convertResult.verifyResults.length}条FAIL` : '')
        );
      }, 50);
    } catch (err) {
      console.error(err);
      setStatus(`出错: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  // 导出Excel
  const handleExport = () => {
    if (!result) {
      setStatus('没有可导出的数据，请先转换！');
      return;
    }

    try {
      const wb = XLSX.utils.book_new();

      // Sheet 1: 最终报价单
      if (result.quoteData.length > 0) {
        const ws1 = XLSX.utils.json_to_sheet(result.quoteData);
        const cols1 = Object.keys(result.quoteData[0]).map(() => ({ wch: 12 }));
        cols1[0] = { wch: 8 };
        cols1[2] = { wch: 18 };
        ws1['!cols'] = cols1;
        XLSX.utils.book_append_sheet(wb, ws1, '最终报价单');
      }

      // Sheet 2: 报价转换结果
      if (result.detailData.length > 0) {
        const ws2 = XLSX.utils.json_to_sheet(result.detailData);
        XLSX.utils.book_append_sheet(wb, ws2, '报价转换结果');
      }

      // Sheet 3: 折扣分析明细
      if (result.analysisData.length > 0) {
        const ws3 = XLSX.utils.json_to_sheet(result.analysisData);
        XLSX.utils.book_append_sheet(wb, ws3, '折扣分析明细');
      }

      // Sheet 4: 21kg以上换算
      if (result.heavyData.length > 0) {
        const ws4 = XLSX.utils.json_to_sheet(result.heavyData);
        XLSX.utils.book_append_sheet(wb, ws4, '21kg以上换算');
      }

      const baseName = quoteFile ? quoteFile.name.replace(/\.xlsx?$/i, '') : '报价';
      const filename = `${baseName}_新报价单.xlsx`;
      XLSX.writeFile(wb, filename);
      setStatus(`已导出: ${filename}`);
    } catch (err) {
      console.error('导出失败:', err);
      setStatus(`导出出错: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  // 渲染表格
  const renderTable = (data: any[], maxRows?: number) => {
    if (!data || data.length === 0) {
      return (
        <div className="empty-state">
          <div className="empty-icon">📭</div>
          <p>暂无数据</p>
        </div>
      );
    }

    const display = maxRows ? data.slice(0, maxRows) : data;
    const cols = Object.keys(display[0]);

    return (
      <div className="table-container">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                {cols.map((col, i) => (
                  <th key={i}>{String(col)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {display.map((row, ri) => (
                <tr key={ri}>
                  {cols.map((col, ci) => {
                    let val = row[col];
                    if (typeof val === 'number') val = Math.round(val * 100) / 100;
                    const strVal = String(val ?? '');

                    let cellClass = '';
                    if (col === '客户简称' || col === '产品名称') {
                      cellClass += ' font-medium';
                    } else {
                      cellClass += ' text-right';
                    }
                    if (col === '折扣率' && strVal && strVal !== '') {
                      cellClass += ' price-up';
                    }
                    if (HEAVY_WEIGHT_COLS.includes(col) && strVal && strVal !== '') {
                      cellClass += ' price-down';
                    }

                    return (
                      <td key={ci} className={cellClass}>{strVal}</td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {maxRows && data.length > maxRows && (
          <div style={{ padding: '10px', textAlign: 'center', fontSize: '13px', color: '#999', background: '#fafbff' }}>
            仅显示前{maxRows}条，共{data.length}条 — 导出Excel查看完整数据
          </div>
        )}
      </div>
    );
  };

  // 状态栏样式
  const statusClassName = () => {
    if (status.includes('出错') || status.includes('FAIL')) return 'status-error';
    if (status.includes('完成') || status.includes('已导出')) return 'status-success';
    if (status.includes('正在')) return 'status-loading';
    return '';
  };

  return (
    <div>
      {/* 头部 */}
      <div className="header">
        <h1>YDH 报价转换工具</h1>
        <p>上传报价表 → 自动计算折扣率 → 生成新报价单 · 纯浏览器运行，无需服务器</p>
      </div>

      {/* 上传区域 */}
      <div className="upload-section">
        <div className="section-title">第一步：选择文件</div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '16px' }}>
          {/* 报价表上传 */}
          <div>
            <div
              className={`upload-zone ${quoteDragOver ? 'active' : ''}`}
              onDrop={onQuoteDrop}
              onDragOver={onQuoteDragOver}
              onDragLeave={onQuoteDragLeave}
              onClick={() => document.getElementById('quote-file-input')?.click()}
            >
              <div className="upload-icon">📄</div>
              <div className="upload-text">点击或拖拽选择旧报价表文件</div>
              <div className="upload-hint">支持 .xlsx / .xls 格式</div>
              <input
                id="quote-file-input"
                type="file"
                accept=".xlsx,.xls"
                onChange={onQuoteFileChange}
                style={{ display: 'none' }}
              />
            </div>
            {quoteFile && (
              <div className="file-info">
                <span>✅</span>
                <span className="file-name">{quoteFile.name}</span>
                <span style={{ color: '#888', fontSize: '12px' }}>({(quoteFile.size / 1024).toFixed(1)} KB)</span>
              </div>
            )}
          </div>

          {/* 公开价表配置 */}
          <div>
            <div className="config-row" style={{ marginTop: 0, borderTop: 'none', paddingTop: 0 }}>
              <div className="config-item">
                <input
                  type="checkbox"
                  id="use-default-price"
                  checked={useDefaultPublicPrice}
                  onChange={(e) => setUseDefaultPublicPrice(e.target.checked)}
                />
                <label htmlFor="use-default-price">使用内置 YDH 2026 公开价</label>
              </div>
            </div>
            {!useDefaultPublicPrice && (
              <>
                <div
                  className="upload-zone"
                  onClick={() => document.getElementById('public-file-input')?.click()}
                  style={{ marginTop: '10px' }}
                >
                  <div className="upload-icon">📊</div>
                  <div className="upload-text">点击上传自定义公开价表</div>
                  <div className="upload-hint">需包含"重量"和"公开价"两列</div>
                  <input
                    id="public-file-input"
                    type="file"
                    accept=".xlsx,.xls"
                    onChange={onPublicFileChange}
                    style={{ display: 'none' }}
                  />
                </div>
                {publicFile && (
                  <div className="file-info">
                    <span>✅</span>
                    <span className="file-name">{publicFile.name}</span>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* 操作按钮 */}
        <div className="action-bar" style={{ marginTop: '20px' }}>
          <div className="action-left">
            <button
              className="btn btn-primary"
              onClick={handleConvert}
              disabled={!quoteFile}
            >
              ▶ 开始转换
            </button>
            {result && (
              <button className="btn btn-success" onClick={handleExport}>
                ⬇ 导出 Excel
              </button>
            )}
          </div>
          {status && (
            <span className={`status-text ${statusClassName()}`}>{status}</span>
          )}
        </div>
      </div>

      {/* 结果区域 */}
      {result && (
        <>
          {/* 统计概览 */}
          <div className="status-bar">
            <div className="status-left">
              <span className="stat-item">
                <span className="stat-label">总记录:</span>
                <span className="stat-value">{result.totalRecords}</span>
              </span>
              <span className="stat-item">
                <span className="stat-label">有折扣:</span>
                <span className="stat-value">{result.discountCount}</span>
              </span>
              <span className="stat-item">
                <span className="stat-label">仅21kg+:</span>
                <span className="stat-value">{result.heavyOnlyCount}</span>
              </span>
              <span className="stat-item">
                <span className="stat-label">验证通过:</span>
                <span className="stat-value" style={{ color: result.verifyResults.length > 0 ? '#ef476f' : '#06d6a0' }}>
                  {result.totalRecords - result.verifyResults.length}/{result.totalRecords}
                </span>
              </span>
            </div>
          </div>

          {/* Tab导航 + 表格 */}
          <div className="tab-nav">
            {[
              { key: 'quote' as const, label: '最终报价单', count: result.quoteData.length },
              { key: 'detail' as const, label: '转换对比明细', count: result.detailData.length },
              { key: 'heavy' as const, label: '21kg+ 换算', count: result.heavyData.length },
            ].map(tab => (
              <button
                key={tab.key}
                className={`tab-btn ${activeTab === tab.key ? 'active' : ''}`}
                onClick={() => setActiveTab(tab.key)}
              >
                {tab.label}
                <span className="tab-badge">{tab.count}</span>
              </button>
            ))}
          </div>

          {activeTab === 'quote' && renderTable(previewRows)}
          {activeTab === 'detail' && renderTable(result.detailData.slice(0, 30))}
          {activeTab === 'heavy' && renderTable(result.heavyData)}

          {/* 验证信息 */}
          <div className="verify-box">
            <div className={`verify-title ${result.verifyResults.length > 0 ? 'verify-fail' : 'verify-ok'}`}>
              {result.verifyResults.length > 0 ? '⚠️ 验证未通过的记录' : '✅ 所有记录验证通过'}
              <span style={{ fontSize: '12px', fontWeight: 400, marginLeft: '8px' }}>
                (新价必须 ≥ 旧价)
              </span>
            </div>
            {result.verifyResults.length > 0 ? (
              <div className="verify-list">
                {result.verifyResults.map((v, i) => <div key={i}>{v}</div>)}
              </div>
            ) : (
              <div className="verify-list all-ok">
                所有重量段的新价格均 ≥ 旧价格，数据验证通过。
              </div>
            )}
          </div>

          {/* 公式说明 */}
          <div className="verify-box" style={{ background: '#f8f9fc' }}>
            <div className="verify-title" style={{ color: '#333' }}>📖 公式说明</div>
            <div style={{ fontSize: '13px', color: '#555', lineHeight: '1.8' }}>
              <p><b>0-20kg:</b> 新价 = 公开价 × 统一折扣 × {(FUEL_RATE + 1).toFixed(2)}(含燃油)，自动计算最大统一折扣率保证每条新价 ≥ 旧价</p>
              <p><b>21kg+:</b> 新基础单价 = 原价 ÷ {(FUEL_RATE + 1).toFixed(2)}，加燃油后与原价完全一致</p>
            </div>
          </div>
        </>
      )}

      {/* 页脚 */}
      <footer style={{ textAlign: 'center', padding: '20px', color: '#aaa', fontSize: '12px' }}>
        YDH 报价转换工具 v1.0 · 燃油费率 {FUEL_RATE * 100}% · 内置 {DEFAULT_PUBLIC_PRICES.length} 个重量段公开价 · 数据不出浏览器
      </footer>
    </div>
  );
}

export default App;
