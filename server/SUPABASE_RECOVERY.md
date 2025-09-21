# Supabase Project Recreation Guide

If your original project is no longer available, here's how to create a new one:

## 1. Create New Supabase Project
- Go to https://supabase.com/dashboard
- Click "New Project"
- Choose your organization
- Project name: `employee-attendance-system`
- Database password: Generate a strong one (SAVE IT!)
- Region: Choose closest to your users
- Click "Create new project"

## 2. Wait for Project Setup
- Takes 2-3 minutes
- You'll see the dashboard when ready

## 3. Get New Connection String
- Go to Settings → Database
- Copy the "Connection string" (URI format)
- Should look like: postgresql://postgres:[PASSWORD]@db.[NEW-REF].supabase.co:5432/postgres

## 4. Set Up Database Schema
- Go to SQL Editor in Supabase
- Create "New Query"
- Copy the entire content from: server/postgres/schema.sql
- Paste and click "Run"
- Verify tables are created in Table Editor

## 5. Update Connection String
- Update test-supabase-connection.js with new connection string
- Update your Render environment variables
- Test the connection

## 6. Deploy Updated Backend
- Your Render service will auto-deploy with new DATABASE_URL
- Or manually trigger a deploy