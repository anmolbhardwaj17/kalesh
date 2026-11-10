import { describe, it, expect } from 'vitest';
import { addNotice, resolveNotice, openNotices, nextNoticeId } from './notice.mjs';

describe('dashboard notices (P2B-106)', () => {
  it('numbers notices from the highest id', () => {
    expect(nextNoticeId([])).toBe('N1');
    expect(nextNoticeId([{ id: 'N2' }, { id: 'N7' }, { id: 'x' }])).toBe('N8');
  });
  it('adds an open notice with folded text and refuses empty text', () => {
    const { list, notice } = addNotice([], '  git push   failed:\n no remote ', '2026-10-15T10:00:00Z');
    expect(notice).toEqual({ id: 'N1', ts: '2026-10-15T10:00:00Z', text: 'git push failed: no remote', resolved: false });
    expect(list).toHaveLength(1);
    expect(() => addNotice(list, '   ')).toThrow();
  });
  it('resolves by id (any case) and keeps the line', () => {
    let { list } = addNotice([], 'one', '2026-10-15T10:00:00Z');
    ({ list } = addNotice(list, 'two', '2026-10-15T11:00:00Z'));
    const after = resolveNotice(list, 'n1', '2026-10-15T12:00:00Z');
    expect(after).toHaveLength(2);
    expect(after[0]).toMatchObject({ id: 'N1', resolved: true, resolvedAt: '2026-10-15T12:00:00Z' });
    expect(openNotices(after).map((n) => n.id)).toEqual(['N2']);
    expect(() => resolveNotice(after, 'N9')).toThrow();
  });
  it('lists open notices newest first', () => {
    const list = [{ id: 'N1', ts: '2026-10-15T09:00:00Z', text: 'a', resolved: false }, { id: 'N2', ts: '2026-10-15T10:00:00Z', text: 'b', resolved: false }, { id: 'N3', ts: '2026-10-15T11:00:00Z', text: 'c', resolved: true }];
    expect(openNotices(list).map((n) => n.id)).toEqual(['N2', 'N1']);
  });
});
