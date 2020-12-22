import dayjs, { Dayjs } from 'dayjs';
import isoWeek from 'dayjs/plugin/isoWeek';

dayjs.extend(isoWeek);

export function formatDate(date: Date | Dayjs | string, format = 'D MMMM YYYY, HH:mm'): string {
  return dayjs(date).format(format);
}

export const time = dayjs;

export default dayjs;
