import React, { useState } from 'react';
import { appLogin } from '../api/client';
import './LoginPage.css';

export default function LoginPage({ onLogin }) {
  const [secret, setSecret] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await appLogin(secret);
      onLogin();
    } catch {
      setError('Incorrect password. Try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-icon">⚡</div>
        <div className="login-title">Tesla Charger</div>
        <div className="login-subtitle">Enter your app password</div>
        <form onSubmit={handleSubmit} className="login-form">
          <input
            type="password"
            className="login-input"
            placeholder="Password"
            value={secret}
            onChange={e => setSecret(e.target.value)}
            autoFocus
            autoComplete="current-password"
          />
          {error && <div className="login-error">{error}</div>}
          <button type="submit" className="btn btn-green login-btn" disabled={loading || !secret}>
            {loading ? <div className="spinner" /> : 'Unlock'}
          </button>
        </form>
      </div>
    </div>
  );
}
