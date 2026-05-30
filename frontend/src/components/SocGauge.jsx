import React from 'react';
import './SocGauge.css';

export default function SocGauge({ soc, charging, size = 160 }) {
  const cx = size / 2;
  const cy = size / 2;
  const radius = (size / 2) - 12;
  const stroke = 10;
  const circumference = 2 * Math.PI * radius;
  const progress = soc != null ? (soc / 100) * circumference : 0;
  const color = charging ? '#30d158' : soc > 20 ? '#0a84ff' : '#e82127';

  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        {charging && (
          <circle
            cx={cx} cy={cy} r={radius}
            fill="none"
            stroke="#30d158"
            strokeWidth={stroke + 6}
            strokeDasharray={`${progress} ${circumference}`}
            strokeLinecap="round"
            className="charging-glow-ring"
            style={{ opacity: 0.25 }}
          />
        )}
        <circle
          cx={cx} cy={cy} r={radius}
          fill="none"
          stroke="#2e2e2e"
          strokeWidth={stroke}
        />
        <circle
          cx={cx} cy={cy} r={radius}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeDasharray={`${progress} ${circumference}`}
          strokeLinecap="round"
          className={charging ? 'charging-ring' : ''}
          style={{ transition: 'stroke-dasharray 0.6s ease' }}
        />
      </svg>
      <div style={{
        position: 'absolute', inset: 0,
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        pointerEvents: 'none',
      }}>
        <span style={{ fontSize: size * 0.22, fontWeight: 700, lineHeight: 1 }}>
          {soc != null ? `${soc}%` : '–'}
        </span>
        {charging ? (
          <span className="charging-bolt" style={{ fontSize: size * 0.15, marginTop: 2 }}>⚡</span>
        ) : (
          <span style={{ fontSize: size * 0.09, color: 'var(--text-muted)', marginTop: 3, letterSpacing: '0.05em' }}>
            SOC
          </span>
        )}
      </div>
    </div>
  );
}
