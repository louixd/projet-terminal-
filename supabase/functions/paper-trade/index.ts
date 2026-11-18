// @ts-ignore Deno resolves npm: imports at runtime; the workspace TypeScript resolver does not.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { getPrices } from '../_shared/market-data.ts';

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (request: Request) => Response | Promise<Response>): unknown;
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, x-client-info, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

function jsonResponse(body: unknown, status = 200) {
  return Response.json(body, { status, headers: corsHeaders });
}

function parseOptionalPrice(value: unknown): number | null | undefined {
  if (value === null || value === '') return null;
  const price = Number(value);
  return Number.isFinite(price) && price > 0 && price <= 1_000_000
    ? price
    : undefined;
}

function isPositionId(value: unknown): value is string {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed.' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const marketDataApiKey = Deno.env.get('TWELVE_DATA_API_KEY');
  if (!supabaseUrl || !serviceRoleKey || !marketDataApiKey) {
    return jsonResponse({ error: 'Paper trading is not configured on the server.' }, 503);
  }

  const authorization = request.headers.get('authorization');
  const accessToken = authorization?.match(/^Bearer (.+)$/i)?.[1];
  if (!accessToken) return jsonResponse({ error: 'Sign in to place a paper trade.' }, 401);

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
  const { data: { user }, error: authError } = await admin.auth.getUser(accessToken);
  if (authError || !user) return jsonResponse({ error: 'Your session is invalid. Sign in again.' }, 401);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid request body.' }, 400);
  }

  const action = body.action;
  try {
    if (action === 'buy') {
      const symbol = typeof body.symbol === 'string' ? body.symbol.trim().toUpperCase() : '';
      const quantity = Number(body.quantity);
      const leverage = Number(body.leverage);
      const maxPrice = Number(body.max_price);
      const takeProfit = parseOptionalPrice(body.take_profit);
      const stopLoss = parseOptionalPrice(body.stop_loss);
      if (!/^[A-Z][A-Z0-9.-]{0,14}$/.test(symbol)
        || !Number.isFinite(quantity) || quantity <= 0 || quantity > 1_000_000
        || !Number.isFinite(leverage) || leverage < 1 || leverage > 10
        || !Number.isFinite(maxPrice) || maxPrice <= 0 || maxPrice > 1_000_000
        || takeProfit === undefined || stopLoss === undefined) {
        return jsonResponse({ error: 'Saisis un ticker américain, une quantité, un levier (1x–10x) et des prix valides.' }, 400);
      }

      const [price] = Object.values(await getPrices([symbol], marketDataApiKey));
      const { data, error } = await admin.rpc('place_paper_buy_limit', {
        p_user_id: user.id,
        p_symbol: symbol,
        p_quantity: quantity,
        p_leverage: leverage,
        p_limit_price: maxPrice,
        p_take_profit: takeProfit,
        p_stop_loss: stopLoss,
        p_current_price: price
      });
      if (error) {
        return jsonResponse({ error: error.message }, error.code === '23514' ? 409 : 400);
      }
      return jsonResponse({ order: data });
    }

    if (action === 'cancel_limit') {
      if (!isPositionId(body.order_id)) {
        return jsonResponse({ error: 'Choisis un ordre limite en attente à annuler.' }, 400);
      }

      const { data, error } = await admin.rpc('cancel_paper_limit_order', {
        p_user_id: user.id,
        p_order_id: body.order_id
      });
      if (error) return jsonResponse({ error: error.message }, error.code === 'P0002' ? 404 : 400);
      return jsonResponse({ order: data });
    }

    if (action === 'set_brackets' || action === 'sell_limit') {
      const positionId = body.position_id;
      if (!isPositionId(positionId)) {
        return jsonResponse({ error: 'Choisis une position ouverte.' }, 400);
      }

      const { data: position, error: positionError } = await admin
        .from('paper_positions')
        .select('symbol')
        .eq('id', positionId)
        .eq('user_id', user.id)
        .eq('status', 'open')
        .maybeSingle();
      if (positionError) return jsonResponse({ error: 'Impossible de charger cette position.' }, 500);
      if (!position) return jsonResponse({ error: 'Cette position ouverte est introuvable.' }, 404);

      if (action === 'sell_limit') {
        const limitPrice = parseOptionalPrice(body.limit_price);
        if (limitPrice === undefined) {
          return jsonResponse({ error: 'Saisis un prix limite de vente valide en USD ou laisse le champ vide pour l’annuler.' }, 400);
        }

        const [price] = limitPrice === null
          ? [null]
          : Object.values(await getPrices([position.symbol], marketDataApiKey));
        const { data, error } = await admin.rpc('place_paper_sell_limit', {
          p_user_id: user.id,
          p_position_id: positionId,
          p_limit_price: limitPrice,
          p_current_price: price
        });
        if (error) return jsonResponse({ error: error.message }, error.code === 'P0002' ? 404 : 400);
        return jsonResponse({ order: data });
      }

      const [price] = Object.values(await getPrices([position.symbol], marketDataApiKey));
      const takeProfit = parseOptionalPrice(body.take_profit);
      const stopLoss = parseOptionalPrice(body.stop_loss);
      if (takeProfit === undefined || stopLoss === undefined) {
        return jsonResponse({ error: 'Saisis un prix de take profit ou stop loss valide en USD.' }, 400);
      }
      const { data, error } = await admin.rpc('set_paper_position_brackets', {
        p_user_id: user.id,
        p_position_id: positionId,
        p_take_profit: takeProfit,
        p_stop_loss: stopLoss,
        p_current_price: price
      });
      if (error) return jsonResponse({ error: error.message }, error.code === 'P0002' ? 404 : 400);
      return jsonResponse({ order: data });
    }

    if (action === 'sell') {
      const positionId = body.position_id;
      if (!isPositionId(positionId)) {
        return jsonResponse({ error: 'Choose an open position to close.' }, 400);
      }

      const { data: position, error: positionError } = await admin
        .from('paper_positions')
        .select('symbol')
        .eq('id', positionId)
        .eq('user_id', user.id)
        .eq('status', 'open')
        .maybeSingle();
      if (positionError) return jsonResponse({ error: 'Unable to load that position.' }, 500);
      if (!position) return jsonResponse({ error: 'That open position was not found.' }, 404);

      const [price] = Object.values(await getPrices([position.symbol], marketDataApiKey));
      const { data, error } = await admin.rpc('close_paper_position', {
        p_user_id: user.id,
        p_position_id: positionId,
        p_price: price
      });
      if (error) return jsonResponse({ error: error.message }, 400);
      return jsonResponse({ order: data });
    }

    return jsonResponse({ error: 'Choose a buy or sell action.' }, 400);
  } catch (error) {
    console.error('Paper trade failed:', error);
    const message = error instanceof Error ? error.message : 'The paper trade could not be completed.';
    return jsonResponse({ error: message }, 502);
  }
});
