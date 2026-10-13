// frontend/src/lib/nutrition-calendar.test.js
import { describe, it, expect } from 'vitest'
import { addDays, weekdayOf, weekStartDate, phaseFor, dayFor, phaseDates, startOptions } from './nutrition-calendar.js'

const MON = 1, SUN = 0
const week = (a, b) => ({ '1': a, '2': b, '3': a, '4': a, '5': b, '6': b, '0': b })
const plan = (over = {}) => ({
  id: 'p', name: 'Anna', start: '2026-10-12', afterLast: 'stay',
  phases: [
    { id: 'cut', name: 'Cut', weeks: 6, dayTypes: [{ id: 'tc', name: 'Training' }, { id: 'rc', name: 'Rest' }], week: week('tc', 'rc') },
    { id: 'main', name: 'Maintenance', weeks: 4, dayTypes: [{ id: 'tm', name: 'Training' }, { id: 'rm', name: 'Rest' }], week: week('tm', 'rm') },
  ],
  ...over,
})

describe('date helpers', () => {
  it('adds days across months and a DST change', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01')
    expect(addDays('2026-03-28', 2)).toBe('2026-03-30')
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31')
  })
  it('knows the weekday', () => {
    expect(weekdayOf('2026-10-12')).toBe(1)
    expect(weekdayOf('2026-10-18')).toBe(0)
  })
  it('finds the first day of the week for both week starts', () => {
    expect(weekStartDate('2026-10-15', MON)).toBe('2026-10-12')
    expect(weekStartDate('2026-10-18', MON)).toBe('2026-10-12')
    expect(weekStartDate('2026-10-15', SUN)).toBe('2026-10-11')
    expect(weekStartDate('2026-10-11', SUN)).toBe('2026-10-11')
  })
})

describe('phaseFor', () => {
  it('is not started before the start week', () => {
    expect(phaseFor(plan(), '2026-10-11', MON)).toEqual({ notStarted: true, startsOn: '2026-10-12' })
  })
  it('counts weeks inside the first phase', () => {
    const r = phaseFor(plan(), '2026-10-28', MON)
    expect(r.phase.id).toBe('cut')
    expect(r.weekOfPhase).toBe(3)
    expect(r.weeksInPhase).toBe(6)
  })
  it('switches phase exactly on the boundary', () => {
    expect(phaseFor(plan(), '2026-11-22', MON).phase.id).toBe('cut')    // Sunday of week 6
    expect(phaseFor(plan(), '2026-11-23', MON).phase.id).toBe('main')   // Monday of week 7
    expect(phaseFor(plan(), '2026-11-23', MON).weekOfPhase).toBe(1)
  })
  it('stays on the last phase after the end by default', () => {
    const r = phaseFor(plan(), '2027-06-01', MON)
    expect(r.phase.id).toBe('main')
    expect(r.beyond).toBe(true)
  })
  it('restarts the cycle when asked', () => {
    // week 10 (0-based) of a 10-week cycle is week 0 again
    const r = phaseFor(plan({ afterLast: 'restart' }), '2026-12-21', MON)
    expect(r.phase.id).toBe('cut')
    expect(r.weekOfPhase).toBe(1)
  })
  it('ends when asked, on the last day of the last phase', () => {
    expect(phaseFor(plan({ afterLast: 'end' }), '2026-12-21', MON)).toEqual({ ended: true, endedOn: '2026-12-20' })
    expect(phaseFor(plan({ afterLast: 'end' }), '2026-12-20', MON).phase.id).toBe('main')
  })
  it('a repeating last phase never ends', () => {
    const p = plan({ afterLast: 'end' })
    p.phases[1].weeks = null
    const r = phaseFor(p, '2030-01-01', MON)
    expect(r.phase.id).toBe('main')
    expect(r.weeksInPhase).toBeNull()
  })
  it('a start date in mid-week counts from the start of its week', () => {
    expect(phaseFor(plan({ start: '2026-10-15' }), '2026-10-12', MON).phase.id).toBe('cut')
  })
  it('follows a Sunday week start', () => {
    // Sunday 2026-10-11 starts the week containing 2026-10-12
    expect(phaseFor(plan(), '2026-10-11', SUN).phase.id).toBe('cut')
    expect(phaseFor(plan(), '2026-10-10', SUN).notStarted).toBe(true)
  })
  it('a plan without phases is empty', () => {
    expect(phaseFor(plan({ phases: [] }), '2026-10-12', MON)).toEqual({ empty: true })
  })
})

describe('dayFor', () => {
  it('picks the weekday’s day type in the right phase', () => {
    expect(dayFor(plan(), '2026-10-13', MON).dayType.id).toBe('rc')          // Tuesday, cut
    expect(dayFor(plan(), '2026-11-26', MON).dayType.id).toBe('tm')          // Thursday, maintenance
    expect(dayFor(plan(), '2026-11-26', MON).weekday).toBe(4)
  })
  it('falls back to the first day type when a weekday points at nothing', () => {
    const p = plan()
    p.phases[0].week['2'] = 'gone'
    expect(dayFor(p, '2026-10-13', MON).dayType.id).toBe('tc')
  })
  it('passes notStarted and ended through without a day type', () => {
    expect(dayFor(plan(), '2026-10-01', MON).notStarted).toBe(true)
    expect(dayFor(plan({ afterLast: 'end' }), '2027-01-04', MON).ended).toBe(true)
  })
})

describe('phaseDates and startOptions', () => {
  it('lists each phase with its first and last day', () => {
    expect(phaseDates(plan(), MON)).toEqual([
      { id: 'cut', from: '2026-10-12', to: '2026-11-22' },
      { id: 'main', from: '2026-11-23', to: '2026-12-20' },
    ])
  })
  it('a repeating phase has no last day', () => {
    const p = plan(); p.phases[1].weeks = null
    expect(phaseDates(p, MON)[1]).toEqual({ id: 'main', from: '2026-11-23', to: null })
  })
  it('offers this week and next week', () => {
    expect(startOptions('2026-10-15', MON)).toEqual({ thisWeek: '2026-10-12', nextWeek: '2026-10-19' })
    expect(startOptions('2026-10-15', SUN)).toEqual({ thisWeek: '2026-10-11', nextWeek: '2026-10-18' })
  })
})
