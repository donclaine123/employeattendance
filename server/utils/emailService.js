/**
 * Email abstraction layer for sending invitations
 * Supports SendGrid, SMTP, and development/testing providers
 */

const path = require('path');
const fs = require('fs');

class EmailService {
    constructor() {
        this.provider = process.env.EMAIL_PROVIDER || 'console'; // console, sendgrid, smtp, brevo
        this.fromEmail = process.env.EMAIL_FROM || 'noreply@localhost';
        this.baseUrl = this.resolveBaseUrl();
        
        // Initialize provider-specific settings
        this.initializeProvider();
    }
    
    resolveBaseUrl() {
        const envUrl = process.env.BASE_URL || process.env.FRONTEND_URL || 'http://localhost:5000';
        
        // If running locally, use workline.local
        if (envUrl.includes('localhost') || envUrl.includes('127.0.0.1')) {
            return 'http://workline.local';
        }
        
        // If production, ensure employeeattendance.me is used
        if (envUrl.includes('employee')) {
            return 'https://employeeattendance.me';
        }
        
        return envUrl;
    }
    
    initializeProvider() {
        switch (this.provider) {
            case 'sendgrid':
                try {
                    this.sgMail = require('@sendgrid/mail');
                    this.sgMail.setApiKey(process.env.SENDGRID_API_KEY);
                    console.log('[email] SendGrid initialized');
                } catch (error) {
                    console.error('[email] SendGrid initialization failed:', error.message);
                    this.provider = 'console';
                }
                break;
                
            case 'brevo':
                try {
                    // Use official Brevo SDK
                    const { TransactionalEmailsApi, TransactionalEmailsApiApiKeys } = require('@getbrevo/brevo');
                    
                    this.brevoApiKey = process.env.BREVO_API_KEY;
                    if (!this.brevoApiKey) {
                        throw new Error('BREVO_API_KEY not provided in environment variables');
                    }
                    
                    console.log('[email] Brevo: API Key present (first 20 chars):', this.brevoApiKey.substring(0, 20) + '...');
                    
                    this.brevoApi = new TransactionalEmailsApi();
                    this.brevoApi.setApiKey(TransactionalEmailsApiApiKeys.apiKey, this.brevoApiKey);
                    
                    console.log('[email] Brevo SDK initialized successfully');
                } catch (error) {
                    console.error('[email] Brevo initialization failed:', error.message);
                    console.error('[email] Brevo error details:', error);
                    this.provider = 'console';
                }
                break;
                
            case 'smtp':
                try {
                    this.nodemailer = require('nodemailer');
                    this.transporter = this.nodemailer.createTransport({
                        host: process.env.SMTP_HOST,
                        port: parseInt(process.env.SMTP_PORT || '587', 10),
                        secure: process.env.SMTP_SECURE === 'true',
                        auth: {
                            user: process.env.SMTP_USER,
                            pass: process.env.SMTP_PASS
                        }
                    });
                    console.log('[email] SMTP initialized');
                } catch (error) {
                    console.error('[email] SMTP initialization failed:', error.message);
                    this.provider = 'console';
                }
                break;
                
            default:
                console.log('[email] Using console provider (development mode)');
        }
    }
    
    /**
     * Transform database role names to user-friendly display names
     * @param {string} roleName - Database role name
     * @returns {string} Display-friendly role name
     */
    transformRoleName(roleName) {
        const roleMap = {
            'hr': 'Monitoring',
            'HR': 'Monitoring',
            'Hr': 'Monitoring',
            'department_head': 'Department Head',
            'employee': 'Employee',
            'superadmin': 'System Administrator'
        };
        return roleMap[roleName] || roleName;
    }
    
    /**
     * Generate HTML email template for invitation
     * @param {Object} data - Template data
     * @param {string} data.recipientEmail - Email of invitee
     * @param {string} data.inviteLink - Complete invitation link
     * @param {string} data.roleName - Role being invited for
     * @param {string} data.inviterName - Name of person sending invite
     * @param {string} data.expiresAt - Expiry timestamp
     * @returns {string} HTML email content
     */
    generateInviteEmailHTML(data) {
        const { recipientEmail, inviteLinkLocal, inviteLinkCloud, roleName, inviterName, expiresAt } = data;
        const displayRoleName = this.transformRoleName(roleName);
        
        return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Account Invitation</title>
    <style>
        /* Base Resets */
        body { 
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            background-color: #09090B; /* --bg-primary */
            color: #E4E4E7; /* --text-primary */
            margin: 0;
            padding: 0;
            width: 100%;
        }
        
        /* Container */
        .wrapper {
            background-color: #09090B;
            padding: 40px 20px;
            width: 100%;
        }
        
        .card {
            max-width: 600px;
            margin: 0 auto;
            background-color: #18181B; /* --bg-secondary */
            border-radius: 16px; /* --radius-xl */
            border: 1px solid #27272A; /* --border-primary */
            box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.4); /* --shadow-lg */
            overflow: hidden;
        }

