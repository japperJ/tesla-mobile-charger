import React, { useState, useEffect, useRef } from 'react';
import { useWebSocket } from '../context/WebSocketContext';
import { useApp } from '../context/AppContext';
import { startCharging, stopCharging, recalculateSchedule, setChargeLimit, setChargingAmps, climateStart, climateStop, setSentryMode, setSeatHeater, updateConfig, getConfig, wakeUp } from '../api/client';
import SocGauge from '../components/SocGauge';
import StatusBadge from '../components/StatusBadge';
import ScheduleCard from '../components/ScheduleCard';
import './DashboardPage.css';

// Optimistic value hook: shows committed value immediately, clears when Tesla confirms or after timeout
function usePendingValue(confirmedValue, timeoutMs = 15000) {
  const [optimistic, setOptimistic] = useState(null);
  const timerRef = useRef(null);

  useEffect(() => {
    if (optimistic !== null && confirmedValue === optimistic) {
      setOptimistic(null);
      clearTimeout(timerRef.current);
    }
  }, [confirmedValue, optimistic]);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  function commit(newValue) {
    setOptimistic(newValue);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setOptimistic(null), timeoutMs);
  }

  return {
    display: optimistic !== null ? optimistic : confirmedValue,
    pending: optimistic !== null,
    commit,
  };
}

