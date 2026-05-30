import React from 'react';

const STATE_MAP = {
  online: { cls: 'badge-green', label: '● Online' },
  asleep: { cls: 'badge-muted', label: '💤 Asleep' },
  offline: { cls: 'badge-red', label: '✗ Offline' },
  unknown: { cls: 'badge-muted', label: '? Unknown' },
};

export default function StatusBadge({ state }) {
  const s = STATE_MAP[state] || STATE_MAP.unknown;
  return <span className={`badge ${s.cls}`}>{s.label}</span>;
}
