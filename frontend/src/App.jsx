import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AppProvider } from './context/AppContext';
import { WebSocketProvider } from './context/WebSocketContext';
import BottomNav from './components/BottomNav';
import DashboardPage from './pages/DashboardPage';
import PricesPage from './pages/PricesPage';
import SchedulePage from './pages/SchedulePage';
import SettingsPage from './pages/SettingsPage';
import SetupPage from './pages/SetupPage';
import './styles/global.css';

export default function App() {
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
