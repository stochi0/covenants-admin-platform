# Covenants Admin Platform

Admin console for managing Covenants marketplace data.

## Local Setup

Create `.env` in this directory:

```bash
VITE_SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
VITE_CLERK_PUBLISHABLE_KEY=...
AUTHORIZED_PARTIES=http://localhost:5173,https://admin.covenantspc.com
CLERK_WEBHOOK_SECRET=...
```

Run the app and API together:

```bash
npm install
npm run dev
```

## Clerk Auth

This app uses the same Clerk production instance and `public.users` table as the main Covenants platform. Signed-in users are synced to `public.users` through `/api/users/sync` with `role = 'viewer'` by default. The admin console is available only when the synced row has `role = 'admin'`.

Promote an admin manually in Supabase:

```sql
update public.users
set role = 'admin'
where email = 'admin@example.com';
```

Configure the Clerk webhook endpoint:

```bash
https://admin.covenantspc.com/api/clerk/webhook
```

Subscribe it to `user.created`, `user.updated`, and `user.deleted`.

## Production Setup

The production admin hostname is:

```bash
https://admin.covenantspc.com
```

In Vercel, add `admin.covenantspc.com` to the admin project and set:

```bash
VITE_SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
VITE_CLERK_PUBLISHABLE_KEY=...
AUTHORIZED_PARTIES=https://admin.covenantspc.com
CLERK_WEBHOOK_SECRET=...
```

In GoDaddy DNS for `covenantspc.com`, add the Vercel-provided subdomain target:

```text
Type: CNAME
Name: admin
Value: the exact target Vercel shows, usually cname.vercel-dns.com
TTL: default or 1 hour
```

Do not change the apex `@` record unless the root domain should move to Vercel. Do not disturb existing records for `capillia.covenantspc.com`.

In Clerk, add `https://admin.covenantspc.com` anywhere the shared production instance requires allowed origins, redirect URLs, or application URLs. If Clerk asks for DNS records for the production domain, add exactly the generated records in GoDaddy and wait for propagation.

## Verification

```bash
npm run build
```

Manual checks:

- Signed-out users see the login screen.
- Signed-in non-admin users see "Admin role required".
- Signed-in admins can load schema, records, options, imports, and facility relations.
- `https://admin.covenantspc.com/api/health` returns `{ "ok": true }`.
- Clerk webhook delivery succeeds from the Clerk Dashboard.
