FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY server/package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy server code
COPY server/ ./

# Copy public files
COPY public/ ./public/

# Expose port
EXPOSE 5000

# Start the application
CMD ["node", "server.js"]
