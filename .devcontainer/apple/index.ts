// Local test gateway: PostgREST RPC and the actual Supabase user-worker runtime.
Deno.serve(async (request: Request) => {
  const url = new URL(request.url);
  if (url.pathname.startsWith('/rest/v1/')) {
    url.host = Deno.env.get('P1_REST_HOST')!;
    url.pathname = url.pathname.slice('/rest/v1'.length);
    // This isolated local stack authenticates provider HMACs in the function.
    // PostgREST uses the test service role, without production JWT material.
    const forwarded = new Request(url, request);
    forwarded.headers.delete('authorization');
    forwarded.headers.delete('apikey');
    return fetch(forwarded);
  }
  if (!url.pathname.startsWith('/functions/v1/provider/')) {
    return new Response('Not found', { status: 404 });
  }
  try {
    const worker = await EdgeRuntime.userWorkers.create({
      servicePath: '/workspaces/p1/supabase/functions/provider',
      memoryLimitMb: 150,
      workerTimeoutMs: 120000,
      noModuleCache: false,
      envVars: Object.entries(Deno.env.toObject()),
    });
    return await worker.fetch(request);
  } catch (error) {
    console.error(error);
    return new Response('Edge worker failed', { status: 503 });
  }
});
