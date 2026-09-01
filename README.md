# Design and Implementation of a Web-Based QR Code Attendance and Monitoring System for Faculty Members in Tertiary Education of St. Clare College of Caloocan

> **WorkLine** — A real-time, anti-spoofing faculty attendance tracking and scheduling platform engineered for the tertiary faculty of **St. Clare College of Caloocan**, featuring dynamic QR code authentication, subject-level schedule alignment, and comprehensive administrative oversight.
> 
> 🌐 **Production Web Application**: [https://employeeattendance.me](https://employeeattendance.me)

---

## 📌 Table of Contents
- [1. Project Description](#1-project-description)
- [2. Features](#2-features)
- [3. Tech Stack](#3-tech-stack)
- [4. System Architecture](#4-system-architecture)
- [5. User Roles & Access Portals](#5-user-roles--access-portals)
- [6. Environment Variables](#6-environment-variables)
- [7. Project Structure](#7-project-structure)
- [8. API Documentation](#8-api-documentation)
- [9. Production Deployment & Live Access](#9-production-deployment--live-access)

---

## 1. Project Description

**WorkLine** is a production web-based attendance and academic monitoring system designed specifically for the tertiary faculty of **St. Clare College of Caloocan**. The system is deployed and accessible at **[https://employeeattendance.me](https://employeeattendance.me)**.

Traditional attendance methods (manual paper logbooks or static biometric scanners) frequently suffer from proxy attendance, long lines, lack of integration with dynamic academic teaching schedules, and slow reporting for academic monitoring teams.

WorkLine solves these challenges by providing:
- **Cloud-Powered Architecture**: Hosted on cloud infrastructure with Supabase PostgreSQL for real-time synchronization, high availability, and multi-device access across campus.
- **Dynamic Anti-Spoofing QR Authentication**: High-security, rotating QR session tokens that expire every few seconds to prevent screenshot sharing or proxy check-ins.
- **Schedule-Aware Attendance Computation**: Evaluates scans against assigned subject schedules in real-time (`Asia/Manila` timezone), calculating exact lateness, breaks, undertime, and completed teaching hours.
- **Dedicated Monitoring Team Portal**: Specialized operational dashboard designed specifically for the **Faculty Attendance Monitoring Team** to oversee live campus attendance and execute audited status overrides.

---

## 2. Features

### 🛡️ Dynamic QR Code Anti-Spoofing Engine
- Server-generated atomic QR tokens rotating on a configurable interval (5–15 seconds).
- Sequence-safe verification preventing replay attacks and proxy attendance.

### ⏱️ Real-Time Subject & Schedule Tracking
- Dynamic schedule integration (start/end times, room designations, grace periods).
- Automatic status classification: `On Time`, `Late`, `On Break`, `Break Overstay`, `Undertime`, `Completed`, `Absent`.

### 🏢 4 Dedicated Role-Based Portals
- **Superadmin (IT Command Center)**: System health, API latency tracking, maintenance mode kill switch, database backups, audit logs, and access control.
- **Faculty Attendance Monitoring Team**: Live campus-wide attendance feed, manual attendance overrides with mandatory justification and audit logging, department analytics, report downloads.
- **Department Head (Academic Program Deans)**: Subject scheduling, room and section allocation, faculty workload balance, adjustment request approvals.
- **Faculty Member**: Real-time personal schedule viewer, dynamic QR camera scanning/check-in, break management, attendance history, discrepancy requests.

### ⚡ Real-Time WebSocket Broadcasting
- Powered by Socket.IO to immediately push check-in events, break changes, and schedule modifications to active monitoring consoles without page refreshes.

---

## 3. Tech Stack

| Layer | Component | Technologies |
| :--- | :--- | :--- |
| **Frontend / Client** | Responsive Web Applications | HTML5, Vanilla JavaScript (ES6+), Vanilla CSS (Design Tokens, Dark/Light Themes), Socket.IO Client |
| **Backend & API** | REST API & WebSocket Server | Node.js, Express.js (Modular Route/Service Architecture), Socket.IO, node-cron, JSON Web Tokens (JWT), bcryptjs |
| **Database Layer** | Cloud Database & Procedures | Supabase (PostgreSQL), Atomic PostgreSQL Stored Procedures (RPCs) |
| **Hosting & Domain** | Production Infrastructure | Cloud Hosting, SSL/TLS Encryption (HTTPS), Custom Domain (`employeeattendance.me`) |

---

## 4. System Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     CLIENT LAYER (WEB PORTALS)                          │
│  - Live Domain: https://employeeattendance.me                           │
│  - Dynamic QR Kiosk Display: https://employeeattendance.me/pages/qr-display.html │
│  - Faculty Mobile Portal: https://employeeattendance.me/pages/employee.html      │
│  - Monitoring Team Dashboard: https://employeeattendance.me/pages/HRDashboard.html│
│  - Department Head & Superadmin Consoles                                │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │ HTTPS / Secure WebSockets (WSS)
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                   BACKEND & APPLICATION LOGIC LAYER                     │
│  - Node.js & Express API Gateway                                       │
│  - Socket.IO Real-Time Event Dispatcher                                 │
│  - Attendance Engine (Lateness / Breaks / Overrides)                   │
│  - Audit Logging & Security Service                                     │
│  - Automated Backup & Maintenance Daemons                              │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │ Encrypted PostgreSQL Connection
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                   DATABASE LAYER (SUPABASE CLOUD)                       │
│  - Supabase Managed PostgreSQL Database                                 │
│  - Atomic RPC Stored Procedures (QR Session, Check-In, Breaks)          │
│  - Role-Based Row Level Security & Encryption                           │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 5. User Roles & Access Portals

| Role / Portal | Target User | Live Portal Link | Key Responsibilities |
| :--- | :--- | :--- | :--- |
| **Superadmin** | IT / System Administrators | `/pages/Superadmin.html` | System health metrics, API latency tracking, global maintenance mode switch, database backup & restore routines, audit security logs, user credential management. |
| **Monitoring Team** | Faculty Attendance Monitoring Team | `/pages/HRDashboard.html` | Live campus-wide faculty attendance feed, subject status overrides with mandatory justification and audit logging, department-wide attendance analytics, and report generation. |
| **Department Head** | Deans & Academic Program Heads | `/pages/DepartmentHead.html` | Faculty subject scheduling, room and section assignments, weekly workload allocation, adjustment approvals, and departmental roster management. |
| **Faculty Member** | Tertiary Faculty / Professors | `/pages/employee.html` | Real-time personal class schedule viewer, dynamic QR scanning validation, break logging, historical attendance records, and leave/adjustment requests. |
| **Kiosk / QR Display** | Classroom / Hallway Display Terminals | `/pages/qr-display.html` | Anti-spoofing rotating QR code generator utilizing time-expiring cryptographic session tokens. |

---

## 6. Environment Variables

The backend application is configured using the following environment variables:

```env
# --- SERVER CONFIGURATION ---
PORT=5000
NODE_ENV=production
FRONTEND_URL=https://employeeattendance.me

# --- DATABASE (SUPABASE CLOUD) ---
DATABASE_URL=postgresql://postgres:[PASSWORD]@db.[PROJECT_REF].supabase.co:5432/postgres
SUPABASE_URL=https://[PROJECT_REF].supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key
SUPABASE_ANON_KEY=your-supabase-anon-key

# --- SECURITY & AUTHENTICATION ---
JWT_SECRET=your-secure-jwt-secret-string-min-32-chars
JWT_EXPIRES_IN=7d

# --- EMAIL SERVICE (OPTIONAL FOR INVITES) ---
BREVO_API_KEY=your-brevo-api-key
EMAIL_FROM=no-reply@stclarecollege.edu.ph
```

---

## 7. Project Structure

```text
employeattendance/
├── public/                     # Frontend Presentation Assets
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
├── server/                     # Backend Application & Business Logic
│   ├── config/                 # App configuration & constant definitions
│   ├── middleware/             # Auth guards (requireAuth), RBAC, error handlers
│   ├── postgres/               # SQL schemas, migrations & RPC functions
│   │   ├── RPC_01_attendance_break.sql
│   │   ├── RPC_02_attendance_checkin.sql
│   │   ├── RPC_09_generate_qr_session_atomic.sql
│   │   └── schema.sql
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
│   ├── utils/                  # Audit loggers, timezone converters, email helpers
│   ├── conn-supabase.js        # Cloud Supabase & PostgreSQL client connectors
│   └── server.js               # Main HTTP/HTTPS & WebSocket server entry point
│
└── README.md                   # System documentation
```

---

## 8. API Documentation

### Core REST Endpoints

| Method | Endpoint | Access Role | Description |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/auth/login` | Public | Authenticates user and returns JWT session |
| `POST` | `/api/auth/logout` | Authenticated | Clears active session |
| `GET` | `/api/attendance/qr/session` | Kiosk / Admin | Generates active rotating dynamic QR session |
| `POST` | `/api/attendance/qr/verify` | Faculty | Verifies scanned QR token against faculty schedule |
| `POST` | `/api/attendance/break` | Faculty | Logs Break-Out and Break-In events |
| `GET` | `/api/hr/live-attendance` | Monitoring Team | Retrieves live campus-wide faculty attendance feed |
| `POST` | `/api/hr/override` | Monitoring Team | Submits audited attendance override with reason |
| `GET` | `/api/department-head/schedules` | Dept Head | Retrieves departmental faculty schedules |
| `POST` | `/api/department-head/schedules` | Dept Head | Creates or updates subject schedule assignments |
| `GET` | `/api/admin/health` | Superadmin | Returns system metrics, latency, and DB status |
| `POST` | `/api/admin/maintenance-mode` | Superadmin | Toggles global system maintenance lock |
| `POST` | `/api/admin/backup/now` | Superadmin | Triggers immediate database backup routine |

### Key PostgreSQL Stored Procedures (RPC)
- `RPC_01_attendance_break`: Atomically writes break timestamp and toggles break flag.
- `RPC_02_attendance_checkin`: Atomically verifies session validity and logs check-in.
- `RPC_09_generate_qr_session_atomic`: Issues expiring QR cryptographic token.

---


