-- Super Water database schema (Microsoft SQL Server 2017+).
-- Safe to run more than once: every statement checks whether the object exists.
-- Batches are separated by lines containing only GO.

-- People who can sign in to /admin.
-- role 'admin'      = everything
-- role 'production' = inventory and production only (for facility staff)
IF OBJECT_ID(N'dbo.users', N'U') IS NULL
CREATE TABLE dbo.users (
  id            INT IDENTITY(1,1) NOT NULL CONSTRAINT pk_users PRIMARY KEY,
  email         NVARCHAR(254)  NOT NULL CONSTRAINT uq_users_email UNIQUE,
  name          NVARCHAR(200)  NOT NULL CONSTRAINT df_users_name DEFAULT N'',
  role          NVARCHAR(20)   NOT NULL CONSTRAINT ck_users_role CHECK (role IN (N'admin', N'production')),
  password_hash NVARCHAR(400)  NOT NULL,
  active        BIT            NOT NULL CONSTRAINT df_users_active DEFAULT 1,
  created_at    DATETIMEOFFSET NOT NULL CONSTRAINT df_users_created DEFAULT SYSDATETIMEOFFSET()
);
GO

IF OBJECT_ID(N'dbo.login_attempts', N'U') IS NULL
CREATE TABLE dbo.login_attempts (
  id  BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT pk_login_attempts PRIMARY KEY,
  ip  NVARCHAR(100)  NOT NULL,
  at  DATETIMEOFFSET NOT NULL CONSTRAINT df_login_attempts_at DEFAULT SYSDATETIMEOFFSET()
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'login_attempts_ip_at' AND object_id = OBJECT_ID(N'dbo.login_attempts'))
CREATE INDEX login_attempts_ip_at ON dbo.login_attempts (ip, at);
GO

-- Editable website text. One row per field; value is JSON so it can hold
-- text, numbers or true/false.
IF OBJECT_ID(N'dbo.content', N'U') IS NULL
CREATE TABLE dbo.content (
  [key]      NVARCHAR(200)  NOT NULL CONSTRAINT pk_content PRIMARY KEY,
  value      NVARCHAR(MAX)  NOT NULL CONSTRAINT ck_content_json CHECK (ISJSON(value) = 1 OR value IN (N'true', N'false') OR value LIKE N'"%' OR TRY_CONVERT(FLOAT, value) IS NOT NULL),
  updated_at DATETIMEOFFSET NOT NULL CONSTRAINT df_content_updated DEFAULT SYSDATETIMEOFFSET(),
  updated_by NVARCHAR(254)  NULL
);
GO

-- What the shop sells. Prices are whole Taka.
-- bottles = how many bottles of size_ml one unit of this product uses.
IF OBJECT_ID(N'dbo.products', N'U') IS NULL
CREATE TABLE dbo.products (
  sku     NVARCHAR(50)  NOT NULL CONSTRAINT pk_products PRIMARY KEY,
  name    NVARCHAR(200) NOT NULL,
  size_ml INT NOT NULL CONSTRAINT ck_products_size CHECK (size_ml IN (500, 2000)),
  bottles INT NOT NULL CONSTRAINT ck_products_bottles CHECK (bottles > 0),
  price   INT NOT NULL CONSTRAINT ck_products_price CHECK (price >= 0),
  was     INT NOT NULL CONSTRAINT ck_products_was CHECK (was >= 0),
  active  BIT NOT NULL CONSTRAINT df_products_active DEFAULT 1,
  sort    INT NOT NULL CONSTRAINT df_products_sort DEFAULT 0
);
GO

