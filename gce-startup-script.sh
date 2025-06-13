#!/bin/bash
# URL-to-RTMP GCE Startup Script

# 1. Update system and install dependencies
apt-get update
apt-get install -y git docker.io docker-compose

# 2. Clone the application repository
# IMPORTANT: Replace with your repository URL
git clone https://github.com/liberator-app/url-to-RTMP.git /opt/url-to-rtmp

# 3. Create the systemd service file to manage the application
cat <<EOF > /etc/systemd/system/url-to-rtmp.service
[Unit]
Description=URL to RTMP Docker Compose Service
Requires=docker.service
After=docker.service

[Service]
Restart=always
RestartSec=10
WorkingDirectory=/opt/url-to-rtmp
ExecStart=/usr/bin/docker-compose up
ExecStop=/usr/bin/docker-compose down

[Install]
WantedBy=multi-user.target
EOF

# 4. Enable the service so it starts on boot
systemctl enable url-to-rtmp.service

# Note: The service will not successfully start until the user creates the .env file.
