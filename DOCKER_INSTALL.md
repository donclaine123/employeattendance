# Install Docker Desktop on Windows

## Option 1: Download Installer (Recommended)

1. Visit: https://www.docker.com/products/docker-desktop
2. Click **Download for Windows**
3. Run `Docker Desktop Installer.exe`
4. Follow installation wizard:
   - ✅ Check: "Use WSL 2 instead of Hyper-V" (for better performance)
   - ✅ Complete installation
5. Restart computer
6. Docker Desktop will start automatically
7. Verify in PowerShell:
   ```powershell
   docker --version
   docker run hello-world
   ```

## Option 2: Windows Package Manager (Quick)

```powershell
# Run as Administrator
winget install -e --id Docker.DockerDesktop
```

## Option 3: Chocolatey

```powershell
# Run as Administrator
choco install docker-desktop
```

## After Installation

1. **Start Docker Desktop** (if not started automatically)
2. **Wait** for Docker engine to fully start (~1-2 minutes)
3. **Verify** it's running:
   ```powershell
   docker ps
   ```
   Should show no errors, even if no containers exist

4. **Then deploy the application**:
   ```powershell
   cd d:\THESIS 1\employeattendance
   docker compose up -d
   ```

## Troubleshooting Installation

### Docker service won't start
```powershell
# Enable Hyper-V (requires admin)
Enable-WindowsOptionalFeature -Online -FeatureName Microsoft-Hyper-V -All

# Or use WSL 2 (recommended)
# https://docs.microsoft.com/en-us/windows/wsl/install
```

### WSL 2 not installed
```powershell
# Install WSL 2
wsl --install
wsl --set-default-version 2
```

### Stuck on Docker startup
- Restart Docker Desktop
- Check: Settings → Resources → Memory allocation (recommend 4GB+)
- Restart computer as last resort

## System Requirements

- **Windows 10/11** (Pro, Enterprise, or Home with WSL 2)
- **Memory**: 4GB minimum (8GB recommended)
- **Disk**: 10GB free space
- **Processor**: Intel/AMD 64-bit (virtualization enabled in BIOS)

Check BIOS: Most modern PCs have virtualization enabled by default.

## Next Steps

Once Docker is installed and running:

```powershell
cd "D:\THESIS 1\employeattendance"
docker compose up -d
```

✅ Done! Access at http://localhost:5000
