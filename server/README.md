# Mock server (root/server)

This folder contains a lightweight mock server for local development. It exposes a REST API under `/api` and a custom `POST /api/login` endpoint.

## Quick start (PowerShell)

```powershell
cd "d:/THESIS 1/employeattendance/server"
npm install
npm start
```

The server listens on port 5000 by default.

## Environment variables

- PORT: HTTP port (default 5000)
- DATABASE_URL: Postgres connection string (default postgresql://workline:secret@localhost:5432/workline)
- JWT_SECRET: Secret used to sign JWTs (required in prod; defaults to dev-secret-key in dev)
- JWT_EXPIRES_IN: JWT expiration, e.g. `8h`, `1d` (default `8h`)
- BCRYPT_ROUNDS: Cost factor for password hashing (default 10)

## Endpoints

- POST /api/login { email, password }
	- Uses bcrypt to validate `users.password_hash` (falls back to plaintext `users.password` only if no hash exists during transition).
	- Updates `users.last_login` on success.
- GET /api/attendance
- POST /api/attendance/checkin
- HR QR endpoints under `/api/hr/qr/*`

## Migrations

You can apply SQL migrations via `node` (no `psql` required):

```powershell
# Run migrations 001–003
npm run migrate:run

# Verify schema
npm run migrate:verify
```

## Password hashing

To hash existing seeded plaintext passwords into `users.password_hash`:

```powershell
# Hash passwords for users missing password_hash
npm run hash-passwords
```

After hashing, the login route will prefer `password_hash` (bcrypt). Plaintext comparison is only used when a hash is absent, to support a safe transition.
