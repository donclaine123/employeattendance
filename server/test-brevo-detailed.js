/**
 * Detailed Brevo Email Service Test
 * Tests the email service to identify why emails aren't being sent
 */

require('dotenv').config();
const EmailService = require('./utils/emailService');

async function testBrevo() {
    console.log('=== BREVO EMAIL SERVICE TEST ===\n');
    
    console.log('Environment Variables:');
    console.log('EMAIL_PROVIDER:', process.env.EMAIL_PROVIDER);
    console.log('BREVO_API_KEY present:', !!process.env.BREVO_API_KEY);
    console.log('BREVO_API_KEY (first 20 chars):', process.env.BREVO_API_KEY?.substring(0, 20) + '...' || 'NOT SET');
    console.log('EMAIL_FROM:', process.env.EMAIL_FROM);
    console.log('BASE_URL:', process.env.BASE_URL);
    console.log('\n');

    try {
        // Create email service instance
        console.log('Creating EmailService instance...');
        const emailService = new EmailService();
        console.log('EmailService created');
        console.log('Provider:', emailService.provider);
        console.log('Brevo API initialized:', !!emailService.brevoApi);
        console.log('\n');

        // Test data
        const testEmail = 'test@example.com';
        const testData = {
            email: testEmail,
            inviteLink: 'https://employeeattendance.me/pages/accept-invite.html?token=test_token_12345',
            roleName: 'Employee',
            inviterName: 'Test Admin',
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
        };

        console.log('Sending test invitation email to:', testEmail);
        console.log('Test data:', testData);
        console.log('\n');

        const result = await emailService.sendInvitationEmail(testData);

        console.log('Result:', result);
        console.log('\n=== TEST COMPLETE ===');

        if (result.success) {
            console.log('✓ Email sent successfully!');
            console.log('Message ID:', result.messageId);
        } else {
            console.log('✗ Email failed to send');
            console.log('Error:', result.error);
        }

    } catch (error) {
        console.error('Test failed with error:', error);
        console.error('Stack:', error.stack);
    }
}

testBrevo();
