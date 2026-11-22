import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { XCircle } from 'lucide-react';
import type { AdminUser, ReportOverview } from '@aiui/shared';
import { formatPrice } from '@aiui/shared';
import { api, errorMessage } from '../../api';
import { EmptyState, ErrorBox, Spinner } from '../../components/ui';
import { PROJECT_TYPES, statNumber } from '../../lib/format';
import { ActivityLog } from './ActivityLog';
import { MEASURES, type Measure, RankedBars, StatTile, TrendChart } from './charts';

const PERIODS = [7, 30, 90] as const;
type Period = (typeof PERIODS)[number];
const LANGUAGE_LABEL: Record<string, string> = { python: 'Python', csharp: 'C#' };

export function ReportsTab() {
  const [days, setDays] = useState<Period>(30);
  const [measure, setMeasure] = useState<Measure>('activeUsers');
  const [data, setData] = useState<ReportOverview | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    setLoading(true);
    setError(null);
    try {
      const overview = await api.adminOverview(days);
      if (mine === seq.current) setData(overview);
    } catch (err) {
      if (mine === seq.current) setError(errorMessage(err));
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    // the person filter of the activity log; the log still works without it
    api
      .adminUsers()
      .then((list) => setUsers([...list].sort((a, b) => a.name.localeCompare(b.name))))
      .catch(() => setUsers([]));
  }, []);

  const t = data?.totals;

  return (
    <div className="reports">
      {/* one filter row scoping everything below it */}
      <div className="toolbar">
        <span className="muted small">Period</span>
        <div className="segmented" role="tablist" aria-label="Period">
          {PERIODS.map((p) => (
            <button key={p} type="button" role="tab" aria-selected={days === p} className={days === p ? 'active' : ''} onClick={() => setDays(p)}>
              Last {p} days
            </button>
          ))}
        </div>
      </div>

      {error && <ErrorBox message={error} onRetry={() => void load()} />}
      {!error && !data && <Spinner label="Loading the report…" />}

      {data && t && (
        <div className={`reports-body ${loading ? 'refreshing' : ''}`}>
          <div className="stat-grid">
            <StatTile label="People with an account" value={statNumber(t.users)} note={t.disabledUsers > 0 ? `${statNumber(t.disabledUsers)} deactivated` : 'All accounts active'} />
            <StatTile label="Active today" value={statNumber(t.activeToday)} />
            <StatTile label="Active in the last 7 days" value={statNumber(t.active7d)} />
            <StatTile label="Active in the last 30 days" value={statNumber(t.active30d)} />
            <StatTile label={`New accounts, last ${data.days} days`} value={statNumber(t.newUsersInPeriod)} />
            <StatTile label="Projects" value={statNumber(t.projects)} note={`${statNumber(t.connections)} saved connections`} />
            <StatTile
              label={`Runs, last ${data.days} days`}
              value={statNumber(t.runsInPeriod)}
              note={
                t.failedRunsInPeriod > 0 ? (
                  <span className="status-critical">
                    <XCircle size={12} /> {statNumber(t.failedRunsInPeriod)} failed
                  </span>
                ) : t.runsInPeriod > 0 ? (
                  'None failed'
                ) : undefined
              }
            />
            <StatTile label={`Code exports, last ${data.days} days`} value={statNumber(t.exportsInPeriod)} />
            <StatTile label="Plugin installs" value={statNumber(t.pluginInstalls)} note={`${statNumber(t.publishedPlugins)} published plugins`} />
            <StatTile label="Marketplace revenue" value={t.revenueCents === 0 ? '$0.00' : formatPrice(t.revenueCents)} note={`${statNumber(t.purchases)} purchase${t.purchases === 1 ? '' : 's'} (demo checkout)`} />
          </div>

          <div className="chart-switch">
            <span className="muted small">Show</span>
            <div className="segmented" role="tablist" aria-label="What the chart shows">
              {MEASURES.map((m) => (
                <button key={m.id} type="button" role="tab" aria-selected={measure === m.id} className={measure === m.id ? 'active' : ''} onClick={() => setMeasure(m.id)}>
                  {m.label}
                </button>
              ))}
            </div>
          </div>
          <TrendChart series={data.series} measure={measure} days={data.days} />

          <div className="chart-grid">
            <RankedBars
              title="Projects by type"
              subtitle="All projects on the platform"
              unit="projects"
              empty="No projects have been created yet."
              items={[...data.projectsByType]
                .sort((a, b) => b.count - a.count)
                .map((p) => ({ key: p.type, label: PROJECT_TYPES[p.type]?.label ?? p.type, value: p.count }))}
            />
            <RankedBars
              title="Exports by language"
              subtitle={`Generated projects downloaded, last ${data.days} days`}
              unit="exports"
              empty="Nobody has exported code in this period."
              items={[...data.exportsByLanguage]
                .sort((a, b) => b.count - a.count)
                .map((e) => ({ key: e.language, label: LANGUAGE_LABEL[e.language] ?? e.language, value: e.count }))}
            />
            <RankedBars
              title="Most installed plugins"
              subtitle="Installs across all accounts"
              unit="installs"
              empty="No plugins have been installed yet."
              items={data.topPlugins.slice(0, 8).map((p) => ({
                key: p.id,
                label: p.name,
                value: p.installs,
                to: `/marketplace/plugin/${encodeURIComponent(p.id)}`,
              }))}
            />
          </div>

          <section className="card">
            <header className="card-head">
              <h3>Most active people</h3>
              <span className="muted small">Last {data.days} days</span>
            </header>
            {data.topUsers.length === 0 ? (
              <EmptyState title="Nobody was active in this period">When people sign in and work on projects, the most active ones are listed here.</EmptyState>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Person</th>
                      <th className="num">Days active</th>
                      <th className="num">Runs</th>
                      <th className="num">Exports</th>
                      <th className="num">Projects</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.topUsers.map((u) => (
                      <tr key={u.id}>
                        <td>
                          <Link to={`/admin/users/${encodeURIComponent(u.id)}`}>
                            <strong>{u.name}</strong>
                          </Link>
                          <div className="muted small">{u.email}</div>
                        </td>
                        <td className="num">{u.activeDays.toLocaleString()}</td>
                        <td className="num">{u.runs.toLocaleString()}</td>
                        <td className="num">{u.exports.toLocaleString()}</td>
                        <td className="num">{u.projects.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}

      <ActivityLog users={users} />
    </div>
  );
}
