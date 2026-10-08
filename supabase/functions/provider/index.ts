import { handleProviderCallback } from "../_shared/provider-callback.ts";

Deno.serve((request: Request) => {
  const path = new URL(request.url).pathname.replace(/\/+$/, "");
  if (path.endsWith("/provider/registrations")) {
    return handleProviderCallback(request, "registration");
  }
  if (path.endsWith("/provider/registrations/cancelled")) {
    return handleProviderCallback(request, "cancellation");
  }
  return new Response(
    JSON.stringify({
      error: {
        code: "not_found",
        message: "Provider callback route not found.",
      },
    }),
    {
      status: 404,
      headers: { "content-type": "application/json; charset=utf-8" },
    },
  );
});
