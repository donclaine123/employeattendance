# Design and Implementation of a Web-Based QR Code Attendance and Monitoring System for Faculty Members in Tertiary Education of St. Clare College of Caloocan

> **WorkLine** — A real-time, anti-spoofing faculty attendance tracking and scheduling platform engineered with a **3-Tier Hybrid Architecture (Local On-Premises & Cloud)**, dynamic QR code authentication, subject-level schedule alignment, and administrative oversight.

---

## 1. Project Description

**WorkLine** is a web-based attendance and academic monitoring system designed specifically for the tertiary faculty of **St. Clare College of Caloocan**. 

Traditional attendance methods (manual paper logs or static biometric scanners) frequently suffer from proxy attendance, long queues, lack of integration with daily academic teaching schedules, and vulnerability to network/internet outages. 

WorkLine solves these challenges by implementing:
- **3-Tier Hybrid Architecture**: Combines an on-premises local server (Dockerized PostgreSQL + Nginx) for zero-latency, offline-capable classroom attendance logging with a managed cloud database (Supabase) for remote monitoring and offsite redundancy.
- **Dynamic Anti-Spoofing QR Authentication**: High-security, rotating QR session tokens that expire within seconds to prevent sharing of static screenshot passes.
- **Schedule-Aware Attendance Computation**: Evaluates check-ins against assigned subject schedules in real-time (`Asia/Manila` timezone), calculating precise lateness, breaks, undertime, and completed hours.
- **Dedicated Monitoring Team Portal**: Specialized operational dashboard designed specifically for the **Faculty Attendance Monitoring Team** to oversee live campus attendance and execute audited status overrides.

---

## 2. Features

### 🛡️ Dynamic QR Code Anti-Spoofing Engine
- Server-generated atomic QR tokens that rotate on a configurable interval (5–15 seconds).
- Sequence-safe verification preventing replay attacks and proxy attendance.

### ⏱️ Real-Time Subject & Schedule Tracking
- Dynamic schedule integration (start/end times, room designations, grace periods).
- Automatic status classification: `On Time`, `Late`, `On Break`, `Break Overstay`, `Undertime`, `Completed`, `Absent`.

### 🏢 4 Dedicated Role-Based Portals
- **Superadmin (IT Command Center)**: Server health, API latency, maintenance mode kill switch, database backup/restore, audit logs, user security controls.
- **Faculty Attendance Monitoring Team**: Live campus-wide attendance feed, manual attendance overrides with mandatory justification and audit logging, department analytics, report downloads.
- **Department Head (Academic Program Deans)**: Subject scheduling, room and section allocation, faculty workload balance, adjustment request approvals.
- **Faculty Member**: Real-time personal schedule viewer, dynamic QR camera scanning/check-in, break management, attendance history, discrepancy requests.

### 🔄 Dual-Database Hybrid Sync & Offline Resilience
- Continues operating uninterrupted on local LAN even during total internet outages.
- Local mutations are flagged (`is_synced = false`, `sync_updated_at`) and automatically reconciled with Supabase once WAN connectivity is restored.

### ⚡ Real-Time WebSocket Broadcasting
- Powered by Socket.IO to immediately push check-in events, break changes, and schedule modifications to active monitoring consoles without page refreshes.

---

## 3. Tech Stack

### 3-Tier Hybrid Architecture Overview

| Tier | Component | Technologies |
| :--- | :--- | :--- |
| **Tier 1: Presentation Layer** | Client Interfaces & Kiosks | HTML5, Vanilla JavaScript (ES6+), Vanilla CSS (Design Tokens, Dark/Light Themes), Socket.IO Client |
| **Tier 2: Logic & Gateway Layer** | Reverse Proxy & API Server | Node.js, Express.js (Modular Route/Service Architecture), Nginx, Socket.IO, node-cron, JSON Web Tokens (JWT), bcryptjs |
| **Tier 3A: Local Data Layer** | On-Premises Local DB | PostgreSQL 15 (Docker Container), PostgreSQL RPC Stored Procedures |
| **Tier 3B: Cloud Data Layer** | Cloud Database & Sync | Supabase (Cloud PostgreSQL), Bidirectional Sync Engine (`syncService.js`) |
| **Network & Discovery** | Edge Routing & ZeroConf | Nginx Reverse Proxy (Ports 80/443), Apple Bonjour / mDNS (`workline.local`) |

---

## 4. Prerequisites

Before installing and running the system, ensure the following software is installed on the host machine:

