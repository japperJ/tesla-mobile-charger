const test = require('node:test');
const assert = require('node:assert/strict');

const { shouldStartSession, shouldStopSession } = require('../src/charging/session-timing');

test('shouldStartSession starts planned session when current time is within its window', () => {
  const session = { status: 'planned', planned_start: '23:00', planned_end: '24:00' };
  assert.equal(shouldStartSession(session, '23:01'), true);
});

test('shouldStartSession does not start before planned start', () => {
  const session = { status: 'planned', planned_start: '23:00', planned_end: '24:00' };
  assert.equal(shouldStartSession(session, '22:59'), false);
});

test('shouldStartSession does not start once window has ended', () => {
  const session = { status: 'planned', planned_start: '23:00', planned_end: '24:00' };
  assert.equal(shouldStartSession(session, '24:00'), false);
});

test('shouldStopSession stops charging session at or after planned end', () => {
  const session = { status: 'charging', planned_start: '13:00', planned_end: '17:00' };
  assert.equal(shouldStopSession(session, '17:00'), true);
  assert.equal(shouldStopSession(session, '17:05'), true);
});
