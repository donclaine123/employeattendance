# Employee Attendance System - Docker Compose Deployment Guide

## Quick Start (One-Command Deployment)

### Prerequisites
- **Docker Desktop** (includes Docker Engine and Docker Compose)
  - Download: https://www.docker.com/products/docker-desktop
  - Install and start Docker Desktop
- **Git** (to clone the repository)
- **Windows, Mac, or Linux**

### Deploy in 3 Steps

#### Step 1: Clone the Repository
```powershell
git clone https://github.com/donclaine123/employeattendance.git
cd employeattendance
```

#### Step 2: Start Everything with One Command
```powershell
docker-compose up -d
```

This command will:
- ✅ Create PostgreSQL database container
- ✅ Initialize database schema automatically
- ✅ Start Supabase API service
- ✅ Build and start Node.js application
- ✅ Create all network connections

**Wait 30 seconds for all services to start up.**

#### Step 3: Access the Application
- **Frontend**: Open browser → `http://localhost:5000`
- **API**: `http://localhost:5000/api`
- **Database**: `postgresql://postgres:postgres@localhost:54322/postgres`
- **Supabase API**: `http://localhost:54321`

---

## What Gets Deployed

### Services Running

| Service | Container | Port | Purpose |
|---------|-----------|------|---------|
| PostgreSQL | employeeattendance-postgres | 54322 | Database engine |
| Supabase | employeeattendance-supabase | 54321 | Auth & API backend |
| Node.js App | employeeattendance-app | 5000 | Express server |

### Automatic Setup
- Database schema created automatically from `server/postgres/schema_clean.sql`
- All 11 tables initialized with indexes
- Default roles and system settings inserted
- No manual configuration needed

---

## Common Commands

### Check Status
```powershell
docker-compose ps
```

Shows:
- Container names
- Status (Up, Down)
- Port mappings
- Health status

### View Logs
```powershell
# All services
docker-compose logs -f

# Specific service
docker-compose logs -f app
docker-compose logs -f postgres
```

### Restart Services
```powershell
# Restart specific service
docker-compose restart app

# Restart all
docker-compose restart
```

### Stop Everything
```powershell
docker-compose down
```
⚠️ **Note**: Data persists (database kept in volume)

### Complete Cleanup (Delete Everything)
```powershell
docker-compose down -v
```
⚠️ **Warning**: This deletes the database volume

---

## Troubleshooting

### Ports Already in Use
If you get "port already in use" error:

```powershell
# Check what's using the port
netstat -ano | findstr :5000

# Kill the process (replace PID)
taskkill /PID <PID> /F

# Or use different ports in docker-compose.yml:
# Change "5000:5000" to "5001:5000"
# Change "54321:8000" to "54323:8000"
# Change "54322:5432" to "54324:5432"
```

### Services Not Starting
```powershell
# Check logs for errors
docker-compose logs

# Rebuild containers
docker-compose down
docker-compose build --no-cache
docker-compose up -d
```

### Database Connection Failed
```powershell
# Verify PostgreSQL is healthy
docker-compose logs postgres

# Manually test connection
docker-compose exec postgres psql -U postgres -d postgres -c "SELECT 1"
```

### App Can't Connect to Database
```powershell
# Check environment variables
docker-compose exec app env | grep DATABASE_URL

# Verify network connectivity
docker-compose exec app ping postgres
```

---

## Development Workflow

### Making Code Changes

1. **Edit files locally** (in your IDE/editor)
2. **Restart the app container**:
   ```powershell
   docker-compose restart app
   ```
3. **Or enable hot-reload** by modifying `docker-compose.yml`:
   ```yaml
   volumes:
     - ./server:/app/server
     - ./public:/app/public
     - /app/node_modules
   ```

### Accessing Database

#### From Your Local Machine
```powershell
# Using psql (if installed)
psql -h localhost -U postgres -d postgres -p 54322

# Or use any SQL client with:
# Host: localhost
# Port: 54322
# User: postgres
# Password: postgres
# Database: postgres
```

#### From Inside Container
```powershell
docker-compose exec postgres psql -U postgres -d postgres
```

---

## Multi-Device Deployment

### Deploy on Another Computer

**Requirements:**
- Docker Desktop installed
- Internet connection (one-time to download images)

**Steps:**
```powershell
# 1. Clone repository
git clone https://github.com/donclaine123/employeattendance.git
cd employeattendance

# 2. Start services
docker-compose up -d

# 3. Access at http://localhost:5000
```

**That's it!** No additional setup needed.

### Deploy to Team Server

```powershell
# On server machine
git clone https://github.com/donclaine123/employeattendance.git
cd employeattendance
docker-compose up -d
```

