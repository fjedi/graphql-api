import { gql } from 'apollo-server-koa';

const defaultAuthTypeDefs = gql`
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

  extend type Mutation {
    logIn(credentials: ViewerCredentialsInput!): Viewer!
    logOut: RemovedEntry!
  }
`;

export default defaultAuthTypeDefs;
