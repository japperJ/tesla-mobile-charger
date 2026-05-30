import React, { useState } from 'react';
import { useWebSocket } from '../context/WebSocketContext';
import { useApp } from '../context/AppContext';
import { getPrices } from '../api/client';
import SessionPriceSheet, { SessionItem } from './SessionPriceSheet';

export default function ScheduleCard({ sessions, onRecalculate, loading }) {
  const { departureInfo } = useWebSocket();
  const { addToast } = useApp();
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

  return (
    <div className="card">
      <div className="section-header">
        <span className="section-title">Today's Schedule</span>
        <button className="btn btn-outline btn-sm" onClick={onRecalculate} disabled={loading}>
          {loading ? <div className="spinner" style={{ width: 14, height: 14 }} /> : '↻'}
        </button>
      </div>

      {sessions.length === 0 ? (
        <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>No windows scheduled</p>
      ) : (
        <div className="schedule-list">
          {sessions.map(s => (
            <SessionItem key={s.id} session={s} onSelect={openSheet} />
          ))}
        </div>
      )}

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