Access from other machines:
- Replace `localhost` with server IP: `http://<SERVER_IP>:5000`
- Database: `postgresql://postgres:postgres@<SERVER_IP>:54322/postgres`

---

## Environment Variables

All environment variables are defined in `docker-compose.yml`:

```yaml
NODE_ENV: development           # Development or production
SUPABASE_URL: http://supabase-api:8000
DATABASE_URL: postgresql://postgres:postgres@postgres:5432/postgres
SECRET_KEYS: sb_secret_N7UND0UgjKTVK-Uodkm0Hg_xSvEMPvz
BASE_URL: http://localhost:3000
```

### Customizing

Edit `docker-compose.yml` under the `app` service's `environment` section.

**Example**: Change database password
```yaml
environment:
  ...
  POSTGRES_PASSWORD: your-new-password
  DATABASE_URL: postgresql://postgres:your-new-password@postgres:5432/postgres
```

Then rebuild:
```powershell
docker-compose down
docker-compose up -d --build
```

---

## Performance & Optimization

### Reduce Memory Usage
```yaml
# In docker-compose.yml, add to postgres service:
deploy:
  resources:
    limits:
      memory: 512M
    reservations:
      memory: 256M
```

### Enable Container Auto-Restart
```yaml
# Already configured with:
restart: unless-stopped
```

### Increase Database Connections
Edit `docker-compose.yml`, add to postgres environment:
```yaml
environment:
  POSTGRES_INIT_ARGS: "-c max_connections=200"
```

---

## Offline Operation

✅ **Complete Offline Support**: All services run locally without internet dependency

- Database: Local PostgreSQL ✅
- API: Local Supabase ✅
- Application: Local Node.js ✅
- File Storage: Local volumes ✅

### Email Sending Note
Emails still require internet connection (Brevo SMTP). Configure `BASE_URL` in `docker-compose.yml` for production email links.

---

## Production Deployment

For production deployment:

1. **Use environment file**:
   ```powershell
   # Create .env.production
   NODE_ENV=production
   SUPABASE_URL=https://your-supabase-project.supabase.co
   DATABASE_URL=postgresql://user:password@prod-db-host:5432/db
   SECRET_KEYS=your-secret-key-here
   ```

2. **Update docker-compose.yml**:
   ```yaml
   app:
     env_file: .env.production
   ```

3. **Use non-root user**:
   ```yaml
   user: "node"  # Add to app service
   ```

4. **Enable HTTPS**:
   - Use Nginx reverse proxy
   - Configure SSL certificates

---

## Advanced Usage

### Custom Database Migration
```powershell
# Add SQL file to postgres init
docker cp migrations/custom.sql employeeattendance-postgres:/docker-entrypoint-initdb.d/
docker-compose restart postgres
```

### Using Environment File
```powershell
# Create .env file
echo "NODE_ENV=production" > .env

# Reference in docker-compose.yml
env_file: .env
```

### Multi-Node Setup
For scaling, use Docker Swarm or Kubernetes:
```powershell
docker swarm init
docker stack deploy -c docker-compose.yml employeeattendance
```

---

## Support & Issues

### Check System Requirements
```powershell
# Verify Docker is installed
docker --version

# Verify Docker Compose
docker-compose --version

# Check available disk space
Get-Volume

# Check RAM usage
Get-Process docker | Select-Object Name, @{Label="Memory(MB)"; Expression={[math]::Round($_.WorkingSet/1MB)}}
```

### Common Error Messages

| Error | Solution |
|-------|----------|
| `Cannot connect to Docker daemon` | Start Docker Desktop |
| `Port 5000 already in use` | Change port in docker-compose.yml or kill process |
| `database does not exist` | Check PostgreSQL logs: `docker-compose logs postgres` |
| `Unable to build image` | Run `docker-compose build --no-cache` |
| `Service is unhealthy` | Check logs and wait 30 seconds before retrying |

---

## Quick Reference

```powershell
# Deploy
docker-compose up -d

# Check status
docker-compose ps

# View logs
docker-compose logs -f

# Stop
docker-compose down

# Clean rebuild
docker-compose down -v && docker-compose up -d --build

# Access database
docker-compose exec postgres psql -U postgres -d postgres

# Restart app
docker-compose restart app
```

---

## What's Next?

1. ✅ **Deployed locally**: System fully working offline
2. 📝 **Test features**: Create users, scan QR codes, check attendance
3. 🔄 **Add real-time updates** (WebSocket)
4. ☁️ **Setup sync to cloud** (when internet available)
5. 🌍 **Deploy to team server**

---

**Version**: 1.0  
**Last Updated**: November 23, 2025  
**Tested On**: Windows 11, Docker Desktop 4.x