-- Stock held at the production facility, counted in bottles per size.
-- on_hand  = physically at the facility
-- reserved = promised to website orders that have not been dispatched yet
-- available to sell = on_hand - reserved
IF OBJECT_ID(N'dbo.stock', N'U') IS NULL
CREATE TABLE dbo.stock (
  size_ml       INT NOT NULL CONSTRAINT pk_stock PRIMARY KEY CONSTRAINT ck_stock_size CHECK (size_ml IN (500, 2000)),
  on_hand       INT NOT NULL CONSTRAINT df_stock_on_hand DEFAULT 0 CONSTRAINT ck_stock_on_hand CHECK (on_hand >= 0),
  reserved      INT NOT NULL CONSTRAINT df_stock_reserved DEFAULT 0 CONSTRAINT ck_stock_reserved CHECK (reserved >= 0),
  low_threshold INT NOT NULL CONSTRAINT df_stock_low DEFAULT 0,
  updated_at    DATETIMEOFFSET NOT NULL CONSTRAINT df_stock_updated DEFAULT SYSDATETIMEOFFSET()
);
GO

-- Every change to stock, so the numbers can always be explained.
IF OBJECT_ID(N'dbo.stock_movements', N'U') IS NULL
CREATE TABLE dbo.stock_movements (
  id              BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT pk_stock_movements PRIMARY KEY,
  size_ml         INT NOT NULL,
  on_hand_change  INT NOT NULL CONSTRAINT df_sm_on_hand DEFAULT 0,
  reserved_change INT NOT NULL CONSTRAINT df_sm_reserved DEFAULT 0,
  reason          NVARCHAR(40)   NOT NULL,  -- production, stocktake, adjustment, order_reserved, order_released, order_dispatched
  ref             NVARCHAR(100)  NULL,      -- batch number or order code
  note            NVARCHAR(1000) NULL,
  actor           NVARCHAR(254)  NULL,      -- who or what made the change
  created_at      DATETIMEOFFSET NOT NULL CONSTRAINT df_sm_created DEFAULT SYSDATETIMEOFFSET()
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'stock_movements_created' AND object_id = OBJECT_ID(N'dbo.stock_movements'))
CREATE INDEX stock_movements_created ON dbo.stock_movements (created_at DESC);
GO

IF OBJECT_ID(N'dbo.orders', N'U') IS NULL
CREATE TABLE dbo.orders (
  id              INT IDENTITY(1,1) NOT NULL CONSTRAINT pk_orders PRIMARY KEY,
  code            NVARCHAR(40)   NOT NULL CONSTRAINT uq_orders_code UNIQUE,  -- shown to the customer, e.g. SW-261121-4821
  public_token    NVARCHAR(64)   NOT NULL,                                   -- lets the customer view their own order page
  customer_name   NVARCHAR(200)  NOT NULL,
  phone           NVARCHAR(40)   NOT NULL,
  email           NVARCHAR(254)  NULL,
  address         NVARCHAR(600)  NOT NULL,
  city            NVARCHAR(200)  NOT NULL,
  note            NVARCHAR(MAX)  NULL,
  items           NVARCHAR(MAX)  NOT NULL CONSTRAINT ck_orders_items CHECK (ISJSON(items) = 1),  -- [{sku, name, qty, price, size_ml, bottles}]
  subtotal        INT NOT NULL,
  delivery_fee    INT NOT NULL CONSTRAINT df_orders_delivery DEFAULT 0,
  total           INT NOT NULL,
  payment_method  NVARCHAR(40) NOT NULL,                                    -- cod, sslcommerz, bkash, ...
  payment_status  NVARCHAR(20) NOT NULL CONSTRAINT df_orders_pay DEFAULT N'unpaid'
                  CONSTRAINT ck_orders_pay CHECK (payment_status IN (N'unpaid', N'pending', N'paid', N'failed', N'refunded')),
  status          NVARCHAR(20) NOT NULL CONSTRAINT df_orders_status DEFAULT N'pending'
                  CONSTRAINT ck_orders_status CHECK (status IN (N'pending', N'confirmed', N'dispatched', N'delivered', N'cancelled')),
  stock_state     NVARCHAR(20) NOT NULL CONSTRAINT df_orders_stock DEFAULT N'reserved'
                  CONSTRAINT ck_orders_stock CHECK (stock_state IN (N'reserved', N'released', N'dispatched')),
  provider_ref    NVARCHAR(200) NULL,                                        -- the gateway's transaction / payment id
  created_at      DATETIMEOFFSET NOT NULL CONSTRAINT df_orders_created DEFAULT SYSDATETIMEOFFSET(),
  updated_at      DATETIMEOFFSET NOT NULL CONSTRAINT df_orders_updated DEFAULT SYSDATETIMEOFFSET()
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'orders_created' AND object_id = OBJECT_ID(N'dbo.orders'))
CREATE INDEX orders_created ON dbo.orders (created_at DESC);
GO

