import React, { useEffect, useState } from 'react';
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, Tooltip,
} from 'chart.js';
import { Bar } from 'react-chartjs-2';
import { getPrices, refreshPrices } from '../api/client';
import { useApp } from '../context/AppContext';
import './PricesPage.css';

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip);

export default function PricesPage() {
  const [prices, setPrices] = useState(null);
  const [tab, setTab] = useState('today');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const { addToast } = useApp();

  useEffect(() => {
    loadPrices();
  }, []);

  async function loadPrices() {
    try {
      const data = await getPrices();
      setPrices(data);
    } catch {
      addToast('Failed to load prices', 'error');
    } finally {
      setLoading(false);
    }
  }

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await refreshPrices();
      await loadPrices();
      addToast('Prices refreshed', 'success');
    } catch {
      addToast('Refresh failed', 'error');
    } finally {
      setRefreshing(false);
    }
  }

  const current = prices?.[tab] || [];
  const minPrice = current.length
    ? Math.min(...current.map(p => parseFloat(p.total_dkk.toFixed(2))))
    : -1;

  const chartData = {
    labels: current.map(p => `${String(p.hour).padStart(2, '0')}:00`),
    datasets: [{
      data: current.map(p => p.total_dkk.toFixed(3)),
      backgroundColor: current.map((p, i) => {
        if (parseFloat(p.total_dkk.toFixed(2)) === minPrice) return '#30d158';
        if (p.total_dkk > 2) return '#e82127';
        return '#444';
      }),
      borderRadius: 4,
    }],
  };

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false }, tooltip: {
      callbacks: {
        label: ctx => ` ${parseFloat(ctx.raw).toFixed(2)} DKK/kWh`,
      },
    }},
    scales: {
      x: { ticks: { color: '#888', font: { size: 10 } }, grid: { display: false } },
      y: { ticks: { color: '#888', font: { size: 10 } }, grid: { color: '#2e2e2e' } },
    },
  };

  return (
    <div className="page">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div className="page-title" style={{ paddingBottom: 0 }}>Prices</div>
        <button className="btn btn-outline btn-sm" onClick={handleRefresh} disabled={refreshing}>
          {refreshing ? <div className="spinner" style={{ width: 14, height: 14 }} /> : '↻'} Refresh
        </button>
      </div>

      {/* Tab switcher */}
      <div className="price-tabs">
        <button className={`price-tab ${tab === 'today' ? 'active' : ''}`} onClick={() => setTab('today')}>Today</button>
        <button className={`price-tab ${tab === 'tomorrow' ? 'active' : ''}`} onClick={() => setTab('tomorrow')}>Tomorrow</button>
      </div>

      {loading ? (
        <div className="price-loading"><div className="spinner" /></div>
      ) : (
        <>
          {/* Chart */}
          <div className="card">
            <div className="chart-wrapper">
              <Bar data={chartData} options={chartOptions} />
            </div>
          </div>

          {/* Price summary */}
          {current.length > 0 && (
            <div className="card price-summary">
              <div className="price-stat">
                <span className="price-stat-label">Cheapest</span>
                <span className="price-stat-value green">{minPrice.toFixed(2)} DKK</span>
                <span className="price-stat-hour">
                  {current
                    .filter(p => parseFloat(p.total_dkk.toFixed(2)) === minPrice)
                    .map(p => `${String(p.hour).padStart(2,'0')}:00`)
                    .join(', ')}
                </span>
              </div>
              <div className="price-stat-divider" />
              <div className="price-stat">
                <span className="price-stat-label">Most Expensive</span>
                <span className="price-stat-value red">{Math.max(...current.map(p => p.total_dkk)).toFixed(2)} DKK</span>
                <span className="price-stat-hour">at {String(current.reduce((b, p, i) => p.total_dkk > current[b].total_dkk ? i : b, 0)).padStart(2,'0')}:00</span>
              </div>
              <div className="price-stat-divider" />
              <div className="price-stat">
                <span className="price-stat-label">Average</span>
                <span className="price-stat-value">{(current.reduce((s, p) => s + p.total_dkk, 0) / current.length).toFixed(2)} DKK</span>
              </div>
            </div>
          )}

          {/* Hour table */}
          <div className="card">
            <div className="section-title" style={{ marginBottom: 12 }}>All Hours</div>
            <div className="price-table">
              {current.map(p => (
                <div key={p.hour} className={`price-row ${parseFloat(p.total_dkk.toFixed(2)) === minPrice ? 'cheapest' : ''}`}>
                  <span className="price-row-hour">{String(p.hour).padStart(2,'0')}:00</span>
                  <div className="price-row-bar">
                    <div className="price-row-fill" style={{ width: `${Math.min(100, (p.total_dkk / 3) * 100)}%` }} />
                  </div>
                  <span className="price-row-val">{p.total_dkk.toFixed(2)}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
