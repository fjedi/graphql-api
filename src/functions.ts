import { Promise } from 'bluebird';

export function timeout(ms: number): Promise<NodeJS.Timeout> {
  return new Promise((resolve) => setTimeout(() => resolve(), ms));
}

//
const ValidIdTypes = ['string', 'number'];
export function compareIds(id1: unknown, id2: unknown): boolean {
  //
  if (!ValidIdTypes.includes(typeof id1) || !ValidIdTypes.includes(typeof id2)) {
    return false;
  }
  return `${id1}` === `${id2}`;
}

export function removeUndefinedValues(values: {
  [key: string]: unknown;
}): { [key: string]: unknown } {
  const res: { [key: string]: unknown } = {};
  Object.keys(values).forEach((key) => {
    if (typeof values[key] !== 'undefined') {
      res[key] = values[key];
    }
  });
  return res;
}

export type ObjectType = 'Object' | 'Null' | 'RegExp' | 'Function';
// Returns specific type of any Object
// getRawType(null)  // returns "Null"
// getRawType(/sdfsd/)  // returns "RegExp"
export function getRawType(value: unknown): ObjectType {
  // eslint-disable-next-line no-underscore-dangle
  const dtoString = Object.prototype.toString;

  const str = dtoString.call(value);

  return str.slice(8, -1) as ObjectType;
}

// Wraps class to avoid creation of multiple instances of it
// Example:
// function Person(name, age) {
//   this.name = name;
//   this.age = age;
// }
// const SingletonPerson = proxy(Person);
// let person1 = new SingletonPerson('zhl', 22);
// let person2 = new SingletonPerson('cyw', 22);
// logger.log(person1 === person2); // true
export function singleton(func: unknown): ProxyConstructor {
  let instance: any;
  const handler = {
    construct(target: any, args: any) {
      if (!instance) {
        // Create an instance if there is not exist
        if (typeof func === 'function') {
          instance = Reflect.construct(func, args);
        }
      }
      return instance;
    },
  };
  return new Proxy(func, handler);
}
