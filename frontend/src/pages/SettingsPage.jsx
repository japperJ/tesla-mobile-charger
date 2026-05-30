import React, { useEffect, useState } from 'react';
import { getConfig, updateConfig, testNotification, getMfaSetup, enableMfa, disableMfa, changePassword, appLogout } from '../api/client';
import { useApp } from '../context/AppContext';
import './SettingsPage.css';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

function buildPerDaySchedule(departureTime = '07:00', targetSoc = '90', daysOfWeek = '0') {
  const bitmask = parseInt(daysOfWeek || 0, 10) || 0;
  const soc = parseInt(targetSoc || 90, 10) || 90;

  return DAY_KEYS.reduce((acc, dayKey, index) => {
    acc[dayKey] = {
      active: !!(bitmask & (1 << index)),
      departure: departureTime || '07:00',
      soc,
    };
    return acc;
  }, {});
}

function parsePerDaySchedule(rawValue, fallback) {
  if (!rawValue) return fallback;

  let parsed;
  try {
    parsed = typeof rawValue === 'string' ? JSON.parse(rawValue) : rawValue;
  } catch {
    return fallback;
  }

  if (!parsed || typeof parsed !== 'object') return fallback;

  return DAY_KEYS.reduce((acc, dayKey) => {
    const fallbackDay = fallback[dayKey];
    const currentDay = parsed[dayKey] || {};
    acc[dayKey] = {
      active: typeof currentDay.active === 'boolean' ? currentDay.active : fallbackDay.active,
      departure: typeof currentDay.departure === 'string' && currentDay.departure ? currentDay.departure : fallbackDay.departure,
      soc: parseInt(currentDay.soc ?? fallbackDay.soc, 10) || fallbackDay.soc,
    };
    return acc;
  }, {});
}

