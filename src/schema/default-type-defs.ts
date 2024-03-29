import { gql } from 'apollo-server-koa';

const defaultTypeDefs = gql`
  scalar Upload

  #
  scalar SanitizedString

  scalar SemVer

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
  scalar IP
  scalar IPv4
  scalar IPv6
  scalar MAC
  scalar Port
  scalar ISBN

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

  type PageInfo {
    current: NonNegativeInt!
    total: NonNegativeInt!
    hasPreviousPage: Boolean
    hasNextPage: Boolean
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

  type Mutation {
    logOut: RemovedEntry!
  }
`;

export default defaultTypeDefs;
