import { gql } from 'apollo-server-koa';

const typeDefs = gql`
  scalar Upload

  #
  scalar SanitizedString

  # A special custom Scalar type for Dates that converts to a ISO formatted string
  scalar Date
  scalar Time
  scalar DateTime

  scalar URL
  scalar EmailAddress
  scalar PhoneNumber
  # Numbers
  scalar BigInt
  scalar NegativeFloat
  scalar NegativeInt
  scalar NonNegativeFloat
  scalar NonNegativeInt
  scalar NonPositiveFloat
  scalar NonPositiveInt
  scalar PositiveFloat
  scalar PositiveInt
  scalar UnsignedFloat
  scalar UnsignedInt

  # scalar Long

  # scalar GUID

  # Colors
  # scalar HexColorCode
  # scalar HSL
  # scalar HSLA
  # scalar RGB
  # scalar RGBA

  # Network
  # scalar IPv4
  # scalar IPv6
  # scalar ISBN
  # scalar MAC
  # scalar Port

  scalar JSON
  scalar JSONObject

  enum CacheControlScope {
    PUBLIC
    PRIVATE
  }

  directive @cacheControl(
    maxAge: Int
    scope: CacheControlScope
  ) on FIELD_DEFINITION | OBJECT | INTERFACE

  input Pagination {
    limit: NonNegativeInt = 50
    offset: NonNegativeInt = 0
  }

  input DateRange {
    from: Date
    to: Date
  }

  enum SortDirection {
    DESC
    ASC
  }

  input Sort {
    fields: [String] = ["createdAt"]
    direction: SortDirection = DESC
  }

  type RemovedEntry {
    id: ID!
  }

  input ViewerCredentialsInput {
    email: EmailAddress!
    password: String!
  }

  enum ViewerRole {
    ADMIN
    USER
  }

  enum ResponseStatus {
    SUCCESS
    FAILURE
  }

  type DefaultResponse {
    status: ResponseStatus
    code: Int
    error: String
  }

  type File {
    id: ID!
    userId: ID
    origin: String
    path: String!
    url: URL!
    mime: String
    filename: String
  }

  #
  type Viewer {
    id: ID!
    firstName: String
    lastName: String
    middleName: String
    fullName: String
    beenOnlineAt: Date
    isOnline: Boolean
    props: JSON
    role: ViewerRole!
    email: EmailAddress
    phoneNumber: String
    comments: String
  }

  type Query {
    viewer: Viewer! @cacheControl(scope: PRIVATE)
  }

  type Mutation {
    logIn(role: ViewerRole, credentials: ViewerCredentialsInput!): Viewer!
    logOut: RemovedEntry!
  }
`;

export default typeDefs;
