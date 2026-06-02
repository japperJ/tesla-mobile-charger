function parseTimeToMinutes(timeStr) {
  if (typeof timeStr !== 'string') return Number.NaN;
  const [h, m] = timeStr.split(':');
  const hour = Number.parseInt(h, 10);
  const minute = Number.parseInt(m, 10);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return Number.NaN;
  return (hour * 60) + minute;
}

function isWithinSessionWindow(currentTime, startTime, endTime) {
  const current = parseTimeToMinutes(currentTime);
  const start = parseTimeToMinutes(startTime);
  const end = parseTimeToMinutes(endTime);
  if (!Number.isFinite(current) || !Number.isFinite(start) || !Number.isFinite(end)) return false;
  return current >= start && current < end;
}

function isPastSessionEnd(currentTime, endTime) {
  const current = parseTimeToMinutes(currentTime);
  const end = parseTimeToMinutes(endTime);
  if (!Number.isFinite(current) || !Number.isFinite(end)) return false;
  return current >= end;
}

function shouldStartSession(session, currentTime) {
  return session?.status === 'planned' &&
    isWithinSessionWindow(currentTime, session.planned_start, session.planned_end);
}

function shouldStopSession(session, currentTime) {
  return session?.status === 'charging' &&
    isPastSessionEnd(currentTime, session.planned_end);
}

module.exports = {
  parseTimeToMinutes,
  shouldStartSession,
  shouldStopSession,
};
