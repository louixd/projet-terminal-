import { createClient } from 'npm:@supabase/supabase-js@2';
import { getPrices } from '../_shared/market-data.ts';

Deno.serve(async (request) => {
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method not allowed.' }, { status: 405 });
  }

  const cronSecret = Deno.env.get('PAPER_TRADING_CRON_SECRET');
  if (!cronSecret || request.headers.get('x-cron-secret') !== cronSecret) {
    return Response.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const marketDataApiKey = Deno.env.get('TWELVE_DATA_API_KEY');
  if (!supabaseUrl || !serviceRoleKey || !marketDataApiKey) {
    return Response.json({ error: 'Paper trading is not configured on the server.' }, { status: 503 });
  }

  try {
    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    });
    const { data: positions, error: positionsError } = await admin
      .from('paper_positions')
      .select('symbol')
      .eq('status', 'open');
    if (positionsError) throw new Error('Unable to load open paper positions.');

    const { data: pendingOrders, error: ordersError } = await admin
      .from('paper_limit_orders')
      .select('symbol')
      .eq('status', 'pending');
    if (ordersError) throw new Error('Unable to load pending paper orders.');

    const symbols = [...new Set([
      ...(positions ?? []).map(({ symbol }) => symbol),
      ...(pendingOrders ?? []).map(({ symbol }) => symbol)
    ])];
    const prices = await getPrices(symbols, marketDataApiKey);
    const { data: result, error: refreshError } = await admin.rpc('run_paper_market_cycle', {
      p_prices: prices
    });
    if (refreshError) throw new Error('Unable to process paper orders and position exits.');

    return Response.json({ ...result, updated_symbols: symbols.length });
  } catch (error) {
    console.error('Minutely paper market refresh failed:', error);
    return Response.json(
      { error: error instanceof Error ? error.message : 'Market update failed.' },
      { status: 502 }
    );
  }
});
