# Use the official Playwright Docker image with all dependencies
FROM mcr.microsoft.com/playwright:v1.53.0-jammy

# Install FFmpeg and additional dependencies
RUN apt-get update && apt-get install -y \
    ffmpeg \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Set working directory (switching back to root for setup)
USER root
WORKDIR /app

# Copy package files first for better Docker layer caching
COPY package*.json ./

# Install Node.js dependencies
RUN npm ci --only=production

# Copy application code
COPY . .

# Change ownership to pwuser (the default Playwright user)
RUN chown -R pwuser:pwuser /app

# Switch to non-root user (pwuser from Playwright image)
USER pwuser

# Environment variables for headless operation
ENV HEADLESS=true

# Expose the application port
EXPOSE 3000

# Health check to ensure the service is running
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:3000/ || exit 1

# Start the application
CMD ["npm", "start"] 