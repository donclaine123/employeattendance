/**
 * Email abstraction layer for sending invitations
 * Supports SendGrid, SMTP, and development/testing providers
 */

const path = require('path');
const fs = require('fs');

class EmailService {
    constructor() {
        this.provider = process.env.EMAIL_PROVIDER || 'brevo'; // console, sendgrid, smtp, brevo
        this.fromEmail = process.env.EMAIL_FROM || 'noreply@localhost';
        this.baseUrl = this.resolveBaseUrl();
        this.cloudBaseUrl = this.normalizeBaseUrl(process.env.CLOUD_BASE_URL || 'https://employeeattendance.me', 'https:');
        this.localRuntime = this.isLocalRuntime();
        
        // Initialize provider-specific settings
        this.initializeProvider();
    }

    normalizeBaseUrl(value, defaultProtocol = 'http:') {
        const rawValue = String(value || '').trim();

        if (!rawValue) {
            return '';
        }

        if (/^https?:\/\//i.test(rawValue)) {
            return rawValue.replace(/\/+$/, '');
        }

        const protocol = defaultProtocol.endsWith(':') ? defaultProtocol : `${defaultProtocol}:`;
        return `${protocol}//${rawValue.replace(/^\/+/, '')}`.replace(/\/+$/, '');
    }

    extractHostname(value) {
        const normalizedValue = this.normalizeBaseUrl(value);

        if (!normalizedValue) {
            return '';
        }

        try {
            return new URL(normalizedValue).hostname.toLowerCase();
        } catch (error) {
            return normalizedValue
                .replace(/^https?:\/\//i, '')
                .split('/')[0]
                .split(':')[0]
                .toLowerCase();
        }
    }

    isLocalHostname(hostname) {
        if (!hostname) {
            return false;
        }

        return hostname === 'localhost'
            || hostname === '127.0.0.1'
            || hostname === '::1'
            || hostname === 'workline.local'
            || hostname === 'local.employeeattendance.me'
            || hostname.startsWith('local.')
            || hostname.includes('.local.');
    }
    
    resolveBaseUrl() {
        const sslEnabled = process.env.SSL_ENABLED === 'true';
        const localDomain = process.env.DOMAIN_NAME || process.env.LOCAL_DOMAIN || '';

        if (localDomain && this.isLocalHostname(this.extractHostname(localDomain))) {
            return this.normalizeBaseUrl(localDomain, sslEnabled ? 'https:' : 'http:');
        }

        const envUrl = process.env.BASE_URL || process.env.FRONTEND_URL || 'http://localhost:5000';
        return this.normalizeBaseUrl(envUrl, sslEnabled ? 'https:' : 'http:');
    }

    isLocalRuntime() {
        if (process.env.EMAIL_ALLOW_EXTERNAL === 'true') {
            return false;
        }

        const hostname = this.extractHostname(
            this.baseUrl ||
            process.env.DOMAIN_NAME ||
            process.env.BASE_URL ||
            process.env.FRONTEND_URL
        );

        return this.isLocalHostname(hostname);
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
                    this.providerError = error;
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

                    if (this.fromEmail) {
                        const senderDomain = String(this.fromEmail).split('@')[1]?.toLowerCase() || '';
                        const commonFreeMailDomains = ['gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'live.com', 'aol.com'];
                        if (commonFreeMailDomains.includes(senderDomain)) {
                            console.warn('[email] Brevo sender uses a public mailbox. Make sure this sender is registered and verified in Brevo or switch EMAIL_FROM to a verified domain sender.');
                        }
                    }
                    
                    console.log('[email] Brevo: API Key present (first 20 chars):', this.brevoApiKey.substring(0, 20) + '...');
                    
                    this.brevoApi = new TransactionalEmailsApi();
                    this.brevoApi.setApiKey(TransactionalEmailsApiApiKeys.apiKey, this.brevoApiKey);
                    
                    console.log('[email] Brevo SDK initialized successfully');
                } catch (error) {
                    console.error('[email] Brevo initialization failed:', error.message);
                    console.error('[email] Brevo error details:', error);
                    this.providerError = error;
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
                    this.providerError = error;
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
        const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        }[character]));

