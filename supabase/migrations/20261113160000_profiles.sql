create table if not exists public.profiles (
    id uuid primary key references auth.users(id) on delete cascade,
    username text,
    avatar_path text,
    updated_at timestamptz not null default now(),
    constraint profiles_username_length check (
        username is null or (
            char_length(username) between 3 and 24
            and username ~ '^[A-Za-z0-9_]+$'
        )
    ),
    constraint profiles_avatar_path_owner check (
        avatar_path is null or avatar_path = id::text || '/avatar'
    )
);

create unique index if not exists profiles_username_lower_unique
    on public.profiles (lower(username))
    where username is not null;

alter table public.profiles enable row level security;

drop policy if exists "Users can read their own profile" on public.profiles;
create policy "Users can read their own profile"
    on public.profiles for select to authenticated
    using ((select auth.uid()) = id);

drop policy if exists "Users can create their own profile" on public.profiles;
create policy "Users can create their own profile"
    on public.profiles for insert to authenticated
    with check ((select auth.uid()) = id);

drop policy if exists "Users can update their own profile" on public.profiles;
create policy "Users can update their own profile"
    on public.profiles for update to authenticated
    using ((select auth.uid()) = id)
    with check ((select auth.uid()) = id);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
    'avatars',
    'avatars',
    true,
    5242880,
    array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Users can read their own avatar object" on storage.objects;
create policy "Users can read their own avatar object"
    on storage.objects for select to authenticated
    using (
        bucket_id = 'avatars'
        and (storage.foldername(name))[1] = (select auth.uid()::text)
    );

drop policy if exists "Users can upload their own avatar" on storage.objects;
create policy "Users can upload their own avatar"
    on storage.objects for insert to authenticated
    with check (
        bucket_id = 'avatars'
        and (storage.foldername(name))[1] = (select auth.uid()::text)
    );

drop policy if exists "Users can update their own avatar" on storage.objects;
create policy "Users can update their own avatar"
    on storage.objects for update to authenticated
    using (
        bucket_id = 'avatars'
        and (storage.foldername(name))[1] = (select auth.uid()::text)
    )
    with check (
        bucket_id = 'avatars'
        and (storage.foldername(name))[1] = (select auth.uid()::text)
    );
