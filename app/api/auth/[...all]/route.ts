import { getLumiAuthRuntime } from "@/lib/auth/better-auth";

function handle(request: Request) {
  return getLumiAuthRuntime().auth.handler(request);
}

export { handle as GET, handle as POST };
