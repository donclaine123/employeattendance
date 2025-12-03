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
        this.baseUrl = process.env.BASE_URL || 'http://localhost:5000';
        
        // Initialize provider-specific settings
        this.initializeProvider();
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
        const { recipientEmail, inviteLink, roleName, inviterName, expiresAt } = data;
        
        return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Account Invitation</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            line-height: 1.6;
            color: #1F2937;
            background: #FFFFFF;
            padding: 20px;
        }
        .container { max-width: 600px; margin: 0 auto; }
        .header {
            background: transparent;
            color: #1F2937;
            padding: 32px 24px;
            text-align: center;
            border-radius: 12px 12px 0 0;
            border: 1px solid #D946EF;
            border-bottom: none;
        }
        .header h1 { font-size: 28px; font-weight: 700; margin-bottom: 8px; color: #D946EF; }
        .header p { font-size: 14px; color: #4B5563; opacity: 1; font-weight: 500; }
        .content {
            background: transparent;
            padding: 32px;
            border: 1px solid #D946EF;
            border-top: none;
            border-radius: 0 0 12px 12px;
        }
        .content h2 { font-size: 20px; font-weight: 600; margin-bottom: 16px; color: #1F2937; }
        .content p { margin-bottom: 16px; font-size: 14px; color: #4B5563; line-height: 1.7; }
        .content strong { color: #1F2937; }
        .button-container { text-align: center; margin: 28px 0; }
        .button {
            display: inline-block;
            background: transparent;
            color: #D946EF;
            padding: 14px 36px;
            text-decoration: none;
            border-radius: 8px;
            font-weight: 700;
            font-size: 15px;
            transition: all 200ms ease-in-out;
            border: 2px solid #D946EF;
            white-space: nowrap;
            mso-padding-alt: 14px 36px;
        }
        .button:hover { background: #D946EF; color: #0A0A0A; }
        a { color: #D946EF; text-decoration: underline; }
        a:hover { color: #E879F9; }
        .link-box {
            word-break: break-all;
            background: transparent;
            padding: 12px;
            border: 1px solid #D946EF;
            border-radius: 6px;
            font-size: 12px;
            color: #D946EF;
            margin: 16px 0;
        }
        .warning {
            background: transparent;
            border: 2px solid #D946EF;
            padding: 16px;
            border-radius: 6px;
            margin: 24px 0;
            font-size: 13px;
        }
        .warning strong { color: #D946EF; }
        .security-notice {
            background: transparent;
            border: 2px solid #D946EF;
            padding: 16px;
            border-radius: 6px;
            margin: 24px 0;
            font-size: 13px;
            color: #1F2937;
        }
        .security-notice strong { color: #D946EF; }
        hr { border: none; border-top: 1px solid #1F1F1F; margin: 24px 0; padding: 0; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>Account Invitation</h1>
            <p>Employee Attendance System</p>
        </div>
        
        <div class="content">
            <h2>You've been invited to join</h2>
            
            <p>Hello!</p>
            
            <p><strong>${inviterName || 'An administrator'}</strong> has invited you to create an account as a <strong>${roleName}</strong> in our Employee Attendance System.</p>
            
            <p>To complete your account setup, click the button below:</p>
            
            <div class="button-container">
                <a href="${inviteLink}" class="button">Complete Account Setup</a>
            </div>
            
            <p>Or copy and paste this link in your browser:</p>
            <div class="link-box">${inviteLink}</div>
            
            <div class="warning">
                <strong>⏰ Important Expiry Notice</strong><br>
                This invitation will expire on <strong>${new Date(expiresAt).toLocaleString()}</strong>.<br>
                Please complete your account setup before then.
            </div>
            
            <div class="security-notice">
                <strong>🔒 Security Notice</strong><br>
                Do not share this invitation link with anyone. This link is personal to you and grants access to your account. If you suspect this email was sent in error, contact your administrator immediately.
            </div>
            
            <p>If you didn't expect this invitation or have questions, please contact your administrator.</p>
            
            <hr>
            <p style="font-size: 12px; color: #9CA3AF; text-align: center; margin-top: 16px;">Employee Attendance System<br>This is an automated message, please do not reply to this email.</p>
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
        const { recipientEmail, inviteLink, roleName, inviterName, expiresAt } = data;
        
        return `
Account Invitation - Employee Attendance System

Hello!

${inviterName || 'An administrator'} has invited you to create an account as a ${roleName} in our Employee Attendance System.

To complete your account setup, visit this link:
${inviteLink}

IMPORTANT: This invitation will expire on ${new Date(expiresAt).toLocaleString()}.
Please complete your account setup before then.

SECURITY NOTICE: Do not share this invitation link with anyone. This link is personal to you and grants access to your account. If you suspect this email was sent in error, contact your administrator immediately.

If you didn't expect this invitation or have questions, please contact your administrator.

---
Employee Attendance System
This is an automated message, please do not reply to this email.
`;
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
        
        const templateData = {
            recipientEmail: email,
            inviteLink,
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
                    return this.sendViaConsole(email, subject, htmlContent, inviteLink);
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
    
    sendViaConsole(to, subject, html, inviteLink) {
        console.log('\n=== EMAIL SENT (CONSOLE MODE) ===');
        console.log(`To: ${to}`);
        console.log(`Subject: ${subject}`);
        console.log(`Invite Link: ${inviteLink}`);
        console.log('=====================================\n');
        return { success: true };
    }
}

// Export singleton instance
module.exports = EmailService;