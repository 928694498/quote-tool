// YDH 报价工具箱 v2.0 - 2026.04.24 deploy
import { useState, useCallback } from 'react';
import * as XLSX from 'xlsx';
import {
  convertQuotes,
  FUEL_RATE,
  HEAVY_WEIGHT_COLS,
  type RawQuoteRow,
  type ConvertResult,
} from './lib/quote-core';
import {
  convertToSystemFormat,
  OUTPUT_HEADERS,
  SYSTEM_WEIGHT_RANGES,
  type SystemFormatRow,
  type SystemFormatResult,
} from './lib/system-format';

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

type Mode = 'convert' | 'system';

function buildPublicPriceMap(): Map<number, number> {
  const map = new Map<number, number>();
  for (const [w, p] of DEFAULT_PUBLIC_PRICES) map.set(w, p);
  return map;
}

function App() {
  // 模式切换
  const [mode, setMode] = useState<Mode>('system');

  // === 模式1: 折扣转换（原有功能）===
  const [quoteFile, setQuoteFile] = useState<File | null>(null);
  const [publicFile, setPublicFile] = useState<File | null>(null);
  const [status, setStatus] = useState<string>('');
  const [result, setResult] = useState<ConvertResult | null>(null);
  const [previewRows, setPreviewRows] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<'quote' | 'detail' | 'heavy'>('quote');
  const [useDefaultPublicPrice, setUseDefaultPublicPrice] = useState(true);
  const [quoteDragOver, setQuoteDragOver] = useState(false);

  // === 模式2: 系统导入格式（新功能）===
  const [sysFile, setSysFile] = useState<File | null>(null);
  const [sysDragOver, setSysDragOver] = useState(false);
  const [sysStatus, setSysStatus] = useState<string>('');
  const [sysResult, setSysResult] = useState<SystemFormatResult | null>(null);
  const [sysPreview, setSysPreview] = useState<SystemFormatRow[]>([]);
  const [effectiveDate, setEffectiveDate] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`;
  });
  const [sysSearch, setSysSearch] = useState('');

  // ---- 文件处理：折扣转换模式 ----
  const onQuoteFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) setQuoteFile(e.target.files[0]);
  }, []);
  const onPublicFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) setPublicFile(e.target.files[0]);
  }, []);
  const onQuoteDrop = useCallback((e: React.DragEvent) => { e.preventDefault(); setQuoteDragOver(false); if (e.dataTransfer.files?.[0]) setQuoteFile(e.dataTransfer.files[0]); }, []);
  const onQuoteDragOver = useCallback((e: React.DragEvent) => { e.preventDefault(); setQuoteDragOver(true); }, []);
  const onQuoteDragLeave = useCallback((e: React.DragEvent) => { e.preventDefault(); setQuoteDragOver(false); }, []);

  // ---- 文件处理：系统导入模式 ----
  const onSysFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) setSysFile(e.target.files[0]);
  }, []);
  const onSysDrop = useCallback((e: React.DragEvent) => { e.preventDefault(); setSysDragOver(false); if (e.dataTransfer.files?.[0]) setSysFile(e.dataTransfer.files[0]); }, []);
  const onSysDragOver = useCallback((e: React.DragEvent) => { e.preventDefault(); setSysDragOver(true); }, []);
  const onSysDragLeave = useCallback((e: React.DragEvent) => { e.preventDefault(); setSysDragOver(false); }, []);

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
        } catch (err) { reject(err); }
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
          let sheetName = wb.SheetNames.find(s => s.includes('处理后报价')) || wb.SheetNames.find(s => s.includes('最终报价')) || wb.SheetNames[0];
          const ws = wb.Sheets[sheetName];
          const json: RawQuoteRow[] = XLSX.utils.sheet_to_json(ws) as RawQuoteRow[];
          resolve(json);
        } catch (err) { reject(err); }
      };
      reader.readAsArrayBuffer(file);
    });
  };

  // === 模式1: 执行转换 ===
  const handleConvert = async () => {
    if (!quoteFile) { setStatus('请先选择报价表！'); return; }
    try {
      setStatus('正在加载公开价表...');
      const publicPrices = useDefaultPublicPrice ? buildPublicPriceMap() : publicFile ? await parsePublicPriceFile(publicFile) : buildPublicPriceMap();
      setStatus(`正在解析报价表... (${quoteFile.name})`);
      const rawData = await parseQuoteFile(quoteFile);
      setStatus('正在计算折扣率和新价格...');
      setTimeout(() => {
        const convertResult = convertQuotes(rawData, publicPrices);
        setResult(convertResult);
        setPreviewRows(convertResult.quoteData.slice(0, 20));
        const passCount = convertResult.totalRecords - convertResult.verifyResults.length;
        const failMsg = convertResult.verifyResults.length > 0 ? ", " + convertResult.verifyResults.length + "条FAIL" : "";
        const statusText = "完成! 共" + convertResult.totalRecords + "条记录 | " + convertResult.discountCount + "条有折扣(0-20kg) | " + convertResult.heavyOnlyCount + "条仅21kg+ | 验证: " + passCount + "/" + convertResult.totalRecords + "通过" + failMsg;
        setStatus(statusText);
      }, 50);
    } catch (err) {
      console.error(err);
      setStatus(`出错: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  // === 模式1: 导出Excel ===
  const handleExport = () => {
    if (!result) { setStatus('没有可导出的数据，请先转换！'); return; }
    try {
      const wb = XLSX.utils.book_new();
      if (result.quoteData.length > 0) {
        const ws1 = XLSX.utils.json_to_sheet(result.quoteData);
        const cols1 = Object.keys(result.quoteData[0]).map(() => ({ wch: 12 }));
        cols1[0] = { wch: 8 }; cols1[2] = { wch: 18 };
        ws1['!cols'] = cols1;
        XLSX.utils.book_append_sheet(wb, ws1, '最终报价单');
      }
      if (result.detailData.length > 0) { XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(result.detailData), '报价转换结果'); }
      if (result.analysisData.length > 0) { XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(result.analysisData), '折扣分析明细'); }
      if (result.heavyData.length > 0) { XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(result.heavyData), '21kg以上换算'); }
      const baseName = quoteFile?.name.replace(/\.xlsx?$/i, '') || '报价';
      XLSX.writeFile(wb, `${baseName}_新报价单.xlsx`);
      setStatus(`已导出: ${baseName}_新报价单.xlsx`);
    } catch (err) { setStatus(`导出出错: ${err instanceof Error ? err.message : String(err)}`); }
  };

  // === 模式2: 执行系统格式转换 ===
  const handleSystemConvert = async () => {
    if (!sysFile) { setSysStatus('请先选择"最终报价单"文件！'); return; }
    try {
      setSysStatus('正在解析文件...');
      const rawData = await (async () => {
        return new Promise<any[]>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = (e) => {
            try {
              const data = new Uint8Array(e.target?.result as ArrayBuffer);
              const wb = XLSX.read(data, { type: 'array' });
              let sheetName = wb.SheetNames.find(s => s.includes('最终报价') || s.includes('处理后报价') || s.includes('报价转换')) || wb.SheetNames[0];
              const ws = wb.Sheets[sheetName];
              // 使用 header: 1 获取原始二维数组，确保所有列都被读到
              const rawArray = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as any[][];
              const headers = rawArray[0] as string[];
              // 手动转对象
              const json = rawArray.slice(1).map((row) => {
                const obj: any = {};
                headers.forEach((h, i) => { if (h) obj[h] = row[i]; });
                return obj;
              });
              resolve(json);
            } catch (err) { reject(err); }
          };
          reader.readAsArrayBuffer(sysFile!);
        });
      })();

      setSysStatus(`已解析 ${rawData.length} 行原始数据，正在转换为系统格式...`);

      setTimeout(() => {
        const sysRes = convertToSystemFormat(rawData, { effectiveDate });
        setSysResult(sysRes);
        setSysPreview(sysRes.rows.slice(0, 50));
        setSysStatus(`完成! 共生成 ${sysRes.totalRecords} 条记录 (${sysRes.customerCount} 个客户)`);
      }, 50);
    } catch (err) {
      console.error(err);
      setSysStatus(`出错: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  // === 模式2: 导出系统格式 Excel ===
  const handleSystemExport = () => {
    if (!sysResult || sysResult.rows.length === 0) { setSysStatus('没有可导出的数据！'); return; }
    try {
      const wb = XLSX.utils.book_new();

      // Sheet: 公司系统导入报价单
      const ws = XLSX.utils.json_to_sheet(sysResult.rows);

      // 设置列宽
      ws['!cols'] = [
        { wch: 14 }, { wch: 10 }, { wch: 8 }, { wch: 8 }, { wch: 8 },
        { wch: 24 }, { wch: 6 }, { wch: 12 }, { wch: 8 }, { wch: 10 },
        { wch: 12 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 8 },
      ];

      XLSX.utils.book_append_sheet(wb, ws, '公司系统导入报价单');

      const baseName = sysFile?.name.replace(/\.xlsx?$/i, '') || '公司系统';
      XLSX.writeFile(wb, `${baseName}_系统导入.xlsx`);
      setSysStatus(`已导出: ${baseName}_系统导入.xlsx`);
    } catch (err) {
      setSysStatus(`导出出错: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  // === 渲染通用表格 ===
  const renderTable = (data: any[], maxRows?: number) => {
    if (!data || data.length === 0) {
      return (<div className="empty-state"><div className="empty-icon">📭</div><p>暂无数据</p></div>);
    }
    const display = maxRows ? data.slice(0, maxRows) : data;
    const cols = Object.keys(display[0]);
    return (
      <div className="table-container">
        <div className="table-scroll">
          <table>
            <thead><tr>{cols.map((col, i) => (<th key={i}>{String(col)}</th>))}</tr></thead>
            <tbody>
              {display.map((row, ri) => (
                <tr key={ri}>
                  {cols.map((col, ci) => {
                    let val = row[col];
                    if (typeof val === 'number') val = Math.round(val * 10000) / 10000;
                    const strVal = String(val ?? '');
                    let cellClass = '';
                    if (col === '客户简称' || col === '产品名称' || col === '客户代码' || col === '产品代码') cellClass += ' font-medium';
                    else cellClass += ' text-right';
                    if ((col === '折扣率' || col === '折扣') && strVal && strVal !== '' && strVal !== '1') cellClass += ' price-up';
                    if (HEAVY_WEIGHT_COLS.includes(col) && strVal && strVal !== '') cellClass += ' price-down';
                    return (<td key={ci} className={cellClass}>{strVal}</td>);
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

  // === 系统格式的表格渲染（带搜索过滤） ===
  const renderSystemTable = () => {
    if (!sysResult || sysResult.rows.length === 0) return null;

    let filtered = sysResult.rows;
    if (sysSearch.trim()) {
      const q = sysSearch.toLowerCase();
      filtered = sysResult.rows.filter(r =>
        String(r.客户代码).toLowerCase().includes(q) ||
        String(r.产品代码).toLowerCase().includes(q) ||
        String(r.重量段标题).toLowerCase().includes(q)
      );
    }

    return (
      <div>
        {/* 搜索栏 */}
        <div style={{
          display: 'flex', gap: '12px', marginBottom: '12px', alignItems: 'center',
          background: '#fff', padding: '12px 16px', borderRadius: '8px', boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
        }}>
          <span style={{ fontSize: '13px', color: '#666', whiteSpace: 'nowrap' }}>
            🔍 筛选 ({filtered.length}/{sysResult.rows.length})
          </span>
          <input
            className="search-input"
            placeholder="搜客户代码 / 产品代码 / 重量段..."
            value={sysSearch}
            onChange={(e) => setSysSearch(e.target.value)}
            style={{ flex: 1 }}
          />
          <button
            className="btn btn-success btn-sm"
            onClick={handleSystemExport}
            disabled={!sysResult}
          >
            ⬇ 导出系统导入文件
          </button>
        </div>

        {/* 规则说明 */}
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: '10px', marginBottom: '16px',
        }}>
          {[
            { label: '0-3kg', rule: '运费=空 | 首重=295 续重=75 | 折扣=原折扣' },
            { label: '3-20kg', rule: '运费=空 | 首重=670 续重=80 | 折扣=原折扣' },
            { label: '20-300kg', rule: '运费=原价 | 首重/续重=空 | 折扣=1' },
          ].map(item => (
            <div key={item.label} style={{
              background: 'linear-gradient(135deg,#f8f9fc,#eef2ff)', padding: '10px 14px',
              borderRadius: '8px', fontSize: '13px', borderLeft: '3px solid #4361ee',
            }}>
              <b style={{ color: '#4361ee' }}>{item.label}</b>
              <div style={{ color: '#666', marginTop: '2px', fontSize: '12px' }}>{item.rule}</div>
            </div>
          ))}
        </div>

        {/* 表格 */}
        {renderTable(filtered, 200)}
      </div>
    );
  };

  // 状态栏样式
  const statusClassName = (s: string) => {
    if (s.includes('出错') || s.includes('FAIL')) return 'status-error';
    if (s.includes('完成') || s.includes('已导出')) return 'status-success';
    if (s.includes('正在')) return 'status-loading';
    return '';
  };

  // ==================== 主渲染 ====================
  return (
    <div>
      {/* 头部 */}
      <div className="header">
        <h1>YDH 报价工具箱</h1>
        <p>折扣计算 · 系统导入格式转换 · 全部浏览器运行，无需服务器</p>
      </div>

      {/* 模式切换 Tab */}
      <div className="tab-nav" style={{ marginBottom: '20px' }}>
        <button className={`tab-btn ${mode === 'system' ? 'active' : ''}`} onClick={() => setMode('system')}>
          📋 公司系统导入格式
        </button>
        <button className={`tab-btn ${mode === 'convert' ? 'active' : ''}`} onClick={() => setMode('convert')}>
          🔄 折扣率转换（旧版）
        </button>
      </div>

      {/* ===== 模式2: 公司系统导入格式 ===== */}
      {mode === 'system' && (
        <>
          <div className="upload-section">
            <div className="section-title">第一步：上传最终报价单</div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '16px' }}>
              {/* 文件上传区 */}
              <div>
                <div
                  className={`upload-zone ${sysDragOver ? 'active' : ''}`}
                  onDrop={onSysDrop}
                  onDragOver={onSysDragOver}
                  onDragLeave={onSysDragLeave}
                  onClick={() => document.getElementById('sys-file-input')?.click()}
                >
                  <div className="upload-icon">📄</div>
                  <div className="upload-text">点击或拖拽选择「最终报价单」</div>
                  <div className="upload-hint">支持 .xlsx / .xls 格式（第一步处理后的输出）</div>
                  <input id="sys-file-input" type="file" accept=".xlsx,.xls" onChange={onSysFileChange} style={{ display: 'none' }} />
                </div>
                {sysFile && (
                  <div className="file-info">
                    <span>✅</span>
                    <span className="file-name">{sysFile.name}</span>
                    <span style={{ color: '#888', fontSize: '12px' }}>({(sysFile.size / 1024).toFixed(1)} KB)</span>
                  </div>
                )}
              </div>

              {/* 配置项 */}
              <div>
                <div style={{
                  background: '#fafbff', padding: '20px', borderRadius: '10px',
                  border: '1px solid #e8ecf4',
                }}>
                  <div style={{ fontSize: '14px', fontWeight: 600, marginBottom: '14px', color: '#333' }}>⚙️ 转换配置</div>

                  <div className="config-item" style={{ marginBottom: '12px' }}>
                    <label htmlFor="eff-date" style={{ fontWeight: 500, minWidth: '80px' }}>生效时间：</label>
                    <input
                      id="eff-date"
                      type="text"
                      value={effectiveDate}
                      onChange={(e) => setEffectiveDate(e.target.value)}
                      placeholder="YYYY/MM/DD"
                      style={{
                        padding: '8px 12px', border: '1px solid #ddd', borderRadius: '6px',
                        fontSize: '14px', width: '140px', fontFamily: 'inherit',
                      }}
                    />
                  </div>

                  <div style={{ fontSize: '12px', color: '#888', lineHeight: '1.8' }}>
                    <p>• 输出格式：每行一个「客户+产品+重量段」，共 7 个重量段区间</p>
                    <p>• 重量段：0-3 / 3-20 / 20-30 / 30-50 / 50-100 / 100-300 / 300-9999</p>
                    <p>• 0-3 和 3-20 运费金额留空，首重/续重自动填写</p>
                    <p>• 20kg 以上折扣统一填 1</p>
                  </div>
                </div>
              </div>
            </div>

            {/* 操作按钮 */}
            <div className="action-bar" style={{ marginTop: '20px' }}>
              <div className="action-left">
                <button className="btn btn-primary" onClick={handleSystemConvert} disabled={!sysFile}>
                  ▶ 转换为系统格式
                </button>
                {sysResult && (
                  <button className="btn btn-success" onClick={handleSystemExport}>
                    ⬇ 导出 Excel
                  </button>
                )}
              </div>
              {sysStatus && <span className={`status-text ${statusClassName(sysStatus)}`}>{sysStatus}</span>}
            </div>
          </div>

          {/* 结果区域 */}
          {sysResult && renderSystemTable()}
        </>
      )}

      {/* ===== 模式1: 折扣率转换（原有功能）===== */}
      {mode === 'convert' && (
        <>
          <div className="upload-section">
            <div className="section-title">第一步：选择文件</div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '16px' }}>
              {/* 报价表上传 */}
              <div>
                <div className={`upload-zone ${quoteDragOver ? 'active' : ''}`} onDrop={onQuoteDrop} onDragOver={onQuoteDragOver} onDragLeave={onQuoteDragLeave} onClick={() => document.getElementById('quote-file-input')?.click()}>
                  <div className="upload-icon">📄</div>
                  <div className="upload-text">点击或拖拽选择旧报价表文件</div>
                  <div className="upload-hint">支持 .xlsx / .xls 格式</div>
                  <input id="quote-file-input" type="file" accept=".xlsx,.xls" onChange={onQuoteFileChange} style={{ display: 'none' }} />
                </div>
                {quoteFile && (
                  <div className="file-info">
                    <span>✅</span><span className="file-name">{quoteFile.name}</span>
                    <span style={{ color: '#888', fontSize: '12px' }}>({(quoteFile.size / 1024).toFixed(1)} KB)</span>
                  </div>
                )}
              </div>

              {/* 公开价表配置 */}
              <div>
                <div className="config-row" style={{ marginTop: 0, borderTop: 'none', paddingTop: 0 }}>
                  <div className="config-item">
                    <input type="checkbox" id="use-default-price" checked={useDefaultPublicPrice} onChange={(e) => setUseDefaultPublicPrice(e.target.checked)} />
                    <label htmlFor="use-default-price">使用内置 YDH 2026 公开价</label>
                  </div>
                </div>
                {!useDefaultPublicPrice && (
                  <>
                    <div className="upload-zone" onClick={() => document.getElementById('public-file-input')?.click()} style={{ marginTop: '10px' }}>
                      <div className="upload-icon">📊</div>
                      <div className="upload-text">点击上传自定义公开价表</div>
                      <div className="upload-hint">需包含"重量"和"公开价"两列</div>
                      <input id="public-file-input" type="file" accept=".xlsx,.xls" onChange={onPublicFileChange} style={{ display: 'none' }} />
                    </div>
                    {publicFile && (
                      <div className="file-info"><span>✅</span><span className="file-name">{publicFile.name}</span></div>
                    )}
                  </>
                )}
              </div>
            </div>

            <div className="action-bar" style={{ marginTop: '20px' }}>
              <div className="action-left">
                <button className="btn btn-primary" onClick={handleConvert} disabled={!quoteFile}>▶ 开始转换</button>
                {result && <button className="btn btn-success" onClick={handleExport}>⬇ 导出 Excel</button>}
              </div>
              {status && <span className={`status-text ${statusClassName(status)}`}>{status}</span>}
            </div>
          </div>

          {/* 结果区域 - 折扣模式 */}
          {result && (
            <>
              <div className="status-bar">
                <div className="status-left">
                  <span className="stat-item"><span className="stat-label">总记录:</span><span className="stat-value">{result.totalRecords}</span></span>
                  <span className="stat-item"><span className="stat-label">有折扣:</span><span className="stat-value">{result.discountCount}</span></span>
                  <span className="stat-item"><span className="stat-label">仅21kg+:</span><span className="stat-value">{result.heavyOnlyCount}</span></span>
                  <span className="stat-item"><span className="stat-label">验证通过:</span><span className="stat-value" style={{ color: result.verifyResults.length > 0 ? '#ef476f' : '#06d6a0' }}>{result.totalRecords - result.verifyResults.length}/{result.totalRecords}</span></span>
                </div>
              </div>

              <div className="tab-nav">
                {[{ key: 'quote' as const, label: '最终报价单', count: result.quoteData.length }, { key: 'detail' as const, label: '转换对比明细', count: result.detailData.length }, { key: 'heavy' as const, label: '21kg+ 换算', count: result.heavyData.length }].map(tab => (
                  <button key={tab.key} className={`tab-btn ${activeTab === tab.key ? 'active' : ''}`} onClick={() => setActiveTab(tab.key)}>
                    {tab.label}<span className="tab-badge">{tab.count}</span>
                  </button>
                ))}
              </div>

              {activeTab === 'quote' && renderTable(previewRows)}
              {activeTab === 'detail' && renderTable(result.detailData.slice(0, 30))}
              {activeTab === 'heavy' && renderTable(result.heavyData)}

              <div className="verify-box">
                <div className={`verify-title ${result.verifyResults.length > 0 ? 'verify-fail' : 'verify-ok'}`}>
                  {result.verifyResults.length > 0 ? '⚠️ 验证未通过的记录' : '✅ 所有记录验证通过'}
                  <span style={{ fontSize: '12px', fontWeight: 400, marginLeft: '8px' }}>(新价必须 ≥ 旧价)</span>
                </div>
                {result.verifyResults.length > 0 ? (
                  <div className="verify-list">{result.verifyResults.map((v, i) => <div key={i}>{v}</div>)}</div>
                ) : (
                  <div className="verify-list all-ok">所有重量段的新价格均 ≥ 旧价格，数据验证通过。</div>
                )}
              </div>

              <div className="verify-box" style={{ background: '#f8f9fc' }}>
                <div className="verify-title" style={{ color: '#333' }}>📖 公式说明</div>
                <div style={{ fontSize: '13px', color: '#555', lineHeight: '1.8' }}>
                  <p><b>0-20kg:</b> 新价 = 公开价 × 统一折扣 × {(FUEL_RATE + 1).toFixed(2)}(含燃油)</p>
                  <p><b>21kg+:</b> 新基础单价 = 原价 ÷ {(FUEL_RATE + 1).toFixed(2)}，加燃油后与原价完全一致</p>
                </div>
              </div>
            </>
          )}
        </>
      )}

      {/* 页脚 */}
      <footer style={{ textAlign: 'center', padding: '20px', color: '#aaa', fontSize: '12px' }}>
        YDH 报价工具箱 v2.0 · 数据不出浏览器 · 支持两种转换模式
      </footer>
    </div>
  );
}

export default App;
