import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import axios from 'axios';
import './SetupPage.css';

const BASE = import.meta.env.VITE_API_URL || '/api';

const TeslaLogo = () => (
  <svg viewBox="0 0 342 35" fill="none" xmlns="http://www.w3.org/2000/svg" className="tesla-logo">
    <path d="M0 .1a9.7 9.7 0 0 0 7 7h11l.5.1v27.6h6.8V7.3L26 7h11a9.8 9.8 0 0 0 7-7H0zm238.6 0h-6.8v34.8H263a9.7 9.7 0 0 0 7-7h-31.4V0zm-52.3 6.8c3.6-4 8.6-6.8 14.5-6.8 5.9 0 10.9 2.8 14.5 6.8 3.6 4 5.7 9.3 5.7 15.1 0 5.8-2.1 11.1-5.7 15-3.6 4-8.6 6.9-14.5 6.9-5.9 0-10.9-2.9-14.5-6.9-3.6-4-5.7-9.2-5.7-15 0-5.8 2.1-11.1 5.7-15.1zm14.5 28.5c3.2 0 5.9-1.4 7.8-3.6 2-2.3 3.1-5.4 3.1-9.8s-1.1-7.5-3.1-9.8c-1.9-2.2-4.6-3.6-7.8-3.6-3.2 0-5.9 1.4-7.8 3.6-2 2.3-3.1 5.4-3.1 9.8s1.1 7.5 3.1 9.8c1.9 2.2 4.6 3.6 7.8 3.6zM156 34.8h6.8V0H156v34.8zM90.5 6.3h22.7V.1H83.9a9.8 9.8 0 0 0-7 7v20.7a9.8 9.8 0 0 0 7 7h22.7V29h-23a2.1 2.1 0 0 1-2.1-2V21h24.2v-6.5H83.5V8.4c0-1.1.9-2 2-2zm243.7 0h22.7V.1h-29.3a9.8 9.8 0 0 0-7 7v20.7a9.8 9.8 0 0 0 7 7h22.7V29h-23a2.1 2.1 0 0 1-2.1-2V21h24.2v-6.5h-24.2V8.4c0-1.1.9-2 2-2z" fill="currentColor"/>
  </svg>
);

