import { describe, expect, it } from 'vitest';
import { classify } from '../src/controllers/newsController';

// Headlines from the live ESPN NBA feed, 2026-11-02.
describe('news classify', () => {
  it('keeps trade and roster news', () => {
    expect(classify('NBA buzz: Latest on trades, news, roster moves and intel')).toBe('trade');
    expect(classify('Nets waive veteran guard ahead of deadline')).toBe('trade');
    expect(classify('Thunder decline option for oft-injured ex-lottery pick Nikola Topic')).toBe('trade');
  });
  it('keeps injury and status news', () => {
    expect(classify("Coby White returns for Hornets, Kon Knueppel 'right around the corner'")).toBe('injury');
    expect(classify('Missing 11 players, Pacers play just six in loss to Hawks')).toBe('injury');
    expect(classify("Hawks' Flemings suspended for elbowing Pelicans' McGowens in head")).toBe('injury');
  });
  it('drops everything else', () => {
    expect(classify("Thunder to retire Russell Westbrook's No. 0")).toBeNull();
    expect(classify('Short-handed Thunder bounce back, hand Cavaliers first loss at home')).toBeNull();
    expect(classify('How NBA title, MVP race has become wide open in two weeks')).toBeNull();
  });
});
