alter table public.paper_positions
    add column if not exists take_profit_price numeric(18, 6)
        check (take_profit_price is null or take_profit_price > 0),
    add column if not exists stop_loss_price numeric(18, 6)
        check (stop_loss_price is null or stop_loss_price > 0),
    add column if not exists limit_exit_price numeric(18, 6)
        check (limit_exit_price is null or limit_exit_price > 0);

create table if not exists public.paper_limit_orders (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    symbol text not null check (symbol ~ '^[A-Z][A-Z0-9.-]{0,14}$'),
    quantity numeric(18, 6) not null check (quantity > 0),
    leverage numeric(4, 2) not null check (leverage between 1 and 10),
    limit_price numeric(18, 6) not null check (limit_price > 0),
    take_profit_price numeric(18, 6) check (take_profit_price is null or take_profit_price > 0),
    stop_loss_price numeric(18, 6) check (stop_loss_price is null or stop_loss_price > 0),
    reserved_margin numeric(18, 2) not null check (reserved_margin >= 0),
    status text not null default 'pending' check (status in ('pending', 'filled', 'cancelled')),
    created_at timestamptz not null default now(),
    filled_at timestamptz,
    cancelled_at timestamptz
);

create index if not exists paper_limit_orders_pending_symbol_idx
    on public.paper_limit_orders (symbol)
    where status = 'pending';
create index if not exists paper_limit_orders_user_created_idx
    on public.paper_limit_orders (user_id, created_at desc);

alter table public.paper_limit_orders enable row level security;
revoke all on public.paper_limit_orders from anon, authenticated;
grant select on public.paper_limit_orders to authenticated;
grant all on public.paper_limit_orders to service_role;

drop policy if exists "Users can read their own paper limit orders" on public.paper_limit_orders;
create policy "Users can read their own paper limit orders"
    on public.paper_limit_orders for select to authenticated
    using ((select auth.uid()) = user_id);

