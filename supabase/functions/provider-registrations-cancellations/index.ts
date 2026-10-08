import { handleProviderCallback } from "../_shared/provider-callback.ts";

Deno.serve((request: Request) =>
  handleProviderCallback(request, "cancellation")
);
