import React, { useState } from 'react';
import { useWebSocket } from '../context/WebSocketContext';
import { useApp } from '../context/AppContext';
import { recalculateSchedule, getPrices } from '../api/client';
import SessionPriceSheet, { SessionItem } from '../components/SessionPriceSheet';
import './SchedulePage.css';

function formatDay(dateStr) {
  const date = new Date(`${dateStr}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return dateStr;
  return date.toLocaleDateString('en-DK', { weekday: 'long', day: 'numeric', month: 'long' });
}

export default function SchedulePage() {
  const { schedule, departureInfo } = useWebSocket();
  const { addToast } = useApp();
  const [loading, setLoading] = useState(false);
  const [selectedSession, setSelectedSession] = useState(null);
  const [sheetPrices, setSheetPrices] = useState([]);
  const [sheetLoading, setSheetLoading] = useState(false);

  async function openSheet(session) {
    setSelectedSession(session);
    setSheetLoading(true);
    setSheetPrices([]);
    try {
      const data = await getPrices();
      const todayStr = new Date().toISOString().slice(0, 10);
      const dayKey = session.date === todayStr ? 'today' : 'tomorrow';
      setSheetPrices(data[dayKey] || []);
    } catch {
      addToast('Failed to load prices', 'error');
    } finally {
      setSheetLoading(false);
    }
  }

  function closeSheet() {
    setSelectedSession(null);
    setSheetPrices([]);
  }

  async function handleRecalculate() {
    setLoading(true);
    try {
      await recalculateSchedule();
      addToast('Schedule recalculated', 'success');
    } catch {
      addToast('Recalculation failed', 'error');
    } finally {
      setLoading(false);
    }
  }

  const today = new Date().toLocaleDateString('en-DK', { weekday: 'long', day: 'numeric', month: 'long' });

  // Group sessions by date for display
  const grouped = schedule.reduce((acc, s) => {
    if (!acc[s.date]) acc[s.date] = [];
    acc[s.date].push(s);
    return acc;
  }, {});

  return (
    <div className="page">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div className="page-title" style={{ paddingBottom: 0 }}>Schedule</div>
        <button className="btn btn-outline btn-sm" onClick={handleRecalculate} disabled={loading}>
          {loading ? <div className="spinner" style={{ width: 14, height: 14 }} /> : '↻'} Recalculate
        </button>
      </div>

      {departureInfo?.date && (
        <p className="departure-info">
          Next departure: {formatDay(departureInfo.date)} — {departureInfo.time}
        </p>
      )}

      <p className="schedule-date">{today}</p>

      {schedule.length === 0 ? (
        <div className="card schedule-empty">
          <span className="schedule-empty-icon">🔋</span>
          <p>No charging scheduled</p>
          <p className="schedule-empty-sub">
            Check your target SOC is higher than current charge level, prices are loaded, and the next departure day is an active day.
          </p>
        </div>
      ) : (
        Object.entries(grouped).map(([date, sessions]) => (
          <div key={date}>
            <p className="schedule-date" style={{ fontSize: 13, marginTop: 16, marginBottom: 8 }}>
              {new Date(date + 'T12:00:00Z').toLocaleDateString('en-DK', { weekday: 'long', day: 'numeric', month: 'long' })}
            </p>
            <div className="schedule-list">
              {sessions.map(session => (
                <SessionItem key={session.id} session={session} onSelect={openSheet} />
              ))}
            </div>
          </div>
        ))
      )}

      {/* Price detail sheet */}
      <SessionPriceSheet
        session={selectedSession}
        prices={sheetPrices}
        loading={sheetLoading}
        departureInfo={departureInfo}
        onClose={closeSheet}
      />

    </div>
  );
}