        const safeInviterName = escapeHtml(inviterName || 'An administrator');
        const safeRoleName = escapeHtml(displayRoleName);
        const safeInviteLinkLocal = escapeHtml(inviteLinkLocal || '#');
        const safeInviteLinkCloud = escapeHtml(inviteLinkCloud || '#');
        const logoBaseUrl = this.cloudBaseUrl || this.baseUrl || '';
        const safeLogoUrl = logoBaseUrl ? escapeHtml(`${logoBaseUrl}/images/logo1.png`) : '';
        const expiryDate = expiresAt ? new Date(expiresAt) : null;
        const safeExpiryDate = expiryDate && !Number.isNaN(expiryDate.getTime())
            ? escapeHtml(expiryDate.toLocaleString())
            : 'N/A';
        const currentYear = new Date().getFullYear();
        
        return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Account Invitation</title>
    <style>
        body {
            margin: 0;
            padding: 0;
            width: 100%;
            background: #ffffff;
            color: #111827;
            font-family: Arial, Helvetica, sans-serif;
            -webkit-text-size-adjust: 100%;
            -ms-text-size-adjust: 100%;
        }

        .preheader {
            display: none !important;
            visibility: hidden;
            opacity: 0;
            color: transparent;
            height: 0;
            width: 0;
            max-height: 0;
            max-width: 0;
            overflow: hidden;
            mso-hide: all;
        }

        .wrapper {
            width: 100%;
            background: #ffffff;
            padding: 24px 16px;
            box-sizing: border-box;
        }

        .container {
            width: 100%;
            max-width: 640px;
            margin: 0 auto;
        }

        .card {
            background: #ffffff;
            border: 0;
            border-radius: 16px;
            overflow: hidden;
            box-shadow: none;
        }

        .header {
            padding: 18px 24px 12px;
            text-align: left;
        }

        .brand-mark {
            width: 36px;
            height: 36px;
            border-radius: 10px;
            margin: 0 0 18px;
            display: flex;
            align-items: center;
            justify-content: center;
            background: #f3f4f6;
            border: 1px solid #e5e7eb;
            overflow: hidden;
        }

        .brand-mark img {
            width: 100%;
            height: 100%;
            object-fit: contain;
            display: block;
        }

        .eyebrow {
            display: inline-block;
            margin-bottom: 10px;
            color: #6b7280;
            font-size: 11px;
            font-weight: 700;
            letter-spacing: 0.06em;
            text-transform: uppercase;
        }

        .header h1 {
            margin: 0 0 8px;
            color: #111827;
            font-size: 29px;
            line-height: 1.15;
            font-weight: 800;
            letter-spacing: -0.03em;
        }

        .header p {
            margin: 0;
            color: #6b7280;
            font-size: 14px;
            line-height: 1.7;
        }

        .header p strong {
            color: #111827;
        }

        .content {
            padding: 0 24px 24px;
        }

        .section-label {
            display: block;
            margin: 24px 0 10px;
            color: #6b7280;
            font-size: 12px;
            font-weight: 700;
            letter-spacing: 0.02em;
            text-transform: uppercase;
        }

        .summary-table,
        .actions-table {
            width: 100%;
            border-collapse: separate;
            border-spacing: 0;
        }

        .summary-cell,
        .action-cell {
            vertical-align: top;
            padding: 0 6px;
        }

        .summary-card {
            background: #f8fafc;
            border: 1px solid #e5e7eb;
            border-radius: 12px;
            padding: 14px 16px;
        }

        .summary-label {
            display: block;
            margin-bottom: 6px;
            color: #6b7280;
            font-size: 10px;
            font-weight: 700;
            letter-spacing: 0.06em;
            text-transform: uppercase;
        }

        .summary-value {
            display: block;
            color: #111827;
            font-size: 13px;
            line-height: 1.45;
            font-weight: 600;
            word-break: break-word;
        }

        .greeting {
            margin: 20px 0 8px;
            color: #111827;
            font-size: 14px;
            line-height: 1.6;
            font-weight: 600;
        }

        .body-copy {
            margin: 0 0 0;
            color: #6b7280;
            font-size: 14px;
            line-height: 1.75;
        }

        .body-copy strong {
            color: #111827;
            font-weight: 700;
        }

        .action-card {
            background: #f8fafc;
            border: 1px solid #e5e7eb;
            border-radius: 14px;
            padding: 18px;
            height: 100%;
        }

