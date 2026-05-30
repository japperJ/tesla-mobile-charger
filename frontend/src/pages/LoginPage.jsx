import React, { useState } from 'react';
import { appLogin, appMfaVerify, appSetup } from '../api/client';
import './LoginPage.css';

// step: 'login' | 'setup' | 'mfa'
export default function LoginPage({ onLogin, needsSetup }) {
  const [step, setStep] = useState(needsSetup ? 'setup' : 'login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [mfaToken, setMfaToken] = useState('');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleLogin(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await appLogin(username, password);
      if (res.mfaRequired) {
        setMfaToken(res.mfaToken);
        setStep('mfa');
      } else {
        onLogin();
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  async function handleMfa(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await appMfaVerify(mfaToken, code);
      onLogin();
    } catch (err) {
      setError(err.response?.data?.error || 'Incorrect code');
      setCode('');
    } finally {
      setLoading(false);
    }
  }

  async function handleSetup(e) {
    e.preventDefault();
    setError('');
    if (password !== password2) { setError('Passwords do not match'); return; }
    if (password.length < 6) { setError('Password must be at least 6 characters'); return; }
    setLoading(true);
    try {
      await appSetup(username.trim(), password);
      // Auto-login after setup
      const res = await appLogin(username.trim(), password);
      if (res.mfaRequired) {
        setMfaToken(res.mfaToken);
        setStep('mfa');
      } else {
        onLogin();
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Setup failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-icon">⚡</div>
        <div className="login-title">Tesla Charger</div>

        {step === 'setup' && (
          <>
            <div className="login-subtitle">Create your account</div>
            <form onSubmit={handleSetup} className="login-form">
              <input className="login-input" type="text" placeholder="Username" value={username}
                onChange={e => setUsername(e.target.value)} autoFocus autoComplete="username" />
              <input className="login-input" type="password" placeholder="Password (min 6 chars)" value={password}
                onChange={e => setPassword(e.target.value)} autoComplete="new-password" />
              <input className="login-input" type="password" placeholder="Confirm password" value={password2}
                onChange={e => setPassword2(e.target.value)} autoComplete="new-password" />
              {error && <div className="login-error">{error}</div>}
              <button type="submit" className="btn btn-green login-btn" disabled={loading || !username || !password}>
                {loading ? <div className="spinner" /> : 'Create Account'}
              </button>
            </form>
          </>
        )}

        {step === 'login' && (
          <>
            <div className="login-subtitle">Sign in to continue</div>
            <form onSubmit={handleLogin} className="login-form">
              <input className="login-input" type="text" placeholder="Username" value={username}
                onChange={e => setUsername(e.target.value)} autoFocus autoComplete="username" />
              <input className="login-input" type="password" placeholder="Password" value={password}
                onChange={e => setPassword(e.target.value)} autoComplete="current-password" />
              {error && <div className="login-error">{error}</div>}
              <button type="submit" className="btn btn-green login-btn" disabled={loading || !username || !password}>
                {loading ? <div className="spinner" /> : 'Sign In'}
              </button>
            </form>
          </>
        )}

        {step === 'mfa' && (
          <>
            <div className="login-subtitle">Enter the 6-digit code from your authenticator app</div>
            <form onSubmit={handleMfa} className="login-form">
              <input className="login-input login-input-otp" type="text" inputMode="numeric"
                pattern="[0-9 ]*" maxLength={7} placeholder="000 000" value={code}
                onChange={e => setCode(e.target.value)} autoFocus autoComplete="one-time-code" />
              {error && <div className="login-error">{error}</div>}
              <button type="submit" className="btn btn-green login-btn" disabled={loading || code.replace(/\s/g, '').length < 6}>
                {loading ? <div className="spinner" /> : 'Verify'}
              </button>
              <button type="button" className="login-back" onClick={() => { setStep('login'); setError(''); setCode(''); }}>
                ← Back to login
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
