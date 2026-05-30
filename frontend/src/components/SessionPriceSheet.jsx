import React from 'react';
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, Tooltip,
} from 'chart.js';
import { Bar } from 'react-chartjs-2';
import '../pages/SchedulePage.css';

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip);

const STATUS_BADGE = {
  planned: 'badge-yellow',
  charging: 'badge-green',
  done: 'badge-muted',
  failed: 'badge-red',
};

const CHART_OPTIONS = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { display: false }, tooltip: {
    callbacks: { label: ctx => ` ${parseFloat(ctx.raw).toFixed(2)} DKK/kWh` },
  }},
  scales: {
    x: { ticks: { color: '#888', font: { size: 10 } }, grid: { display: false } },
    y: { ticks: { color: '#888', font: { size: 10 } }, grid: { color: '#2e2e2e' } },
  },
};

function formatDay(dateStr) {
  const date = new Date(`${dateStr}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return dateStr;
  return date.toLocaleDateString('en-DK', { weekday: 'long', day: 'numeric', month: 'long' });
}

export function SessionItem({ session, onSelect }) {
  const now = new Date();
  const nowStr = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
  const isActive = nowStr >= session.planned_start && nowStr < session.planned_end;

  return (
    <div
      className={`card session-item${isActive ? ' session-active' : ''}`}
      onClick={() => onSelect(session)}
      style={{ cursor: 'pointer' }}
    >
      <div className="session-time">
        <span className="session-start">{session.planned_start}</span>
        <span className="session-arrow">→</span>
        <span className="session-end">{session.planned_end}</span>
      </div>
      <div className="session-meta">
        <span className={`badge ${STATUS_BADGE[session.status] || 'badge-muted'}`}>
          {session.status}
        </span>
        {session.start_soc !== null && (
          <span className="session-soc">Starting at {session.start_soc}%</span>
        )}
      </div>
      <span className="session-chevron">›</span>
    </div>
  );
}

export default function SessionPriceSheet({ session, prices, loading, departureInfo, onClose }) {
  if (!session) return null;

  const startHour = parseInt(session.planned_start.split(':')[0]);
  const endHour = parseInt(session.planned_end.split(':')[0]);
  const depHour = departureInfo?.date === session.date && departureInfo?.time
    ? parseInt(departureInfo.time.split(':')[0])
    : -1;

  const chartData = prices.length > 0 ? {
    labels: prices.map(p => `${String(p.hour).padStart(2, '0')}:00`),
    datasets: [{
      data: prices.map(p => p.total_dkk.toFixed(3)),
      backgroundColor: prices.map(p => {
        if (p.hour >= startHour && p.hour < endHour) return '#30d158';
        if (p.total_dkk > 2) return '#e82127';
        return '#444';
      }),
      borderRadius: 4,
    }],
  } : null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="schedule-sheet" onClick={e => e.stopPropagation()}>
        <div className="sheet-handle" />

        <div className="sheet-header">
          <div className="sheet-title">
            <span className="sheet-date">{formatDay(session.date)}</span>
            <span className="sheet-time-range">
              {session.planned_start} → {session.planned_end}
            </span>
          </div>
          <div className="sheet-header-right">
            <span className={`badge ${STATUS_BADGE[session.status] || 'badge-muted'}`}>
              {session.status}
            </span>
            <button className="sheet-close" onClick={onClose}>✕</button>
          </div>
        </div>

        {loading ? (
          <div className="price-loading"><div className="spinner" /></div>
        ) : prices.length > 0 ? (
          <>
            <div className="card">
              <div className="chart-wrapper">
                <Bar data={chartData} options={CHART_OPTIONS} />
              </div>
            </div>

            <div className="card">
              <div className="section-title" style={{ marginBottom: 12 }}>All Hours</div>
              <div className="price-table">
                {prices.map(p => {
                  const isCharging = p.hour >= startHour && p.hour < endHour;
                  const isDep = p.hour === depHour;
                  return (
                    <div
                      key={p.hour}
                      className={`price-row${isCharging ? ' charging-hour' : ''}${isDep ? ' departure-hour' : ''}`}
                    >
                      <span className="price-row-hour">{String(p.hour).padStart(2, '0')}:00</span>
                      <div className="price-row-bar">
                        <div className="price-row-fill" style={{ width: `${Math.min(100, (p.total_dkk / 3) * 100)}%` }} />
                      </div>
                      <span className="price-row-val">{p.total_dkk.toFixed(2)}</span>
                      {isDep && (
                        <span className="departure-label">🚗 {departureInfo.time}</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        ) : (
          <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '32px 0' }}>
            No price data available for this day
          </p>
        )}
      </div>
    </div>
  );
}
