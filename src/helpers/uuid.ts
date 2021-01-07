import { v1 as uuidV1 } from 'uuid';

export function uuid(version: number): string {
  if (version && version !== 1) {
    throw new Error(`Invalid "version" passed to "uuid" generator: ${version}`);
  }
  return uuidV1();
}

export default null;
