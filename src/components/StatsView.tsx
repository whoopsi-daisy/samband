'use client';

import { memo } from 'react';
import { Statistics } from '@/types';

interface StatsViewProps {
  stats: Statistics;
  onTypeClick?: (type: string) => void;
  onLocationClick?: (location: string) => void;
}

const WEEKDAY_NAMES = ['Mån', 'Tis', 'Ons', 'Tor', 'Fre', 'Lör', 'Sön'];

function TopList({
  rows,
  onSelect,
}: {
  rows: { label: string; total: number }[];
  onSelect?: (label: string) => void;
}) {
  // Normalise against the largest row, not the grand total. Against the total,
  // the top entry of a long-tailed distribution fills ~10% of the track and
  // every bar reads as empty.
  const max = Math.max(...rows.map((r) => r.total), 1);
  return (
    <ul className="top-list">
      {rows.map((row, i) => {
        const pct = Math.round((row.total / max) * 100);
        return (
          <li key={row.label}>
            <button type="button" className="top-item" onClick={() => onSelect?.(row.label)}>
              <span className="top-rank">{i + 1}</span>
              <span className="top-name">{row.label}</span>
              <span className="top-track">
                <span className="top-bar" style={{ width: `${pct}%` }} />
              </span>
              <span className="top-count">{row.total.toLocaleString('sv-SE')}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function StatsView({ stats, onTypeClick, onLocationClick }: StatsViewProps) {
  const maxDaily = Math.max(...stats.daily.map((d) => d.count), 1);
  const maxWeekday = Math.max(...stats.weekdays, 1);
  const maxHourly = Math.max(...stats.hourly, 1);

  return (
    <section aria-label="Statistik">
      <div className="stats-grid">
        <div className="stat stat--primary">
          <span className="stat-value">{stats.total.toLocaleString('sv-SE')}</span>
          <span className="stat-label">Totalt antal händelser</span>
        </div>
        <div className="stat">
          <span className="stat-value">{stats.last24h}</span>
          <span className="stat-label">Senaste 24h</span>
        </div>
        <div className="stat">
          <span className="stat-value">{stats.last7d}</span>
          <span className="stat-label">Senaste 7 dagar</span>
        </div>
        <div className="stat">
          <span className="stat-value">{stats.last30d}</span>
          <span className="stat-label">Senaste 30 dagar</span>
        </div>
        <div className="stat">
          <span className="stat-value">~{stats.avgPerDay}</span>
          <span className="stat-label">Genomsnitt/dag</span>
        </div>
        <div className="stat">
          <span className="stat-value">{stats.uniqueLocations}</span>
          <span className="stat-label">Unika platser</span>
        </div>
        <div className="stat">
          <span className="stat-value">{stats.uniqueTypes}</span>
          <span className="stat-label">Händelsetyper</span>
        </div>
        <div className="stat">
          <span className="stat-value">{stats.gpsPercent}%</span>
          <span className="stat-label">Med GPS-position</span>
        </div>
        <div className="stat">
          <span className="stat-value">{stats.updatedPercent}%</span>
          <span className="stat-label">Uppdaterade</span>
        </div>
      </div>

      <div className="card">
        <h2 className="card-title">Senaste 7 dagarna</h2>
        <div className="chart">
          {stats.daily.map((day) => (
            <div key={day.date} className="chart-col" title={`${day.date}: ${day.count} händelser`}>
              <span className="chart-value">{day.count}</span>
              <span className="chart-track">
                <span className="chart-bar" style={{ height: `${(day.count / maxDaily) * 100}%` }} />
              </span>
              <span className="chart-label">{day.day.substring(0, 3)}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="card-grid">
        <div className="card">
          <h2 className="card-title">Per veckodag</h2>
          <div className="chart">
            {stats.weekdays.map((count, i) => (
              <div key={i} className="chart-col" title={`${WEEKDAY_NAMES[i]}: ${count} händelser`}>
                <span className="chart-track">
                  <span className="chart-bar" style={{ height: `${(count / maxWeekday) * 100}%` }} />
                </span>
                <span className="chart-label">{WEEKDAY_NAMES[i]}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <h2 className="card-title">Per timme</h2>
          <div className="chart chart--dense">
            {stats.hourly.map((count, hour) => (
              <div
                key={hour}
                className="chart-col"
                title={`${String(hour).padStart(2, '0')}:00 — ${count} händelser`}
              >
                <span className="chart-track">
                  <span className="chart-bar" style={{ height: `${(count / maxHourly) * 100}%` }} />
                </span>
              </div>
            ))}
          </div>
          <div className="chart-axis">
            <span>00</span>
            <span>06</span>
            <span>12</span>
            <span>18</span>
            <span>23</span>
          </div>
        </div>
      </div>

      <div className="card-grid">
        <div className="card">
          <h2 className="card-title">Vanligaste händelsetyper</h2>
          <TopList rows={stats.topTypes} onSelect={onTypeClick} />
        </div>
        <div className="card">
          <h2 className="card-title">Vanligaste platser</h2>
          <TopList rows={stats.topLocations} onSelect={onLocationClick} />
        </div>
      </div>
    </section>
  );
}

export default memo(StatsView);
