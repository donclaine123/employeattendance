📱 Web-Based QR Code Attendance and Monitoring System for Employees of St. Clare College of Caloocan
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