        /* Header */
        .header {
            background-color: #18181B;
            padding: 40px 30px 20px 30px;
            text-align: center;
        }

        .header h1 {
            color: #E4E4E7; /* --text-primary */
            font-size: 24px;
            font-weight: 700;
            margin: 16px 0 8px 0;
        }

        .header p {
            color: #A1A1AA; /* --text-secondary */
            font-size: 14px;
            margin: 0;
        }

        /* Content */
        .content {
            padding: 20px 40px 40px 40px;
            color: #A1A1AA; /* --text-secondary */
            font-size: 15px;
            line-height: 1.6;
        }

        .content p {
            margin-bottom: 20px;
        }

        .content strong {
            color: #E4E4E7; /* --text-primary */
            font-weight: 600;
        }

        /* Actions */
        .actions {
            margin: 32px 0;
            display: flex;
            flex-direction: column;
            gap: 16px;
        }

        .btn-wrapper {
            text-align: center;
        }

        .btn {
            display: inline-block;
            padding: 14px 28px;
            border-radius: 8px; /* --radius-md */
            font-weight: 600;
            text-decoration: none;
            font-size: 15px;
            width: 100%;
            text-align: center;
            box-sizing: border-box;
        }

        .btn-primary {
            background-color: #FAFAFA; /* --accent-primary */
            color: #09090B; /* --bg-primary */
        }

        .btn-secondary {
            background-color: #27272A; /* --bg-tertiary */
            color: #E4E4E7; /* --text-primary */
            border: 1px solid #3F3F46; /* --border-secondary */
        }

        .btn-helper {
            font-size: 12px;
            color: #71717A; /* --text-tertiary */
            text-align: center;
            margin-top: 8px;
            margin-bottom: 24px;
        }

        /* Info Boxes */
        .info-box {
            background-color: #27272A; /* --bg-tertiary */
            border-radius: 8px;
            padding: 16px;
            margin: 24px 0;
            border-left: 3px solid #FAFAFA; /* --accent-primary */
        }
        
        .info-label {
            display: block;
            font-size: 12px;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            color: #71717A; /* --text-tertiary */
            margin-bottom: 4px;
            font-weight: 600;
        }

        .info-value {
            color: #E4E4E7; /* --text-primary */
            font-family: monospace;
            font-size: 13px;
            word-break: break-all;
        }

        /* Alert/Notice */
        .notice {
            background-color: rgba(239, 68, 68, 0.1); /* --red-primary with opacity */
            border: 1px solid rgba(239, 68, 68, 0.2);
            color: #FCA5A5; /* --red-badge-text */
            padding: 16px;
            border-radius: 8px;
            font-size: 13px;
            margin-top: 32px;
        }

        .notice strong {
            color: #EF4444; /* --red-primary */
            display: block;
            margin-bottom: 4px;
        }

        /* Footer */
        .footer {
            border-top: 1px solid #27272A; /* --border-primary */
            padding-top: 24px;
            margin-top: 32px;
            text-align: center;
            font-size: 12px;
            color: #52525B; /* --gray-600 */
        }

