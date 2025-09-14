# Mock server (root/server)

This folder contains a lightweight mock server for local development. It exposes a REST API under `/api` and a custom `POST /api/login` endpoint.

Quick start (PowerShell):

cd "d:/THESIS 1/employeattendance/server"
npm install
npm start

The server listens on port 5000 by default. Endpoints:
- GET /api/users
- POST /api/login { email, password }
- GET /api/attendance

Set `PORT` env var to override the default.
