export type CalendarSystem = 'GREGORIAN' | 'ETHIOPIAN' | 'BOTH';
export const normalizeCalendarSystem = (value: unknown): CalendarSystem => value === 'ETHIOPIAN' || value === 'BOTH' ? value : 'GREGORIAN';
export interface EthiopianDate { year: number; month: number; day: number }

export const ETHIOPIAN_MONTHS = ['Meskerem', 'Tikimt', 'Hidar', 'Tahsas', 'Tir', 'Yekatit', 'Megabit', 'Miazia', 'Ginbot', 'Sene', 'Hamle', 'Nehase', 'Pagume'] as const;
const ETHIOPIAN_EPOCH = 1723856;

const gregorianToJdn = (year: number, month: number, day: number) => {
  const a = Math.floor((14 - month) / 12), y = year + 4800 - a, m = month + 12 * a - 3;
  return day + Math.floor((153 * m + 2) / 5) + 365 * y + Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400) - 32045;
};
const jdnToGregorian = (jdn: number) => {
  const a = jdn + 32044, b = Math.floor((4 * a + 3) / 146097), c = a - Math.floor(146097 * b / 4), d = Math.floor((4 * c + 3) / 1461), e = c - Math.floor(1461 * d / 4), m = Math.floor((5 * e + 2) / 153);
  return { year: 100 * b + d - 4800 + Math.floor(m / 10), month: m + 3 - 12 * Math.floor(m / 10), day: e - Math.floor((153 * m + 2) / 5) + 1 };
};
export const isEthiopianLeapYear = (year: number) => (year + 1) % 4 === 0;
export const daysInEthiopianMonth = (year: number, month: number) => month >= 1 && month <= 12 ? 30 : month === 13 ? (isEthiopianLeapYear(year) ? 6 : 5) : 0;
export const ethiopianToJdn = ({ year, month, day }: EthiopianDate) => {
  if (!Number.isInteger(year) || year < 1 || !Number.isInteger(month) || month < 1 || month > 13 || !Number.isInteger(day) || day < 1 || day > daysInEthiopianMonth(year, month)) throw new Error('Invalid Ethiopian date');
  return ETHIOPIAN_EPOCH + 365 * year + Math.floor(year / 4) + 30 * month + day - 31;
};
export const gregorianToEthiopian = (input: Date | number): EthiopianDate => {
  const date = new Date(input); if (Number.isNaN(date.getTime())) throw new Error('Invalid date');
  const jdn = gregorianToJdn(date.getFullYear(), date.getMonth() + 1, date.getDate());
  let year = Math.floor((4 * (jdn - ETHIOPIAN_EPOCH) + 3) / 1461);
  while (ethiopianToJdn({ year: year + 1, month: 1, day: 1 }) <= jdn) year += 1;
  while (ethiopianToJdn({ year, month: 1, day: 1 }) > jdn) year -= 1;
  const offset = jdn - ethiopianToJdn({ year, month: 1, day: 1 });
  return { year, month: Math.floor(offset / 30) + 1, day: offset % 30 + 1 };
};
export const ethiopianToGregorian = (date: EthiopianDate) => {
  const value = jdnToGregorian(ethiopianToJdn(date));
  return new Date(value.year, value.month - 1, value.day, 12, 0, 0, 0);
};
export const parseEthiopianDate = (value: string): Date | null => {
  const match = /^(\d{3,4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(value.trim());
  if (!match) return null;
  try { return ethiopianToGregorian({ year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) }); } catch { return null; }
};
export const formatEthiopianDate = (input: Date | number, long = false) => {
  const date = gregorianToEthiopian(input);
  return long ? `${ETHIOPIAN_MONTHS[date.month - 1]} ${date.day}, ${date.year} E.C.` : `${date.year}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')} E.C.`;
};
export const formatCalendarDate = (input: Date | number, system: CalendarSystem, options?: Intl.DateTimeFormatOptions) => {
  const gregorian = new Date(input).toLocaleDateString(undefined, options);
  if (system === 'GREGORIAN') return gregorian;
  const ethiopian = formatEthiopianDate(input, !!options);
  return system === 'ETHIOPIAN' ? ethiopian : `${gregorian} · ${ethiopian}`;
};
export const ethiopianMonthBounds = (timestamp = Date.now()) => {
  const current = gregorianToEthiopian(timestamp); const start = ethiopianToGregorian({ year: current.year, month: current.month, day: 1 });
  const next = current.month === 13 ? { year: current.year + 1, month: 1, day: 1 } : { year: current.year, month: current.month + 1, day: 1 };
  const nextGregorian = ethiopianToGregorian(next);
  return { start: new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime(), end: new Date(nextGregorian.getFullYear(), nextGregorian.getMonth(), nextGregorian.getDate()).getTime() - 1 };
};
export const advanceEthiopianDate = (frequency: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY', timestamp: number, anchor = timestamp) => {
  if (frequency === 'DAILY' || frequency === 'WEEKLY') { const date = new Date(timestamp); date.setDate(date.getDate() + (frequency === 'DAILY' ? 1 : 7)); return date.getTime(); }
  const current = gregorianToEthiopian(timestamp), original = gregorianToEthiopian(anchor);
  let year = current.year, month = current.month;
  if (frequency === 'MONTHLY') { month += 1; if (month > 13) { month = 1; year += 1; } }
  else year += 1;
  const result = ethiopianToGregorian({ year, month: frequency === 'YEARLY' ? original.month : month, day: Math.min(original.day, daysInEthiopianMonth(year, frequency === 'YEARLY' ? original.month : month)) });
  const source = new Date(timestamp);
  result.setHours(source.getHours(), source.getMinutes(), source.getSeconds(), source.getMilliseconds());
  return result.getTime();
};
