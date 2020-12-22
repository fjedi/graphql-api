import dayjs, { Dayjs } from 'dayjs';

export function formatDate(date: Date | Dayjs | string, format = 'D MMMM YYYY, HH:mm'): string {
  return dayjs(date).format(format);
}

export const time = dayjs;

export default dayjs;
