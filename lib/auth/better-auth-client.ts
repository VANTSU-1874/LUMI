"use client";

import { createAuthClient } from "better-auth/react";
import { inferAdditionalFields } from "better-auth/client/plugins";

import { AUTH_USER_ADDITIONAL_FIELDS } from "./account-model";

export const authClient = createAuthClient({
  plugins: [
    inferAdditionalFields({
      user: AUTH_USER_ADDITIONAL_FIELDS,
    }),
  ],
});