- **Node.js**: v18.0.0 or higher ([Download Node.js](https://nodejs.org/))
- **npm**: v8.0.0 or higher
- **Docker Desktop**: Required for local PostgreSQL containerization ([Download Docker](https://www.docker.com/products/docker-desktop/))
- **Nginx**: For local reverse proxy routing and mDNS resolution ([Download Nginx](https://nginx.org/en/download.html))
- **Git**: For version control

---

## 5. Installation/Setup

### Step 1: Clone the Repository
```bash
git clone https://github.com/donclaine123/employeattendance.git
cd employeattendance
```

### Step 2: Install Backend Dependencies
```bash
cd server
npm install
cd ..
```

### Step 3: Configure Environment Variables
Create a `.env` file inside the `server/` directory (or copy from `.env.example`):
```bash
cd server
cp .env.example .env
```

---

## 6. Environment Variables

Create and configure `server/.env` with the following parameters:

```env
# --- SERVER CONFIGURATION ---
PORT=5000
NODE_ENV=production
FRONTEND_URL=http://localhost

# --- LOCAL DATABASE (TIER 3A) ---
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/employeeattendance

# --- CLOUD DATABASE (TIER 3B - SUPABASE) ---
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key
SUPABASE_ANON_KEY=your-supabase-anon-key

# --- SECURITY & AUTHENTICATION ---
JWT_SECRET=your-secure-jwt-secret-string-min-32-chars
JWT_EXPIRES_IN=7d

# --- BREVO EMAIL SERVICE (OPTIONAL FOR INVITES) ---
BREVO_API_KEY=your-brevo-api-key
EMAIL_FROM=no-reply@stclarecollege.edu.ph
```

---

## 7. How to Run

### Method A: Docker Compose (Full Stack — Recommended)
This runs the local PostgreSQL database container and the backend service:
```bash
# In the employeattendance root directory
docker-compose up -d --build
```

### Method B: Standalone Development Mode
```bash
# 1. Start your local PostgreSQL instance or Docker database
docker-compose up -d db

# 2. Run backend in development mode (with hot reload/dev logs)
cd server
npm run dev
```

### Method C: Launch Nginx Reverse Proxy (For Local Network & mDNS Access)
```powershell
# From employeattendance/nginx directory
cd nginx
.\start-nginx.ps1
```

---

## 8. Usage

### Access URLs
| Interface | URL | Description |
| :--- | :--- | :--- |
| **Localhost Access** | `http://localhost` | Main login screen on host computer |
| **Local Network / Mobile** | `http://<HOST_IP_ADDRESS>` (e.g., `http://192.168.1.199`) | Connect phone to campus Wi-Fi |
| **Clean Hostname (mDNS)** | `http://workline.local` | ZeroConf URL for any device on LAN |
| **Classroom Kiosk Display** | `http://workline.local/pages/qr-display.html` | Dynamic rotating QR code board |

### User Workflow
1. **Kiosk Setup**: Open `qr-display.html` on a classroom monitor or tablet. The system will start rotating dynamic QR sessions every few seconds.
2. **Faculty Check-In**:
   - Faculty member opens `http://workline.local` on mobile browser and logs in.
   - Navigates to the QR Scanner and scans the active kiosk code.
   - Attendance engine verifies schedule, matches current subject/room, and logs check-in.
3. **Monitoring Team Oversight**:
   - Monitoring team logs in at `HRDashboard.html`.
   - Views real-time status of all faculty across departments.
   - If an instructor had an emergency room transfer or valid reason, the team can submit an **Override** with recorded justification.
4. **Superadmin Management**:
   - IT Administrator accesses `Superadmin.html` to monitor API health, trigger manual/scheduled database backups, or enable global maintenance mode.

---

## 9. Project Structure

```text
employeattendance/
├── docker-compose.yml          # Container orchestration (Node App + PostgreSQL)
├── Dockerfile                  # Production container definition
├── nginx/                      # Reverse proxy configuration & scripts
│   ├── conf/nginx.conf         # Production Nginx routing & WebSocket proxy
│   └── start-nginx.ps1         # Automated Windows Nginx runner
│
├── public/                     # TIER 1: Frontend Presentation Assets
│   ├── css/                    # Modular stylesheets (themes, tables, modals)
│   ├── js/                     # Client JavaScript, API connectors & Socket listeners
│   ├── pages/                  # Role-based dashboard interfaces
│   │   ├── Superadmin.html     # IT System Administration & Health Portal
│   │   ├── HRDashboard.html    # Faculty Attendance Monitoring Team Portal
│   │   ├── DepartmentHead.html # Academic Program Deans & Scheduling Portal
│   │   ├── employee.html       # Faculty Personal Attendance & Schedule Portal
│   │   └── qr-display.html     # Kiosk Anti-Spoof Dynamic QR Display
│   └── index.html              # Central Login & Authentication Gateway
│
├── server/                     # TIER 2: Backend Application & Business Logic
│   ├── config/                 # App configuration & constant definitions
│   ├── middleware/             # Auth guards (requireAuth), RBAC, error handlers
│   ├── postgres/               # TIER 3A: SQL schemas, migrations & RPC functions
│   │   ├── RPC_01_attendance_break.sql
│   │   ├── RPC_02_attendance_checkin.sql
│   │   ├── RPC_09_generate_qr_session_atomic.sql
│   │   └── local_schema.sql
│   ├── routes/                 # Express route controllers
│   │   ├── admin.routes.js     # Superadmin endpoints
│   │   ├── attendance.routes.js# QR scan and check-in endpoints
│   │   ├── auth.routes.js      # Login, session, password reset endpoints
│   │   ├── hr.routes.js        # Monitoring team & override endpoints
│   │   └── departmenthead.routes.js # Academic scheduling endpoints
│   ├── services/               # Core business logic layer
│   │   ├── attendanceService.js# Attendance computation logic
│   │   ├── overrideService.js  # Administrative override handlers
│   │   ├── backupScheduler.js  # Automated SQL backup daemon
│   │   └── userService.js      # Account management
│   ├── utils/                  # Audit loggers, timezone converters, sync helpers
│   │   └── syncService.js      # Hybrid bidirectional sync engine (Local <-> Cloud)
│   ├── conn-supabase.js        # Local PostgreSQL & Cloud Supabase clients
│   └── server.js               # Main HTTP/HTTPS & WebSocket server entry point
│
└── START_HERE.md               # Quick presentation & demo guide
```

---

## 10. Testing

### Health & Database Verification
```bash
# Check local PostgreSQL connection
node server/postgres/verify-migrations.js

# Test database connection and Supabase sync client
node server/conn-supabase.js
```

### Manual Operational Test Routine
1. **Authentication Test**: Log in using Superadmin, Monitoring Team, Department Head, and Faculty accounts to ensure role redirection functions accurately.
2. **Dynamic QR Rotation Test**: Launch `public/pages/qr-display.html` and verify that the QR code image and session token renew automatically every 10 seconds.
3. **Simulated Attendance Scan**: Scan the QR code using a faculty account; verify that the scan records in local PostgreSQL and updates the Monitoring Team dashboard in real-time via Socket.IO.
4. **Offline Resilience Test**: Disconnect WAN/internet access while keeping local Wi-Fi active. Perform check-ins; verify that records write to local PostgreSQL (`is_synced = false`). Reconnect internet and verify sync reconciliation with Supabase.

---

## 11. API Documentation

### Core REST Endpoints

| Method | Endpoint | Access Role | Description |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/auth/login` | Public | Authenticates user and returns JWT cookie/token |
| `POST` | `/api/auth/logout` | Authenticated | Clears active session |
| `GET` | `/api/attendance/qr/session` | Kiosk / Admin | Generates active rotating dynamic QR session |
| `POST` | `/api/attendance/qr/verify` | Faculty | Verifies scanned QR token against faculty schedule |
| `POST` | `/api/attendance/break` | Faculty | Logs Break-Out and Break-In events |
| `GET` | `/api/hr/live-attendance` | Monitoring Team | Retrieves live campus-wide faculty attendance feed |
| `POST` | `/api/hr/override` | Monitoring Team | Submits audited attendance override with reason |
| `GET` | `/api/department-head/schedules` | Dept Head | Retrieves departmental faculty schedules |
| `POST` | `/api/department-head/schedules` | Dept Head | Creates or updates subject schedule assignments |
| `GET` | `/api/admin/health` | Superadmin | Returns system metrics, latency, and DB sync status |
| `POST` | `/api/admin/maintenance-mode` | Superadmin | Toggles global system maintenance lock |
| `POST` | `/api/admin/backup/now` | Superadmin | Triggers immediate PostgreSQL database backup |

### Key PostgreSQL Stored Procedures (RPC)
- `RPC_01_attendance_break`: Atomically writes break timestamp and toggles break flag.
- `RPC_02_attendance_checkin`: Atomically verifies session validity and logs check-in.
- `RPC_09_generate_qr_session_atomic`: Issues expiring QR cryptographic token.

---

## 12. Deployment

### Local Campus Deployment (On-Premises)
1. Configure host workstation with a static local IP on the institutional network (e.g., `192.168.1.199`).
2. Run Nginx with `nginx/conf/nginx.conf` listening on Ports 80 and 443.
3. Ensure Docker container `employeeattendance-app` and PostgreSQL container are running with `restart: always`.
4. Configure Apple Bonjour / mDNS service to broadcast `workline.local` across the campus subnet.

### Cloud Deployment (Supabase & Render/VPS)
1. Execute SQL schema definitions (`server/postgres/schema.sql` and `server/postgres/all_rpcs.sql`) in Supabase SQL Editor.
2. Deploy backend service using `Dockerfile` or `render.yaml` to cloud host.
3. Set environment variables `DATABASE_URL`, `SUPABASE_URL`, and `SUPABASE_SERVICE_ROLE_KEY` in cloud dashboard.

---

## 🎓 Academic & Institutional Context
- **Institution**: St. Clare College of Caloocan
- **Department**: College of Computer Studies / Tertiary Education
- **Subject**: Thesis Project