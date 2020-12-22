import dayjs, { Dayjs } from 'dayjs';
import isoWeek from 'dayjs/plugin/isoWeek';

dayjs.extend(isoWeek);

export type DateValue = Date | Dayjs | string | number;

export function formatDate(date: DateValue, format = 'D MMMM YYYY, HH:mm'): string {
  return dayjs(date).format(format);
}

export const time = dayjs;

export default dayjs;
