# Azure production handoff

The application is prepared for a split Azure deployment. Deploy only after the
final product and billing configuration are approved.

## Recommended resources

1. Azure Static Web Apps for `frontend`.
2. Linux Azure App Service (Basic B1 or higher) for `backend`.
3. Azure Database for PostgreSQL Flexible Server in the same region as App Service.
4. Application Insights for backend failures and WebSocket health.

For Sri Lanka, benchmark South India, Central India, and Southeast Asia before
choosing the production region. Keep the API and database together.

## Backend App Service settings

Configure the startup command as `bash startup.sh`. Enable WebSockets, HTTPS
Only, Always On, health check path `/health`, and a 64-bit worker. Add these
application settings in App Service or Key Vault:

```text
APP_ENV=production
DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/DATABASE?sslmode=require
SECRET_KEY=<at-least-32-random-bytes>
ACCESS_TOKEN_EXPIRE_MINUTES=10080
CORS_ORIGINS=https://YOUR-FRONTEND.azurestaticapps.net,https://YOUR-DOMAIN
OPENAI_API_KEY=<secret>
PAYPAL_MODE=live
PAYPAL_CLIENT_ID=<secret>
PAYPAL_CLIENT_SECRET=<secret>
PAYPAL_WEBHOOK_ID=<secret>
PAYPAL_STARTER_PLAN_ID=<live-plan-id>
PAYPAL_PRO_PLAN_ID=<live-plan-id>
PAYPAL_ELITE_PLAN_ID=<live-plan-id>
WEB_CONCURRENCY=2
```

Never add production values to Git.

## Frontend Static Web Apps settings

Use `frontend` as the app location, `npm run build` as the build command, and
`frontend/dist` as the output. Add the values from
`frontend/.env.production.example` to the build environment. The API must use
`https://` and the WebSocket URL must use `wss://`.

`public/staticwebapp.config.json` supplies SPA routing, camera/microphone
permissions, security headers, and caching for hashed assets and model files.

## Release gate

Before production:

- replace automatic table creation with reviewed database migrations;
- configure the PayPal live webhook and verify webhook signatures;
- run Train, Practice, Analysis, registration, subscription, and admin tests;
- test Auto and Eco Studio modes on a low-powered laptop and Android phone;
- verify camera and microphone access on the final HTTPS domain;
- confirm WebSocket reconnection through `wss://`;
- enable database backups and App Service monitoring;
- load-test concurrent WebSocket sessions before increasing worker count.
