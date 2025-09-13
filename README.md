📱 Design and Implementation of a Web-Based QR Code Attendance and Monitoring System for Employees of St. Clare College of Caloocan

A secure, role-based attendance system designed to replace manual logs with automated, tamper-resistant digital tracking — built for real-world adoption at SCC. 

🚀 Project Overview
This system enables St. Clare College of Caloocan employees to log daily attendance by scanning a unique QR code via any web browser — no app install required. Built with evolutionary prototyping, the system evolved through real feedback from HR and administrative staff to ensure usability, security, and institutional fit.

🎯 Primary Goals:

Eliminate proxy attendance
Reduce manual workload for HR
Provide real-time monitoring for supervisors
Generate accurate, exportable reports for payroll
Ensure data privacy and auditability

🧑‍💼 User Roles

Employee
Login → Scan QR → View own logs
Department Head
View & export attendance for their team only
HR Admin
Generate QR codes, manage employees, view/export all data
Super Admin
Full system access, user management, backup/restore

🔐 No self-registration. All accounts created by HR or Super Admin.

🛠️ Tech Stack
Frontend: HTML, CSS, JavaScript, Bootstrap (mobile-responsive)
Backend: PHP (Laravel) / Node.js (pick one)
Database: MySQL
QR Library: qrcode.js (client-side) or server-side generator
Hosting: XAMPP (local dev), deployable on Render, Railway, or Vercel
Security: Password hashing (bcrypt), session timeout, input sanitization

🔄 System Flow (Simplified)
Morning: HR Admin generates daily QR code.
Employee: Logs in → scans QR → system records time-in + status (On Time / Late).
Real-Time: Dashboard updates for HR & supervisors.
End of Day: HR exports PDF/Excel report for payroll.
Audit: All actions logged. No deletions — only “Invalid” flags.


📌 System Documentation (Guidelines & Roadmap)
1. System Overview

Web-based QR Code Attendance & Monitoring System for employees.

Purpose: Automate attendance, reduce errors, prevent proxy logins, and provide HR with accurate reports.

2. Core Features

Employee Authentication

Login using employee ID + password (later maybe OTP or email verification).

QR Code Attendance

Each session/day generates a unique QR code.

Employees scan it to log attendance.

Attendance Monitoring

Time-in / time-out tracking.

Daily, weekly, monthly reports.

Admin Dashboard

View attendance logs.

Export reports (CSV/PDF).

Detect anomalies (e.g., multiple scans).

Notifications (Optional)

Email confirmation of attendance.

Reminders for missing time logs.

3. Guidelines for Development

Use Evolutionary Prototyping: build a basic working version → get feedback → refine.

Keep it Simple First: start with login + QR scan + basic reports.

Security First:

Prevent multiple scans in the same period.

Validate employee identity.

Scalability: System should handle growing employee records.

4. Roadmap (Phases)

Phase 1: Core Attendance

Employee login.

QR scan attendance (time-in).

Basic database logging.

Phase 2: Time-out + Reports

Add time-out scanning.

Generate attendance reports.

Admin dashboard (basic).

Phase 3: Security Enhancements

Prevent duplicate/proxy scans.

Add session control.

Phase 4: Usability Features

Notifications / summaries.

Export functions (PDF/Excel).

Mobile responsiveness.



📑 Functional Requirements Specification (FRS)
"Design and Implementation of a Web-Based QR Code Attendance and Monitoring System for Employees of St. Clare College of Caloocan"

1. Introduction

This FRS defines the functional requirements for the Web-Based QR Code Attendance and Monitoring System. It specifies the system behaviors, inputs, outputs, and interactions to ensure accurate and secure employee attendance tracking.

2. Functional Requirements
2.1 User Authentication & Security

FR-1: The system shall allow employees, supervisors, HR, and super admin to log in using a unique ID and password.

FR-2: Passwords shall be stored using hashing (e.g., bcrypt/MD5).

FR-3: The system shall automatically log out users after 15 minutes of inactivity.

FR-4: The system shall restrict access based on role permissions.

2.2 QR Code Generation

FR-5: The system shall generate a unique, encrypted QR code for attendance daily.

FR-6: Only the HR admin can generate the official QR code for the day.

FR-7: Generated QR codes shall expire after 24 hours or once the attendance window closes.

2.3 Attendance Logging

FR-8: Employees shall be able to scan the QR code using their device camera via the browser.

FR-9: The system shall record the following data upon successful scan:

Employee ID

Full Name

Department

Date & Time-In

Attendance Status (On Time / Late / Absent)

FR-10: The system shall prevent duplicate attendance logs for the same day unless it is a valid time-out entry.

FR-11: The system shall notify the employee if their scan is successful or invalid.

2.4 Monitoring & Reporting

FR-12: Supervisors shall view attendance records only for employees under their department.

FR-13: HR shall view attendance records for all employees across the institution.

FR-14: The system shall allow filtering of attendance records by:

Date

Department

Status (Present, Late, Absent)

FR-15: The system shall automatically flag employees as Late if their log time is after the set schedule.

FR-16: The system shall automatically mark employees as Absent if no scan is recorded for the day.

FR-17: The system shall provide export functionality (CSV/PDF) for reports.

2.5 Security & Integrity

FR-18: The system shall block QR scans from unregistered or unauthorized users.

FR-19: The system shall store all admin actions (add/edit/delete) in an activity log.

FR-20: The system shall maintain an audit trail of changes in attendance records.

FR-21: The system shall reject attendance scans from devices outside the SCC network (if geolocation/IP restriction is enabled).

2.6 User & System Management

FR-22: HR and Super Admin shall be able to add, edit, and delete employee accounts.

FR-23: Supervisors shall not have access to employee account management.

FR-24: Super Admin shall have the ability to back up and restore the database.

FR-25: The system shall provide a dashboard showing real-time attendance logs.

3. Non-Functional Notes (Optional to include here)

Though mainly covered in the SRS, the FRS assumes the following constraints:

The system shall be mobile-responsive and work on common browsers (Chrome, Edge, Firefox).

The system shall process QR scan validation in under 2 seconds.

The system shall support at least 200 concurrent users during peak time.