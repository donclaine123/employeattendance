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
                        throw new Error('BREVO_API_KEY not provided');
                    }
                    
                    this.brevoApi = new TransactionalEmailsApi();
                    this.brevoApi.setApiKey(TransactionalEmailsApiApiKeys.apiKey, this.brevoApiKey);
                    
                    console.log('[email] Brevo SDK initialized');
                } catch (error) {
                    console.error('[email] Brevo initialization failed:', error.message);
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
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #4CAF50; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
        .content { background: #f9f9f9; padding: 30px; border: 1px solid #ddd; }
        .button { display: inline-block; background: #4CAF50; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; margin: 20px 0; }
        .footer { background: #333; color: white; padding: 20px; text-align: center; font-size: 12px; border-radius: 0 0 8px 8px; }
        .warning { background: #fff3cd; border: 1px solid #ffeaa7; padding: 15px; border-radius: 4px; margin: 20px 0; }
    </style>
</head>
<body>
    <div class="header">
        <h1>Account Invitation</h1>
    </div>
    
    <div class="content">
        <h2>You've been invited to join our Employee Attendance System</h2>
        
        <p>Hello!</p>
        
        <p><strong>${inviterName || 'An administrator'}</strong> has invited you to create an account as a <strong>${roleName}</strong> in our Employee Attendance System.</p>
        
        <p>To complete your account setup, click the button below:</p>
        
        <p style="text-align: center;">
            <a href="${inviteLink}" class="button">Complete Account Setup</a>
        </p>
        
        <p>Or copy and paste this link in your browser:</p>
        <p style="word-break: break-all; background: #fff; padding: 10px; border: 1px solid #ddd;">
            ${inviteLink}
        </p>
        
        <div class="warning">
            <strong>⏰ Important:</strong> This invitation will expire on <strong>${new Date(expiresAt).toLocaleString()}</strong>. 
            Please complete your account setup before then.
        </div>
        
        <p>If you didn't expect this invitation or have questions, please contact your administrator.</p>
    </div>
    
    <div class="footer">
        <p>Employee Attendance System<br>
        This is an automated message, please do not reply to this email.</p>
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
            
            const result = await this.brevoApi.sendTransacEmail(emailData);
            
            console.log(`[email] Brevo: Invitation sent to ${to}, messageId: ${result.body.messageId}`);
            return { success: true, messageId: result.body.messageId };
            
        } catch (error) {
            console.error('[email] Brevo error:', error.message);
            return { success: false, error: error.message };
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