        .action-kicker {
            display: block;
            margin-bottom: 6px;
            color: #6b7280;
            font-size: 10px;
            font-weight: 700;
            letter-spacing: 0.06em;
            text-transform: uppercase;
        }

        .action-title {
            margin: 0 0 8px;
            color: #111827;
            font-size: 15px;
            line-height: 1.25;
            font-weight: 700;
            letter-spacing: -0.02em;
        }

        .action-copy {
            margin: 0 0 18px;
            color: #4b5563;
            font-size: 13px;
            line-height: 1.65;
            min-height: 42px;
        }

        .btn {
            display: block;
            padding: 12px 16px;
            border-radius: 10px;
            text-decoration: none;
            text-align: center;
            font-size: 14px;
            font-weight: 700;
        }

        .btn-primary {
            background: #7f1d1d;
            border: 1px solid #7f1d1d;
            color: #ffffff !important;
        }

        .btn-secondary {
            background: #7f1d1d;
            border: 1px solid #7f1d1d;
            color: #ffffff !important;
        }

        .action-hint {
            margin-top: 10px;
            color: #6b7280;
            font-size: 12px;
            line-height: 1.5;
            text-align: center;
        }

        .copy-box {
            background: #f8fafc;
            border: 1px solid #e5e7eb;
            border-radius: 12px;
            padding: 14px 16px;
            margin-top: 12px;
        }

        .copy-label {
            display: block;
            margin-bottom: 6px;
            color: #6b7280;
            font-size: 10px;
            font-weight: 700;
            letter-spacing: 0.06em;
            text-transform: uppercase;
        }

        .copy-value {
            color: #111827;
            font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
            font-size: 13px;
            line-height: 1.55;
            word-break: break-all;
        }

        .notice {
            margin-top: 24px;
            background: #fffbeb;
            border: 1px solid #fde68a;
            border-left: 4px solid #f59e0b;
            border-radius: 12px;
            padding: 16px 16px 15px;
        }

        .notice strong {
            display: block;
            margin-bottom: 6px;
            color: #92400e;
            font-size: 13px;
            font-weight: 800;
            letter-spacing: 0.02em;
        }

        .notice p {
            margin: 0;
            color: #92400e;
            font-size: 13px;
            line-height: 1.65;
        }

        .footer {
            margin-top: 24px;
            padding-top: 18px;
            border-top: 1px solid #e5e7eb;
            text-align: center;
        }

        .footer p {
            margin: 0;
            color: #6b7280;
            font-size: 12px;
            line-height: 1.6;
        }

        .footer p + p {
            margin-top: 8px;
        }

        @media only screen and (max-width: 620px) {
            .wrapper {
                padding: 14px 10px;
            }

            .header,
            .content {
                padding-left: 18px;
                padding-right: 18px;
            }

            .header {
                padding-top: 16px;
                padding-bottom: 10px;
            }

            .header h1 {
                font-size: 26px;
            }

            .greeting {
                margin-top: 18px;
            }

            .summary-cell,
            .action-cell {
                display: block;
                width: 100%;
                padding: 0;
            }

            .summary-cell + .summary-cell,
            .action-cell + .action-cell {
                margin-top: 12px;
            }

            .action-card {
                padding: 18px;
            }

            .btn {
                padding: 12px 16px;
            }

            .copy-box {
                padding: 14px 16px;
            }
        }
    </style>
</head>
<body>
    <div class="preheader">You've been invited by ${safeInviterName} to join Workline as a ${safeRoleName}. Complete setup using the link that matches your network.</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" class="wrapper">
        <tr>
            <td align="center">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" class="container">
                    <tr>
                        <td class="card">
                            <div class="header">
                                <div class="brand-mark" aria-hidden="true">
                                    ${safeLogoUrl ? `<img src="${safeLogoUrl}" alt="Workline logo">` : 'W'}
                                </div>
                                <div class="eyebrow">Account invitation</div>
                                <h1>You've been invited to join Workline</h1>
                                <p>Choose the setup option that matches where you're accessing the system.</p>
                            </div>