export default function SettingsPage() {
  const { addToast } = useApp();
  const [config, setConfig] = useState(null);
  const [perDay, setPerDay] = useState(buildPerDaySchedule());
  const [saving, setSaving] = useState(false);

  // Security state
  const [secSection, setSecSection] = useState(null); // null | 'mfa-setup' | 'mfa-disable' | 'password'
  const [mfaQr, setMfaQr] = useState(null);
  const [mfaCode, setMfaCode] = useState('');
  const [mfaEnabled, setMfaEnabled] = useState(false);
  const [pwCurrent, setPwCurrent] = useState('');
  const [pwNew, setPwNew] = useState('');
  const [pwNew2, setPwNew2] = useState('');
  const [secLoading, setSecLoading] = useState(false);

  useEffect(() => {
    getConfig()
      .then(cfg => {
        setConfig(cfg);
        setPerDay(parsePerDaySchedule(
          cfg.per_day_schedule,
          buildPerDaySchedule(cfg.departure_time, cfg.target_soc, cfg.days_of_week)
        ));
      })
      .catch(() => addToast('Failed to load config', 'error'));
  }, [addToast]);

  useEffect(() => {
    if (!config || config.schedule_mode === 'advanced') return;
    setPerDay(buildPerDaySchedule(config.departure_time, config.target_soc, config.days_of_week));
  }, [config?.departure_time, config?.target_soc, config?.days_of_week, config?.schedule_mode]);

  const isAdvanced = config?.schedule_mode === 'advanced';

  function handleChange(key, value) {
    setConfig(prev => ({ ...prev, [key]: value }));
  }

  function toggleDay(dayIndex) {
    const bitmask = parseInt(config.days_of_week || 0, 10);
    const toggled = bitmask ^ (1 << dayIndex);
    handleChange('days_of_week', String(toggled));
  }

  function isDayActive(dayIndex) {
    return !!(parseInt(config?.days_of_week || 0, 10) & (1 << dayIndex));
  }

  function handlePerDayChange(dayKey, field, value) {
    setPerDay(prev => ({
      ...prev,
      [dayKey]: {
        ...prev[dayKey],
        [field]: field === 'soc' ? parseInt(value, 10) : value,
      },
    }));
  }

  async function handleToggleMode() {
    const nextMode = isAdvanced ? 'standard' : 'advanced';
    const nextPerDay = buildPerDaySchedule(config.departure_time, config.target_soc, config.days_of_week);
    const previousScheduleMode = config.schedule_mode;
    const previousPerDay = perDay;
    const updates = {
      schedule_mode: nextMode,
      per_day_schedule: JSON.stringify(nextPerDay),
    };

    setConfig(prev => ({ ...prev, ...updates }));
    setPerDay(nextPerDay);

    try {
      await updateConfig(updates);
    } catch {
      setConfig(prev => ({
        ...prev,
        schedule_mode: previousScheduleMode,
        per_day_schedule: JSON.stringify(previousPerDay),
      }));
      setPerDay(previousPerDay);
      addToast('Failed to update charging mode', 'error');
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      const payload = {
        ...config,
        per_day_schedule: JSON.stringify(
          isAdvanced
            ? perDay
            : buildPerDaySchedule(config.departure_time, config.target_soc, config.days_of_week)
        ),
      };
      await updateConfig(payload);
      setConfig(payload);
      addToast('Settings saved', 'success');
    } catch {
      addToast('Failed to save settings', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleTestNotification() {
    try {
      await testNotification();
      addToast('Test notification sent!', 'success');
    } catch {
      addToast('Failed to send notification', 'error');
    }
  }

  async function startMfaSetup() {
    setSecLoading(true);
    try {
      const data = await getMfaSetup();
      setMfaQr(data);
      setMfaCode('');
      setSecSection('mfa-setup');
    } catch { addToast('Failed to start MFA setup', 'error'); }
    finally { setSecLoading(false); }
  }

  async function handleMfaEnable(e) {
    e.preventDefault();
    setSecLoading(true);
    try {
      await enableMfa(mfaCode.replace(/\s/g, ''));
      setMfaEnabled(true);
      setSecSection(null);
      setMfaCode('');
      addToast('Authenticator app enabled! ✅', 'success');
    } catch (err) {
      addToast(err.response?.data?.error || 'Incorrect code', 'error');
    } finally { setSecLoading(false); }
  }

  async function handleMfaDisable(e) {
    e.preventDefault();
    setSecLoading(true);
    try {
      await disableMfa(mfaCode.replace(/\s/g, ''));
      setMfaEnabled(false);
      setSecSection(null);
      setMfaCode('');
      addToast('Authenticator app disabled', 'success');
    } catch (err) {
      addToast(err.response?.data?.error || 'Incorrect code', 'error');
    } finally { setSecLoading(false); }
  }

  async function handleChangePassword(e) {
    e.preventDefault();
    if (pwNew !== pwNew2) { addToast('New passwords do not match', 'error'); return; }
    if (pwNew.length < 6) { addToast('New password must be at least 6 characters', 'error'); return; }
    setSecLoading(true);
    try {
      await changePassword(pwCurrent, pwNew);
      setSecSection(null);
      setPwCurrent(''); setPwNew(''); setPwNew2('');
      addToast('Password changed successfully', 'success');
    } catch (err) {
      addToast(err.response?.data?.error || 'Failed to change password', 'error');
    } finally { setSecLoading(false); }
  }

  async function handleLogout() {
    try { await appLogout(); } catch { /* ignore */ }
    window.location.reload();
  }

  if (!config) return <div className="page"><div className="spinner" style={{ margin: '40px auto' }} /></div>;

  return (
    <div className="page">
      <div className="page-title">Settings</div>

      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div className="section-title" style={{ marginBottom: 0 }}>Charging</div>
          <button className={`mode-toggle ${isAdvanced ? 'active' : ''}`} onClick={handleToggleMode}>
            {isAdvanced ? 'Advanced' : 'Standard'}
          </button>
        </div>

        {!isAdvanced ? (
          <>
            <div className="form-group">
              <label className="form-label">Departure Time</label>
              <input
                className="form-input"
                type="time"
                value={config.departure_time || '07:00'}
                onChange={e => handleChange('departure_time', e.target.value)}
              />
            </div>

            <div className="form-group">
              <label className="form-label">Active Days</label>
              <div className="day-selector">
                {DAYS.map((day, i) => (
                  <button
                    key={day}
                    className={`day-btn ${isDayActive(i) ? 'active' : ''}`}
                    onClick={() => toggleDay(i)}
                  >
                    {day}
                  </button>
                ))}
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Target SOC (%)</label>
              <div className="slider-row">
                <input
                  className="form-slider"
                  type="range"
                  min="50"
                  max="100"
                  step="5"
                  value={config.target_soc || 80}
                  onChange={e => handleChange('target_soc', e.target.value)}
                />
                <span className="slider-value">{config.target_soc}%</span>
              </div>
            </div>
          </>
        ) : (
          <div className="form-group" style={{ marginBottom: 16 }}>
            {DAY_KEYS.map((dayKey, index) => {
              const day = perDay[dayKey];
              return (
                <div key={dayKey} className={`adv-day-row ${day.active ? '' : 'inactive'}`}>
                  <div className="adv-day-header">
                    <div className="adv-day-name">{DAYS[index]}</div>
                    <button
                      className={`toggle-btn ${day.active ? 'active' : ''}`}
                      onClick={() => handlePerDayChange(dayKey, 'active', !day.active)}
                    >
                      {day.active ? 'On' : 'Off'}
                    </button>
                  </div>

                  <div className="adv-day-fields">
                    <div>
                      <div className="adv-field-label">Departure time</div>
                      <input
                        className="form-input"
                        type="time"
                        value={day.departure}
                        disabled={!day.active}
                        onChange={e => handlePerDayChange(dayKey, 'departure', e.target.value)}
                      />
                    </div>

                    <div>
                      <div className="adv-field-label">Target SOC (%)</div>
                      <div className="slider-row">
                        <input
                          className="form-slider"
                          type="range"
                          min="50"
                          max="100"
                          step="5"
                          value={day.soc}
                          disabled={!day.active}
                          onChange={e => handlePerDayChange(dayKey, 'soc', e.target.value)}
                        />
                        <span className="slider-value">{day.soc}%</span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="form-group">
          <label className="form-label">Charger Power (kW)</label>
          <div className="slider-row">
            <input
              className="form-slider"
              type="range"
              min="1.4"
              max="22"
              step="0.1"
              value={config.charger_kw || 11}
              onChange={e => handleChange('charger_kw', e.target.value)}
            />
            <span className="slider-value">{parseFloat(config.charger_kw || 11).toFixed(1)} kW</span>
          </div>
        </div>

        <div className="form-group" style={{ marginBottom: 0 }}>
          <label className="form-label">Battery Size (kWh)</label>
          <div className="slider-row">
            <input
              className="form-slider"
              type="range"
              min="40"
              max="120"
              step="1"
              value={config.battery_kwh || 75}
              onChange={e => handleChange('battery_kwh', e.target.value)}
            />
            <span className="slider-value">{config.battery_kwh || 75} kWh</span>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="section-title" style={{ marginBottom: 16 }}>Pre-heat</div>

        <div className="form-group">
          <label className="form-label">Enable pre-heat before departure</label>
          <div className="toggle-row">
            <button
              className={`toggle-btn ${config.preheat_enabled === '1' ? 'active' : ''}`}
              onClick={() => handleChange('preheat_enabled', config.preheat_enabled === '1' ? '0' : '1')}
            >
              {config.preheat_enabled === '1' ? 'On' : 'Off'}
            </button>
          </div>
        </div>

        {config.preheat_enabled === '1' && (
          <>
            <div className="form-group">
              <label className="form-label">Start pre-heat (minutes before departure)</label>
              <div className="slider-row">
                <input
                  className="form-slider"
                  type="range" min="5" max="45" step="5"
                  value={config.preheat_offset_min || 15}
                  onChange={e => handleChange('preheat_offset_min', e.target.value)}
                />
                <span className="slider-value">{config.preheat_offset_min || 15} min</span>
              </div>
            </div>

            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Target cabin temperature (°C)</label>
              <div className="slider-row">
                <input
                  className="form-slider"
                  type="range" min="15" max="26" step="1"
                  value={config.preheat_temp_c || 21}
                  onChange={e => handleChange('preheat_temp_c', e.target.value)}
                />
                <span className="slider-value">{config.preheat_temp_c || 21}°C</span>
              </div>
            </div>
          </>
        )}
      </div>

      <div className="card">
        <div className="section-title" style={{ marginBottom: 16 }}>Notifications</div>

        <div className="form-group">
          <label className="form-label">ntfy.sh Server</label>
          <input
            className="form-input"
            type="url"
            placeholder="https://ntfy.sh"
            value={config.ntfy_server || ''}
            onChange={e => handleChange('ntfy_server', e.target.value)}
          />
        </div>

        <div className="form-group" style={{ marginBottom: 12 }}>
          <label className="form-label">ntfy.sh Topic</label>
          <input
            className="form-input"
            type="text"
            placeholder="my-tesla-charger"
            value={config.ntfy_topic || ''}
            onChange={e => handleChange('ntfy_topic', e.target.value)}
          />
        </div>

        <button className="btn btn-outline btn-sm" onClick={handleTestNotification}>
          🔔 Send Test Notification
        </button>
      </div>

      <div className="card">
        <div className="section-title" style={{ marginBottom: 16 }}>🔐 Security</div>

        {/* MFA row */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 14, color: 'var(--text-primary)' }}>Authenticator App (TOTP)</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{mfaEnabled ? '✅ Enabled' : 'Not enabled'}</div>
          </div>
          {mfaEnabled
            ? <button className="btn btn-outline btn-sm" onClick={() => { setSecSection('mfa-disable'); setMfaCode(''); }}>Disable</button>
            : <button className="btn btn-outline btn-sm" onClick={startMfaSetup} disabled={secLoading}>Set up</button>}
        </div>

        {secSection === 'mfa-setup' && mfaQr && (
          <form onSubmit={handleMfaEnable} style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 8 }}>
              Scan this QR code with Google Authenticator, Authy, or any TOTP app, then enter the 6-digit code to confirm.
            </div>
            <img src={mfaQr.qr} alt="QR code" style={{ width: '100%', maxWidth: 200, display: 'block', margin: '0 auto 12px', borderRadius: 8 }} />
            <div style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', marginBottom: 12, wordBreak: 'break-all' }}>
              Manual key: <strong>{mfaQr.secret}</strong>
            </div>
            <input className="form-input" type="text" inputMode="numeric" pattern="[0-9 ]*"
              placeholder="000 000" maxLength={7} value={mfaCode}
              onChange={e => setMfaCode(e.target.value)} autoComplete="one-time-code" />
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button type="submit" className="btn btn-green btn-sm" disabled={secLoading || mfaCode.replace(/\s/g,'').length < 6}>
                {secLoading ? <div className="spinner" /> : 'Confirm'}
              </button>
              <button type="button" className="btn btn-outline btn-sm" onClick={() => setSecSection(null)}>Cancel</button>
            </div>
          </form>
        )}

        {secSection === 'mfa-disable' && (
          <form onSubmit={handleMfaDisable} style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 8 }}>Enter your current authenticator code to disable MFA.</div>
            <input className="form-input" type="text" inputMode="numeric" pattern="[0-9 ]*"
              placeholder="000 000" maxLength={7} value={mfaCode}
              onChange={e => setMfaCode(e.target.value)} autoComplete="one-time-code" />
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button type="submit" className="btn btn-sm" style={{ background: 'var(--accent)' }} disabled={secLoading || mfaCode.replace(/\s/g,'').length < 6}>
                {secLoading ? <div className="spinner" /> : 'Disable MFA'}
              </button>
              <button type="button" className="btn btn-outline btn-sm" onClick={() => setSecSection(null)}>Cancel</button>
            </div>
          </form>
        )}

        {/* Change password row */}
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12, marginTop: 4 }}>
          {secSection !== 'password'
            ? <button className="btn btn-outline btn-sm" onClick={() => { setSecSection('password'); setPwCurrent(''); setPwNew(''); setPwNew2(''); }}>
                Change Password
              </button>
            : (
              <form onSubmit={handleChangePassword}>
                <input className="form-input" type="password" placeholder="Current password" value={pwCurrent}
                  onChange={e => setPwCurrent(e.target.value)} style={{ marginBottom: 8 }} autoComplete="current-password" />
                <input className="form-input" type="password" placeholder="New password" value={pwNew}
                  onChange={e => setPwNew(e.target.value)} style={{ marginBottom: 8 }} autoComplete="new-password" />
                <input className="form-input" type="password" placeholder="Confirm new password" value={pwNew2}
                  onChange={e => setPwNew2(e.target.value)} style={{ marginBottom: 8 }} autoComplete="new-password" />
                <div style={{ display: 'flex', gap: 8 }}>
                  <button type="submit" className="btn btn-green btn-sm" disabled={secLoading || !pwCurrent || !pwNew}>
                    {secLoading ? <div className="spinner" /> : 'Update Password'}
                  </button>
                  <button type="button" className="btn btn-outline btn-sm" onClick={() => setSecSection(null)}>Cancel</button>
                </div>
              </form>
            )}
        </div>

        {/* Logout */}
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12, marginTop: 12 }}>
          <button className="btn btn-outline btn-sm" onClick={handleLogout}>Sign Out</button>
        </div>
      </div>

      <button className="btn btn-green" onClick={handleSave} disabled={saving}>
        {saving ? <><div className="spinner" style={{ borderTopColor: '#fff' }} />Saving…</> : 'Save Settings'}
      </button>
    </div>
  );
}