        /* Dark Mode Media Query Support for Email Clients */
        @media (prefers-color-scheme: dark) {
            .card { border-color: #3F3F46; }
        }
    </style>
</head>
<body>
    <div class="wrapper">
        <div class="card">
            <!-- Header -->
            <div class="header">
                <!-- Using a generic placeholder icon if specific logo URL isn't available, or simple text -->
                <div style="width: 48px; height: 48px; background: #27272A; border-radius: 12px; margin: 0 auto; display: flex; align-items: center; justify-content: center; color: #FAFAFA; font-weight: bold; font-size: 20px;">W</div>
                <h1>Account Invitation</h1>
                <p>Workline Employee Attendance</p>
            </div>

            <!-- Content -->
            <div class="content">
                <p>Hello,</p>
                <p><strong>${inviterName || 'An administrator'}</strong> has invited you to join the team as a <strong>${displayRoleName}</strong>.</p>
                <p>To get started, please complete your account setup using one of the secure links below.</p>

                <!-- Actions -->
                <div class="actions">
                    <!-- Local Link -->
                    <div class="btn-wrapper">
                        <a href="${inviteLinkLocal}" class="btn btn-primary">Setup on School Premises</a>
                        <div class="btn-helper">Use this if you are connected to the school's local network (workline.local)</div>
                    </div>

                    <!-- Cloud Link -->
                    <div class="btn-wrapper">
                        <a href="${inviteLinkCloud}" class="btn btn-secondary">Setup via Internet</a>
                        <div class="btn-helper">Use this if you are accessing from outside the school (employeeattendance.me)</div>
                    </div>
                </div>

                <!-- Manual Links -->
                <div class="info-box">
                    <span class="info-label">Or copy this link (School Network)</span>
                    <div class="info-value">${inviteLinkLocal}</div>
                </div>

                <div class="info-box">
                    <span class="info-label">Or copy this link (Public Internet)</span>
                    <div class="info-value">${inviteLinkCloud}</div>
                </div>

                <!-- Expiry Notice -->
                <div class="notice">
                    <strong>⏰ Expires Soon</strong>
                    This invitation is valid until ${new Date(expiresAt).toLocaleString()}. Please complete your setup before this time.
                </div>

                <!-- Footer -->
                <div class="footer">
                    <p>This is an automated security notification.<br>If you were not expecting this invitation, please ignore this email.</p>
                    <p>&copy; ${new Date().getFullYear()} Workline Attendance System</p>
                </div>
            </div>
        </div>
    </div>
</body>
</html>`;
    }
    
    /**
     * Generate plain text email for invitation
     * @param {Object} data - Template data
     * @returns {string} Plain text email content
     */
    generateInviteEmailText(data) {
        const { recipientEmail, inviteLinkLocal, inviteLinkCloud, roleName, inviterName, expiresAt } = data;
        
        return `
Account Invitation - Employee Attendance System

Hello!

${inviterName || 'An administrator'} has invited you to create an account as a ${roleName} in our Employee Attendance System.

To complete your account setup, visit one of these links:

🏫 SCHOOL PREMISES (Local Network):
${inviteLinkLocal}

🌐 INTERNET ACCESS:
${inviteLinkCloud}

Use the first link if you're on the school premises with local network access.
Use the second link if you're accessing from the internet.

IMPORTANT: This invitation will expire on ${new Date(expiresAt).toLocaleString()}.
Please complete your account setup before then.

SECURITY NOTICE: Do not share this invitation link with anyone. This link is personal to you and grants access to your account. If you suspect this email was sent in error, contact your administrator immediately.

If you didn't expect this invitation or have questions, please contact your administrator.

---
Employee Attendance System
This is an automated message, please do not reply to this email.
`;
    }

    generatePasswordResetEmailHTML(data) {
        const { recipientEmail, resetLinkLocal, resetLinkCloud, expiresAt } = data;
        
        return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Password Reset Request</title>
    <style>
        body { 
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background-color: #09090B;
            color: #E4E4E7;
            margin: 0;
            padding: 0;
            width: 100%;
        }
        .wrapper { padding: 40px 20px; width: 100%; }
        .card { max-width: 600px; margin: 0 auto; background-color: #18181B; border-radius: 16px; border: 1px solid #27272A; box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.4); overflow: hidden; }
        .header { background-color: #18181B; padding: 40px 30px 20px 30px; text-align: center; }
        .header h1 { color: #E4E4E7; font-size: 24px; font-weight: 700; margin: 16px 0 8px 0; }
        .content { padding: 20px 40px 40px 40px; color: #A1A1AA; font-size: 15px; line-height: 1.6; }
        .actions { margin: 32px 0; display: flex; flex-direction: column; gap: 16px; }
        .btn-container { text-align: left; background: #27272A; padding: 20px; border-radius: 12px; }
        .btn-container h3 { margin: 0 0 12px 0; font-size: 14px; color: #A1A1AA; text-transform: uppercase; letter-spacing: 0.05em; }
        .btn { display: inline-block; padding: 12px 24px; background-color: #FAFAFA; color: #09090B !important; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 14px; text-align: center; width: 100%; box-sizing: border-box; }
        .btn-cloud { background-color: transparent; color: #FAFAFA !important; border: 1px solid #FAFAFA; }
        .footer { background-color: #09090B; padding: 24px 30px; text-align: center; border-top: 1px solid #27272A; }
        .footer p { color: #71717A; font-size: 13px; margin: 0; line-height: 1.5; }
    </style>
</head>
<body>
    <div class="wrapper">
        <div class="card">
            <div class="header">
                <h1>Password Reset</h1>
            </div>
            <div class="content">
                <p>Hello,</p>
                <p>We received a request to reset the password for your account associated with <strong>${recipientEmail}</strong>.</p>
                
                <div class="actions">
                    <div class="btn-container">
                        <h3>🏫 If you are on School Premises</h3>
                        <a href="${resetLinkLocal}" class="btn">Reset Password (Local)</a>
                    </div>
                    <div class="btn-container">
                        <h3>🌍 If you are at Home / using Mobile Data</h3>
                        <a href="${resetLinkCloud}" class="btn btn-cloud">Reset Password (Cloud)</a>
                    </div>
                </div>

                <div style="background: rgba(245, 158, 11, 0.1); border: 1px solid rgba(245, 158, 11, 0.2); border-radius: 8px; padding: 16px; margin-top: 24px; font-size: 14px;">
                    <strong style="color: #F59E0B;">Security Notice:</strong>
                    <br>This link will expire on <strong>${new Date(expiresAt).toLocaleString()}</strong>.
                    If you did not request a password reset, please ignore this email or contact your administrator.
                </div>
            </div>
            <div class="footer">
                <p>Employee Attendance System</p>
                <p>This is an automated message, please do not reply.</p>
            </div>
        </div>
    </div>
</body>
</html>`;
    }

