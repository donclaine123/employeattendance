1. 🔐 Login Page
(Landing Page — Everyone lands here first)

Employee ID + Password fields
“Forgot Password?” → redirects to HR (no self-reset)
“Scan QR to Login” button (optional for quick login if session exists)
SCC Logo + System Title: Employee Attendance Portal
Footer: “Contact IT for assistance”
✅ Mandatory. No exceptions. No public access. 

2. 📸 Employee Dashboard (Scan Page)
(After Employee logs in)

Greeting: “Good morning, [Name]!”
Employee Info: ID, Department, Schedule
Big Button: “SCAN QR CODE TO LOG ATTENDANCE”
On click → activates camera → scans → shows success/error
Status Display:
✅ “You’ve logged in at 7:58 AM — Status: On Time”
⏱️ “You haven’t logged in yet.”
Recent Logs (collapsible): Last 7 days (Date | Time-In | Status)
Logout Button (top-right)
✅ Simple. Focused. Zero distractions. 

3. 👮‍♂️ Department Head Dashboard
(After Supervisor logs in)

Greeting + Department Name
Real-Time Attendance Table:
Employee Name | ID | Time-In | Status (color-coded)
Filters: Date, Status (Present/Late/Absent)
Export Button: “Download Team Report (PDF/Excel)”
Summary Cards:
Total Present Today: 12
Total Late: 3
Total Absent: 1
Logout Button
✅ Shows only their department. No access to others. 

4. 👩‍💼 HR Admin Dashboard (Main Control Panel)
(After HR Admin logs in)

Greeting + “HR Admin Panel”
Tabs or Sections:
📊 Dashboard Overview
College-wide stats: Total Present, Late, Absent
Quick filters: Date, Department
🆕 Generate QR Code
Button: “Generate Daily QR Code”
Shows last generated QR + expiry
Optional: “Revoke Current QR”
👥 Manage Employees
Table: All employees (Name, ID, Dept, Status)
Buttons: “Add Employee”, “Edit”, “Deactivate”
Search + Filter by Department
📤 Reports
“Export Daily Report (PDF/Excel)”
Date range selector
Preview before export
⚠️ Manual Override
Form: Employee ID + Reason (required)
Logs override in audit trail
Logout Button
✅ Full view. Full control. Full responsibility. 

5. 🛡️ Super Admin Dashboard (System Control)
(After Super Admin logs in)

Greeting + “System Administrator Panel”
Tabs:
👥 User Management
List of all users (including HR, Supervisors)
Add/Edit/Delete admin accounts
Assign roles (HR Admin, Supervisor)
View “Created By” and “Last Login”
🔐 System Settings
Session timeout (e.g., 15 mins)
QR validity window (e.g., 24 hours)
Enable/disable geolocation/IP restriction
💾 Backup & Restore
“Download Full Backup (Encrypted)”
“Restore from Backup” (with warning)
📜 Audit Logs
Table: Who did what, when, IP address
Filter by date, user, action type
📊 Activity Monitor
“Currently Logged In Users”
Last active timestamp
Logout Button