export default function SetupPage() {
  const [status, setStatus] = useState(null);
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [serverUrl, setServerUrl] = useState('https://ts.hostme.dk');
  const [region, setRegion] = useState('eu');
  const [saving, setSaving] = useState(false);
  const [registering, setRegistering] = useState(false);
  const { addToast } = useApp();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  async function loadStatus() {
    const { data: auth } = await axios.get(`${BASE}/auth/status`);
    const { data: partner } = await axios.get(`${BASE}/auth/partner-status`);
    return { ...auth, partnerRegistered: partner.registered };
  }

  useEffect(() => {
    const err = searchParams.get('error');
    if (err) addToast(decodeURIComponent(err), 'error');

    loadStatus().then(s => {
      if (s.configured && s.partnerRegistered) {
        navigate('/dashboard', { replace: true });
      } else {
        setStatus(s);
        setServerUrl(s.serverUrl || 'https://ts.hostme.dk');
        setRegion(s.region || 'eu');
      }
    }).catch(() => setStatus({}));
  }, []); // eslint-disable-line

  async function handleSaveCredentials(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await axios.post(`${BASE}/auth/credentials`, {
        clientId: clientId.trim(),
        clientSecret: clientSecret.trim(),
        serverUrl: serverUrl.trim(),
        region,
      });
      const s = await loadStatus();
      setStatus(s);
      addToast('Credentials saved!', 'success');
    } catch (err) {
      addToast(err.response?.data?.error || 'Failed to save credentials', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdateServerUrl() {
    await axios.post(`${BASE}/auth/credentials`, { clientId: '_keep_', clientSecret: '_keep_', serverUrl: serverUrl.trim() });
    const s = await loadStatus();
    setStatus(s);
    addToast('Server URL updated', 'success');
  }

  function handleConnectTesla() {
    window.location.href = `${BASE}/auth/start`;
  }

  async function handleRegister() {
    setRegistering(true);
    try {
      await axios.post(`${BASE}/auth/register`);
      addToast('✅ App registered with Tesla Fleet API!', 'success');
      setTimeout(() => navigate('/dashboard', { replace: true }), 1200);
    } catch (err) {
      const msg = err.response?.data?.error;
      const detail = typeof msg === 'object' ? JSON.stringify(msg) : (msg || err.message);
      addToast('Registration failed: ' + detail, 'error');
    } finally {
      setRegistering(false);
    }
  }

  async function handleLogout() {
    await axios.post(`${BASE}/auth/logout`).catch(() => {});
    const s = await loadStatus();
    setStatus(s);
  }

  if (!status) return <div className="setup-loading"><div className="spinner" /></div>;

  // Determine current step
  const step = !status.hasClientCreds ? 1 : !status.configured ? 2 : 3;

  return (
    <div className="setup-page">
      <div className="setup-logo">
        <TeslaLogo />
        <h1 className="setup-title">Charger Scheduler</h1>
        <div className="setup-steps-indicator">
          {[1,2,3].map(n => (
            <div key={n} className={`step-dot ${n < step ? 'done' : n === step ? 'active' : ''}`} />
          ))}
        </div>
      </div>

      {/* ── Step 1: Developer credentials ── */}
      {step === 1 && (
        <form className="setup-form" onSubmit={handleSaveCredentials}>
          <div className="card">
            <div className="setup-step-badge">Step 1 of 3</div>
            <div className="setup-step-title">Tesla Developer Credentials</div>
            <p className="setup-info">
              Register your app at{' '}
              <a href="https://developer.tesla.com" target="_blank" rel="noopener" className="setup-link">developer.tesla.com</a>{' '}
              then paste your credentials below.
            </p>
            <div className="setup-redirect-hint">
              Redirect URI to register:<br/>
              <code>{serverUrl}/api/auth/callback</code>
            </div>
          </div>
          <div className="card">
            <div className="form-group">
              <label className="form-label">Client ID</label>
              <input className="form-input" value={clientId} onChange={e => setClientId(e.target.value)}
                placeholder="your-tesla-client-id" required autoComplete="off" />
            </div>
            <div className="form-group">
              <label className="form-label">Client Secret</label>
              <input className="form-input" type="password" value={clientSecret}
                onChange={e => setClientSecret(e.target.value)}
                placeholder="your-tesla-client-secret" required autoComplete="off" />
            </div>
            <div className="form-group">
              <label className="form-label">Server URL</label>
              <input className="form-input" value={serverUrl} onChange={e => setServerUrl(e.target.value)}
                placeholder="https://ts.hostme.dk" />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Region</label>
              <select className="form-input" value={region} onChange={e => setRegion(e.target.value)}>
                <option value="eu">Europe (EU)</option>
                <option value="na">North America (NA)</option>
              </select>
            </div>
          </div>
          <button className="btn btn-primary" type="submit" disabled={saving || !clientId || !clientSecret}>
            {saving ? <><div className="spinner" style={{borderTopColor:'#fff'}}/> Saving…</> : 'Save & Continue →'}
          </button>
        </form>
      )}

      {/* ── Step 2: Tesla login ── */}
      {step === 2 && (
        <div className="setup-form">
          <div className="card">
            <div className="setup-step-badge">Step 2 of 3</div>
            <div className="setup-step-title">Log in with Tesla</div>
            <p className="setup-info">
              Click below to log in. Tesla will redirect back to:<br/>
              <code className="setup-redirect-code">{status.redirectUri}</code>
            </p>
            {status.redirectUri !== `${serverUrl}/api/auth/callback` && (
              <div style={{display:'flex', gap:'0.5rem', marginTop:'0.75rem'}}>
                <input className="form-input" value={serverUrl} onChange={e => setServerUrl(e.target.value)}
                  placeholder="https://ts.hostme.dk" style={{flex:1}} />
                <button className="btn btn-outline" style={{whiteSpace:'nowrap'}} onClick={handleUpdateServerUrl}>
                  Update URL
                </button>
              </div>
            )}
          </div>
          <button className="btn btn-primary" onClick={handleConnectTesla}>
            🔐 Log in with Tesla
          </button>
          <button className="btn btn-outline" onClick={handleLogout}>← Change credentials</button>
        </div>
      )}

      {/* ── Step 3: Partner registration ── */}
      {step === 3 && (
        <div className="setup-form">
          <div className="card">
            <div className="setup-step-badge">Step 3 of 3</div>
            <div className="setup-step-title">Register App with Tesla</div>
            <p className="setup-info">
              One-time registration so Tesla authorises this app to use the Fleet API.
              Tesla will verify the public key at:
            </p>
            <code className="setup-redirect-code">{status.serverUrl}/.well-known/appspecific/com.tesla.3p.public-key.pem</code>
            <p className="setup-info" style={{marginTop:'0.75rem', color:'var(--text-muted)', fontSize:'0.8rem'}}>
              ⚠️ Your server must be publicly accessible at <strong>{status.serverUrl}</strong> for this to work.
            </p>
          </div>
          <button className="btn btn-primary" onClick={handleRegister} disabled={registering}>
            {registering
              ? <><div className="spinner" style={{borderTopColor:'#fff'}}/> Registering…</>
              : '🚀 Register with Tesla Fleet API'}
          </button>
          <button className="btn btn-outline" onClick={handleLogout}>← Re-authenticate Tesla</button>
        </div>
      )}

      <p className="setup-note">Tokens are encrypted and stored on your server.</p>
    </div>
  );
}