                            <div class="content">
                                <p class="greeting">Hello,</p>
                                <p class="body-copy"><strong>${safeInviterName}</strong> has invited you to join the team as an <strong>${safeRoleName}</strong>.</p>
                                <p class="body-copy" style="margin-top: 10px;">To get started, use one of the secure setup options below. Both links take you to the same invitation, but each is optimized for a different network.</p>

                                <span class="section-label">Choose a setup method</span>
                                <table role="presentation" class="actions-table" width="100%">
                                    <tr>
                                        <td class="action-cell" width="50%">
                                            <div class="action-card">
                                                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                                                    <tr>
                                                        <td valign="top">
                                                            <div class="action-kicker">On campus</div>
                                                            <h2 class="action-title">School network</h2>
                                                            <p class="action-copy">Use this if you are connected to the school's local network.</p>
                                                        </td>
                                                        <td valign="top" align="right" style="padding-left: 12px;">
                                                            <div style="width: 28px; height: 28px; border-radius: 8px; background: #f3f4f6; border: 1px solid #e5e7eb; color: #6b7280; font-size: 12px; font-weight: 700; line-height: 28px; text-align: center;">L</div>
                                                        </td>
                                                    </tr>
                                                </table>
                                                <a href="${safeInviteLinkLocal}" target="_blank" rel="noopener noreferrer" class="btn btn-primary">Open local setup</a>
                                            </div>
                                        </td>
                                        <td class="action-cell" width="50%">
                                            <div class="action-card">
                                                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                                                    <tr>
                                                        <td valign="top">
                                                            <div class="action-kicker">Off campus</div>
                                                            <h2 class="action-title">Public internet</h2>
                                                            <p class="action-copy">Use this if you are setting up your account from outside the school.</p>
                                                        </td>
                                                        <td valign="top" align="right" style="padding-left: 12px;">
                                                            <div style="width: 28px; height: 28px; border-radius: 8px; background: #f3f4f6; border: 1px solid #e5e7eb; color: #6b7280; font-size: 12px; font-weight: 700; line-height: 28px; text-align: center;">W</div>
                                                        </td>
                                                    </tr>
                                                </table>
                                                <a href="${safeInviteLinkCloud}" target="_blank" rel="noopener noreferrer" class="btn btn-secondary">Open web setup</a>
                                            </div>
                                        </td>
                                    </tr>
                                </table>

                                <span class="section-label">Direct links</span>
                                <div class="copy-box">
                                    <span class="copy-label">School network link</span>
                                    <div class="copy-value"><a href="${safeInviteLinkLocal}" target="_blank" rel="noopener noreferrer" style="color:#2563eb;text-decoration:none;word-break:break-all;">${safeInviteLinkLocal}</a></div>
                                </div>
                                <div class="copy-box">
                                    <span class="copy-label">Public internet link</span>
                                    <div class="copy-value"><a href="${safeInviteLinkCloud}" target="_blank" rel="noopener noreferrer" style="color:#2563eb;text-decoration:none;word-break:break-all;">${safeInviteLinkCloud}</a></div>
                                </div>

                                <div class="notice">
                                    <strong>Invitation expires soon</strong>
                                    <p>This invitation is valid until ${safeExpiryDate}. Complete your setup before that time.</p>
                                </div>

                                <div class="footer">
                                    <p>This is an automated security notification. If you were not expecting this invitation, you can safely ignore this email.</p>
                                    <p>&copy; ${currentYear} Workline Attendance System</p>
                                </div>
                            </div>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
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

🏫 LOCAL NETWORK:
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
                        <h3>🏫 If you are on the local network</h3>
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

🏫 LOCAL NETWORK:
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
        const resetLinkLocal = `${this.baseUrl}/pages/reset-password.html?token=${token}`;
        const resetLinkCloud = `${this.cloudBaseUrl}/pages/reset-password.html?token=${token}`;
        
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
        const inviteLinkLocal = `${this.baseUrl}/pages/accept-invite.html?token=${token}`;
        const inviteLinkCloud = `${this.cloudBaseUrl}/pages/accept-invite.html?token=${token}`;
        
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
        console.log(`🏫 Local Link: ${inviteLinkLocal}`);
        console.log(`🌐 Cloud Link (Internet): ${inviteLinkCloud}`);
        console.log('=====================================\n');
        return { success: true };
    }
}

// Export singleton instance
module.exports = EmailService;