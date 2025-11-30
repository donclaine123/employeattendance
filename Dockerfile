FROM node:18-alpine

# Set working directory
WORKDIR /app

# Copy everything from the root into /app
COPY . .

# Change to server directory and install dependencies
WORKDIR /app/server
RUN npm ci --only=production

# Go back to app root
WORKDIR /app

# Expose the application port
EXPOSE 5000

# Start the server
CMD ["node", "server/server.js"]
