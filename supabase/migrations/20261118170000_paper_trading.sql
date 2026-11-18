create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault with schema vault;

create table if not exists public.paper_wallets (
    user_id uuid primary key references auth.users(id) on delete cascade,
    initial_balance numeric(18, 2) not null default 10000 check (initial_balance > 0),
    cash_balance numeric(18, 2) not null default 10000 check (cash_balance >= 0),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.paper_positions (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    symbol text not null check (symbol ~ '^[A-Z][A-Z0-9.-]{0,14}$'),
    quantity numeric(18, 6) not null check (quantity > 0),
    leverage numeric(4, 2) not null check (leverage between 1 and 10),
    entry_price numeric(18, 6) not null check (entry_price > 0),
    current_price numeric(18, 6) not null check (current_price > 0),
    margin_locked numeric(18, 2) not null check (margin_locked >= 0),
    status text not null default 'open' check (status in ('open', 'closed', 'liquidated')),
    realized_pnl numeric(18, 2),
    exit_price numeric(18, 6),
    opened_at timestamptz not null default now(),
    closed_at timestamptz
);

create index if not exists paper_positions_open_symbol_idx
    on public.paper_positions (symbol)
    where status = 'open';
create index if not exists paper_positions_user_opened_idx
    on public.paper_positions (user_id, opened_at desc);

create table if not exists public.paper_trades (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    position_id uuid not null references public.paper_positions(id) on delete cascade,
    symbol text not null,
    action text not null check (action in ('buy', 'sell', 'liquidation')),
    quantity numeric(18, 6) not null,
    leverage numeric(4, 2) not null,
    price numeric(18, 6) not null,
    realized_pnl numeric(18, 2),
    created_at timestamptz not null default now()
);

create index if not exists paper_trades_user_created_idx
    on public.paper_trades (user_id, created_at desc);

create table if not exists public.paper_equity_snapshots (
    user_id uuid not null references auth.users(id) on delete cascade,
    snapshot_hour timestamptz not null,
    equity numeric(18, 2) not null,
    captured_at timestamptz not null default now(),
    primary key (user_id, snapshot_hour)
);

alter table public.paper_wallets enable row level security;
alter table public.paper_positions enable row level security;
alter table public.paper_trades enable row level security;
alter table public.paper_equity_snapshots enable row level security;

revoke all on public.paper_wallets, public.paper_positions,
    public.paper_trades, public.paper_equity_snapshots from anon, authenticated;
grant select on public.paper_wallets, public.paper_positions,
    public.paper_trades, public.paper_equity_snapshots to authenticated;
grant all on public.paper_wallets, public.paper_positions,
    public.paper_trades, public.paper_equity_snapshots to service_role;

drop policy if exists "Users can read their own paper wallet" on public.paper_wallets;
create policy "Users can read their own paper wallet"
    on public.paper_wallets for select to authenticated
    using ((select auth.uid()) = user_id);

drop policy if exists "Users can read their own paper positions" on public.paper_positions;
create policy "Users can read their own paper positions"
    on public.paper_positions for select to authenticated
    using ((select auth.uid()) = user_id);

drop policy if exists "Users can read their own paper trades" on public.paper_trades;
create policy "Users can read their own paper trades"
    on public.paper_trades for select to authenticated
    using ((select auth.uid()) = user_id);

drop policy if exists "Users can read their own equity snapshots" on public.paper_equity_snapshots;
create policy "Users can read their own equity snapshots"
    on public.paper_equity_snapshots for select to authenticated
    using ((select auth.uid()) = user_id);

create or replace function public.create_paper_wallet_for_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    insert into public.paper_wallets (user_id)
    values (new.id)
    on conflict (user_id) do nothing;
    return new;
end;
$$;

drop trigger if exists create_paper_wallet_after_signup on auth.users;
create trigger create_paper_wallet_after_signup
    after insert on auth.users
    for each row execute function public.create_paper_wallet_for_user();

insert into public.paper_wallets (user_id)
select id from auth.users
on conflict (user_id) do nothing;

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
        + coalesce(sum(margin_locked + quantity * (current_price - entry_price)), 0),
        2
    )
    into current_equity
    from public.paper_positions
    where user_id = current_user_id and status = 'open';

    select coalesce(jsonb_agg(to_jsonb(position_row) order by opened_at desc), '[]'::jsonb)
    into open_positions
    from (
        select id, symbol, quantity, leverage, entry_price, current_price,
               margin_locked, opened_at,
               round(quantity * (current_price - entry_price), 2) as unrealized_pnl,
               round(entry_price * greatest(0, 1 - 1 / leverage), 6) as liquidation_price
        from public.paper_positions
        where user_id = current_user_id and status = 'open'
    ) as position_row;

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
        'trades', trade_history
    );
