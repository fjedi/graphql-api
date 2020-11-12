import { ParameterizedContext } from 'koa';
import { get } from 'lodash';

export type LangLookupParams = {
  lookupCookie?: string;
  lookupSession?: string;
  lookupPath?: string;
  lookupFromPathIndex?: number;
  lookupQuerystring?: string;
  order: string[];
};

export const LANG_DETECTION_DEFAULT_ORDER = ['cookie', 'header', 'user'];
export const LANG_DETECTION_DEFAULT_OPTIONS = {
  order: ['path', 'querystring', 'cookie', 'session', 'header'],
  lookupSession: 'lang',
  // keys or params to lookup language from
  lookupQuerystring: 'lang',
  lookupCookie: 'lang',
};

export const LANG_DETECTORS = {
  user(context: ParameterizedContext): string | null {
    return get(context, 'state.viewer.languageCode');
  },
  cookie(context: ParameterizedContext, options: LangLookupParams): string | null | undefined {
    const cookie = options.lookupCookie || 'i18next';
    return context.cookies.get(cookie);
  },
  // fork from i18next-express-middleware
  header(context: ParameterizedContext): string[] | undefined {
    const acceptLanguage = context.get('accept-language');
    let found;
    const locales = [];
    if (acceptLanguage) {
      const lngs: { lng: string; q: any }[] = [];

      // associate language tags by their 'q' value (between 1 and 0)
      acceptLanguage.split(',').forEach((l) => {
        const parts = l.split(';'); // 'en-GB;q=0.8' -> ['en-GB', 'q=0.8']

        // get the language tag qvalue: 'q=0.8' -> 0.8
        let qvalue = 1; // default qvalue

        // eslint-disable-next-line no-plusplus
        for (let i = 0; i < parts.length; i++) {
          const part = parts[i].split('=');
          if (part[0] === 'q' && !Number.isNaN(part[1])) {
            qvalue = Number(part[1]);
            break;
          }
        }
        // add the tag and primary subtag to the qvalue associations
        lngs.push({
          lng: parts[0],
          q: qvalue,
        });
      });

      lngs.sort((a, b) => b.q - a.q);

      // eslint-disable-next-line no-plusplus
      for (let i = 0; i < lngs.length; i++) {
        locales.push(lngs[i].lng);
      }

      if (locales.length) found = locales;
    }

    return found;
  },
  path(context: ParameterizedContext, options: LangLookupParams): string | null {
    let found;

    if (options.lookupPath !== undefined && context.params) {
      found = context.params[options.lookupPath];
    }

    if (!found && options.lookupFromPathIndex !== undefined) {
      const parts = context.path.split('/');
      if (parts[0] === '') {
        // Handle paths that start with a slash, i.e., '/foo' -> ['', 'foo']
        parts.shift();
      }

      if (parts.length > options.lookupFromPathIndex) {
        found = parts[options.lookupFromPathIndex];
      }
    }
    return found;
  },
  querystring(context: ParameterizedContext, options: LangLookupParams): string | null {
    const name = options?.lookupQuerystring || 'lng';
    return context.query[name];
  },
  session(context: ParameterizedContext, options: LangLookupParams): string | null {
    const name = options.lookupSession || 'lng';
    return context.session && context.session[name];
  },
};

export function detectContextLang(
  context: ParameterizedContext,
  options: LangLookupParams,
): string {
  let { order } = options || {};
  order = order && Array.isArray(order) ? order : LANG_DETECTION_DEFAULT_ORDER;

  const languages = [];

  // eslint-disable-next-line no-plusplus
  for (let i = 0, len = order.length; i < len; i++) {
    // @ts-ignore
    const detector = LANG_DETECTORS[order[i]];
    let lng;
    if (detector) {
      lng = detector(context, options);
    }
    if (lng && typeof lng === 'string') {
      languages.push(lng);
    } else if (Array.isArray(lng)) {
      languages.push(...lng);
    }
  }
  let found;
  // eslint-disable-next-line no-plusplus
  for (let i = 0, len = languages.length; i < len; i++) {
    const cleanedLng = context.i18next.services.languageUtils.formatLanguageCode(languages[i]);
    if (context.i18next.services.languageUtils.isWhitelisted(cleanedLng)) found = cleanedLng;
    if (found) break;
  }

  if (found && context.i18next.services.languageUtils.options.load === 'languageOnly') {
    return found.substring(0, 2);
  }

  return found;
}

export function setContextLang(
  context: ParameterizedContext,
  lng: string,
  options?: LangLookupParams,
): void {
  const { lookupCookie, lookupSession } = options || {};
  // eslint-disable-next-line no-param-reassign
  context.state.languageCode = lng.substring(0, 2);
  // eslint-disable-next-line no-param-reassign
  context.language = lng;
  context.set('content-language', lng);
  //
  if (lookupCookie) {
    context.cookies.set(lookupCookie, lng, { httpOnly: false, signed: false });
  }
  if (lookupSession && context.session) {
    // eslint-disable-next-line no-param-reassign
    context.session[lookupSession] = lng;
  }
}
