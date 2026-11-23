# Super Water: React + .NET + SQL Server

This is the Super Water website rebuilt on a new stack. It looks and works the same as the original Node/Postgres version:

| Part | Original | New |
|---|---|---|
| Website, order page, admin | Plain HTML + JavaScript (`public/`) | React 18 + the same CSS (`frontend/`) |
| Server | Node functions on Vercel (`api/`, `lib/`) | ASP.NET Core 9 (`backend/SuperWater.Api/`) |
| Database | PostgreSQL | Microsoft SQL Server 2017+ |

The API addresses and replies are unchanged (`/api/site`, `/api/admin`, `/api/payment`, `/api/facility`). The facility's own software and the payment gateways keep working without changes. Password hashes use the same scrypt format as before, so existing accounts can be copied across.

The original code (`public/`, `api/`, `lib/`, `db/`, `scripts/`) is still in the folder for reference. The new version does not use it.

---

## 1. Run it on your computer

You need the **.NET 9 SDK**, **Node.js 20+** and **SQL Server** (Express is fine).

**1. Server settings.** Open `backend/SuperWater.Api/appsettings.Development.json` and check the connection string:

```json
"ConnectionStrings": { "SuperWater": "Server=.\\SQLEXPRESS;Database=SuperWater;Trusted_Connection=True;TrustServerCertificate=True" }
```

The database, its tables, the six products and the first admin account are created automatically on the first request. The admin account uses `ADMIN_EMAIL` and `ADMIN_PASSWORD` from the same file. Change that password after you sign in.

**2. Start the server:**

```bash
cd backend/SuperWater.Api
dotnet run
```

The API runs at http://localhost:5080.

**3. Start the website** in a second terminal:

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173 for the website and http://localhost:5173/admin for the admin. The dev server forwards `/api` to port 5080.

## 2. Put it on a server

1. **Build the website.** This writes the finished site into the server's `wwwroot` folder:
   ```bash
   cd frontend
   npm run build
   ```
2. **Publish the server:**
   ```bash
   cd backend/SuperWater.Api
   dotnet publish -c Release -o ../../publish
   ```
3. Copy `publish/` to the server and host it with IIS, a Windows service, Linux with systemd + nginx, or Azure App Service. One app serves both the website and the API.
4. **Settings.** Put these in `appsettings.json` next to the app, or set them as environment variables (use `ConnectionStrings__SuperWater` for the connection string):

   | Name | Value |
   |---|---|
   | `ConnectionStrings:SuperWater` | SQL Server connection string |
   | `SESSION_SECRET` | Random text, 32+ characters |
   | `ADMIN_EMAIL` / `ADMIN_PASSWORD` | First admin account (password 10+ characters). You can remove them after the first sign-in. |
   | `FACILITY_API_KEY` | Random text, 24+ characters (only if the facility's software will connect) |
   | `SITE_URL` | Optional. The public address, for example `https://superwater.com.bd`, if the server sits behind a proxy |
   | `SSLCOMMERZ_STORE_ID`, `SSLCOMMERZ_STORE_PASSWORD`, `SSLCOMMERZ_LIVE` | SSLCommerz. Without `SSLCOMMERZ_LIVE=true` the sandbox is used. |
   | `BKASH_USERNAME`, `BKASH_PASSWORD`, `BKASH_APP_KEY`, `BKASH_APP_SECRET`, `BKASH_BASE_URL` | bKash. Without `BKASH_BASE_URL` the sandbox is used. |

   The SQL login needs permission to create tables. It also needs permission to create the database, unless the database already exists.

5. Use HTTPS in production. Sign-in cookies are marked `Secure` when the app runs in the Production environment.

The admin panel sections, stock rules and payment flow are the same as in the original `README.md` (sections 2–4).

## 3. Where things are

```
shared/cms-defaults.json      built-in text for every editable field (used by both the website and the server)
frontend/
  index.html, order.html, 404.html, admin/index.html   page shells (title, meta tags)
  public/assets/              images and fonts (unchanged)
  src/site/                   the website: SiteApp.jsx, site.css (same CSS as before)
  src/order/                  the customer's order status page
  src/admin/                  the admin panel: AdminApp.jsx, sections.jsx, admin.css
backend/SuperWater.Api/
  Program.cs                  routes, static files, clean URLs, security headers
  Endpoints/                  Site, Admin, Payment, Facility (one per original api/*.js)
  Services/                   Orders, Inventory, Content + CmsSchema, Auth, Scrypt, Seed
  Payments/                   SSLCommerz, bKash, TemplateGateway (for adding Nagad, etc.)
  Database/schema.sql         SQL Server tables (runs automatically, safe to run again)
```

**Adding an editable text field:**
1. Add the key and its text to `shared/cms-defaults.json`.
2. Add the field to `Services/Content.cs` → `CmsSchema.Groups`.
3. Show it on the page with `{t('your.key')}` in `SiteApp.jsx`.

**Adding a payment gateway:** copy `Payments/TemplateGateway.cs`, fill in its methods, and register it in `Program.cs`.

## 4. Checks

The original automated tests run unchanged against the new server:

```bash
# with the server running on port 5080
BASE=http://localhost:5080 ADMIN_EMAIL=… ADMIN_PASSWORD=… FACILITY_API_KEY=… node scripts/smoke-test.js
```

`scripts/payment-test/` (fake SSLCommerz and bKash) also works. Start the .NET server on port 3123 with the variables listed in that folder's README.

## 5. Moving data from the old Postgres database

The tables and columns have the same names. To copy them across:

- Export each table from Postgres as CSV and import it into SQL Server, in this order: `users`, `products`, `stock`, `content`, `orders`, `stock_movements`, `payment_events`, `app_state`.
- `content.value`, `orders.items`, `payment_events.payload` and `app_state.value` are JSON. Copy them as text.
- For tables with an `id` column, run `SET IDENTITY_INSERT dbo.<table> ON` before the import.
- Password hashes copy across as they are, so everyone keeps their password.
