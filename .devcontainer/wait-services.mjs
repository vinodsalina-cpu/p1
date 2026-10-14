const url = new URL('/functions/v1/provider/unknown', process.env.SUPABASE_API_URL);
const deadline = Date.now() + 60000;
while (Date.now() < deadline) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
    if (response.status === 404) process.exit(0);
  } catch {}
  await new Promise(resolve => setTimeout(resolve, 1000));
}
console.error('Supabase Edge Function did not become ready within 60 seconds');
process.exit(1);