end;
$$;

create or replace function public.open_paper_position(
    p_user_id uuid,
    p_symbol text,
    p_quantity numeric,
    p_leverage numeric,
    p_price numeric
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
       or p_price is null or p_price <= 0 or p_price > 1000000 then
        raise exception 'Invalid paper order' using errcode = '22023';
    end if;

    p_quantity := round(p_quantity, 6);
    p_price := round(p_price, 6);
    p_leverage := round(p_leverage, 2);

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
        user_id, symbol, quantity, leverage, entry_price, current_price, margin_locked
    )
    values (
        p_user_id, p_symbol, p_quantity, p_leverage, p_price, p_price, required_margin
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
        'margin', required_margin
    );
end;
$$;

create or replace function public.close_paper_position(
    p_user_id uuid,
    p_position_id uuid,
    p_price numeric
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    position_row public.paper_positions%rowtype;
    exit_price numeric(18, 6);
    liquidation_price numeric(18, 6);
    realized_pnl numeric(18, 2);
    cash_return numeric(18, 2);
    close_status text;
    trade_action text;
begin
    if p_user_id is null or p_position_id is null
       or p_price is null or p_price <= 0 or p_price > 1000000 then
        raise exception 'Invalid close order' using errcode = '22023';
    end if;

    p_price := round(p_price, 6);

    select * into position_row
    from public.paper_positions
    where id = p_position_id and user_id = p_user_id and status = 'open'
    for update;

    if not found then
        raise exception 'Open position not found' using errcode = 'P0002';
    end if;

    liquidation_price := round(
        position_row.entry_price * greatest(0, 1 - 1 / position_row.leverage),
        6
    );
    if position_row.leverage > 1 and p_price <= liquidation_price then
        exit_price := liquidation_price;
        close_status := 'liquidated';
        trade_action := 'liquidation';
    else
        exit_price := p_price;
        close_status := 'closed';
        trade_action := 'sell';
    end if;

    realized_pnl := round(position_row.quantity * (exit_price - position_row.entry_price), 2);
    cash_return := greatest(0, position_row.margin_locked + realized_pnl);

    update public.paper_wallets
    set cash_balance = cash_balance + cash_return,
        updated_at = now()
    where user_id = p_user_id;

    update public.paper_positions
    set status = close_status,
        current_price = exit_price,
        exit_price = exit_price,
        realized_pnl = realized_pnl,
        closed_at = now()
    where id = p_position_id;

    insert into public.paper_trades (
        user_id, position_id, symbol, action, quantity, leverage, price, realized_pnl
    )
    values (
        p_user_id, p_position_id, position_row.symbol, trade_action,
        position_row.quantity, position_row.leverage, exit_price, realized_pnl
    );

    return jsonb_build_object(
        'position_id', p_position_id,
        'status', close_status,
        'price', exit_price,
        'realized_pnl', realized_pnl,
        'cash_return', cash_return
    );
end;
$$;

create or replace function public.refresh_paper_market(p_prices jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
    position_row public.paper_positions%rowtype;
    market_price numeric(18, 6);
    liquidation_price numeric(18, 6);
    realized_pnl numeric(18, 2);
    cash_return numeric(18, 2);
    updated_count integer := 0;
begin
    if p_prices is null or jsonb_typeof(p_prices) <> 'object' then
        raise exception 'Price data must be an object' using errcode = '22023';
    end if;

    for position_row in
        select * from public.paper_positions
        where status = 'open'
        order by user_id, id
        for update
    loop
        if not (p_prices ? position_row.symbol) then
            continue;
        end if;

        begin
            market_price := (p_prices ->> position_row.symbol)::numeric;
        exception when invalid_text_representation then
            raise exception 'Invalid market price for %', position_row.symbol
                using errcode = '22023';
        end;

        if market_price is null or market_price <= 0 or market_price > 1000000 then
            raise exception 'Invalid market price for %', position_row.symbol
                using errcode = '22023';
        end if;
        market_price := round(market_price, 6);

        liquidation_price := round(
            position_row.entry_price * greatest(0, 1 - 1 / position_row.leverage),
            6
        );

        if position_row.leverage > 1 and market_price <= liquidation_price then
            realized_pnl := round(
                position_row.quantity * (liquidation_price - position_row.entry_price),
                2
            );
            cash_return := greatest(0, position_row.margin_locked + realized_pnl);

            update public.paper_wallets
            set cash_balance = cash_balance + cash_return,
                updated_at = now()
            where user_id = position_row.user_id;

            update public.paper_positions
            set status = 'liquidated',
                current_price = liquidation_price,
                exit_price = liquidation_price,
                realized_pnl = realized_pnl,
                closed_at = now()
            where id = position_row.id;

            insert into public.paper_trades (
                user_id, position_id, symbol, action, quantity, leverage, price, realized_pnl
            )
            values (
                position_row.user_id, position_row.id, position_row.symbol, 'liquidation',
                position_row.quantity, position_row.leverage, liquidation_price, realized_pnl
            );
        else
            update public.paper_positions
            set current_price = market_price
            where id = position_row.id;
        end if;

        updated_count := updated_count + 1;
    end loop;

    insert into public.paper_equity_snapshots (user_id, snapshot_hour, equity)
    select wallet.user_id,
           date_trunc('hour', now()),
           round(
               wallet.cash_balance
               + coalesce(sum(position.margin_locked
                   + position.quantity * (position.current_price - position.entry_price)), 0),
               2
           )
    from public.paper_wallets as wallet
    left join public.paper_positions as position
      on position.user_id = wallet.user_id and position.status = 'open'
    group by wallet.user_id, wallet.cash_balance
    on conflict (user_id, snapshot_hour)
    do update set equity = excluded.equity, captured_at = now();

    return updated_count;
end;
$$;

create or replace function public.get_paper_leaderboard(p_period text)
returns table (
    rank_number bigint,
    username text,
    pnl numeric,
    return_percent numeric,
    updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
    lookback interval;
begin
    if p_period = 'week' then
        lookback := interval '7 days';
    elsif p_period = 'month' then
        lookback := interval '30 days';
    else
        raise exception 'Period must be week or month' using errcode = '22023';
    end if;

    return query
    with account_values as (
        select wallet.user_id,
               coalesce(latest.equity, wallet.initial_balance) as current_equity,
               coalesce(baseline.equity, wallet.initial_balance) as starting_equity,
               latest.captured_at as last_updated,
               coalesce(profile.username, 'Trader-' || left(wallet.user_id::text, 6)) as display_name
        from public.paper_wallets as wallet
        left join lateral (
            select snapshot.equity, snapshot.captured_at
            from public.paper_equity_snapshots as snapshot
            where snapshot.user_id = wallet.user_id
            order by snapshot.snapshot_hour desc
            limit 1
        ) as latest on true
        left join lateral (
            select snapshot.equity
            from public.paper_equity_snapshots as snapshot
            where snapshot.user_id = wallet.user_id
              and snapshot.snapshot_hour <= now() - lookback
            order by snapshot.snapshot_hour desc
            limit 1
        ) as baseline on true
        left join public.profiles as profile on profile.id = wallet.user_id
        where exists (
            select 1 from public.paper_trades as trade
            where trade.user_id = wallet.user_id
        )
    ),
    ranked as (
        select display_name,
               round(current_equity - starting_equity, 2) as account_pnl,
               round((current_equity - starting_equity) / nullif(starting_equity, 0) * 100, 2) as account_return,
               last_updated
        from account_values
    )
    select row_number() over (order by ranked.account_pnl desc, ranked.display_name),
           ranked.display_name,
           ranked.account_pnl,
           ranked.account_return,
           ranked.last_updated
    from ranked
    order by ranked.account_pnl desc, ranked.display_name
    limit 100;
end;
$$;

revoke all on function public.create_paper_wallet_for_user() from public, anon, authenticated;
revoke all on function public.get_paper_portfolio() from public, anon;
revoke all on function public.open_paper_position(uuid, text, numeric, numeric, numeric) from public, anon, authenticated;
revoke all on function public.close_paper_position(uuid, uuid, numeric) from public, anon, authenticated;
revoke all on function public.refresh_paper_market(jsonb) from public, anon, authenticated;
revoke all on function public.get_paper_leaderboard(text) from public;

grant execute on function public.get_paper_portfolio() to authenticated;
grant execute on function public.open_paper_position(uuid, text, numeric, numeric, numeric) to service_role;
grant execute on function public.close_paper_position(uuid, uuid, numeric) to service_role;
grant execute on function public.refresh_paper_market(jsonb) to service_role;
grant execute on function public.get_paper_leaderboard(text) to anon, authenticated;

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

    select jobid into existing_job_id
    from cron.job
    where jobname = 'hourly-paper-market-refresh';

    if existing_job_id is not null then
        perform cron.unschedule(existing_job_id);
    end if;

    perform cron.schedule(
        'hourly-paper-market-refresh',
        '0 * * * *',
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

revoke all on function public.schedule_hourly_paper_market_refresh() from public, anon, authenticated;

do $$
begin
    if exists (
        select 1 from vault.secrets where name = 'paper_trading_cron_secret'
    ) then
        perform public.schedule_hourly_paper_market_refresh();
    else
        raise notice 'Hourly refresh not scheduled. Configure the paper trading cron secret and call public.schedule_hourly_paper_market_refresh().';
    end if;
end;
$$;
