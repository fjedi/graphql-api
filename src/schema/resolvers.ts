import { DefaultContext, ParameterizedContext } from '@fjedi/rest-api';
import { DefaultError } from '@fjedi/errors';
// @ts-ignore
import GraphQLUpload from 'graphql-upload/GraphQLUpload.js';
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
  // LongResolver,
  // GUIDResolver,
  // HexColorCodeResolver,
  // HSLResolver,
  // HSLAResolver,
  // IPv4Resolver,
  // IPv6Resolver,
  // ISBNResolver,
  // MACResolver,
  // PortResolver,
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

    // IPv4: IPv4Resolver,
    // IPv6: IPv6Resolver,
    // MAC: MACResolver,
    // Port: PortResolver,

    // ISBN: ISBNResolver,

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
      OPERATOR: 'operator',
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
      async logIn(_: unknown, args: { [k: string]: any }, context: ParameterizedContext) {
        if (context.state.viewer) {
          return context.state.viewer;
        }
        const {
          credentials: { email, password },
        } = args as { credentials: { email: string; password: string } };
        // @ts-ignore
        const { foundUser, session } = await server.db!.models.User.authByEmail(
          {
            email,
            password,
          },
          { context },
        );

        server.constructor.setAuthCookie(context, session.token, {
          secure: context.secure,
          sameSite: context.get('referrer').includes('localhost') ? 'none' : 'strict',
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
