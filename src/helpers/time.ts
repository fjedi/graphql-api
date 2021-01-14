import dayjs, { Dayjs, ConfigType, OpUnitType } from 'dayjs';
import isoWeekPlugin from 'dayjs/plugin/isoWeek';
import utcPlugin from 'dayjs/plugin/utc';
import tzPlugin from 'dayjs/plugin/timezone';

dayjs.extend(tzPlugin);
dayjs.extend(utcPlugin);
dayjs.extend(isoWeekPlugin);

type ISOUnitType = OpUnitType | 'isoWeek';
export interface TimeInstance extends Dayjs {
  // "isoWeek" plugin's methods
  isoWeekYear(): number;
  isoWeek(): number;
  isoWeek(value: number): TimeInstance;
  isoWeekday(): number;
  isoWeekday(value: number): TimeInstance;
  startOf(unit: ISOUnitType): TimeInstance;
  endOf(unit: ISOUnitType): TimeInstance;
  isSame(date: ConfigType, unit?: ISOUnitType): boolean;
  isBefore(date: ConfigType, unit?: ISOUnitType): boolean;
  isAfter(date: ConfigType, unit?: ISOUnitType): boolean;

  // "UTC" plugin's methods
  utc(keepLocalTime?: boolean): TimeInstance;
  local(): TimeInstance;
  isUTC(): boolean;

  // "Timezone" plugin's methods
  tz(timezone?: string, keepLocalTime?: boolean): TimeInstance;
  offsetName(type?: 'short' | 'long'): string | undefined;
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