function PendingDot() {
  return <span className="pending-dot" />;
}

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export default function DashboardPage() {
  const { vehicleStatus, schedule, connected, lastUpdateTs } = useWebSocket();
  const { addToast } = useApp();
  const [actionLoading, setActionLoading] = useState(null);
  const [confirmCharge, setConfirmCharge] = useState(false);
  const [seatLevels, setSeatLevels] = useState({});
  const [homeCoords, setHomeCoords] = useState({ lat: null, lng: null });
  const [extrasOpen, setExtrasOpen] = useState(false);
  const [wakePressed, setWakePressed] = useState(false);
  const [countdown, setCountdown] = useState(null);
  const [seatPending, setSeatPending] = useState({});
  const seatTimers = useRef({});
  // Slider sheets
  const [limitSheetOpen, setLimitSheetOpen] = useState(false);
  const [ampsSheetOpen, setAmpsSheetOpen] = useState(false);
  const [limitSheetDraft, setLimitSheetDraft] = useState(null);
  const [ampsSheetDraft, setAmpsSheetDraft] = useState(null);
  // Climate confirm: null | 'start' | 'stop'
  const [confirmClimate, setConfirmClimate] = useState(null);

  const ampsP = usePendingValue(vehicleStatus?.chargeCurrentRequest);
  const limitP = usePendingValue(vehicleStatus?.chargeLimit);
  const sentryP = usePendingValue(vehicleStatus?.sentryMode);
  const climateP = usePendingValue(vehicleStatus?.climateOn);

  useEffect(() => {
    if (!wakePressed || !lastUpdateTs) return;
    const tick = () => setCountdown(Math.max(0, 30 - Math.floor((Date.now() - lastUpdateTs) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [wakePressed, lastUpdateTs]);

  useEffect(() => {
    getConfig().then(cfg => {
      const lat = parseFloat(cfg.home_lat);
      const lng = parseFloat(cfg.home_lng);
      if (lat && lng) setHomeCoords({ lat, lng });
    }).catch(() => {});
  }, []);

  async function handleChargeAction(action) {
    setActionLoading(action);
    setConfirmCharge(false);
    try {
      if (action === 'start') { await startCharging(); addToast('Charging started', 'success'); }
      else { await stopCharging(); addToast('Charging stopped', 'success'); }
    } catch (err) {
      addToast(err.response?.data?.error || 'Command failed', 'error');
    } finally { setActionLoading(null); }
  }

  async function handleClimateAction(on) {
    setActionLoading(on ? 'climate_on' : 'climate_off');
    try {
      if (on) { await climateStart(); addToast('Climate started', 'success'); }
      else { await climateStop(); addToast('Climate stopped', 'success'); }
      climateP.commit(on);
    } catch (err) {
      addToast(err.response?.data?.error || 'Climate command failed', 'error');
    } finally {
      setActionLoading(null);
      setConfirmClimate(null);
    }
  }

  async function handleSetLimit(percent) {
    setActionLoading('limit');
    try {
      await setChargeLimit(percent);
      addToast(`Charge limit set to ${percent}%`, 'success');
      limitP.commit(percent);
    } catch (err) {
      addToast(err.response?.data?.error || 'Failed to set limit', 'error');
    } finally { setActionLoading(null); }
  }

  async function handleSetAmps(amps) {
    setActionLoading('amps');
    try {
      await setChargingAmps(amps);
      addToast(`Charging speed set to ${amps}A`, 'success');
      ampsP.commit(amps);
    } catch (err) {
      addToast(err.response?.data?.error || 'Failed to set amps', 'error');
    } finally { setActionLoading(null); }
  }

  async function handleSentryToggle(on) {
    setActionLoading('sentry');
    try {
      await setSentryMode(on);
      addToast(on ? 'Sentry mode enabled 🛡️' : 'Sentry mode disabled', 'success');
      sentryP.commit(on);
    } catch (err) {
      addToast(err.response?.data?.error || 'Failed to set sentry mode', 'error');
    } finally { setActionLoading(null); }
  }

  async function handleSeatHeater(heater, level) {
    setSeatLevels(prev => ({ ...prev, [heater]: level })); // optimistic
    setSeatPending(prev => ({ ...prev, [heater]: true }));
    clearTimeout(seatTimers.current[heater]);
    seatTimers.current[heater] = setTimeout(() =>
      setSeatPending(prev => ({ ...prev, [heater]: false })), 15000);
    setActionLoading(`seat_${heater}`);
    try {
      await setSeatHeater(heater, level);
    } catch (err) {
      setSeatLevels(prev => ({ ...prev, [heater]: undefined })); // revert
      setSeatPending(prev => ({ ...prev, [heater]: false }));
      addToast(err.response?.data?.error || 'Seat heater command failed', 'error');
    } finally { setActionLoading(null); }
  }

  async function handleRecalculate() {
    setActionLoading('recalc');
    try { await recalculateSchedule(); addToast('Schedule recalculated', 'success'); }
    catch { addToast('Recalculation failed', 'error'); }
    finally { setActionLoading(null); }
  }

  async function handleWakeUp() {
    setActionLoading('wake');
    setWakePressed(true);
    try {
      await wakeUp();
      addToast('Wake command sent — car is waking up', 'success');
    } catch (err) {
      addToast(err.response?.data?.error || 'Wake command failed', 'error');
    } finally { setActionLoading(null); }
  }

  async function handleSaveHomeLocation() {
    if (!vehicleStatus?.latitude || !vehicleStatus?.longitude) {
      addToast('Car location not available', 'error'); return;
    }
    try {
      await updateConfig({ home_lat: vehicleStatus.latitude, home_lng: vehicleStatus.longitude });
      setHomeCoords({ lat: vehicleStatus.latitude, lng: vehicleStatus.longitude });
      addToast('Home location saved ✅', 'success');
    } catch { addToast('Failed to save location', 'error'); }
  }

  const isCharging = vehicleStatus?.chargingState === 'Charging';
  const isPluggedIn = vehicleStatus?.pluggedIn;
  const isOnline = vehicleStatus?.state === 'online';
  const climateOn = climateP.display;
  const sentryOn = sentryP.display;
  const maxAmps = vehicleStatus?.chargeCurrentRequestMax ?? 32;
  const currentAmps = ampsP.display;

  // At-home calculation
  let atHome = null;
  if (homeCoords.lat && homeCoords.lng && vehicleStatus?.latitude && vehicleStatus?.longitude) {
    const dist = haversineKm(homeCoords.lat, homeCoords.lng, vehicleStatus.latitude, vehicleStatus.longitude);
    atHome = dist < 0.5;
  }

  const displayLimit = limitP.display;

  return (
    <div className="page">
      <div className="connection-status">
        <div className={`connection-dot ${connected ? 'online' : 'offline'}`} />
        <span>{connected ? 'Live' : 'Reconnecting…'}</span>
      </div>

      {/* Vehicle Status Card */}
      <div className="card dashboard-status-card">
        {vehicleStatus ? (
          <>
            <div className="gauge-row">
              <SocGauge soc={vehicleStatus.soc} charging={isCharging} size={160} />
            </div>

            <div className="vehicle-badges">
              <StatusBadge state={vehicleStatus.state} />
              {isPluggedIn && (
                <span className={`badge ${isCharging ? 'badge-green' : 'badge-yellow'}`}>
                  {isCharging ? '⚡ Charging' : '🔌 Plugged In'}
                </span>
              )}
              {!isPluggedIn && isOnline && <span className="badge badge-muted">Not plugged in</span>}
              {atHome !== null && (
                <span className={`badge ${atHome ? 'badge-green' : 'badge-muted'}`}>
                  {atHome ? '🏠 At home' : '📍 Away'}
                </span>
              )}
              {atHome === null && isOnline && vehicleStatus.latitude && (
                <button className="badge badge-muted set-home-btn" onClick={handleSaveHomeLocation} title="Set this as home location">
                  📍 Set as home
                </button>
              )}
            </div>

            {/* Temps row */}
            {isOnline && (vehicleStatus.insideTemp != null || vehicleStatus.outsideTemp != null) && (
              <div className="temp-row">
                {vehicleStatus.insideTemp != null && (
                  <div className="temp-item">
                    <span className="temp-label">Inside</span>
                    <span className="temp-value">{vehicleStatus.insideTemp.toFixed(1)}°C</span>
                  </div>
                )}
                {vehicleStatus.outsideTemp != null && (
                  <div className="temp-item">
                    <span className="temp-label">Outside</span>
                    <span className="temp-value">{vehicleStatus.outsideTemp.toFixed(1)}°C</span>
                  </div>
                )}
                {vehicleStatus.driverTempSetting != null && (
                  <div className="temp-item">
                    <span className="temp-label">Set to</span>
                    <span className="temp-value">{vehicleStatus.driverTempSetting.toFixed(0)}°C</span>
                  </div>
                )}
              </div>
            )}

            <div className="charge-stats">
              {vehicleStatus.chargeLimit != null && (
                <div className="stat-item">
                  <span className="stat-label">Limit</span>
                  <span className="stat-value">{vehicleStatus.chargeLimit}%</span>
                </div>
              )}
              {isCharging && vehicleStatus.minutesToFull > 0 && (
                <div className="stat-item">
                  <span className="stat-label">Full in</span>
                  <span className="stat-value">{formatMinutes(vehicleStatus.minutesToFull)}</span>
                </div>
              )}
              {vehicleStatus.chargerPower > 0 && (
                <div className="stat-item">
                  <span className="stat-label">Power</span>
                  <span className="stat-value">{vehicleStatus.chargerPower} kW</span>
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="status-placeholder">
            <div className="spinner" />
            <span>Loading vehicle status…</span>
          </div>
        )}
        {/* Wake Car button — shown when car is asleep/offline */}
        {vehicleStatus && !isOnline && (
          <div className="wake-wrap">
            <button className="btn btn-outline btn-sm wake-btn" onClick={handleWakeUp}
              disabled={actionLoading === 'wake'}>
              {actionLoading === 'wake' ? <><div className="spinner spinner-sm" /> Waking…</> : '☀️ Wake Car'}
            </button>
            {wakePressed && countdown !== null && (
              <span className="wake-countdown">
                {countdown > 0 ? `Next update in ${countdown}s` : 'Updating…'}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Charge Controls */}
      <div className="card">
        <div className="section-header">
          <span className="section-title">Charging</span>
        </div>
        <div className="control-buttons">
          <button className="btn btn-green" onClick={() => setConfirmCharge(true)}
            disabled={!!actionLoading || isCharging}>
            ⚡ Start Charging
          </button>
          {isCharging && (
            <button className="btn btn-outline" onClick={() => handleChargeAction('stop')}
              disabled={!!actionLoading}>
              {actionLoading === 'stop' ? <div className="spinner" /> : '⏹'} Stop Charging
            </button>
          )}
        </div>

        {/* Charge limit — tap to open sheet */}
        {isOnline && displayLimit != null && (
          <button className="setting-row" onClick={() => { setLimitSheetDraft(displayLimit); setLimitSheetOpen(true); }} disabled={!isOnline}>
            <span className="setting-row-label">Charge Limit</span>
            <span className="setting-row-value">{displayLimit}% {limitP.pending && <PendingDot />}</span>
            <span className="setting-row-chevron">›</span>
          </button>
        )}

        {/* Charging amps — tap to open sheet */}
        {isOnline && isPluggedIn && currentAmps != null && (
          <button className="setting-row" onClick={() => { setAmpsSheetDraft(currentAmps); setAmpsSheetOpen(true); }} disabled={!isOnline}>
            <span className="setting-row-label">Charging Speed</span>
            <span className="setting-row-value">{currentAmps}A {ampsP.pending && <PendingDot />}</span>
            <span className="setting-row-chevron">›</span>
          </button>
        )}
      </div>

      {/* Climate Controls */}
      <div className="card">
        <div className="section-header">
          <span className="section-title">Climate</span>
          {climateOn && <span className="badge badge-green">On {climateP.pending && <PendingDot />}</span>}
          {!climateOn && climateP.pending && <PendingDot />}
        </div>
        <div className="control-buttons">
          {!climateOn && (
            <button className="btn btn-outline" onClick={() => setConfirmClimate('start')}
              disabled={!!actionLoading || !isOnline}>
              🌡️ Start Climate
            </button>
          )}
          {climateOn && (
            <button className="btn btn-outline" onClick={() => setConfirmClimate('stop')}
              disabled={!!actionLoading || !isOnline}>
              ❄️ Stop Climate
            </button>
          )}
        </div>
      </div>

      {/* Extras — Seat Heaters + Sentry (collapsible) */}
      {vehicleStatus && (
        <div className="card">
          <button className="extras-toggle" onClick={() => setExtrasOpen(o => !o)}>
            <span className="section-title">Extras</span>
            <span className="extras-badges">
              {sentryOn && <span className="badge badge-green" style={{ fontSize: 11 }}>🛡️ Sentry</span>}
              {sentryP.pending && <PendingDot />}
            </span>
            <span className="extras-chevron">{extrasOpen ? '▲' : '▼'}</span>
          </button>

          <div className={`extras-body ${extrasOpen ? 'open' : ''}`}>
            {/* Seat Heaters */}
            <div className="seat-heater-section" style={{ marginTop: 0, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
              <div className="form-label" style={{ marginBottom: 8 }}>Seat Heaters</div>
              <div className="seat-heater-grid">
                <SeatHeaterBtn label="Driver" heater={0} level={seatLevels[0] ?? vehicleStatus?.seatHeatersLeft} loading={actionLoading === 'seat_0'} onSet={handleSeatHeater} disabled={!isOnline} pending={!!seatPending[0]} />
                <SeatHeaterBtn label="Passenger" heater={1} level={seatLevels[1] ?? vehicleStatus?.seatHeatersRight} loading={actionLoading === 'seat_1'} onSet={handleSeatHeater} disabled={!isOnline} pending={!!seatPending[1]} />
              </div>
            </div>

            {/* Sentry */}
            <div className="seat-heater-section">
              <div className="form-label" style={{ marginBottom: 8 }}>Sentry Mode</div>
              <div className="control-buttons">
                <button className="btn btn-outline" onClick={() => handleSentryToggle(true)}
                  disabled={!!actionLoading || sentryOn === true || !isOnline}>
                  {actionLoading === 'sentry' && !sentryOn ? <div className="spinner" /> : '🛡️'} Enable Sentry
                </button>
                <button className="btn btn-outline" onClick={() => handleSentryToggle(false)}
                  disabled={!!actionLoading || sentryOn === false || sentryOn === null || !isOnline}>
                  {actionLoading === 'sentry' && sentryOn ? <div className="spinner" /> : '🔓'} Disable Sentry
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Today's Schedule */}
      <ScheduleCard sessions={schedule} onRecalculate={handleRecalculate} loading={actionLoading === 'recalc'} />

      {/* Start Charging confirmation modal */}
      {confirmCharge && (
        <div className="modal-backdrop" onClick={() => setConfirmCharge(false)}>
          <div className="modal-sheet" onClick={e => e.stopPropagation()}>
            <div className="modal-icon">⚡</div>
            <div className="modal-title">Start Charging?</div>
            <div className="modal-desc">This will immediately start charging your Tesla.</div>
            <div className="modal-actions">
              <button className="btn btn-green" onClick={() => handleChargeAction('start')}
                disabled={!!actionLoading}>
                {actionLoading === 'start' ? <div className="spinner" /> : 'Yes, Start Charging'}
              </button>
              <button className="btn btn-outline" onClick={() => setConfirmCharge(false)}
                disabled={!!actionLoading}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Climate confirm sheet */}
      {confirmClimate && (
        <div className="modal-backdrop" onClick={() => setConfirmClimate(null)}>
          <div className="modal-sheet" onClick={e => e.stopPropagation()}>
            <div className="modal-icon">{confirmClimate === 'start' ? '🌡️' : '❄️'}</div>
            <div className="modal-title">{confirmClimate === 'start' ? 'Start Climate?' : 'Stop Climate?'}</div>
            <div className="modal-desc">
              {confirmClimate === 'start'
                ? 'This will pre-heat/cool your Tesla remotely.'
                : 'This will turn off climate control in your Tesla.'}
            </div>
            <div className="modal-actions">
              <button className="btn btn-green"
                disabled={!!actionLoading}
                onClick={() => handleClimateAction(confirmClimate === 'start')}>
                {actionLoading === 'climate_on' || actionLoading === 'climate_off'
                  ? <div className="spinner" />
                  : confirmClimate === 'start' ? 'Yes, Start Climate' : 'Yes, Stop Climate'}
              </button>
              <button className="btn btn-outline" onClick={() => setConfirmClimate(null)}
                disabled={!!actionLoading}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Charge limit sheet */}
      {limitSheetOpen && (
        <div className="modal-backdrop" onClick={() => setLimitSheetOpen(false)}>
          <div className="slider-sheet" onClick={e => e.stopPropagation()}>
            <div className="sheet-handle" />
            <div className="slider-sheet-title">Charge Limit</div>
            <div className="slider-sheet-value">{limitSheetDraft}%</div>
            <input
              type="range" min="50" max="100" step="5"
              value={limitSheetDraft ?? displayLimit}
              className="form-slider slider-sheet-input"
              onChange={e => setLimitSheetDraft(parseInt(e.target.value))}
            />
            <div className="slider-sheet-range">
              <span>50%</span><span>100%</span>
            </div>
            <div className="modal-actions" style={{ marginTop: 24 }}>
              <button className="btn btn-green"
                disabled={actionLoading === 'limit'}
                onClick={() => { handleSetLimit(limitSheetDraft); setLimitSheetOpen(false); }}>
                {actionLoading === 'limit' ? <div className="spinner" /> : `Set to ${limitSheetDraft}%`}
              </button>
              <button className="btn btn-outline" onClick={() => setLimitSheetOpen(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Charging speed sheet */}
      {ampsSheetOpen && (
        <div className="modal-backdrop" onClick={() => setAmpsSheetOpen(false)}>
          <div className="slider-sheet" onClick={e => e.stopPropagation()}>
            <div className="sheet-handle" />
            <div className="slider-sheet-title">Charging Speed</div>
            <div className="slider-sheet-value">{ampsSheetDraft}A</div>
            <input
              type="range" min="5" max={maxAmps} step="1"
              value={ampsSheetDraft ?? currentAmps}
              className="form-slider slider-sheet-input"
              onChange={e => setAmpsSheetDraft(parseInt(e.target.value))}
            />
            <div className="slider-sheet-range">
              <span>5A</span><span>{maxAmps}A</span>
            </div>
            <div className="modal-actions" style={{ marginTop: 24 }}>
              <button className="btn btn-green"
                disabled={actionLoading === 'amps'}
                onClick={() => { handleSetAmps(ampsSheetDraft); setAmpsSheetOpen(false); }}>
                {actionLoading === 'amps' ? <div className="spinner" /> : `Set to ${ampsSheetDraft}A`}
              </button>
              <button className="btn btn-outline" onClick={() => setAmpsSheetOpen(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function formatMinutes(mins) {
  if (mins < 60) return `${mins}min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}min` : `${h}h`;
}

const HEAT_LABELS = ['Off', 'Low', 'Med', 'High'];

function SeatHeaterBtn({ label, heater, level, loading, onSet, disabled, pending }) {
  const safeLevel = level ?? 0;
  const nextLevel = (safeLevel + 1) % 4;
  return (
    <button
      className={`seat-heater-btn ${safeLevel > 0 ? `heat-level-${safeLevel}` : ''}`}
      onClick={() => onSet(heater, nextLevel)}
      disabled={loading || disabled}
      title={`${label}: Level ${safeLevel} — tap to change`}
    >
      {loading ? <div className="spinner spinner-sm" /> : <span className="heat-icon">{HEAT_LABELS[safeLevel]}</span>}
      <span className="seat-label">{label}{pending && <PendingDot />}</span>
    </button>
  );
}

