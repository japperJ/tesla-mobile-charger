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
  const [needsSetup, setNeedsSetup] = useState(false);

  useEffect(() => {
    api.get('/auth/status')
      .then(res => {
        if (res.data?.code === 'SETUP_REQUIRED') {
          setNeedsSetup(true);
          setAppAuthed(false);
        } else {
          setAppAuthed(true);
        }
      })
      .catch(err => {
        const data = err.response?.data;
        if (data?.code === 'SETUP_REQUIRED') { setNeedsSetup(true); setAppAuthed(false); }
        else if (err.response?.status === 401) setAppAuthed(false);
        else setAppAuthed(true);
      });

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
    return <LoginPage onLogin={() => { setAppAuthed(true); setNeedsSetup(false); }} needsSetup={needsSetup} />;
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
