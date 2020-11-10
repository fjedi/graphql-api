import { number, string } from 'yup';
// @ts-ignore
import is from 'is_js';

export async function isPositiveNumber(
  value: any,
  options: { required?: boolean; isInt?: boolean },
): Promise<boolean> {
  const { required, isInt = false } = options || {};
  let rule = number();
  if (required) {
    rule = rule.required();
  }
  rule = rule.positive();
  if (isInt) {
    rule = rule.integer();
  }
  return rule.isValid(value);
}

export async function isEmail(email?: unknown): Promise<boolean> {
  return string().email().isValid(email);
}

export async function isNonEmptyString(str?: unknown): Promise<boolean> {
  return string().trim().required().isValid(str);
}

export async function isUUID(str?: unknown): Promise<boolean> {
  return string()
    .trim()
    .required()
    .matches(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/, {
      excludeEmptyString: true,
    })
    .isValid(str);
}

export function isEmpty(value: any[] | unknown | string): boolean {
  return is.empty(value);
}
