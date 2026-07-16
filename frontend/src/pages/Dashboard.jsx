import { useCallback, useEffect, useMemo, useState } from "react";
import { NavLink, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { techniqueCatalog } from "../data/techniqueCatalog";
import { API_BASE_URL } from "../services/api";

const PAGES = [
  { id: "overview", code: "01", label: "Overview", description: "Health and next action" },
  { id: "performance", code: "02", label: "Performance", description: "Quality, pace and issues" },
  { id: "techniques", code: "03", label: "Techniques", description: "Compare skills" },
  { id: "activity", code: "04", label: "Activity", description: "Frequency and habits" },
  { id: "sessions", code: "05", label: "Sessions", description: "Explore every set" }
];

const isoDate = (date) => date.toISOString().slice(0, 10);
const defaultStartDate = () => {
  const date = new Date();
  date.setDate(date.getDate() - 89);
  return isoDate(date);
};
const formatLabel = (value) => value
  ? value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase())
  : "None yet";
const formatDateTime = (value) => value
  ? new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value))
  : "No activity";
const formatShortDate = (value) => value
  ? new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(`${value}T12:00:00`))
  : "";

function KpiCard({ label, value, detail, tone = "default" }) {
  return (
    <article className={`dashboard-kpi dashboard-kpi--${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

function LineChart({ data, valueKey = "average_accuracy", label = "Accuracy trend" }) {
  if (!data?.length) return <p className="dashboard-empty">No data matches these filters.</p>;
  const width = 1000;
  const height = 260;
  const padding = 34;
  const values = data.map((item) => Number(item[valueKey]) || 0);
  const max = Math.max(100, ...values);
  const points = data.map((item, index) => {
    const x = padding + (index / Math.max(data.length - 1, 1)) * (width - padding * 2);
    const y = height - padding - ((Number(item[valueKey]) || 0) / max) * (height - padding * 2);
    return { x, y, item };
  });
  const path = points.map((point, index) => `${index ? "L" : "M"}${point.x},${point.y}`).join(" ");
  const area = `${path} L${points.at(-1).x},${height - padding} L${points[0].x},${height - padding} Z`;

  return (
    <div className="dashboard-line-chart">
      <svg aria-label={label} role="img" viewBox={`0 0 ${width} ${height}`}>
        <defs>
          <linearGradient id="dashboard-area" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#6aa8ff" stopOpacity="0.34" />
            <stop offset="1" stopColor="#6aa8ff" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[25, 50, 75, 100].map((tick) => {
          const y = height - padding - (tick / max) * (height - padding * 2);
          return <line className="dashboard-chart-grid" key={tick} x1={padding} x2={width - padding} y1={y} y2={y} />;
        })}
        <path d={area} fill="url(#dashboard-area)" />
        <path className="dashboard-chart-line" d={path} />
        {points.map((point) => <circle className="dashboard-chart-point" cx={point.x} cy={point.y} key={`${point.item.date}-${point.x}`} r="5" />)}
      </svg>
      <div className="dashboard-chart-axis"><span>{formatShortDate(data[0].date)}</span><span>{formatShortDate(data.at(-1).date)}</span></div>
    </div>
  );
}

function BarList({ items, valueKey = "count", suffix = "", empty = "No data matches these filters." }) {
  const max = Math.max(...(items || []).map((item) => Number(item[valueKey]) || 0), 1);
  if (!items?.length) return <p className="dashboard-empty">{empty}</p>;
  return (
    <div className="dashboard-bar-list">
      {items.map((item) => (
        <div className="dashboard-bar-row" key={item.name || item.label}>
          <div><strong>{item.name || formatLabel(item.label)}</strong><span>{item[valueKey]}{suffix}</span></div>
          <i><span style={{ width: `${Math.max(3, ((Number(item[valueKey]) || 0) / max) * 100)}%` }} /></i>
        </div>
      ))}
    </div>
  );
}

function ActivityHeatmap({ daily = [], start, end }) {
  const counts = new Map(daily.map((item) => [item.date, item.sessions]));
  const startDate = new Date(`${start}T12:00:00`);
  const endDate = new Date(`${end}T12:00:00`);
  const cells = [];
  for (let cursor = new Date(startDate); cursor <= endDate && cells.length < 180; cursor.setDate(cursor.getDate() + 1)) {
    const key = isoDate(cursor);
    cells.push({ date: key, count: counts.get(key) || 0 });
  }
  return (
    <div className="dashboard-heatmap" role="img" aria-label="Training activity by day">
      {cells.map((cell) => (
        <span className={`level-${Math.min(cell.count, 4)}`} key={cell.date} title={`${formatShortDate(cell.date)} · ${cell.count} sessions`} />
      ))}
    </div>
  );
}

function Panel({ eyebrow, title, meta, className = "", children }) {
  return (
    <section className={`dashboard-card ${className}`}>
      <header><div><p>{eyebrow}</p><h2>{title}</h2></div>{meta ? <span>{meta}</span> : null}</header>
      {children}
    </section>
  );
}

function DashboardFilters({ searchParams, setSearchParams, data, collapsed, onToggle }) {
  const category = searchParams.get("category") || "";
  const subcategory = searchParams.get("subcategory") || "";
  const taxonomy = useMemo(() => Object.fromEntries(
    techniqueCatalog.map((item) => [item.category, Object.fromEntries(item.subcategories.map((sub) => [sub.name, sub.techniques.map((technique) => technique.name)]))])
  ), []);
  const subcategories = category ? Object.keys(taxonomy[category] || {}) : [];
  const techniques = subcategory ? taxonomy[category]?.[subcategory] || [] : [];
  const update = (key, value, clear = []) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value); else next.delete(key);
    clear.forEach((item) => next.delete(item));
    setSearchParams(next, { replace: true });
  };
  const applyPreset = (days) => {
    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - days + 1);
    const next = new URLSearchParams(searchParams);
    next.set("date_from", isoDate(start));
    next.set("date_to", isoDate(end));
    setSearchParams(next, { replace: true });
  };
  const activeCount = [...searchParams.keys()].length;

  return (
    <aside className={`dashboard-filters ${collapsed ? "is-collapsed" : ""}`} aria-label="Dashboard filters">
      <div className="dashboard-filters__heading">
        <div><p>Global filters</p><strong>{activeCount ? `${activeCount} active` : "All data"}</strong></div>
        <button aria-label={`${collapsed ? "Expand" : "Collapse"} filters`} onClick={onToggle} type="button">{collapsed ? "›" : "‹"}</button>
      </div>
      <div className="dashboard-filters__body">
        <div className="dashboard-filter-presets">
          {[7, 30, 90].map((days) => <button key={days} onClick={() => applyPreset(days)} type="button">{days}d</button>)}
        </div>
        <label><span>From</span><input type="date" value={searchParams.get("date_from") || defaultStartDate()} onChange={(event) => update("date_from", event.target.value)} /></label>
        <label><span>To</span><input type="date" value={searchParams.get("date_to") || isoDate(new Date())} onChange={(event) => update("date_to", event.target.value)} /></label>
        <label><span>Mode</span><select value={searchParams.get("mode") || "all"} onChange={(event) => update("mode", event.target.value)}><option value="all">All modes</option><option value="train">Train</option><option value="practice">Practice</option></select></label>
        <label><span>Main category</span><select value={category} onChange={(event) => update("category", event.target.value, ["subcategory", "technique_name"])}><option value="">All categories</option>{Object.keys(taxonomy).map((item) => <option key={item}>{item}</option>)}</select></label>
        <label><span>Subcategory</span><select disabled={!category} value={subcategory} onChange={(event) => update("subcategory", event.target.value, ["technique_name"])}><option value="">All subcategories</option>{subcategories.map((item) => <option key={item}>{item}</option>)}</select></label>
        <label><span>Technique</span><select disabled={!subcategory} value={searchParams.get("technique_name") || ""} onChange={(event) => update("technique_name", event.target.value)}><option value="">All techniques</option>{techniques.map((item) => <option key={item}>{item}</option>)}</select></label>
        <label><span>Difficulty</span><select value={searchParams.get("difficulty") || ""} onChange={(event) => update("difficulty", event.target.value)}><option value="">All levels</option><option>Beginner</option><option>Intermediate</option><option>Advanced</option></select></label>
        <label><span>Status</span><select value={searchParams.get("status") || "all"} onChange={(event) => update("status", event.target.value)}><option value="all">All statuses</option><option value="completed">Completed</option><option value="active">Active / incomplete</option><option value="cancelled">Cancelled</option></select></label>
        <label><span>Minimum accuracy</span><select value={searchParams.get("accuracy_min") || ""} onChange={(event) => update("accuracy_min", event.target.value)}><option value="">Any score</option>{[50, 60, 70, 80, 90].map((item) => <option key={item} value={item}>{item}%+</option>)}</select></label>
        <label><span>Focus area</span><select value={searchParams.get("focus") || ""} onChange={(event) => update("focus", event.target.value)}><option value="">All focus areas</option>{(data?.filter_options?.focus_areas || []).map((item) => <option key={item} value={item}>{formatLabel(item)}</option>)}</select></label>
        <button className="dashboard-filters__clear" onClick={() => setSearchParams({}, { replace: true })} type="button">Clear all filters</button>
      </div>
    </aside>
  );
}

function OverviewPage({ data }) {
  const overview = data.overview;
  return <>
    <div className="dashboard-kpi-grid">
      <KpiCard label="Sessions" value={overview.total_sessions} detail={`${overview.completed_sessions} completed`} tone="blue" />
      <KpiCard label="Average form" value={`${overview.average_accuracy}%`} detail={`Best ${overview.best_accuracy}%`} tone="green" />
      <KpiCard label="Practice reps" value={overview.total_reps} detail={`${overview.clean_rate}% clean`} />
      <KpiCard label="Consistency" value={`${overview.consistency}%`} detail="Repeatability" />
      <KpiCard label="Training time" value={`${overview.training_minutes}m`} detail={`${overview.active_days} active days`} />
      <KpiCard label="Top technique" value={overview.top_technique || "--"} detail="Highest average form" />
    </div>
    <Panel eyebrow="Form trajectory" title="Accuracy over time" meta={`${data.daily.length} active days`} className="dashboard-card--wide"><LineChart data={data.daily} /></Panel>
    <Panel eyebrow="Technique ranking" title="Strongest skills" meta="Average form"><BarList items={data.techniques.slice(0, 6)} valueKey="average_accuracy" suffix="%" /></Panel>
    <Panel eyebrow="Coach recommendation" title="What to do next" className="dashboard-recommendation"><p>{overview.recommendation}</p><span>Based on the active dashboard filters</span></Panel>
  </>;
}

function PerformancePage({ data }) {
  const dailyClean = data.daily.slice(-14).map((item) => ({ name: formatShortDate(item.date), value: item.reps ? Math.round(item.clean_reps / item.reps * 100) : 0 }));
  return <>
    <div className="dashboard-kpi-grid dashboard-kpi-grid--compact">
      <KpiCard label="Average form" value={`${data.overview.average_accuracy}%`} detail="Selected period" tone="blue" />
      <KpiCard label="Clean rate" value={`${data.overview.clean_rate}%`} detail="Practice repetitions" tone="green" />
      <KpiCard label="Consistency" value={`${data.overview.consistency}%`} detail="Stable execution" />
      <KpiCard label="Best score" value={`${data.overview.best_accuracy}%`} detail="Personal high" />
    </div>
    <Panel eyebrow="Performance curve" title="Form accuracy trend" className="dashboard-card--wide"><LineChart data={data.daily} /></Panel>
    <Panel eyebrow="Rep quality" title="Daily clean rate"><BarList items={dailyClean} valueKey="value" suffix="%" /></Panel>
    <Panel eyebrow="Movement issues" title="Most frequent corrections"><BarList items={data.issues.slice(0, 7)} /></Panel>
    <Panel eyebrow="Pace profile" title="How you move"><BarList items={data.pace} /></Panel>
    <Panel eyebrow="Body focus" title="Areas needing attention"><BarList items={data.focus_areas.slice(0, 7)} /></Panel>
  </>;
}

function TechniquesPage({ data }) {
  return <>
    <Panel eyebrow="Technique comparison" title="Average form ranking" meta={`${data.techniques.length} techniques`} className="dashboard-card--wide"><BarList items={data.techniques} valueKey="average_accuracy" suffix="%" /></Panel>
    <div className="dashboard-technique-grid">
      {data.techniques.length ? data.techniques.map((item) => <article key={item.name}>
        <div><span>{item.category}</span><small>{item.subcategory}</small></div>
        <h3>{item.name}</h3>
        <strong>{item.average_accuracy}%</strong>
        <dl><div><dt>Sessions</dt><dd>{item.sessions}</dd></div><div><dt>Reps</dt><dd>{item.reps}</dd></div><div><dt>Clean</dt><dd>{item.clean_rate}%</dd></div><div><dt>Consistency</dt><dd>{item.consistency}%</dd></div></dl>
      </article>) : <p className="dashboard-empty">No techniques match these filters.</p>}
    </div>
  </>;
}

function ActivityPage({ data }) {
  return <>
    <div className="dashboard-kpi-grid dashboard-kpi-grid--compact">
      <KpiCard label="Active days" value={data.overview.active_days} detail="Days with sessions" tone="green" />
      <KpiCard label="Training time" value={`${data.overview.training_minutes}m`} detail="Selected period" />
      <KpiCard label="Sessions" value={data.overview.total_sessions} detail="Train and Practice" tone="blue" />
      <KpiCard label="Repetitions" value={data.overview.total_reps} detail="Practice volume" />
    </div>
    <Panel eyebrow="Activity calendar" title="Training consistency" meta={`${data.range.date_from} — ${data.range.date_to}`} className="dashboard-card--full"><ActivityHeatmap daily={data.daily} start={data.range.date_from} end={data.range.date_to} /></Panel>
    <Panel eyebrow="Session frequency" title="Sessions by active day" className="dashboard-card--wide"><LineChart data={data.daily} valueKey="sessions" label="Sessions per day" /></Panel>
    <Panel eyebrow="Practice volume" title="Repetitions by day"><BarList items={data.daily.slice(-14).map((item) => ({ name: formatShortDate(item.date), value: item.reps }))} valueKey="value" /></Panel>
  </>;
}

function SessionsPage({ data }) {
  const [query, setQuery] = useState("");
  const sessions = data.sessions.filter((item) => item.technique_name?.toLowerCase().includes(query.toLowerCase()));
  return <Panel eyebrow="Session explorer" title="Training history" meta={`${sessions.length} results`} className="dashboard-card--full dashboard-session-card">
    <div className="dashboard-session-search"><input aria-label="Search sessions" onChange={(event) => setQuery(event.target.value)} placeholder="Search technique…" value={query} /></div>
    <div className="dashboard-table-wrap"><table><thead><tr><th>Date and time</th><th>Technique</th><th>Mode</th><th>Status</th><th>Form</th><th>Reps</th><th>Consistency</th></tr></thead><tbody>
      {sessions.map((item) => <tr key={item.id}><td>{formatDateTime(item.ended_at || item.started_at)}</td><td><strong>{item.technique_name}</strong><span>{item.category} · {item.subcategory}</span></td><td><b className={`dashboard-mode dashboard-mode--${item.mode}`}>{item.mode}</b></td><td>{formatLabel(item.status)}</td><td>{item.accuracy}%</td><td>{item.reps === null ? "--" : `${item.reps}/${item.target_reps}`}</td><td>{item.consistency === null ? "--" : `${item.consistency}%`}</td></tr>)}
    </tbody></table>{sessions.length === 0 ? <p className="dashboard-empty">No sessions match this search and filter combination.</p> : null}</div>
  </Panel>;
}

export default function Dashboard() {
  const { page = "overview" } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [data, setData] = useState(null);
  const [loadState, setLoadState] = useState("loading");
  const [message, setMessage] = useState("Loading your dashboard…");
  const [filtersCollapsed, setFiltersCollapsed] = useState(false);
  const activePage = PAGES.some((item) => item.id === page) ? page : "overview";

  useEffect(() => {
    if (page !== activePage) navigate(`/dashboard/${activePage}`, { replace: true });
  }, [activePage, navigate, page]);

  const loadDashboard = useCallback(async (signal) => {
    const token = localStorage.getItem("token");
    const query = new URLSearchParams(searchParams);
    setLoadState("loading");
    try {
      const response = await fetch(`${API_BASE_URL}/dashboard?${query}`, { headers: { Authorization: `Bearer ${token}` }, signal });
      if (!response.ok) throw new Error(response.status === 401 ? "Your session expired." : "Dashboard data is temporarily unavailable.");
      setData(await response.json());
      setLoadState("ready");
    } catch (error) {
      if (error.name === "AbortError") return;
      setMessage(error.message);
      setLoadState("error");
    }
  }, [searchParams]);

  useEffect(() => {
    const controller = new AbortController();
    loadDashboard(controller.signal);
    return () => controller.abort();
  }, [loadDashboard]);

  const pageContent = data ? {
    overview: <OverviewPage data={data} />,
    performance: <PerformancePage data={data} />,
    techniques: <TechniquesPage data={data} />,
    activity: <ActivityPage data={data} />,
    sessions: <SessionsPage data={data} />
  }[activePage] : null;

  return (
    <main className={`dashboard-page ${filtersCollapsed ? "dashboard-page--filters-collapsed" : ""}`}>
      <DashboardFilters collapsed={filtersCollapsed} data={data} onToggle={() => setFiltersCollapsed((value) => !value)} searchParams={searchParams} setSearchParams={setSearchParams} />
      <div className="dashboard-main">
        <nav className="dashboard-page-tiles" aria-label="Dashboard pages">
          {PAGES.map((item) => <NavLink className={({ isActive }) => `dashboard-page-tile ${isActive ? "is-active" : ""}`} key={item.id} to={`/dashboard/${item.id}?${searchParams}`}><span>{item.code}</span><strong>{item.label}</strong><small>{item.description}</small></NavLink>)}
        </nav>
        <header className="dashboard-titlebar">
          <div><p>Personal analytics</p><h1>{PAGES.find((item) => item.id === activePage)?.label}</h1><span>{data ? `${formatShortDate(data.range.date_from)} — ${formatShortDate(data.range.date_to)}` : "Preparing filtered view"}</span></div>
          <div><span>Last updated</span><strong>{formatDateTime(data?.generated_at)}</strong><button onClick={() => loadDashboard()} type="button">Refresh</button></div>
        </header>
        {loadState === "loading" ? <div className="dashboard-loading" role="status"><i /><strong>Building your filtered dashboard…</strong></div> : null}
        {loadState === "error" ? <div className="dashboard-error" role="alert"><strong>Dashboard needs attention</strong><p>{message}</p><button onClick={() => loadDashboard()} type="button">Try again</button></div> : null}
        {loadState === "ready" ? <div className="dashboard-content">{pageContent}</div> : null}
      </div>
    </main>
  );
}