    generatePasswordResetEmailText(data) {
        const { recipientEmail, resetLinkLocal, resetLinkCloud, expiresAt } = data;
        return `
Password Reset Request - Employee Attendance System

Hello,
We received a request to reset the password for your account (${recipientEmail}).

To reset your password, visit one of these links:

🏫 SCHOOL PREMISES (Local Network):
${resetLinkLocal}

🌍 INTERNET ACCESS:
${resetLinkCloud}

IMPORTANT: This link will expire on ${new Date(expiresAt).toLocaleString()}.
If you did not request a password reset, you can safely ignore this email.

---
Employee Attendance System
This is an automated message, please do not reply to this email.
`;
    }

    async sendPasswordResetEmail(resetData) {
        const { email, resetLink, expiresAt } = resetData;
        
        // Extract the token from the resetLink
        const token = resetLink.split('token=')[1];
        
        // Generate both local and cloud links
        const resetLinkLocal = `http://workline.local/pages/reset-password.html?token=${token}`;
        const resetLinkCloud = `https://employeeattendance.me/pages/reset-password.html?token=${token}`;
        
        const templateData = {
            recipientEmail: email,
            resetLinkLocal,
            resetLinkCloud,
            expiresAt
        };
        
        const htmlContent = this.generatePasswordResetEmailHTML(templateData);
        const textContent = this.generatePasswordResetEmailText(templateData);
        
        const subject = `Password Reset Request`;
        
        try {
            switch (this.provider) {
                case 'sendgrid':
                    return await this.sendViaSendGrid(email, subject, htmlContent, textContent);
                case 'brevo':
                    return await this.sendViaBrevo(email, subject, htmlContent, textContent);
                case 'smtp':
                    return await this.sendViaSMTP(email, subject, htmlContent, textContent);
                default:
                    return this.sendViaConsole(email, subject, htmlContent, resetLinkLocal, resetLinkCloud);
            }
        } catch (error) {
            console.error('[email] Failed to send password reset:', error.message);
            return { success: false, error: error.message };
        }
    }
    
    /**
     * Send invitation email
     * @param {Object} inviteData - Invitation data
     * @param {string} inviteData.email - Recipient email
     * @param {string} inviteData.inviteLink - Complete invitation link
     * @param {string} inviteData.roleName - Role name
     * @param {string} inviteData.inviterName - Inviter name
     * @param {string} inviteData.expiresAt - Expiration timestamp
     * @returns {Promise<boolean>} Success status
     */
    async sendInvitationEmail(inviteData) {
        const { email, inviteLink, roleName, inviterName, expiresAt } = inviteData;
        
        // Extract the token from the inviteLink
        const token = inviteLink.split('token=')[1];
        
        // Generate both local and cloud links
        const inviteLinkLocal = `http://workline.local/pages/accept-invite.html?token=${token}`;
        const inviteLinkCloud = `https://employeeattendance.me/pages/accept-invite.html?token=${token}`;
        
        const templateData = {
            recipientEmail: email,
            inviteLinkLocal,
            inviteLinkCloud,
            roleName,
            inviterName,
            expiresAt
        };
        
        const htmlContent = this.generateInviteEmailHTML(templateData);
        const textContent = this.generateInviteEmailText(templateData);
        
        const subject = `Account Invitation - ${roleName} Access`;
        
        try {
            switch (this.provider) {
                case 'sendgrid':
                    return await this.sendViaSendGrid(email, subject, htmlContent, textContent);
                    
                case 'brevo':
                    return await this.sendViaBrevo(email, subject, htmlContent, textContent);
                    
                case 'smtp':
                    return await this.sendViaSMTP(email, subject, htmlContent, textContent);
                    
                default:
                    return this.sendViaConsole(email, subject, htmlContent, inviteLinkLocal, inviteLinkCloud);
            }
        } catch (error) {
            console.error('[email] Failed to send invitation:', error.message);
            return { success: false, error: error.message };
        }
    }
    
