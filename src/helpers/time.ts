import moment from 'moment';

export function formatDate(date: Date | moment.Moment | string, format = 'D MMMM YYYY, HH:mm') {
  return moment(date).format(format);
}

export default moment;
