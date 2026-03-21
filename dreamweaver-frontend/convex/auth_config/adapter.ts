import { createApi } from "@convex-dev/better-auth";

import schema from "./schema";
import { createAuthOptions } from "../auth";

export const {
  createUser,
  updateUser,
  deleteUser,
  createSession,
  isAuthenticated,
} = createApi(schema, createAuthOptions);