    async sendViaSendGrid(to, subject, html, text) {
        try {
            await this.sgMail.send({
                to,
                from: this.fromEmail,
                subject,
                html,
                text
            });
            console.log(`[email] SendGrid: Invitation sent to ${to}`);
            return { success: true };
        } catch (error) {
            console.error('[email] SendGrid error:', error.message);
            return { success: false, error: error.message };
        }
    }
    
    async sendViaBrevo(to, subject, html, text) {
        try {
            console.log('[email] Brevo: Attempting to send email to:', to);
            console.log('[email] Brevo API initialized:', !!this.brevoApi);
            
            // Use official Brevo SDK
            const { SendSmtpEmail } = require('@getbrevo/brevo');
            
            const emailData = new SendSmtpEmail();
            emailData.sender = {
                email: this.fromEmail,
                name: 'Employee Attendance System'
            };
            emailData.to = [{ email: to }];
            emailData.subject = subject;
            emailData.htmlContent = html;
            emailData.textContent = text;
            
            console.log('[email] Brevo: Email data prepared, sending now...');
            
            if (!this.brevoApi) {
                throw new Error('Brevo API not initialized');
            }
            
            const result = await this.brevoApi.sendTransacEmail(emailData);
            
            console.log(`[email] Brevo: Invitation sent to ${to}, messageId: ${result.body?.messageId || 'N/A'}`);
            console.log('[email] Brevo: Full response:', JSON.stringify(result));
            return { success: true, messageId: result.body?.messageId };
            
        } catch (error) {
            console.error('[email] Brevo error:', error.message);
            console.error('[email] Brevo error stack:', error.stack);
            console.error('[email] Brevo error full:', error);
            
            // Extract more details from error
            let errorMessage = error.message;
            let errorCode = null;
            
            // Parse Brevo API error response
            if (error.response && error.response.body) {
                const body = error.response.body;
                errorCode = body.code;
                errorMessage = body.message || errorMessage;
                
                // Add more context for common Brevo errors
                if (body.code === 'invalid_email') {
                    errorMessage = `Invalid email address: ${to}`;
                } else if (body.code === 'blocked_email' || body.message?.includes('blocked')) {
                    errorMessage = `Email address is blocked in Brevo. Contact support to unblock: ${to}`;
                } else if (body.code === 'invalid_sender') {
                    errorMessage = 'Sender email not verified in Brevo';
                }
            }
            
            return { 
                success: false, 
                error: errorMessage,
                errorCode: errorCode,
                details: {
                    recipient: to,
                    message: errorMessage,
                    code: errorCode
                }
            };
        }
    }
    
    async sendViaSMTP(to, subject, html, text) {
        try {
            await this.transporter.sendMail({
                from: this.fromEmail,
                to,
                subject,
                html,
                text
            });
            console.log(`[email] SMTP: Invitation sent to ${to}`);
            return { success: true };
        } catch (error) {
            console.error('[email] SMTP error:', error.message);
            return { success: false, error: error.message };
        }
    }
    
    sendViaConsole(to, subject, html, inviteLinkLocal, inviteLinkCloud) {
        console.log('\n=== EMAIL SENT (CONSOLE MODE) ===');
        console.log(`To: ${to}`);
        console.log(`Subject: ${subject}`);
        console.log(`🏫 Local Link (School Premises): ${inviteLinkLocal}`);
        console.log(`🌐 Cloud Link (Internet): ${inviteLinkCloud}`);
        console.log('=====================================\n');
        return { success: true };
    }
}

// Export singleton instance
module.exports = EmailService;