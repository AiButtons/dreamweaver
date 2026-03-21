import { betterAuth } from "better-auth";
import { convex } from "@convex-dev/better-auth/plugins";
import { getAuthConfigProvider } from "@convex-dev/better-auth/auth-config";

console.log("Convex plugin import:", convex);

const authConfig = {
  providers: [getAuthConfigProvider()],
};

const auth = betterAuth({
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,
  },
  plugins: [convex({ authConfig })],
});

export default auth;