create or replace function public.open_paper_position_with_brackets(
    p_user_id uuid,
    p_symbol text,
    p_quantity numeric,
    p_leverage numeric,
    p_price numeric,
    p_take_profit numeric,
    p_stop_loss numeric
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    wallet_row public.paper_wallets%rowtype;
    position_id uuid;
    required_margin numeric;
begin
    if p_user_id is null
       or p_symbol is null
       or p_symbol !~ '^[A-Z][A-Z0-9.-]{0,14}$'
       or p_quantity is null or p_quantity <= 0 or p_quantity > 1000000
       or p_leverage is null or p_leverage < 1 or p_leverage > 10
       or p_price is null or p_price <= 0 or p_price > 1000000
       or (p_take_profit is not null and p_take_profit <= p_price)
       or (p_stop_loss is not null and p_stop_loss >= p_price) then
        raise exception 'Invalid paper order or exit levels' using errcode = '22023';
    end if;

    p_quantity := round(p_quantity, 6);
    p_price := round(p_price, 6);
    p_leverage := round(p_leverage, 2);
    p_take_profit := round(p_take_profit, 6);
    p_stop_loss := round(p_stop_loss, 6);

    insert into public.paper_wallets (user_id)
    values (p_user_id)
    on conflict (user_id) do nothing;

    select * into wallet_row
    from public.paper_wallets
    where user_id = p_user_id
    for update;

    required_margin := round(p_quantity * p_price / p_leverage, 2);
    if required_margin < 0.01 then
        raise exception 'Position margin must be at least one cent' using errcode = '22023';
    end if;
    if wallet_row.cash_balance < required_margin then
        raise exception 'Insufficient virtual cash' using errcode = '23514';
    end if;

    insert into public.paper_positions (
        user_id, symbol, quantity, leverage, entry_price, current_price,
        margin_locked, take_profit_price, stop_loss_price
    )
    values (
        p_user_id, p_symbol, p_quantity, p_leverage, p_price, p_price,
        required_margin, p_take_profit, p_stop_loss
    )
    returning id into position_id;

    update public.paper_wallets
    set cash_balance = cash_balance - required_margin,
        updated_at = now()
    where user_id = p_user_id;

    insert into public.paper_trades (
        user_id, position_id, symbol, action, quantity, leverage, price
    )
    values (p_user_id, position_id, p_symbol, 'buy', p_quantity, p_leverage, p_price);

    return jsonb_build_object(
        'position_id', position_id,
        'symbol', p_symbol,
        'quantity', p_quantity,
        'leverage', p_leverage,
        'price', p_price,
        'margin', required_margin,
        'take_profit_price', p_take_profit,
        'stop_loss_price', p_stop_loss
    );
end;
$$;

create or replace function public.place_paper_buy_limit(
    p_user_id uuid,
    p_symbol text,
    p_quantity numeric,
    p_leverage numeric,
    p_limit_price numeric,
    p_take_profit numeric,
    p_stop_loss numeric,
    p_current_price numeric
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    wallet_row public.paper_wallets%rowtype;
    order_id uuid;
    reserved_amount numeric;
    reference_price numeric;
    position_order jsonb;
begin
    if p_user_id is null
       or p_symbol is null
       or p_symbol !~ '^[A-Z][A-Z0-9.-]{0,14}$'
       or p_quantity is null or p_quantity <= 0 or p_quantity > 1000000
       or p_leverage is null or p_leverage < 1 or p_leverage > 10
       or p_limit_price is null or p_limit_price <= 0 or p_limit_price > 1000000
       or p_current_price is null or p_current_price <= 0 or p_current_price > 1000000 then
        raise exception 'Invalid paper buy limit' using errcode = '22023';
    end if;

    reference_price := least(p_limit_price, p_current_price);
    if (p_take_profit is not null and p_take_profit <= reference_price)
       or (p_stop_loss is not null and p_stop_loss >= reference_price) then
        raise exception 'Le take profit doit être au-dessus et le stop loss en dessous du prix d’entrée prévu'
            using errcode = '22023';
    end if;

    if p_current_price <= p_limit_price then
        position_order := public.open_paper_position_with_brackets(
            p_user_id, p_symbol, p_quantity, p_leverage, p_current_price,
            p_take_profit, p_stop_loss
        );
        return position_order || jsonb_build_object('status', 'filled');
    end if;

    p_quantity := round(p_quantity, 6);
    p_leverage := round(p_leverage, 2);
    p_limit_price := round(p_limit_price, 6);
    p_take_profit := round(p_take_profit, 6);
    p_stop_loss := round(p_stop_loss, 6);
    reserved_amount := round(p_quantity * p_limit_price / p_leverage, 2);
    if reserved_amount < 0.01 then
        raise exception 'Position margin must be at least one cent' using errcode = '22023';
    end if;

    insert into public.paper_wallets (user_id)
    values (p_user_id)
    on conflict (user_id) do nothing;

    select * into wallet_row
    from public.paper_wallets
    where user_id = p_user_id
    for update;

    if wallet_row.cash_balance < reserved_amount then
        raise exception 'Insufficient virtual cash' using errcode = '23514';
    end if;

    insert into public.paper_limit_orders (
        user_id, symbol, quantity, leverage, limit_price,
        take_profit_price, stop_loss_price, reserved_margin
    )
    values (
        p_user_id, p_symbol, p_quantity, p_leverage, p_limit_price,
        p_take_profit, p_stop_loss, reserved_amount
    )
    returning id into order_id;

    update public.paper_wallets
    set cash_balance = cash_balance - reserved_amount,
        updated_at = now()
    where user_id = p_user_id;

    return jsonb_build_object(
        'order_id', order_id,
        'status', 'pending',
        'symbol', p_symbol,
        'quantity', p_quantity,
        'limit_price', p_limit_price,
        'reserved_margin', reserved_amount,
        'take_profit_price', p_take_profit,
        'stop_loss_price', p_stop_loss
    );
end;
$$;

create or replace function public.cancel_paper_limit_order(
    p_user_id uuid,
    p_order_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    order_row public.paper_limit_orders%rowtype;
begin
    select * into order_row
    from public.paper_limit_orders
    where id = p_order_id and user_id = p_user_id and status = 'pending'
    for update;

    if not found then
        raise exception 'Pending limit order not found' using errcode = 'P0002';
    end if;

    update public.paper_wallets
    set cash_balance = cash_balance + order_row.reserved_margin,
        updated_at = now()
    where user_id = p_user_id;

    update public.paper_limit_orders
    set status = 'cancelled', cancelled_at = now()
    where id = p_order_id;

    return jsonb_build_object('order_id', p_order_id, 'status', 'cancelled');
end;
$$;

create or replace function public.set_paper_position_brackets(
    p_user_id uuid,
    p_position_id uuid,
    p_take_profit numeric,
    p_stop_loss numeric,
    p_current_price numeric
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    position_row public.paper_positions%rowtype;
    closed_order jsonb;
begin
    if p_user_id is null or p_position_id is null
       or p_current_price is null or p_current_price <= 0 or p_current_price > 1000000 then
        raise exception 'Invalid position or market price' using errcode = '22023';
    end if;

    select * into position_row
    from public.paper_positions
    where id = p_position_id and user_id = p_user_id and status = 'open'
    for update;

    if not found then
        raise exception 'Open position not found' using errcode = 'P0002';
    end if;

    if (p_take_profit is not null and p_take_profit <= position_row.entry_price)
       or (p_stop_loss is not null and p_stop_loss >= position_row.entry_price) then
        raise exception 'Le take profit doit être au-dessus et le stop loss en dessous du prix d’entrée'
            using errcode = '22023';
    end if;

    if (p_take_profit is not null and p_current_price >= p_take_profit)
       or (p_stop_loss is not null and p_current_price <= p_stop_loss) then
        closed_order := public.close_paper_position(p_user_id, p_position_id, p_current_price);
        return closed_order || jsonb_build_object('brackets_triggered', true);
    end if;

    update public.paper_positions
    set take_profit_price = round(p_take_profit, 6),
        stop_loss_price = round(p_stop_loss, 6)
    where id = p_position_id;

    return jsonb_build_object(
        'position_id', p_position_id,
        'status', 'updated',
        'take_profit_price', p_take_profit,
        'stop_loss_price', p_stop_loss
    );
end;
$$;

create or replace function public.place_paper_sell_limit(
    p_user_id uuid,
    p_position_id uuid,
    p_limit_price numeric,
    p_current_price numeric
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    position_row public.paper_positions%rowtype;
    closed_order jsonb;
begin
    if (p_limit_price is not null and (p_limit_price <= 0 or p_limit_price > 1000000))
       or (p_limit_price is not null and (
           p_current_price is null or p_current_price <= 0 or p_current_price > 1000000
       )) then
        raise exception 'Invalid sell limit or market price' using errcode = '22023';
    end if;

    select * into position_row
    from public.paper_positions
    where id = p_position_id and user_id = p_user_id and status = 'open'
    for update;

    if not found then
        raise exception 'Open position not found' using errcode = 'P0002';
    end if;

    if p_limit_price is null then
        update public.paper_positions
        set limit_exit_price = null
        where id = p_position_id;
        return jsonb_build_object('position_id', p_position_id, 'status', 'cancelled');
    end if;

    if p_current_price >= p_limit_price then
        closed_order := public.close_paper_position(p_user_id, p_position_id, p_current_price);
        update public.paper_positions set limit_exit_price = null where id = p_position_id;
        return closed_order || jsonb_build_object('status', 'filled');
    end if;

    update public.paper_positions
    set limit_exit_price = round(p_limit_price, 6)
    where id = p_position_id;

    return jsonb_build_object(
        'position_id', p_position_id,
        'status', 'pending',
        'limit_exit_price', round(p_limit_price, 6)
    );
end;
$$;

create or replace function public.run_paper_market_cycle(p_prices jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    order_row public.paper_limit_orders%rowtype;
    position_row public.paper_positions%rowtype;
    market_price numeric(18, 6);
    filled_orders integer := 0;
    closed_positions integer := 0;
    required_margin numeric(18, 2);
    position_id uuid;
begin
    if p_prices is null or jsonb_typeof(p_prices) <> 'object' then
        raise exception 'Price data must be an object' using errcode = '22023';
    end if;

    for order_row in
        select * from public.paper_limit_orders
        where status = 'pending' and p_prices ? symbol
        order by created_at, id
        for update
    loop
        market_price := (p_prices ->> order_row.symbol)::numeric;
        if market_price is null or market_price <= 0 or market_price > 1000000 then
            raise exception 'Invalid market price for %', order_row.symbol
                using errcode = '22023';
        end if;
        market_price := round(market_price, 6);

        if market_price > order_row.limit_price then
            continue;
        end if;

        if order_row.stop_loss_price is not null
           and market_price <= order_row.stop_loss_price then
            update public.paper_wallets
            set cash_balance = cash_balance + order_row.reserved_margin,
                updated_at = now()
            where user_id = order_row.user_id;
            update public.paper_limit_orders
            set status = 'cancelled', cancelled_at = now()
            where id = order_row.id;
            continue;
        end if;

        required_margin := round(order_row.quantity * market_price / order_row.leverage, 2);
        if required_margin < 0.01 then
            update public.paper_wallets
            set cash_balance = cash_balance + order_row.reserved_margin,
                updated_at = now()
            where user_id = order_row.user_id;
            update public.paper_limit_orders
            set status = 'cancelled', cancelled_at = now()
            where id = order_row.id;
            continue;
        end if;

        insert into public.paper_positions (
            user_id, symbol, quantity, leverage, entry_price, current_price,
            margin_locked, take_profit_price, stop_loss_price
        )
        values (
            order_row.user_id, order_row.symbol, order_row.quantity, order_row.leverage,
            market_price, market_price, required_margin,
            order_row.take_profit_price, order_row.stop_loss_price
        )
        returning id into position_id;

        update public.paper_wallets
        set cash_balance = cash_balance + order_row.reserved_margin - required_margin,
            updated_at = now()
        where user_id = order_row.user_id;

        insert into public.paper_trades (
            user_id, position_id, symbol, action, quantity, leverage, price
        )
        values (
            order_row.user_id, position_id, order_row.symbol, 'buy',
            order_row.quantity, order_row.leverage, market_price
        );

        update public.paper_limit_orders
        set status = 'filled', filled_at = now()
        where id = order_row.id;
        filled_orders := filled_orders + 1;
    end loop;

    for position_row in
        select * from public.paper_positions
        where status = 'open' and p_prices ? symbol
        order by user_id, id
        for update
    loop
        market_price := round((p_prices ->> position_row.symbol)::numeric, 6);
        if position_row.leverage > 1
           and market_price <= round(
               position_row.entry_price * greatest(0, 1 - 1 / position_row.leverage),
               6
           ) then
            perform public.close_paper_position(
                position_row.user_id, position_row.id, market_price
            );
            closed_positions := closed_positions + 1;
        elsif (position_row.stop_loss_price is not null
               and market_price <= position_row.stop_loss_price)
           or (position_row.take_profit_price is not null
               and market_price >= position_row.take_profit_price)
           or (position_row.limit_exit_price is not null
               and market_price >= position_row.limit_exit_price) then
            perform public.close_paper_position(
                position_row.user_id, position_row.id, market_price
            );
            closed_positions := closed_positions + 1;
        end if;
    end loop;

    perform public.refresh_paper_market(p_prices);

    insert into public.paper_equity_snapshots (user_id, snapshot_hour, equity)
    select wallet.user_id,
           date_trunc('hour', now()),
           round(
               wallet.cash_balance
               + coalesce(sum(position.margin_locked
                   + position.quantity * (position.current_price - position.entry_price)), 0)
               + coalesce((
                   select sum(pending.reserved_margin)
                   from public.paper_limit_orders as pending
                   where pending.user_id = wallet.user_id and pending.status = 'pending'
               ), 0),
               2
           )
    from public.paper_wallets as wallet
    left join public.paper_positions as position
      on position.user_id = wallet.user_id and position.status = 'open'
    group by wallet.user_id, wallet.cash_balance
    on conflict (user_id, snapshot_hour)
    do update set equity = excluded.equity, captured_at = now();

    return jsonb_build_object(
        'filled_orders', filled_orders,
        'closed_positions', closed_positions
    );
end;
$$;

create or replace function public.get_paper_portfolio()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    current_user_id uuid := auth.uid();
    wallet_row public.paper_wallets%rowtype;
    open_positions jsonb;
    pending_orders jsonb;
    trade_history jsonb;
    current_equity numeric(18, 2);
begin
    if current_user_id is null then
        raise exception 'Authentication required' using errcode = '28000';
    end if;

    insert into public.paper_wallets (user_id)
    values (current_user_id)
    on conflict (user_id) do nothing;

    select * into wallet_row
    from public.paper_wallets
    where user_id = current_user_id;

    select round(
        wallet_row.cash_balance
        + coalesce(sum(margin_locked + quantity * (current_price - entry_price)), 0)
        + coalesce((
            select sum(pending.reserved_margin)
            from public.paper_limit_orders as pending
            where pending.user_id = current_user_id and pending.status = 'pending'
        ), 0),
        2
    )
    into current_equity
    from public.paper_positions
    where user_id = current_user_id and status = 'open';

    select coalesce(jsonb_agg(to_jsonb(position_row) order by opened_at desc), '[]'::jsonb)
    into open_positions
    from (
        select id, symbol, quantity, leverage, entry_price, current_price,
               margin_locked, take_profit_price, stop_loss_price, limit_exit_price, opened_at,
               round(quantity * (current_price - entry_price), 2) as unrealized_pnl,
               round(entry_price * greatest(0, 1 - 1 / leverage), 6) as liquidation_price
        from public.paper_positions
        where user_id = current_user_id and status = 'open'
    ) as position_row;

    select coalesce(jsonb_agg(to_jsonb(order_row) order by created_at), '[]'::jsonb)
    into pending_orders
    from (
        select id, symbol, quantity, leverage, limit_price,
               take_profit_price, stop_loss_price, reserved_margin, created_at
        from public.paper_limit_orders
        where user_id = current_user_id and status = 'pending'
        order by created_at
    ) as order_row;

    select coalesce(jsonb_agg(to_jsonb(trade_row) order by created_at desc), '[]'::jsonb)
    into trade_history
    from (
        select id, position_id, symbol, action, quantity, leverage, price,
               realized_pnl, created_at
        from public.paper_trades
        where user_id = current_user_id
        order by created_at desc
        limit 25
    ) as trade_row;

    return jsonb_build_object(
        'initial_balance', wallet_row.initial_balance,
        'cash_balance', wallet_row.cash_balance,
        'equity', current_equity,
        'last_snapshot_at', (
            select max(snapshot.captured_at)
            from public.paper_equity_snapshots as snapshot
            where snapshot.user_id = current_user_id
        ),
        'positions', open_positions,
        'pending_orders', pending_orders,
        'trades', trade_history
    );
end;
$$;

revoke all on function public.open_paper_position_with_brackets(uuid, text, numeric, numeric, numeric, numeric, numeric) from public, anon, authenticated;
revoke all on function public.place_paper_buy_limit(uuid, text, numeric, numeric, numeric, numeric, numeric, numeric) from public, anon, authenticated;
revoke all on function public.cancel_paper_limit_order(uuid, uuid) from public, anon, authenticated;
revoke all on function public.set_paper_position_brackets(uuid, uuid, numeric, numeric, numeric) from public, anon, authenticated;
revoke all on function public.place_paper_sell_limit(uuid, uuid, numeric, numeric) from public, anon, authenticated;
revoke all on function public.run_paper_market_cycle(jsonb) from public, anon, authenticated;
revoke all on function public.get_paper_portfolio() from public, anon;

grant execute on function public.open_paper_position_with_brackets(uuid, text, numeric, numeric, numeric, numeric, numeric) to service_role;
grant execute on function public.place_paper_buy_limit(uuid, text, numeric, numeric, numeric, numeric, numeric, numeric) to service_role;
grant execute on function public.cancel_paper_limit_order(uuid, uuid) to service_role;
grant execute on function public.set_paper_position_brackets(uuid, uuid, numeric, numeric, numeric) to service_role;
grant execute on function public.place_paper_sell_limit(uuid, uuid, numeric, numeric) to service_role;
grant execute on function public.run_paper_market_cycle(jsonb) to service_role;
grant execute on function public.get_paper_portfolio() to authenticated;

create or replace function public.schedule_hourly_paper_market_refresh()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    existing_job_id bigint;
begin
    if not exists (
        select 1 from vault.secrets where name = 'paper_trading_cron_secret'
    ) then
        raise exception 'Create the paper_trading_cron_secret in Supabase Vault first';
    end if;

    for existing_job_id in
        select jobid
        from cron.job
        where jobname in ('hourly-paper-market-refresh', 'minutely-paper-market-refresh')
    loop
        perform cron.unschedule(existing_job_id);
    end loop;

    perform cron.schedule(
        'minutely-paper-market-refresh',
        '* * * * *',
        $job$
        select net.http_post(
            url := 'https://bxayvygrogqaomlfhktq.supabase.co/functions/v1/refresh-paper-market',
            headers := jsonb_build_object(
                'Content-Type', 'application/json',
                'x-cron-secret', (
                    select decrypted_secret
                    from vault.decrypted_secrets
                    where name = 'paper_trading_cron_secret'
                )
            ),
            body := '{}'::jsonb,
            timeout_milliseconds := 120000
        );
        $job$
    );
end;
$$;

do $$
begin
    if exists (
        select 1 from vault.secrets where name = 'paper_trading_cron_secret'
    ) then
        perform public.schedule_hourly_paper_market_refresh();
    else
        raise notice 'Minutely refresh not scheduled. Configure the paper trading cron secret and call public.schedule_hourly_paper_market_refresh().';
    end if;
end;
$$;