-- Links an order to the signed-in customer who placed it (guest orders stay NULL).
IF COL_LENGTH(N'dbo.orders', N'customer_id') IS NULL
ALTER TABLE dbo.orders ADD customer_id INT NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'orders_customer' AND object_id = OBJECT_ID(N'dbo.orders'))
CREATE INDEX orders_customer ON dbo.orders (customer_id, created_at DESC);
GO

-- Raw record of every message from a payment gateway, for auditing.
IF OBJECT_ID(N'dbo.payment_events', N'U') IS NULL
CREATE TABLE dbo.payment_events (
  id         BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT pk_payment_events PRIMARY KEY,
  order_code NVARCHAR(40)   NULL,
  provider   NVARCHAR(40)   NOT NULL,
  kind       NVARCHAR(20)   NOT NULL,  -- init, callback, ipn, verify
  ok         BIT            NOT NULL CONSTRAINT df_pe_ok DEFAULT 0,
  payload    NVARCHAR(MAX)  NULL,      -- JSON
  created_at DATETIMEOFFSET NOT NULL CONSTRAINT df_pe_created DEFAULT SYSDATETIMEOFFSET()
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'payment_events_order' AND object_id = OBJECT_ID(N'dbo.payment_events'))
CREATE INDEX payment_events_order ON dbo.payment_events (order_code, created_at);
GO

-- Small key/value store for things like a payment gateway's access token.
IF OBJECT_ID(N'dbo.app_state', N'U') IS NULL
CREATE TABLE dbo.app_state (
  [key]      NVARCHAR(200)  NOT NULL CONSTRAINT pk_app_state PRIMARY KEY,
  value      NVARCHAR(MAX)  NOT NULL,  -- JSON
  updated_at DATETIMEOFFSET NOT NULL CONSTRAINT df_app_state_updated DEFAULT SYSDATETIMEOFFSET()
);
GO

-- Every email the shop tried to send (order updates, alerts, tests), so problems are visible in the admin.
IF OBJECT_ID(N'dbo.email_log', N'U') IS NULL
CREATE TABLE dbo.email_log (
  id          INT IDENTITY(1,1) NOT NULL CONSTRAINT pk_email_log PRIMARY KEY,
  order_code  NVARCHAR(40)   NULL,
  kind        NVARCHAR(40)   NOT NULL,   -- placed, paid, payment_failed, confirmed, dispatched, delivered, cancelled, refunded, admin_alert, test
  to_email    NVARCHAR(254)  NOT NULL,
  subject     NVARCHAR(300)  NOT NULL,
  status      NVARCHAR(20)   NOT NULL,   -- sent, failed, skipped
  error       NVARCHAR(1000) NULL,
  created_at  DATETIMEOFFSET NOT NULL CONSTRAINT df_email_log_created DEFAULT SYSDATETIMEOFFSET()
);
GO

-- Customers who register on the public website (separate from admin users).
IF OBJECT_ID(N'dbo.customers', N'U') IS NULL
CREATE TABLE dbo.customers (
  id            INT IDENTITY(1,1) NOT NULL CONSTRAINT pk_customers PRIMARY KEY,
  email         NVARCHAR(254)  NOT NULL CONSTRAINT uq_customers_email UNIQUE,
  name          NVARCHAR(200)  NOT NULL,
  phone         NVARCHAR(40)   NOT NULL CONSTRAINT df_customers_phone DEFAULT N'',
  address       NVARCHAR(300)  NOT NULL CONSTRAINT df_customers_address DEFAULT N'',
  city          NVARCHAR(100)  NOT NULL CONSTRAINT df_customers_city DEFAULT N'',
  password_hash NVARCHAR(400)  NOT NULL,
  created_at    DATETIMEOFFSET NOT NULL CONSTRAINT df_customers_created DEFAULT SYSDATETIMEOFFSET()
);
GO
