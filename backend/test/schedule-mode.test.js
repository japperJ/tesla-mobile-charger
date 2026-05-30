const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildDefaultPerDaySchedule,
  parsePerDaySchedule,
  resolveDepartureSettings,
  toDepartureInfo,
} = require('../src/charging/schedule-mode');

test('buildDefaultPerDaySchedule maps standard weekdays to active days', () => {
  const schedule = buildDefaultPerDaySchedule({ departureTime: '06:30', targetSoc: '85', daysOfWeek: '31' });

  assert.deepEqual(schedule.mon, { active: true, departure: '06:30', soc: 85 });
  assert.deepEqual(schedule.tue, { active: true, departure: '06:30', soc: 85 });
  assert.deepEqual(schedule.fri, { active: true, departure: '06:30', soc: 85 });
  assert.deepEqual(schedule.sat, { active: false, departure: '06:30', soc: 85 });
  assert.deepEqual(schedule.sun, { active: false, departure: '06:30', soc: 85 });
});

test('parsePerDaySchedule falls back when config is empty or invalid', () => {
  const fallback = buildDefaultPerDaySchedule({ departureTime: '07:00', targetSoc: '90', daysOfWeek: '31' });

  assert.deepEqual(parsePerDaySchedule('', fallback), fallback);
  assert.deepEqual(parsePerDaySchedule('{invalid', fallback), fallback);
});

test('resolveDepartureSettings keeps standard mode behavior for same-day departures', () => {
  const result = resolveDepartureSettings({
    config: {
      schedule_mode: 'standard',
      departure_time: '07:00',
      target_soc: '90',
      days_of_week: '31',
    },
    todayStr: '2025-06-02',
    nowHour: 5,
  });

  assert.equal(result.departureDate, '2025-06-02');
  assert.equal(result.departureHour, 7);
  assert.equal(result.targetSoc, 90);
  assert.equal(result.isActiveDepartureDay, true);
  assert.equal(result.overnight, false);
});

test('resolveDepartureSettings uses tomorrow advanced settings when todays departure has passed', () => {
  const result = resolveDepartureSettings({
    config: {
      schedule_mode: 'advanced',
      departure_time: '07:00',
      target_soc: '90',
      days_of_week: '0',
      per_day_schedule: JSON.stringify({
        mon: { active: true, departure: '06:00', soc: 80 },
        tue: { active: true, departure: '08:00', soc: 95 },
        wed: { active: false, departure: '07:00', soc: 90 },
        thu: { active: false, departure: '07:00', soc: 90 },
        fri: { active: false, departure: '07:00', soc: 90 },
        sat: { active: false, departure: '07:00', soc: 90 },
        sun: { active: false, departure: '07:00', soc: 90 },
      }),
    },
    todayStr: '2025-06-02',
    nowHour: 7,
  });

  assert.equal(result.departureDate, '2025-06-03');
  assert.equal(result.departureHour, 8);
  assert.equal(result.targetSoc, 95);
  assert.equal(result.isActiveDepartureDay, true);
  assert.equal(result.overnight, true);
  assert.equal(result.activeBitmask, 3);
});

test('resolveDepartureSettings reports inactive advanced departures when today and tomorrow are off', () => {
  const result = resolveDepartureSettings({
    config: {
      schedule_mode: 'advanced',
      departure_time: '07:00',
      target_soc: '90',
      days_of_week: '0',
      per_day_schedule: JSON.stringify({
        mon: { active: false, departure: '06:00', soc: 80 },
        tue: { active: false, departure: '08:00', soc: 95 },
        wed: { active: false, departure: '07:00', soc: 90 },
        thu: { active: false, departure: '07:00', soc: 90 },
        fri: { active: false, departure: '07:00', soc: 90 },
        sat: { active: false, departure: '07:00', soc: 90 },
        sun: { active: false, departure: '07:00', soc: 90 },
      }),
    },
    todayStr: '2025-06-02',
    nowHour: 7,
  });

  assert.equal(result.departureDate, '2025-06-03');
  assert.equal(result.isActiveDepartureDay, false);
  assert.equal(result.departureHour, 8);
  assert.equal(result.targetSoc, 95);
});

test('toDepartureInfo formats departure hour as HH:00', () => {
  assert.deepEqual(toDepartureInfo('2025-06-03', 8), { date: '2025-06-03', time: '08:00' });
  assert.equal(toDepartureInfo(null, 8), null);
});
