# Design and Implementation of a Web-Based QR Code Attendance and Monitoring System for Faculty Members in Tertiary Education of St. Clare College of Caloocan

> **WorkLine** — Real-time, anti-spoofing faculty attendance tracking and scheduling platform engineered with a **3-Tier Hybrid Architecture (Local & Cloud)**, dual-database offline-resilient synchronization, dynamic QR code authentication, and comprehensive administrative oversight.

---

## 📌 Table of Contents
- [1. Executive Summary](#1-executive-summary)
- [2. 3-Tier Hybrid Architecture (Local + Cloud)](#2-3-tier-hybrid-architecture-local--cloud)
- [3. System Architecture Diagram](#3-system-architecture-diagram)
- [4. User Roles & Access Portals](#4-user-roles--access-portals)
- [5. Key Features & Innovations](#5-key-features--innovations)
- [6. Technology Stack](#6-technology-stack)
- [7. Directory Structure](#7-directory-structure)
- [8. Setup & Installation](#8-setup--installation)
- [9. Networking & Local Deployment](#9-networking--local-deployment)
- [10. Database & Hybrid Synchronization](#10-database--hybrid-synchronization)
- [11. Thesis & Research Context](#11-thesis--research-context)

---

## 1. Executive Summary

Traditional faculty attendance mechanisms in tertiary education often rely on manual sign-in sheets or static biometric terminals, leading to operational inefficiencies, scheduling discrepancies, proxy check-ins, and delayed reporting for academic monitoring teams.

This system addresses these challenges by introducing a **schedule-aware, dynamic QR-code-based attendance monitoring platform** tailored specifically for the tertiary faculty of **St. Clare College of Caloocan**. 

The system is built upon a **3-Tier Hybrid Architecture**:
- **Local On-Premises Tier**: Ensures zero-latency classroom check-ins and uninterrupted campus operations even during complete internet or WAN outages.
- **Cloud Tier**: Provides off-campus administrative oversight, remote report generation, multi-device accessibility, and redundant backup replication via Supabase.

---

## 2. 3-Tier Hybrid Architecture (Local + Cloud)

The system is architected across three distinct, decoupled tiers combining local on-premise execution with cloud synchronization:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     TIER 1: PRESENTATION LAYER                         │
│  - Dynamic QR Kiosk Display (Terminals / Classrooms)                   │
│  - Faculty Mobile Portal (Smartphone Web App)                           │
│  - Monitoring Team Live Dashboard (Workstations)                       │
│  - Department Head & Superadmin Consoles                               │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │ HTTP / HTTPS / WebSockets (Port 80/443)
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                TIER 2: APPLICATION & BUSINESS LOGIC LAYER               │
│  - Nginx Edge Reverse Proxy (TLS, mDNS: workline.local)                │
│  - Node.js & Express REST API Server                                   │
│  - Socket.IO Real-Time WebSocket Broadcaster                           │
│  - Attendance Engine (Lateness / Breaks / Overrides)                   │
│  - Intelligent Bidirectional Sync Engine (syncService.js)              │
│  - Automated DB Backup & Maintenance Scheduler                         │
└──────────────────┬──────────────────────────────────┬───────────────────┘
                   │                                  │
      Local Socket / TCP (5432)             Encrypted HTTPS / WSS Sync
                   │                                  │
                   ▼                                  ▼
┌──────────────────────────────────────┐  ┌───────────────────────────────┐
│     TIER 3A: LOCAL DATA LAYER        │  │   TIER 3B: CLOUD DATA LAYER   │
│  - Local PostgreSQL (Dockerized)     │  │  - Cloud Supabase PostgreSQL  │
│  - Low Latency LAN Operations        │◄─┼─►- Remote Monitoring Access    │
│  - Offline Campus Attendance Store   │  │  - Offsite Backup & Analytics │
│  - Atomic RPC Stored Procedures      │  │  - Edge Functions & Auth      │
└──────────────────────────────────────┘  └───────────────────────────────┘
```

### Breakdown of Tiers:

1. **Tier 1: Presentation Tier (Client UI)**
   - Single-Page Applications (SPAs) and dynamic web interfaces built using HTML5, Vanilla JavaScript (ES6+), and CSS3 with modern design tokens.
   - Real-time client-side synchronization through Socket.IO WebSockets.

2. **Tier 2: Application / Logic Tier (Business Core)**
   - **Nginx Reverse Proxy**: Acts as the local gateway, managing SSL termination, mDNS resolution (`workline.local`), and WebSocket traffic routing.
   - **Node.js / Express Server**: Processes business rules, authentication, schedule verification, attendance status calculation, and administrative overrides.
   - **Hybrid Synchronization Service**: Manages conflict-free bidirectional syncing between local PostgreSQL and cloud Supabase.

3. **Tier 3: Hybrid Data Tier (Local Database + Cloud Supabase)**
   - **Local Tier (On-Premise)**: A containerized PostgreSQL instance residing on the campus server. It guarantees that faculty can continue clocking in and out without interruption during internet outages.
   - **Cloud Tier (Remote)**: Supabase PostgreSQL cloud instance that synchronizes state with the local database, allowing department heads and administrators to monitor attendance remotely from outside the campus network.

---

## 3. System Architecture Diagram

```mermaid
graph TD
    subgraph Tier 1: Presentation Layer
        FacultyDevice["Faculty Mobile Device / Browser"]
        KioskDisplay["Kiosk / Classroom QR Display"]
        AdminStation["Monitoring & IT Workstations"]
    end

    subgraph Tier 2: Application & Gateway Layer
        Nginx["Nginx Reverse Proxy (Port 80 / 443)"]
        mDNS["mDNS / Bonjour (workline.local)"]
        ExpressServer["Node.js / Express API Server"]
        SocketEngine["Socket.IO Real-Time Engine"]
        SyncEngine["Hybrid Sync Service (syncService.js)"]
    end

    subgraph Tier 3: Hybrid Data Layer
        LocalPostgres[("Local PostgreSQL (Docker Container)\nOn-Premises / Offline-Ready")]
        SupabaseCloud[("Supabase Cloud Database\nRemote Access & Cloud Redundancy")]
    end

    FacultyDevice -->|HTTP / WebSocket| Nginx
    KioskDisplay -->|HTTP / WebSocket| Nginx
    AdminStation -->|HTTP / WebSocket| Nginx
    mDNS -.-> Nginx

    Nginx --> ExpressServer
    ExpressServer <--> SocketEngine
    ExpressServer <--> LocalPostgres
    ExpressServer <--> SyncEngine
    SyncEngine <-->|Bidirectional Cloud Sync| SupabaseCloud
```

---

## 4. User Roles & Access Portals

The system enforces strict **Separation of Concerns (SoC)** and **Role-Based Access Control (RBAC)** across specialized portals:

| Role / Portal | Target User | Key Responsibilities |
| :--- | :--- | :--- |
| **Superadmin**<br>([Superadmin.html](public/pages/Superadmin.html)) | IT / System Administrators | System health metrics, API latency tracking, global maintenance mode switch, database backup & restore routines, audit security logs, user credential management. |
| **Monitoring Team**<br>([HRDashboard.html](public/pages/HRDashboard.html)) | Faculty Attendance Monitoring Team | Live campus-wide faculty attendance feed, subject status overrides with mandatory justification and audit logging, department-wide attendance analytics, and report generation. |
| **Department Head**<br>([DepartmentHead.html](public/pages/DepartmentHead.html)) | Deans & Academic Program Heads | Faculty subject scheduling, room and section assignments, weekly workload allocation, adjustment approvals, and departmental roster management. |
| **Faculty Member**<br>([employee.html](public/pages/employee.html)) | Tertiary Faculty / Professors | Real-time personal class schedule viewer, dynamic QR scanning validation, break logging, historical attendance records, and leave/adjustment requests. |
| **Kiosk / QR Display**<br>([qr-display.html](public/pages/qr-display.html)) | Classroom / Hallway Display Terminals | Anti-spoofing rotating QR code generator utilizing time-expiring cryptographic session tokens. |

---

## 5. Key Features & Innovations

### 🛡️ Dynamic Anti-Spoofing QR Verification
- QR tokens are generated server-side using atomic PostgreSQL RPC procedures (`RPC_09_generate_qr_session_atomic.sql`).
- Sessions automatically rotate on a configurable timer (e.g., every 5–15 seconds) to prevent faculty from sharing static screenshots.

### ⏱️ Schedule-Aware Attendance & Break Tracking
- Integrates directly with institutional class schedules (time start, time end, grace periods, room assignments).
- Automatically calculates:
  - **On Time / Late** (precise calculation based on subject start timestamp vs. scan time in `Asia/Manila` timezone).
  - **On Break / Break Overstay** (monitors active faculty breaks).
  - **Incomplete / Undertime / Completed** status upon checkout.

### 🔄 Dual-Database Resilience & Offline Continuity
- If internet connectivity drops, the local campus server continues processing check-ins via local PostgreSQL.
- Changes are flagged with dirty sync states (`is_synced = false`, `sync_updated_at`) and automatically reconciled with Supabase once connectivity is restored.

### 📝 Audited Administrative Overrides
- When unforeseen schedule changes or emergency classes occur, the Monitoring Team can execute an attendance override via `overrideService.js`. Every override requires a recorded reason and logs an immutable audit event.

### ⚡ Real-Time Instant Updates
- Powered by **Socket.IO** to instantly broadcast check-ins, status transitions, and schedule adjustments across all active monitoring screens without requiring manual page refreshes.

---

## 6. Technology Stack

- **Frontend (Tier 1)**: HTML5, Vanilla JavaScript (ES6+), Vanilla CSS (Responsive Design, Dark Mode UI tokens), Socket.IO Client.
- **Backend (Tier 2)**: Node.js, Express.js (Modular Route & Service Architecture), node-cron (Backups & Schedulers).
- **Real-Time Communication**: Socket.IO WebSockets.
- **Data Tier (Tier 3 - Hybrid)**:
  - **Local**: PostgreSQL 15 (Docker container).
  - **Cloud**: Supabase PostgreSQL (Managed Cloud Database).
- **Server Gateway & Reverse Proxy**: Nginx (HTTP/HTTPS, TLS, WebSocket Proxying).
- **Service Discovery**: mDNS / Apple Bonjour (`workline.local`).

---

## 7. Directory Structure

```text
employeattendance/
├── public/                     # Tier 1: Frontend client assets
│   ├── css/                    # Modular stylesheets (dashboard, tables, modals)
│   ├── fonts/                  # Custom institutional webfonts
│   ├── js/                     # Client-side logic & Socket.IO listeners
│   ├── pages/                  # Role-based dashboards & interfaces
│   │   ├── Superadmin.html     # IT System Administration Portal
│   │   ├── HRDashboard.html    # Faculty Monitoring Team Portal
│   │   ├── DepartmentHead.html # Academic Department Head Portal
│   │   ├── employee.html       # Faculty Personal Portal
│   │   └── qr-display.html     # Kiosk QR Code Live Display
│   └── index.html              # Central authentication & login gateway
│
├── server/                     # Tier 2: Backend application root
│   ├── config/                 # Environment and application constants
│   ├── middleware/             # Auth, role guard, error handling, rate limits
│   ├── postgres/               # Tier 3A: SQL schemas, migrations, and RPCs
│   ├── routes/                 # Express route controllers
│   │   ├── admin.routes.js     # Superadmin IT operations
│   │   ├── attendance.routes.js# QR & attendance check-in endpoints
│   │   ├── auth.routes.js      # Authentication, sessions & password reset
│   │   ├── hr.routes.js        # Monitoring team operations & overrides
│   │   └── departmenthead.routes.js # Academic scheduling endpoints
│   ├── services/               # Core business logic layer
│   │   ├── attendanceService.js# Attendance computation engine
│   │   ├── overrideService.js  # Monitoring override management
│   │   ├── backupScheduler.js  # Automated DB dump routines
│   │   └── userService.js      # Account & profile management
│   ├── utils/                  # Audit loggers, timezone converters, sync helpers
│   ├── conn-supabase.js        # PostgreSQL & Supabase database connectors
│   └── server.js               # Main HTTP/HTTPS & Socket.IO server entry point
│
├── nginx/                      # Nginx reverse proxy configurations
│   ├── conf/nginx.conf         # Production reverse proxy & WebSocket routing
│   └── start-nginx.ps1         # Windows automated Nginx launch script
│
├── docker-compose.yml          # Container orchestration (Node app + Local PostgreSQL)
├── Dockerfile                  # Production Node.js container definition
└── START_HERE.md               # Quick execution and demo instructions
```

---

## 8. Setup & Installation

### Prerequisites
- [Node.js](https://nodejs.org/) (v18.0.0 or higher)
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (for containerized DB and server)
- [Nginx](https://nginx.org/en/download.html) (for reverse proxy & local URL resolution)

### Step 1: Clone and Configure Environment
```bash
cd employeattendance
cp .env.example .env
```
Ensure your `.env` contains valid credentials:
```env
PORT=5000
DATABASE_URL=postgresql://postgres:yourpassword@localhost:5432/employeeattendance
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-key
JWT_SECRET=your-secure-jwt-secret
NODE_ENV=production
```

### Step 2: Install Dependencies
```bash
cd server
npm install
```

### Step 3: Launch with Docker Compose (Recommended)
```bash
docker-compose up -d --build
```

### Or Run Standalone:
```bash
# In server directory
npm run start
```

---

## 9. Networking & Local Deployment

To allow faculty members to scan QR codes and access their portals from their smartphones on the campus Wi-Fi network:

1. **Access via Localhost (Host PC):**
   ```
   http://localhost
   ```
2. **Access via Campus LAN IP (Mobile / Tablet):**
   ```
   http://<HOST_IP_ADDRESS>  (e.g., http://192.168.1.199)
   ```
3. **Access via mDNS Hostname (ZeroConf):**
   ```
   http://workline.local
   ```
   *(Requires Bonjour Service enabled on the host workstation)*.

---

## 10. Database & Hybrid Synchronization

The system employs PostgreSQL stored procedures (RPCs) to guarantee transaction atomicity and sync integrity across the hybrid data layer:

- `RPC_01_attendance_break.sql`: Atomically logs break-out and break-in states.
- `RPC_02_attendance_checkin.sql`: Processes instant scan validation and sets attendance timestamps.
- `RPC_09_generate_qr_session_atomic.sql`: Issues cryptographically isolated QR tokens and invalidates stale sessions.
- `RPC_10_get_schedules_by_date_range.sql`: Efficiently retrieves active faculty schedules.
- `syncService.js`: Periodically checks for records with `is_synced = false` and synchronizes state between local Docker PostgreSQL and cloud Supabase.

---

## 11. Thesis & Research Context

- **Institution**: St. Clare College of Caloocan
- **Academic Program**: Tertiary Education / College of Computer Studies
- **Project Scope**: Faculty Attendance and Academic Schedule Monitoring
- **Architecture Model**: 3-Tier Hybrid Architecture (On-Premises Local Server + Cloud Database)
- **Primary Stakeholders**: Academic Deans, Monitoring Team, Tertiary Faculty Members, and IT Administrators.