const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function dayIndex(dateStr) {
  const jsDay = new Date(dateStr + 'T12:00:00Z').getUTCDay();
  return (jsDay + 6) % 7;
}

function parseHour(value, fallbackHour = 7) {
  const hour = Number.parseInt(String(value || '').split(':')[0], 10);
  return Number.isFinite(hour) ? hour : fallbackHour;
}

function parseSoc(value, fallbackSoc = 90) {
  const soc = Number.parseInt(value, 10);
  return Number.isFinite(soc) ? soc : fallbackSoc;
}

function cloneSchedule(schedule) {
  return JSON.parse(JSON.stringify(schedule));
}

function buildDefaultPerDaySchedule({ departureTime = '07:00', targetSoc = '90', daysOfWeek = '0' } = {}) {
  const bitmask = Number.parseInt(daysOfWeek, 10) || 0;
  const soc = parseSoc(targetSoc);

  return DAY_KEYS.reduce((acc, dayKey, index) => {
    acc[dayKey] = {
      active: Boolean(bitmask & (1 << index)),
      departure: departureTime || '07:00',
      soc,
    };
    return acc;
  }, {});
}

function parsePerDaySchedule(rawValue, fallbackSchedule) {
  if (!rawValue) return cloneSchedule(fallbackSchedule);

  let parsed;
  try {
    parsed = typeof rawValue === 'string' ? JSON.parse(rawValue) : rawValue;
  } catch {
    return cloneSchedule(fallbackSchedule);
  }

  if (!parsed || typeof parsed !== 'object') return cloneSchedule(fallbackSchedule);

  const normalized = {};
  for (const dayKey of DAY_KEYS) {
    const fallback = fallbackSchedule[dayKey];
    const current = parsed[dayKey] || {};
    normalized[dayKey] = {
      active: typeof current.active === 'boolean' ? current.active : fallback.active,
      departure: typeof current.departure === 'string' && current.departure ? current.departure : fallback.departure,
      soc: parseSoc(current.soc, fallback.soc),
    };
  }

  return normalized;
}

function buildActiveBitmask(perDaySchedule) {
  return DAY_KEYS.reduce((mask, dayKey, index) => (
    perDaySchedule?.[dayKey]?.active ? mask | (1 << index) : mask
  ), 0);
}

function resolveDepartureSettings({ config, todayStr, nowHour }) {
  const tomorrowStr = addDays(todayStr, 1);
  const mode = config?.schedule_mode === 'advanced' ? 'advanced' : 'standard';
  const standardDepartureHour = parseHour(config?.departure_time);
  const standardTargetSoc = parseSoc(config?.target_soc);

  if (mode === 'standard') {
    const overnight = standardDepartureHour <= nowHour;
    const departureDate = overnight ? tomorrowStr : todayStr;
    const activeBitmask = Number.parseInt(config?.days_of_week, 10) || 0;

    return {
      mode,
      departureDate,
      departureHour: standardDepartureHour,
      targetSoc: standardTargetSoc,
      overnight,
      activeBitmask,
      isActiveDepartureDay: Boolean(activeBitmask & (1 << dayIndex(departureDate))),
    };
  }

  const fallbackSchedule = buildDefaultPerDaySchedule({
    departureTime: config?.departure_time,
    targetSoc: config?.target_soc,
    daysOfWeek: config?.days_of_week,
  });
  const perDaySchedule = parsePerDaySchedule(config?.per_day_schedule, fallbackSchedule);
  const activeBitmask = buildActiveBitmask(perDaySchedule);
  const todaySettings = perDaySchedule[DAY_KEYS[dayIndex(todayStr)]];
  const todayDepartureHour = parseHour(todaySettings.departure, standardDepartureHour);

  if (todaySettings.active && todayDepartureHour > nowHour) {
    return {
      mode,
      departureDate: todayStr,
      departureHour: todayDepartureHour,
      targetSoc: parseSoc(todaySettings.soc, standardTargetSoc),
      overnight: false,
      activeBitmask,
      isActiveDepartureDay: true,
    };
  }

  const tomorrowSettings = perDaySchedule[DAY_KEYS[dayIndex(tomorrowStr)]];
  return {
    mode,
    departureDate: tomorrowStr,
    departureHour: parseHour(tomorrowSettings.departure, standardDepartureHour),
    targetSoc: parseSoc(tomorrowSettings.soc, standardTargetSoc),
    overnight: true,
    activeBitmask,
    isActiveDepartureDay: Boolean(tomorrowSettings.active),
  };
}

function toDepartureInfo(date, hour) {
  if (!date || hour === undefined || hour === null || hour === '') return null;
  const parsedHour = Number.parseInt(hour, 10);
  if (!Number.isFinite(parsedHour)) return null;

  return {
    date,
    time: `${String(parsedHour).padStart(2, '0')}:00`,
  };
}

module.exports = {
  DAY_KEYS,
  addDays,
  dayIndex,
  buildDefaultPerDaySchedule,
  parsePerDaySchedule,
  buildActiveBitmask,
  resolveDepartureSettings,
  toDepartureInfo,
};
