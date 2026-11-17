/** Weather dates arrive as calendar days (YYYY-MM-DD). Format them in UTC so a day never shifts in another timezone. */
export const parseDay = (iso: string) => Date.parse(`${String(iso).slice(0, 10)}T00:00:00Z`);

export function dayFormatter(locale: string, options: Intl.DateTimeFormatOptions) {
  const formatter = new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' });
  return (iso: string) => {
    const time = parseDay(iso);
    return Number.isFinite(time) ? formatter.format(time) : String(iso);
  };
}

export const finite = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

/** "12 mm" for rain; one decimal under 10 mm so light rain is not shown as 0. */
export const mm = (value: number) => `${value < 10 ? value.toFixed(1).replace(/\.0$/, '') : Math.round(value)} mm`;
