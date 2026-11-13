import { describe, expect, it } from 'vitest';
import { campusDate, campusMealType, campusTime, checkSlotBookable, parseCampusDate } from './order';

describe('校园时钟与预约截止', () => {
  it('使用北京时间跨日和切换餐次', () => {
    expect(campusDate(new Date('2026-11-11T15:59:59.999Z'))).toBe('2026-11-11');
    expect(campusDate(new Date('2026-11-11T16:00:00.000Z'))).toBe('2026-11-12');
    expect(campusMealType(new Date('2026-11-11T23:00:00Z'))).toBe('BREAKFAST');
    expect(campusMealType(new Date('2026-11-12T02:00:00Z'))).toBe('LUNCH');
    expect(campusMealType(new Date('2026-11-12T07:00:00Z'))).toBe('DINNER');
  });

  it('区分日期键和实际时刻，并拒绝无效日期及时间', () => {
    expect(parseCampusDate('2026-11-12')?.toISOString()).toBe('2026-11-12T00:00:00.000Z');
    expect(campusTime('2026-11-12', '07:00')?.toISOString()).toBe('2026-11-11T23:00:00.000Z');
    expect(parseCampusDate('2026-02-30')).toBeUndefined();
    expect(campusTime('2026-11-12', '24:00')).toBeUndefined();
  });

  it('不同偏移表示同一截止瞬间，截止后一毫秒拒绝预约', () => {
    const slot = {
      date: '2026-11-12', startTime: '12:00', endTime: '12:30',
      capacity: 3, booked: 0, cutoffMinutes: 15, isClosed: false,
    };
    expect(checkSlotBookable(slot, '2026-11-12T03:45:00.000Z')).toEqual({ ok: true });
    expect(checkSlotBookable(slot, '2026-11-11T19:45:00.000-08:00')).toEqual({ ok: true });
    expect(checkSlotBookable(slot, '2026-11-12T03:45:00.001Z').reason).toBe('PAST_CUTOFF');
    expect(checkSlotBookable({ ...slot, endTime: '11:00' }, '2026-11-12T03:45:00Z').reason).toBe('INVALID_SLOT');
    expect(checkSlotBookable({ ...slot, booked: -1 }, '2026-11-12T03:45:00Z').reason).toBe('INVALID_SLOT');
  });
});
