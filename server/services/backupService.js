const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

function parseDatabaseUrl(databaseUrl) {
  const parsed = new URL(databaseUrl);

  return {
    host: parsed.hostname,
    port: parsed.port || '5432',
    user: decodeURIComponent(parsed.username || 'postgres'),
    password: decodeURIComponent(parsed.password || ''),
    database: parsed.pathname.replace(/^\//, '') || 'postgres'
  };
}

function getPrimaryBackupsDirectory() {
  return path.resolve(__dirname, '..', '..', 'backups');
}

function getBackupsDirectory(customDirectory) {
  const backupsDirectory = path.resolve(customDirectory || getPrimaryBackupsDirectory());
  fs.mkdirSync(backupsDirectory, { recursive: true });
  return backupsDirectory;
}

function getPrimaryBackupListingDirectory() {
  return getBackupsDirectory();
}

function getBackupSearchDirectories() {
  return [getBackupsDirectory()];
}

function getBackupFilePath(fileName) {
  const safeFileName = path.basename(String(fileName || ''));
  if (!safeFileName || safeFileName.includes('..')) {
    throw new Error('Invalid backup file name');
  }

  return path.join(getBackupsDirectory(), safeFileName);
}

function findExistingBackupFilePath(fileName) {
  const safeFileName = path.basename(String(fileName || ''));
  if (!safeFileName || safeFileName.includes('..')) {
    throw new Error('Invalid backup file name');
  }

  for (const backupsDirectory of getBackupSearchDirectories()) {
    const filePath = path.join(backupsDirectory, safeFileName);
    if (fs.existsSync(filePath)) {
      return filePath;
    }
  }

  return null;
}

function formatBackupSize(sizeBytes) {
  if (!Number.isFinite(sizeBytes) || sizeBytes < 0) return 'Unknown';
  if (sizeBytes >= 1024 * 1024) return `${(sizeBytes / (1024 * 1024)).toFixed(2)}MB`;
  if (sizeBytes >= 1024) return `${(sizeBytes / 1024).toFixed(2)}KB`;
  return `${sizeBytes}B`;
}

function getBackupTimestamp(stats) {
  return stats.mtime.toISOString();
}

function listDatabaseBackups() {
  const backupsByName = new Map();

  for (const backupsDirectory of [getPrimaryBackupListingDirectory()]) {
    if (!fs.existsSync(backupsDirectory)) {
      continue;
    }

    const files = fs.readdirSync(backupsDirectory)
      .filter(fileName => fileName.toLowerCase().endsWith('.sql'))
      .map((fileName) => {
        const filePath = path.join(backupsDirectory, fileName);
        const stats = fs.statSync(filePath);
        return {
          fileName,
          filePath,
          sizeBytes: stats.size,
          sizeLabel: formatBackupSize(stats.size),
          createdAt: getBackupTimestamp(stats),
          modifiedAt: getBackupTimestamp(stats),
        };
      });

    for (const backup of files) {
      if (!backupsByName.has(backup.fileName)) {
        backupsByName.set(backup.fileName, backup);
      }
    }
  }

  const files = Array.from(backupsByName.values())
    .sort((left, right) => new Date(right.modifiedAt) - new Date(left.modifiedAt));

  return files;
}

function getBackupMetadata(fileName) {
  const filePath = findExistingBackupFilePath(fileName);
  if (!filePath) {
    return null;
  }

  const stats = fs.statSync(filePath);
  return {
    fileName: path.basename(filePath),
    filePath,
    sizeBytes: stats.size,
    sizeLabel: formatBackupSize(stats.size),
    createdAt: getBackupTimestamp(stats),
    modifiedAt: getBackupTimestamp(stats),
  };
}

function deleteBackupFile(fileName) {
  const safeFileName = path.basename(String(fileName || ''));
  if (!safeFileName || safeFileName.includes('..')) {
    throw new Error('Invalid backup file name');
  }

  let deletedCount = 0;

  for (const backupsDirectory of getBackupSearchDirectories()) {
    const filePath = path.join(backupsDirectory, safeFileName);
    if (!fs.existsSync(filePath)) {
      continue;
    }

    fs.unlinkSync(filePath);
    deletedCount += 1;
  }

  return deletedCount > 0;
}

function enforceBackupRetention(retentionCount) {
  const maxBackups = Number.parseInt(retentionCount, 10);
  if (!Number.isInteger(maxBackups) || maxBackups < 1) {
    return { removed: [], kept: listDatabaseBackups() };
  }

  const backups = listDatabaseBackups();
  const removed = [];

  for (const backup of backups.slice(maxBackups)) {
    if (deleteBackupFile(backup.fileName)) {
      removed.push(backup);
    }
  }

  return {
    removed,
    kept: backups.slice(0, maxBackups),
  };
}

function persistBackupFile(sourceFilePath, fileName) {
  if (!sourceFilePath || !fs.existsSync(sourceFilePath)) {
    throw new Error('Source backup file not found');
  }

  const safeFileName = path.basename(String(fileName || ''));
  if (!safeFileName || safeFileName.includes('..')) {
    throw new Error('Invalid backup file name');
  }

  const destinationFilePath = getBackupFilePath(safeFileName);
  fs.copyFileSync(sourceFilePath, destinationFilePath);

  const stats = fs.statSync(destinationFilePath);
  return {
    fileName: safeFileName,
    filePath: destinationFilePath,
    sizeBytes: stats.size,
    sizeLabel: formatBackupSize(stats.size),
    createdAt: getBackupTimestamp(stats),
    modifiedAt: getBackupTimestamp(stats),
  };
}

function createBackupFileName() {
  const now = new Date();
  const timestamp = new Date().toISOString()
    .replace(/T/, '_')
    .replace(/:/g, '')
    .replace(/\..+$/, '');
  const milliseconds = String(now.getMilliseconds()).padStart(3, '0');

  return `workline_backup_${timestamp}_${milliseconds}.sql`;
}

async function createDatabaseBackup(options = {}) {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not configured');
  }

  const db = parseDatabaseUrl(databaseUrl);
  if (!db.host || !db.database) {
    throw new Error('DATABASE_URL is invalid');
  }

  if (!db.password) {
    throw new Error('DATABASE_URL password is required for backup generation');
  }

  const backupsDirectory = getBackupsDirectory(options.outputDirectory);
  const fileName = createBackupFileName();
  const filePath = path.join(backupsDirectory, fileName);

  await new Promise((resolve, reject) => {
    const output = fs.createWriteStream(filePath, { flags: 'w' });
    const errorChunks = [];

    const child = spawn('pg_dump', [
      '--host', db.host,
      '--port', String(db.port),
      '--username', db.user,
      '--dbname', db.database,
      '--format=plain',
      '--no-owner',
      '--no-privileges',
      '--clean',
      '--if-exists'
    ], {
      env: {
        ...process.env,
        PGPASSWORD: db.password
      }
    });

    child.stdout.pipe(output);
    child.stderr.on('data', (chunk) => {
      errorChunks.push(chunk.toString());
    });

    child.on('error', (error) => {
      output.destroy();
      reject(new Error(`Failed to start pg_dump: ${error.message}`));
    });

    output.on('error', (error) => {
      reject(error);
    });

    child.on('close', (code) => {
      output.end(() => {
        if (code !== 0) {
          const message = errorChunks.join('').trim() || `pg_dump exited with code ${code}`;
          reject(new Error(message));
          return;
        }

        try {
          const stats = fs.statSync(filePath);
          resolve({
            fileName,
            filePath,
            sizeBytes: stats.size,
            createdAt: new Date().toISOString()
          });
        } catch (error) {
          reject(error);
        }
      });
    });
  });

  const stats = fs.statSync(filePath);
  return {
    fileName,
    filePath,
    sizeBytes: stats.size,
    createdAt: new Date().toISOString()
  };
}

module.exports = {
  createDatabaseBackup,
  listDatabaseBackups,
  getBackupMetadata,
  getBackupFilePath,
  deleteBackupFile,
  persistBackupFile,
  enforceBackupRetention,
};