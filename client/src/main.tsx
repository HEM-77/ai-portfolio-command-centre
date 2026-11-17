import React from 'react';
import { createRoot } from 'react-dom/client';
import { BarChart3, MessageSquareText, FileText, RefreshCw, ArrowUpDown } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { api, ApiError, mockMode } from './api/client';
import type { AskResult, Citation, DataQualityReport, InitiativeMetrics, InitiativesResponse, PortfolioSummary, WeeklyBrief } from './types/api';
import './style.css';

const money = (n: number | null) => n === null ? 'Unavailable' : new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(n);
const percent = (n: number | null) => n === null ? 'Unavailable' : `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(n * 100)}%`;
const date = (s: string) => new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium' }).format(new Date(s));
const label = (s: string) => s.replaceAll('_', ' ');
type Page = 'overview' | 'assistant' | 'brief';

function ErrorNotice({ error, retry }: { error: Error; retry: () => void }) {
  return <div className="notice error" role="alert"><strong>{error instanceof ApiError && error.code === 'NOT_READY' ? 'Data is still loading' : 'Could not load data'}</strong><span>{error.message}</span><button onClick={retry}><RefreshCw size={15} /> Retry</button></div>;
}
function Metric({ title, value, detail }: { title: string; value: string; detail?: string }) {
  return <div className="metric"><span>{title}</span><strong>{value}</strong>{detail && <small>{detail}</small>}</div>;
}
function Citations({ items }: { items: Citation[] }) {
  if (!items.length) return null;
  return <section className="citations"><h3>Sources</h3><div className="citation-grid">{items.map(c => <article key={c.citationId} className="citation" id={`citation-${c.citationId}`}><strong>[{c.citationId}] {c.section}</strong><small>{c.sourceFile} · {c.initiativeId}</small><p>{c.excerpt}</p></article>)}</div></section>;
}
function AnswerText({ text }: { text: string }) {
  return <p className="answer-text">{text.split(/(\[C\d+\])/g).map((part, index) => /^\[C\d+\]$/.test(part) ? <a key={index} href={`#citation-${part.slice(1, -1)}`} className="cite-marker">{part}</a> : <React.Fragment key={index}>{part}</React.Fragment>)}</p>;
}
function Overview() {
  const [data, setData] = React.useState<{ summary: PortfolioSummary; initiatives: InitiativesResponse; quality: DataQualityReport }>();
  const [error, setError] = React.useState<Error>();
  const [loading, setLoading] = React.useState(true);
  const [sort, setSort] = React.useState<keyof InitiativeMetrics>('initiativeId');
  const [descending, setDescending] = React.useState(false);
  const load = React.useCallback(async () => { setLoading(true); setError(undefined); try { const [summary, initiatives, quality] = await Promise.all([api.summary(), api.initiatives(), api.quality()]); setData({ summary, initiatives, quality }); } catch (e) { setError(e as Error); } finally { setLoading(false); } }, []);
  React.useEffect(() => { void load(); }, [load]);
  if (loading) return <div className="state" role="status">Loading portfolio…</div>;
  if (error) return <ErrorNotice error={error} retry={() => void load()} />;
  if (!data) return null;
  const { summary, initiatives, quality } = data;
  const rows = [...initiatives.initiatives].sort((a, b) => { const x = a[sort], y = b[sort]; const order = x === null ? 1 : y === null ? -1 : typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y)); return descending ? -order : order; });
  const changeSort = (field: keyof InitiativeMetrics) => { setDescending(sort === field ? !descending : false); setSort(field); };
  const columns: { key: keyof InitiativeMetrics; name: string; format?: (n: number | null) => string }[] = [{ key: 'name', name: 'Initiative' }, { key: 'businessUnit', name: 'Business unit' }, { key: 'stage', name: 'Stage' }, { key: 'status', name: 'Status' }, { key: 'spendToDate', name: 'Spend', format: money }, { key: 'valueRealised', name: 'Value realised', format: money }, { key: 'roi', name: 'ROI', format: percent }, { key: 'adoptionRate', name: 'Adoption', format: percent }];
  return <><div className="page-head"><div><span className="eyebrow">Portfolio performance</span><h1>Overview</h1><p>As of {date(summary.asOf)} · {summary.initiativeCount} initiatives</p></div></div>{mockMode && <div className="notice demo">Contract example data. The documented examples include one initiative row, so charts and the table show only that row.</div>}
    <div className="metrics"><Metric title="Total spend" value={money(summary.totalSpend)} /><Metric title="Value realised" value={money(summary.totalValueRealised)} /><Metric title="Portfolio ROI" value={percent(summary.portfolioRoi)} /><Metric title="Average adoption" value={percent(summary.averageAdoptionRate)} /><Metric title="Negative ROI" value={String(summary.negativeRoiCount)} detail="initiatives" /></div>
    <div className="overview-grid"><section className="panel chart-panel"><div className="section-head"><h2>ROI by initiative</h2><span>Scorecard</span></div>{rows.length ? <div className="chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={rows} layout="vertical" margin={{ left: 12, right: 30 }}><XAxis type="number" tickFormatter={v => percent(v)} /><YAxis type="category" dataKey="name" width={155} tick={{ fontSize: 12 }} /><Tooltip formatter={(v) => percent(Number(v))} /><Bar dataKey="roi" radius={[0, 3, 3, 0]}>{rows.map(row => <Cell key={row.initiativeId} fill={row.roi !== null && row.roi < 0 ? '#c55346' : '#168273'} />)}</Bar></BarChart></ResponsiveContainer></div> : <p className="empty">No initiatives to chart.</p>}</section><section className="panel status-panel"><div className="section-head"><h2>Status breakdown</h2><span>Initiatives</span></div>{(['on_track', 'at_risk', 'off_track'] as const).map(status => <div className="status-row" key={status}><span className={`dot ${status}`} /> <span>{label(status)}</span><strong>{summary.countsByStatus[status]}</strong></div>)}</section></div>
    <section className="table-section"><div className="section-head"><h2>Initiatives</h2><span>{rows.length} shown</span></div>{rows.length ? <div className="table-scroll"><table><thead><tr>{columns.map(c => <th key={c.key}><button onClick={() => changeSort(c.key)} aria-label={`Sort by ${c.name}`}>{c.name}<ArrowUpDown size={13} /></button></th>)}</tr></thead><tbody>{rows.map(row => <tr key={row.initiativeId}>{columns.map(c => <td key={c.key}>{c.key === 'status' ? <span className={`status-pill ${row.status}`}>{label(row.status)}</span> : c.format ? c.format(row[c.key] as number | null) : String(row[c.key] ?? 'Unavailable')}</td>)}</tr>)}</tbody></table></div> : <p className="empty">No initiatives available.</p>}</section>
    <section className="quality"><div className="section-head"><h2>Data quality</h2><span>Updated {date(quality.generatedAt)}</span></div><div className="quality-counts"><span>{quality.rowsRead} rows read</span><span>{quality.rowsAccepted} accepted</span><span>{quality.rowsRejected} rejected</span></div>{quality.issues.length ? <ul>{quality.issues.map(issue => <li key={issue.issueId}><strong>{issue.severity}</strong> {issue.sourceFile}{issue.row !== null ? `, row ${issue.row}` : ''}: {issue.message}</li>)}</ul> : <p className="empty">No data-quality issues reported.</p>}</section></>;
}
function Assistant() {
  const [question, setQuestion] = React.useState(''); const [result, setResult] = React.useState<AskResult>(); const [error, setError] = React.useState<Error>(); const [loading, setLoading] = React.useState(false);
  const ask = async (q = question) => { const value = q.trim(); if (value.length < 3 || value.length > 1000) { setError(new Error('Question must be between 3 and 1000 characters.')); return; } setQuestion(value); setLoading(true); setError(undefined); setResult(undefined); try { setResult(await api.ask(value)); } catch (e) { setError(e as Error); } finally { setLoading(false); } };
  const examples = ['Which initiatives have negative ROI, and why?', 'What does the charter say about adoption risks?', 'Which initiatives need attention this week?'];
  return <><div className="page-head"><div><span className="eyebrow">Portfolio intelligence</span><h1>Ask the portfolio</h1><p>Questions answered from the scorecard and cited charter evidence.</p></div></div>{mockMode && <div className="notice demo">Contract example mode. Ask a question containing “unverified” or “no evidence” to preview those response states.</div>}
    <section className="ask-panel"><form onSubmit={e => { e.preventDefault(); void ask(); }}><label htmlFor="question">Your question</label><textarea id="question" value={question} onChange={e => setQuestion(e.target.value)} placeholder="Ask about performance, risk or evidence…" maxLength={1000} /><div className="form-footer"><span>{question.length}/1000</span><button className="primary" disabled={loading || question.trim().length < 3} type="submit">{loading ? 'Working…' : 'Ask question'}</button></div></form><div className="examples"><span>Try a question</span>{examples.map(q => <button key={q} onClick={() => void ask(q)} disabled={loading}>{q}</button>)}</div></section>
    {loading && <div className="state" role="status">Finding scorecard figures and charter evidence…</div>}{error && <ErrorNotice error={error} retry={() => void ask()} />}
    {result && <section className="answer"><div className="section-head"><h2>Answer</h2><span>{label(result.questionType)} · {date(result.generatedAt)}</span></div>{result.validation.status === 'unverified' && <div className="notice warning"><strong>Answer could not be verified</strong><span>The fallback answer is shown. {result.validation.notes.join(' ')}</span></div>}{result.validation.status === 'insufficient_evidence' && <div className="notice warning"><strong>Not enough evidence to answer</strong><span>No supported answer is available for this question.</span></div>}<AnswerText text={result.answer} />{result.figures.length > 0 && <div className="figures"><h3>Figures from the scorecard</h3><div className="table-scroll"><table><thead><tr><th>Initiative</th><th>Metric</th><th>Value</th><th>Source</th></tr></thead><tbody>{result.figures.map((f, i) => <tr key={`${f.metric}-${i}`}><td>{f.initiativeId ?? 'Portfolio'}</td><td>{label(f.metric)}</td><td>{f.metric.toLowerCase().includes('roi') || f.metric.toLowerCase().includes('rate') ? percent(f.value) : f.value === null ? 'Unavailable' : money(f.value)}</td><td>{f.source}</td></tr>)}</tbody></table></div></div>}<Citations items={result.citations} /></section>}</>;
}
function Brief() {
  const [data, setData] = React.useState<WeeklyBrief>(); const [error, setError] = React.useState<Error>(); const [loading, setLoading] = React.useState(true);
  const load = React.useCallback(async () => { setLoading(true); setError(undefined); try { setData(await api.weekly()); } catch (e) { setError(e as Error); } finally { setLoading(false); } }, []);
  React.useEffect(() => { void load(); }, [load]);
  if (loading) return <div className="state" role="status">Loading weekly brief…</div>;
  if (error) return <ErrorNotice error={error} retry={() => void load()} />;
  if (!data) return null;
  return <><div className="page-head"><div><span className="eyebrow">Executive reporting</span><h1>Weekly brief</h1><p>Week ending {date(data.weekEnding)}</p></div></div>{mockMode && <div className="notice demo">Contract example data. The documented weekly brief includes one flag and an unavailable narrative.</div>}
    <div className="metrics brief-metrics"><Metric title="Portfolio ROI" value={percent(data.summary.portfolioRoi)} /><Metric title="Total spend" value={money(data.summary.totalSpend)} /><Metric title="Value realised" value={money(data.summary.totalValueRealised)} /><Metric title="Negative ROI" value={String(data.summary.negativeRoiCount)} detail="initiatives" /></div>
    <section className="brief-section"><div className="section-head"><h2>Attention flags</h2><span>{data.flags.length} reported</span></div>{data.flags.length ? (['high', 'medium', 'low'] as const).map(severity => { const flags = data.flags.filter(f => f.severity === severity); return flags.length ? <div key={severity} className="flag-group"><h3>{severity} severity</h3>{flags.map(f => <article key={f.flagId} className={`flag ${severity}`}><div><strong>{f.initiativeName}</strong><small>{f.initiativeId} · {label(f.rule)}</small></div><p>{f.message}</p></article>)}</div> : null; }) : <p className="empty">No attention flags this week.</p>}</section>
    <section className="brief-section narrative"><div className="section-head"><h2>Narrative</h2><span>{data.narrative.status}</span></div>{data.narrative.status === 'unavailable' || !data.narrative.text ? <div className="notice warning">Narrative is unavailable. The scorecard and attention flags above are still current.</div> : <><AnswerText text={data.narrative.text} />{data.narrative.status === 'unverified' && <div className="notice warning">Narrative could not be verified.</div>}<Citations items={data.narrative.citations} /></>}</section></>;
}
function App() {
  const [page, setPage] = React.useState<Page>('overview');
  const tabs: { id: Page; title: string; icon: React.ReactNode }[] = [{ id: 'overview', title: 'Overview', icon: <BarChart3 size={18} /> }, { id: 'assistant', title: 'Assistant', icon: <MessageSquareText size={18} /> }, { id: 'brief', title: 'Weekly brief', icon: <FileText size={18} /> }];
  return <div className="app"><aside className="sidebar"><div className="brand"><span className="brand-icon"><BarChart3 size={22} /></span><span>AI Portfolio<br/><strong>Command Centre</strong></span></div><nav aria-label="Main navigation">{tabs.map(tab => <button key={tab.id} className={page === tab.id ? 'active' : ''} onClick={() => setPage(tab.id)} aria-current={page === tab.id ? 'page' : undefined}>{tab.icon}{tab.title}</button>)}</nav><div className="sidebar-foot">{mockMode ? 'Contract example mode' : 'Live portfolio data'}</div></aside><main>{page === 'overview' ? <Overview /> : page === 'assistant' ? <Assistant /> : <Brief />}</main></div>;
}

createRoot(document.getElementById('root')!).render(<App />);
