import dayjs, { Dayjs, ConfigType, OpUnitType } from 'dayjs';
import isoWeek from 'dayjs/plugin/isoWeek';

dayjs.extend(isoWeek);

type ISOUnitType = OpUnitType | 'isoWeek';
export interface TimeInstance extends Dayjs {
  isoWeekYear(): number;
  isoWeek(): number;
  isoWeek(value: number): Dayjs;

  isoWeekday(): number;
  isoWeekday(value: number): Dayjs;

  startOf(unit: ISOUnitType): Dayjs;

  endOf(unit: ISOUnitType): Dayjs;

  isSame(date: ConfigType, unit?: ISOUnitType): boolean;

  isBefore(date: ConfigType, unit?: ISOUnitType): boolean;

  isAfter(date: ConfigType, unit?: ISOUnitType): boolean;
}
export type TimeConstructor = (
  date?: dayjs.ConfigType,
  format?: dayjs.OptionType,
  locale?: string,
  strict?: boolean,
) => TimeInstance;

export type DateValue = Date | Dayjs | string | number;

export function formatDate(date: DateValue, format = 'D MMMM YYYY, HH:mm'): string {
  return dayjs(date).format(format);
}

export const time = dayjs as TimeConstructor;

export default dayjs;
