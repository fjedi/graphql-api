import { DefaultContext, ParameterizedContext } from '@fjedi/rest-api';
import { DefaultError } from '@fjedi/errors';
import GraphQLUpload from 'graphql-upload/GraphQLUpload.mjs';
import {
  DateTimeResolver,
  EmailAddressResolver,
  NegativeFloatResolver,
  NegativeIntResolver,
  NonNegativeFloatResolver,
  NonNegativeIntResolver,
  NonPositiveFloatResolver,
  NonPositiveIntResolver,
  PhoneNumberResolver,
  PositiveFloatResolver,
  PositiveIntResolver,
  // PostalCodeResolver,
  UnsignedFloatResolver,
  UnsignedIntResolver,
  URLResolver,
  BigIntResolver,
  SemVerResolver,
  // LongResolver,
  // GUIDResolver,
  // HexColorCodeResolver,
  // HSLResolver,
  // HSLAResolver,
  IPResolver,
  IPv4Resolver,
  IPv6Resolver,
  ISBNResolver,
  MACResolver,
  PortResolver,
  // RGBResolver,
  // RGBAResolver,
  // USCurrencyResolver,
  JSONResolver,
  JSONObjectResolver,
  // ObjectIDResolver,
  // @ts-ignore
} from 'graphql-scalars';
import { SanitizedString } from './scalars';

export default function defaultResolvers(server: any) {
  return {
    Upload: GraphQLUpload,
    //
    SanitizedString,
    //
    DateTime: DateTimeResolver,

    NonPositiveInt: NonPositiveIntResolver,
    PositiveInt: PositiveIntResolver,
    NonNegativeInt: NonNegativeIntResolver,
    NegativeInt: NegativeIntResolver,
    NonPositiveFloat: NonPositiveFloatResolver,
    PositiveFloat: PositiveFloatResolver,
    NonNegativeFloat: NonNegativeFloatResolver,
    NegativeFloat: NegativeFloatResolver,
    UnsignedFloat: UnsignedFloatResolver,
    UnsignedInt: UnsignedIntResolver,
    BigInt: BigIntResolver,
    SemVer: SemVerResolver,
    // Long: LongResolver,

    EmailAddress: EmailAddressResolver,
    URL: URLResolver,
    PhoneNumber: PhoneNumberResolver,
    // PostalCode: PostalCodeResolver,

    // GUID: GUIDResolver,

    // HexColorCode: HexColorCodeResolver,
    // HSL: HSLResolver,
    // HSLA: HSLAResolver,
    // RGB: RGBResolver,
    // RGBA: RGBAResolver,

    IP: IPResolver,
    IPv4: IPv4Resolver,
    IPv6: IPv6Resolver,
    MAC: MACResolver,
    Port: PortResolver,
    ISBN: ISBNResolver,

    // USCurrency: USCurrencyResolver,
    JSON: JSONResolver,
    JSONObject: JSONObjectResolver,
    //
    ResponseStatus: {
      SUCCESS: 'success',
      FAILURE: 'failure',
    },
    ViewerRole: {
      ADMIN: 'admin',
      USER: 'user',
    },
    Query: {
      viewer(_: unknown, args: unknown, context: DefaultContext) {
        const contextUser = context?.state?.viewer;
        if (contextUser) {
          return contextUser;
        }
        throw new DefaultError('Not authorized', {
          status: 401,
        });
      },
    },
    Mutation: {
      async logIn(
        _: unknown,
        args: { credentials: { email: string; password: string } },
        context: ParameterizedContext,
      ) {
        if (context.state.viewer) {
          return context.state.viewer;
        }
        if (!server.db) {
          throw new DefaultError('Login failed due to issues with database connection', {
            status: 500,
          });
        }
        const {
          credentials: { email, password },
        } = args as { credentials: { email: string; password: string } };
        //
        const { foundUser, session } = await server.db.models.User.authByEmail(
          {
            email,
            password,
          },
          { context },
        );

        const referrer = context.get('referrer') || context.get('referer') || '';
        server.constructor.setAuthCookie(context, session.token, {
          secure: context.secure,
          sameSite: referrer.includes('localhost') ? 'none' : 'strict',
        });
        // eslint-disable-next-line no-param-reassign
        context.state.viewer = foundUser;

        return foundUser;
      },
      async logOut(_: unknown, args: unknown, context: ParameterizedContext) {
        const { viewer, session } = context.state;
        if (!viewer || !session) {
          throw new Error('You are not logged in');
        }
        //
        await session.destroy();
        //
        context.cookies.set('token', undefined);

        return {
          id: viewer.id,
        };
      },
    },
  };
}
