import { DurationFormat } from '@formatjs/intl-durationformat';

export function isOlderThanHours(date: Date, hours: number) {
  return (Date.now() - date.getTime()) > hours * 60 * 60 * 1000;
};

export function formatElapsedTime(locale: string, seconds: number) {
  const totalSeconds = Math.floor(seconds);

  const durationFormatter = new DurationFormat(locale, {
    style: 'short',
  });

  return durationFormatter.format({
    hours: Math.floor(totalSeconds / 3600),
    minutes: Math.floor((totalSeconds % 3600) / 60),
    seconds: totalSeconds % 60,
  });
}
