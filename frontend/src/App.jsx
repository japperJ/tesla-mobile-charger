import React, { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AppProvider } from './context/AppContext';
import { WebSocketProvider } from './context/WebSocketContext';
import BottomNav from './components/BottomNav';
import DashboardPage from './pages/DashboardPage';
import PricesPage from './pages/PricesPage';
import SchedulePage from './pages/SchedulePage';
import SettingsPage from './pages/SettingsPage';
import SetupPage from './pages/SetupPage';
import LoginPage from './pages/LoginPage';
import api from './api/client';
import './styles/global.css';

export default function App() {
  const [appAuthed, setAppAuthed] = useState(null); // null=checking, true=ok, false=need login

  useEffect(() => {
    // Probe a lightweight endpoint to see if our session cookie is valid
    api.get('/auth/status')
      .then(() => setAppAuthed(true))
      .catch(err => {
        if (err.response?.status === 401) setAppAuthed(false);
        else setAppAuthed(true); // network error or dev mode — let through
      });

    // Global 401 interceptor — any subsequent 401 drops back to login
    const id = api.interceptors.response.use(
      r => r,
      err => {
        if (err.response?.status === 401 && err.response?.data?.code === 'APP_AUTH_REQUIRED') {
          setAppAuthed(false);
        }
        return Promise.reject(err);
      }
    );
    return () => api.interceptors.response.eject(id);
  }, []);

  if (appAuthed === null) {
    return (
      <div style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="spinner" />
      </div>
    );
  }

  if (appAuthed === false) {
    return <LoginPage onLogin={() => setAppAuthed(true)} />;
  }

  return (
    <BrowserRouter>
      <AppProvider>
        <WebSocketProvider>
          <div className="app">
            <Routes>
              <Route path="/setup" element={<SetupPage />} />
              <Route path="/dashboard" element={<DashboardPage />} />
              <Route path="/prices" element={<PricesPage />} />
              <Route path="/schedule" element={<SchedulePage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="*" element={<Navigate to="/dashboard" replace />} />
            </Routes>
            <BottomNav />
          </div>
        </WebSocketProvider>
      </AppProvider>
    </BrowserRouter>
  );
}
